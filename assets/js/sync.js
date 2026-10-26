// Sincronización con Firebase (Auth + Firestore, plan Spark).
// Carga app.js solo después de iniciar sesión y descargar los datos.
// Sin configuración o sin SDK, arranca la app en modo local (localStorage).
(() => {
  const cfg = window.ERM_FIREBASE_CONFIG || {};
  const LEGACY_KEY = 'erm-proyecta-state-v1';
  const LOCAL_KEY = 'erm-proyecta-local-v1';
  const DEVICE_KEY = 'erm-proyecta-device-id';
  const SYNC_BRANCHES = ['scenario', 'quote', 'database', 'contacts', 'orders', 'inventory', 'expenses', 'attendance', 'finance'];
  const CHUNK_CHARS = 300000;
  const BLOB_MIN_CHARS = 2000;
  const PUSH_DELAY_MS = 1500;

  const startApp = () => {
    const script = document.createElement('script');
    script.src = `assets/js/app.js?v=${encodeURIComponent(window.ERM_APP_VERSION || Date.now())}`;
    document.body.appendChild(script);
  };

  if (!cfg.apiKey || !cfg.projectId || !window.firebase) {
    if (cfg.apiKey && !window.firebase) console.warn('No se pudo cargar el SDK de Firebase; la app inicia en modo local.');
    startApp();
    return;
  }

  firebase.initializeApp(cfg);
  const auth = firebase.auth();
  const db = firebase.firestore();
  try {
    db.settings({
      cache: firebase.firestore.persistentLocalCache({
        tabManager: firebase.firestore.persistentMultipleTabManager()
      }),
      experimentalAutoDetectLongPolling: true
    });
  } catch (e) { /* ya inicializado o SDK sin soporte; sigue en memoria */ }

  const safeGet = (key) => { try { return localStorage.getItem(key); } catch (e) { return null; } };
  const safeSet = (key, value) => { try { localStorage.setItem(key, value); } catch (e) { console.warn('localStorage no disponible.', e); } };
  let deviceId = safeGet(DEVICE_KEY);
  if (!deviceId) {
    deviceId = `dev-${Math.random().toString(36).slice(2, 10)}`;
    safeSet(DEVICE_KEY, deviceId);
  }

  let uid = null;
  let memory = null;
  let dirty = false;
  let pushTimer = null;
  let pushing = false;
  const lastPushed = {};
  const knownChunks = new Set();

  // ---------- estilos y UI ----------
  const style = document.createElement('style');
  style.textContent = `
    /* Pantalla de entrada con la marca AndiWorks: fondo tinta, ficha blanca y el logo "cortado" por un láser. */
    .sync-login{position:fixed;inset:0;z-index:5000;display:flex;align-items:center;justify-content:center;background:#15181D;padding:32px 16px;overflow-y:auto;font-family:'Barlow',system-ui,sans-serif}
    .sync-login.loading{flex-direction:column;gap:18px;color:#EEF0EE;font:500 13px 'IBM Plex Mono',monospace;letter-spacing:.08em;text-transform:uppercase}
    .sync-login-stack{width:min(420px,100%);display:flex;flex-direction:column;align-items:center;gap:22px}
    .sync-logo{position:relative;width:132px;height:132px}
    .sync-logo img{width:100%;height:100%;display:block;animation:sync-cut 1.6s cubic-bezier(.6,.05,.35,1) both}
    .sync-logo::after{content:"";position:absolute;left:-14%;right:-14%;top:0;height:2px;border-radius:2px;background:#F26A1B;box-shadow:0 0 12px 2px rgba(242,106,27,.75);opacity:0;animation:sync-laser 1.6s cubic-bezier(.6,.05,.35,1) both}
    .sync-logo::before{content:"";position:absolute;inset:-10px;border-radius:50%;border:1px solid #F26A1B;opacity:0;animation:sync-ring 1s ease-out 1.5s both}
    .sync-login.loading .sync-logo img{animation:none}
    .sync-login.loading .sync-logo::after{animation:sync-scan 1.4s ease-in-out infinite alternate}
    .sync-login.loading .sync-logo::before{animation:none}
    @keyframes sync-cut{from{clip-path:inset(0 0 100% 0)}to{clip-path:inset(0 0 0 0)}}
    @keyframes sync-laser{0%{top:0;opacity:1}92%{top:100%;opacity:1}100%{top:100%;opacity:0}}
    @keyframes sync-scan{from{top:8%;opacity:.9}to{top:92%;opacity:.9}}
    @keyframes sync-ring{0%{opacity:0;transform:scale(.92)}15%{opacity:.9}100%{opacity:0;transform:scale(1.14)}}
    @media (prefers-reduced-motion:reduce){.sync-logo img,.sync-logo::after,.sync-logo::before,.sync-login.loading .sync-logo::after{animation:none}}
    .sync-login form{width:100%;box-sizing:border-box;background:#fff;border-radius:6px;padding:32px 28px;display:flex;flex-direction:column;gap:14px;color:#15181D}
    .sync-login-title{display:flex;flex-direction:column;gap:4px;border-top:2px solid #15181D;padding-top:14px}
    .sync-login h2{margin:0;font:800 36px/1 'Barlow Condensed',sans-serif;text-transform:uppercase;letter-spacing:0}
    .sync-login-title span{color:#596069;font-size:15px}
    .sync-login label{font-size:14px;font-weight:600;display:flex;flex-direction:column;gap:6px}
    .sync-login input{height:46px;box-sizing:border-box;padding:0 12px;border:1px solid #9AA1A9;border-radius:4px;font:16px 'Barlow',sans-serif;background:#fff;color:#15181D}
    .sync-login input:focus-visible,.sync-login button:focus-visible{outline:2px solid #F26A1B;outline-offset:2px}
    .sync-login button{min-height:50px;border:0;border-radius:4px;background:#15181D;color:#fff;font:700 16px 'Barlow',sans-serif;cursor:pointer}
    .sync-login button:disabled{opacity:.6;cursor:wait}
    .sync-login .sync-error{color:#b3261e;font-size:14px;font-weight:600;min-height:18px}
    .sync-login-foot{border-top:1px solid #E2E5E3;padding-top:12px;font-size:13px;color:#596069}
    .sync-login-foot b{color:#F26A1B;font-weight:inherit}
    .sync-badge{position:fixed;left:10px;bottom:10px;z-index:4000;display:flex;gap:8px;align-items:center;padding:4px 10px;font-size:12px;border-radius:14px;background:var(--panel,#fff);border:var(--border,1px solid #d5d8de);color:var(--ink,#1c1f26);transition:bottom .15s ease}
    .sync-badge button{border:0;background:none;color:var(--brand,#2563eb);cursor:pointer;font:inherit;padding:0}
    .sync-banner{position:fixed;top:0;left:0;right:0;z-index:5000;padding:8px 14px;text-align:center;font-size:13px;background:#fff3cd;color:#5c4400}
    .sync-banner button{margin-left:8px}
  `;
  document.head.appendChild(style);

  let badge = null;
  const setStatus = (text) => { if (badge) badge.querySelector('span').textContent = text; };
  const ensureBadge = () => {
    if (badge) return;
    badge = document.createElement('div');
    badge.className = 'sync-badge';
    badge.innerHTML = '<span>☁ …</span>';
    document.body.appendChild(badge);
  };

  const signOutSession = async () => {
    if (dirty && !window.confirm('Hay cambios sin sincronizar. ¿Cerrar sesión de todos modos?')) return;
    await auth.signOut();
    window.location.reload();
  };

  const revealSessionPanel = () => {
    const panel = document.getElementById('session-panel');
    if (!panel) return;
    panel.classList.remove('is-hidden');
    panel.setAttribute('aria-hidden', 'false');
    const logoutBtn = document.getElementById('session-logout-btn');
    if (logoutBtn) logoutBtn.addEventListener('click', signOutSession);

    const toggleBtn = document.getElementById('session-toggle-btn');
    const menu = document.getElementById('session-menu');
    if (toggleBtn && menu) {
      toggleBtn.addEventListener('click', (event) => {
        event.stopPropagation();
        const willShow = menu.classList.contains('is-hidden');
        menu.classList.toggle('is-hidden', !willShow);
        toggleBtn.setAttribute('aria-expanded', willShow ? 'true' : 'false');
      });
      document.addEventListener('click', (event) => {
        if (menu.classList.contains('is-hidden')) return;
        if (menu.contains(event.target) || toggleBtn.contains(event.target)) return;
        menu.classList.add('is-hidden');
        toggleBtn.setAttribute('aria-expanded', 'false');
      });
    }
  };

  function showLogin() {
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'sync-login';
      overlay.innerHTML = `
        <div class="sync-login-stack">
          <div class="sync-logo"><img src="assets/logo/logoapp.svg" alt="AndiWorks" /></div>
          <form>
            <div class="sync-login-title">
              <h2>Entrar a AndiApp</h2>
              <span>Tus datos se sincronizan entre el computador y el teléfono.</span>
            </div>
            <label>Correo<input type="email" name="email" placeholder="tu correo" autocomplete="username" required /></label>
            <label>Contraseña<input type="password" name="password" autocomplete="current-password" required /></label>
            <div class="sync-error" role="alert"></div>
            <button type="submit">Ingresar</button>
            <div class="sync-login-foot">AndiApp by AndiWorks<b>.cl</b> · versión ${window.ERM_APP_VERSION || ''}</div>
          </form>
        </div>`;
      document.body.appendChild(overlay);
      const form = overlay.querySelector('form');
      const errorBox = overlay.querySelector('.sync-error');
      const submit = overlay.querySelector('button');
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        submit.disabled = true;
        errorBox.textContent = '';
        try {
          await auth.signInWithEmailAndPassword(form.email.value.trim(), form.password.value);
          overlay.remove();
          resolve();
        } catch (error) {
          errorBox.textContent = 'No se pudo iniciar sesión. Revisa correo y contraseña.';
          submit.disabled = false;
        }
      });
    });
  }

  function showLoading(text) {
    let el = document.querySelector('.sync-login.loading');
    if (!el) {
      el = document.createElement('div');
      el.className = 'sync-login loading';
      el.innerHTML = '<div class="sync-logo"><img src="assets/logo/logoapp.svg" alt="" /></div><span></span>';
      document.body.appendChild(el);
    }
    el.querySelector('span').textContent = text;
    return () => el.remove();
  }

  // ---------- Firestore por trozos (contenido direccionado por hash) ----------
  const chunksCol = () => db.collection('users').doc(uid).collection('chunks');
  const manifestRef = () => db.collection('users').doc(uid).collection('sync').doc('manifest');

  async function sha256(text) {
    const bytes = new TextEncoder().encode(text);
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest)).slice(0, 16).map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  async function putChunked(text) {
    const hash = await sha256(text);
    const total = Math.max(1, Math.ceil(text.length / CHUNK_CHARS));
    for (let i = 0; i < total; i += 1) {
      const id = `${hash}_${i}`;
      if (knownChunks.has(id)) continue;
      await chunksCol().doc(id).set({ d: text.slice(i * CHUNK_CHARS, (i + 1) * CHUNK_CHARS) });
      knownChunks.add(id);
    }
    return { h: hash, n: total };
  }

  async function getChunked(hash, total) {
    const docs = await Promise.all(Array.from({ length: total }, (_, i) => chunksCol().doc(`${hash}_${i}`).get()));
    return docs.map((snap, i) => {
      if (!snap.exists) throw new Error(`Falta el trozo ${hash}_${i}`);
      knownChunks.add(`${hash}_${i}`);
      return snap.data().d;
    }).join('');
  }

  const isBlob = (value) => typeof value === 'string' && value.startsWith('data:') && value.length > BLOB_MIN_CHARS;
  const isToken = (value) => typeof value === 'string' && value.startsWith('ermblob:');

  function collectBlobs(value, out) {
    if (isBlob(value)) out.add(value);
    else if (Array.isArray(value)) value.forEach((item) => collectBlobs(item, out));
    else if (value && typeof value === 'object') Object.values(value).forEach((item) => collectBlobs(item, out));
  }

  function replaceDeep(value, mapper) {
    if (typeof value === 'string') return mapper(value);
    if (Array.isArray(value)) return value.map((item) => replaceDeep(item, mapper));
    if (value && typeof value === 'object') {
      const copy = {};
      Object.keys(value).forEach((key) => { copy[key] = replaceDeep(value[key], mapper); });
      return copy;
    }
    return value;
  }

  async function encodeBranch(branchValue) {
    const blobs = new Set();
    collectBlobs(branchValue, blobs);
    const tokens = new Map();
    for (const blob of blobs) {
      const { h, n } = await putChunked(blob);
      tokens.set(blob, `ermblob:${h}:${n}`);
    }
    return JSON.stringify(replaceDeep(branchValue, (str) => tokens.get(str) || str));
  }

  async function decodeBranch(jsonText) {
    const parsed = JSON.parse(jsonText);
    const tokens = new Set();
    (function walk(value) {
      if (isToken(value)) tokens.add(value);
      else if (Array.isArray(value)) value.forEach(walk);
      else if (value && typeof value === 'object') Object.values(value).forEach(walk);
    })(parsed);
    const resolved = new Map();
    await Promise.all(Array.from(tokens).map(async (token) => {
      const [, h, n] = token.split(':');
      resolved.set(token, await getChunked(h, Number(n)));
    }));
    return replaceDeep(parsed, (str) => (isToken(str) ? resolved.get(str) : str));
  }

  // ---------- pull / push ----------
  async function pull() {
    const snap = await manifestRef().get();
    if (!snap.exists) return null;
    const branches = snap.data().branches || {};
    const result = {};
    await Promise.all(Object.keys(branches).map(async (branch) => {
      const { h, n } = branches[branch];
      const json = await getChunked(h, n);
      result[branch] = await decodeBranch(json);
      lastPushed[branch] = JSON.stringify(result[branch]);
      lastPushed[`ref:${branch}`] = { h, n };
    }));
    return result;
  }

  function scheduleFlush() {
    dirty = true;
    setStatus('☁ Cambios pendientes…');
    clearTimeout(pushTimer);
    pushTimer = setTimeout(flush, PUSH_DELAY_MS);
  }

  async function flush() {
    if (pushing) { scheduleFlush(); return; }
    if (!memory) return;
    pushing = true;
    dirty = false;
    setStatus('☁ Sincronizando…');
    try {
      const update = {};
      const stale = [];
      for (const branch of SYNC_BRANCHES) {
        if (memory[branch] === undefined) continue;
        const current = JSON.stringify(memory[branch]);
        if (current === lastPushed[branch]) continue;
        const ref = await putChunked(await encodeBranch(memory[branch]));
        update[branch] = ref;
        const previous = lastPushed[`ref:${branch}`];
        if (previous && previous.h !== ref.h) stale.push(previous);
        lastPushed[branch] = current;
        lastPushed[`ref:${branch}`] = ref;
      }
      if (Object.keys(update).length) {
        await manifestRef().set({ branches: update, updatedAt: Date.now(), device: deviceId }, { merge: true });
        for (const old of stale) {
          for (let i = 0; i < old.n; i += 1) {
            knownChunks.delete(`${old.h}_${i}`);
            chunksCol().doc(`${old.h}_${i}`).delete().catch(() => {});
          }
        }
      }
      setStatus(dirty ? '☁ Cambios pendientes…' : '☁ Sincronizado');
    } catch (error) {
      console.error('Error al sincronizar con Firebase.', error);
      dirty = true;
      setStatus('⚠ Sin sincronizar (reintentando)');
      clearTimeout(pushTimer);
      pushTimer = setTimeout(flush, 15000);
    } finally {
      pushing = false;
    }
  }

  function watchRemoteChanges() {
    manifestRef().onSnapshot((snap) => {
      if (!snap.exists || snap.metadata.hasPendingWrites) return;
      const branches = snap.data().branches || {};
      const hasRealChange = Object.keys(branches).some((branch) => {
        const known = lastPushed[`ref:${branch}`];
        const incoming = branches[branch];
        return !known || known.h !== incoming.h || known.n !== incoming.n;
      });
      if (!hasRealChange) return;
      if (snap.data().device === deviceId) return;
      if (document.querySelector('.sync-banner')) return;
      const banner = document.createElement('div');
      banner.className = 'sync-banner';
      banner.innerHTML = 'Se actualizaron datos desde otro dispositivo. <button type="button" class="btn btn-soft">Recargar</button>';
      banner.querySelector('button').addEventListener('click', async () => {
        if (dirty) await flush();
        window.location.reload();
      });
      document.body.appendChild(banner);
    }, () => {});
  }

  window.addEventListener('beforeunload', (event) => {
    if (dirty) { event.preventDefault(); event.returnValue = ''; }
  });

  // ---------- arranque ----------
  async function boot() {
    const hideLoading = showLoading('Cargando datos…');
    let remote = null;
    try {
      remote = await pull();
    } catch (error) {
      hideLoading();
      console.error('No se pudieron descargar los datos.', error);
      window.alert('No se pudieron descargar los datos de Firebase. Revisa tu conexión y recarga; no se iniciará la app para no sobrescribir datos.');
      return;
    }

    let seedFromLegacy = false;
    let local = {};
    try { local = JSON.parse(safeGet(LOCAL_KEY) || '{}'); } catch (e) { local = {}; }

    if (remote) {
      memory = { ...remote, ...local };
    } else {
      let legacy = null;
      try { legacy = JSON.parse(safeGet(LEGACY_KEY) || 'null'); } catch (e) { legacy = null; }
      memory = legacy && typeof legacy === 'object' ? legacy : {};
      seedFromLegacy = Boolean(legacy);
      if (legacy) local = { ui: legacy.ui, currentView: legacy.currentView, appName: legacy.appName };
      memory = { ...memory, ...local };
    }

    window.ERMStorage.setBackend({
      read: () => (memory && Object.keys(memory).length ? JSON.stringify(memory) : null),
      write: (state) => {
        memory = state;
        safeSet(LOCAL_KEY, JSON.stringify({ ui: state.ui, currentView: state.currentView, appName: state.appName }));
        scheduleFlush();
      }
    });

    hideLoading();
    ensureBadge();
    revealSessionPanel();
    setStatus('☁ Sincronizado');
    watchRemoteChanges();
    startApp();
    if (seedFromLegacy) scheduleFlush();
  }

  auth.onAuthStateChanged(async (user) => {
    if (uid) return;
    if (!user) {
      await showLogin();
      return;
    }
    uid = user.uid;
    boot();
  });
})();
