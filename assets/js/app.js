(() => {
  const state = window.ERMStorage.load();
  const refs = {};
  const APP_VERSION = String(window.ERM_APP_VERSION || '2.0.0');
  let notesAutoSaveTimer = null;
  let notesDragState = null;
  let attendanceChronoTimer = null;
  let expenseAutoSaveTimers = {};
  const saveFeedbackTimers = {};
  let financeChartObserver = null;

  const AI_PROJECT_CONTEXT_TEXT = `AndiApp · Base IA del proyecto (transferible)

Que es este proyecto
- AndiApp es una plataforma interna de AndiWorks para modelar escenarios, costear trabajos reales y gestionar ordenes de trabajo con criterio operativo.
- Busca evitar presupuestos subvalorados, profesionalizar decisiones de precio y centralizar registro de datos comerciales/tecnicos.

Para que sirve en la practica
- Escenario: define costos fijos, sueldos, eficiencia e IVA.
- Presupuestador: construye una OT con insumos, mano de obra, CIF y logistica.
- Base de datos: mantiene insumos, tipos de producto y ayuda externa.
- Clientes: administra contacto comercial.
- Panel OT: consolida ordenes y seguimiento (incluye PDF boleta/factura en vista previa OT).
- Inventario: controla equipamiento deseado.
- Gastos: administra gastos periodicos y respaldos PDF.
- Asistencia: registra entrada/salida, pausas y edicion de registros.
- Finanzas: libro de ingresos/egresos e IVA.
- Central de respaldos: importa/exporta bases por modulo y descarga global.

Arquitectura tecnica
- App web estatica (solo navegador): index.html + assets/js + assets/css. Sin backend propio ni bundler.
- Estado persistente via ERMStorage: localStorage (clave erm-proyecta-state-v1) o, con Firebase configurado, Firestore mediante sync.js.
- Estado base en ERMDefaults (data.js).
- Calculos centrales en calculations.js.
- UI/eventos en app.js.
- Librerias locales en assets/js/vendor (jspdf, jszip).

Puntos tecnicos criticos
- Calculo de precios: targetPrice usa margen entre 0 y 95% con formula costo/(1-margen).
- Logistica: total integra combustible/peajes/estacionamiento/tiempo y costos extra cuando aplican.
- Respaldos: se usa File System Access API (Guardar como) cuando el navegador la soporta, o descarga estandar.
- PDFs: visor interno embebido y descarga desde el navegador.
- Adjuntos (imagenes/PDF) son data URL dentro del estado; sync.js los separa en trozos de Firestore (sin limite practico de 1 MB por documento).

Criterios de calidad
- No romper logica ni flujos existentes.
- Mantener consistencia visual entre modulos.
- Preferir cambios pequenos, verificables y reversibles.

Instrucciones para cualquier IA nueva
- Leer primero: index.html, assets/js/app.js, assets/js/storage.js, assets/js/data.js, assets/js/calculations.js, assets/css/styles.css.
- Entender state global y ramas: scenario, quote, database, inventory, expenses, contacts, orders, attendance, finance, ui.
- Respetar lenguaje visual actual y no introducir cambios de UX no solicitados.

Objetivo
- Consolidar AndiApp como sistema interno confiable para decidir precios, ejecutar OT con control y conservar historial operacional util para crecer con orden.`;

  const formatCLP = (value, maxDecimals = 0, minDecimals = 0) => new Intl.NumberFormat('es-CL', {
    style: 'currency',
    currency: 'CLP',
    maximumFractionDigits: maxDecimals,
    minimumFractionDigits: minDecimals
  }).format(Number(value) || 0);

  const formatCurrency = (value) => formatCLP(value, 0, 0);
  const formatCurrencySmart = (value) => {
    const num = Number(value) || 0;
    if (!Number.isFinite(num)) return formatCurrency(0);
    const hasDecimals = Math.abs(num % 1) > 0.000001;
    if (Math.abs(num) < 1) return formatCLP(num, 4, hasDecimals ? 2 : 0);
    if (Math.abs(num) < 1000) return formatCLP(num, 2, hasDecimals ? 2 : 0);
    return formatCLP(num, 2, hasDecimals ? 2 : 0);
  };

  const formatNumber = (value, minDecimals = 0, maxDecimals = 0) => {
    const num = Number(value);
    if (!Number.isFinite(num)) return String(value || '');
    return num.toLocaleString('es-CL', {
      minimumFractionDigits: minDecimals,
      maximumFractionDigits: maxDecimals
    });
  };

  const normalizeProviderType = (type) => {
    const normalized = String(type || '').trim().toLowerCase();
    if (normalized === 'particular' || normalized === 'persona') return 'Particular';
    return 'Proveedor';
  };

  const normalizePhoneList = (value) => {
    return String(value || '')
      .split(/[,;|]/)
      .map((item) => item.trim())
      .filter(Boolean)
      .join(', ');
  };

  const formatPercent = (value) => `${((Number(value) || 0) * 100).toFixed(1)}%`;
  const formatPercentInput = (value) => Number(((Number(value) || 0) * 100).toFixed(2));

  // Helpers to format numeric inputs for display (CLP thousands separator)
  const formatInputNumberDisplay = (input) => {
    try {
      const raw = String(input.value || input.dataset.rawValue || '').replace(/\./g, '').replace(/,/g, '.');
      const num = Number(raw);
      if (!Number.isFinite(num)) return;
      input.value = formatNumber(num, 0, 0);
    } catch (e) {
      // ignore
    }
  };

  const unformatInputNumberDisplay = (input) => {
    try {
      const v = String(input.value || '').replace(/\./g, '').replace(/,/g, '.');
      input.dataset.rawValue = v;
      input.value = v;
    } catch (e) {
      // ignore
    }
  };

  const parseClpNumber = (value) => {
    try {
      const str = String(value || '0').replace(/\./g, '').replace(/,/g, '.');
      return Number(str) || 0;
    } catch (e) {
      return 0;
    }
  };

  const uid = (prefix) => `${prefix}-${Math.random().toString(36).slice(2, 9)}`;

  const getByPath = (obj, path) => path.split('.').reduce((acc, part) => acc?.[part], obj);

  const setByPath = (obj, path, value) => {
    const parts = path.split('.');
    const last = parts.pop();
    const target = parts.reduce((acc, part) => acc[part], obj);
    target[last] = value;
  };

  const setByPathSafe = (obj, path, value) => {
    const parts = String(path || '').split('.').filter(Boolean);
    if (!parts.length) return;
    const last = parts.pop();
    let target = obj;
    parts.forEach((part) => {
      if (!target[part] || typeof target[part] !== 'object') target[part] = {};
      target = target[part];
    });
    target[last] = value;
  };

  const deleteByPathSafe = (obj, path) => {
    const parts = String(path || '').split('.').filter(Boolean);
    if (!parts.length) return;
    const last = parts.pop();
    const target = parts.reduce((acc, part) => (acc && acc[part] ? acc[part] : null), obj);
    if (target && typeof target === 'object') delete target[last];
  };

  const deepMerge = (target, source) => {
    if (!source || typeof source !== 'object' || Array.isArray(source)) return target;
    Object.keys(source).forEach((key) => {
      const incoming = source[key];
      if (incoming && typeof incoming === 'object' && !Array.isArray(incoming)) {
        if (!target[key] || typeof target[key] !== 'object' || Array.isArray(target[key])) target[key] = {};
        deepMerge(target[key], incoming);
      } else {
        target[key] = incoming;
      }
    });
    return target;
  };

  const getArrayByPath = (path) => getByPath(state, path) || [];

  const sanitize = (text) => String(text ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');

  function iconSvg(name, className = 'ui-icon') {
    // Iconografía = glifos Unicode monocromos (sin librería de iconos),
    // coherentes con la línea visual de plano técnico.
    const iconByName = {
      plus: '+',
      trash: '×',      // ×  borrar
      broom: '↺',      // ↺  limpiar / reiniciar
      edit: '✎',       // ✎  editar
      upload: '↑',     // ↑  subir
      download: '↓',   // ↓  descargar
      eye: '◉',        // ◉  ver
      eyeClosed: '○',  // ○  oculto
      info: 'ℹ',       // ℹ  info
      close: '×',      // ×  cerrar
      trophy: '★',     // ★  logro
      statusOn: '●',   // ●  activo
      statusOff: '○',  // ○  inactivo
      moon: '☾',       // ☾  tema oscuro
      sun: '☼',        // ☼  tema claro
      lock: '■',       // ■  bloqueado
      unlock: '□',     // □  desbloqueado
      calculator: '▦'  // ▦  calculadora
    };
    const icon = iconByName[name] || iconByName.plus;
    const variantClass = name === 'eyeClosed' ? 'ui-icon-eye-closed' : '';
    return `<span class="${className} ui-icon-emoji ${variantClass}" aria-hidden="true">${icon}</span>`;
  }

  const baseLabels = {
    scenario: 'Base Escenario',
    database: 'Base de Datos interna',
    productTypes: 'Base de Tipos de producto',
    external: 'Base de Proveedores',
    contacts: 'Base de Clientes',
    orders: 'Base de Panel de OT',
    desired: 'Base de Inventario (equipamiento)',
    expenses: 'Base de Gasto',
    attendance: 'Base de Asistencia',
    finance: 'Base de Finanzas'
  };

  function getBackupDateToken(date = new Date()) {
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = String(date.getFullYear()).slice(-2);
    return `${day}_${month}_${year}`;
  }

  function getBackupFileName(baseKey, date = new Date()) {
    const token = getBackupDateToken(date);
    const prefixByBase = {
      scenario: 'ESCENARIO',
      database: 'BASEDEDATOS',
      productTypes: 'TIPOPRODUCTOS',
      external: 'SERVICIOSEXTERNO',
      contacts: 'CLIENTES',
      orders: 'PANELOT',
      inventoryCompany: 'INVENTARIOEMPRESA',
      desired: 'EQUIPAMIENTODESEADO',
      expenses: 'GASTO',
      attendance: 'ASISTENCIA',
      finance: 'FINANZAS'
    };
    const prefix = prefixByBase[baseKey] || 'BASE';
    return `${prefix}_${token}_ANDIAPP.json`;
  }

  function normalizeQuotePrototypeState(quote) {
    if (!quote) return;
    const isPrototype = String(quote.productName || '').trim().toLowerCase() === 'prototipo';
    quote.isPrototype = isPrototype;
    if (isPrototype) {
      quote.customerId = '';
      quote.customerName = '';
      quote.estimatedDeliveryDate = '';
      quote.status = 'Prototipo';
      quote.orderNumber = 'Prototipo';
    } else if (String(quote.orderNumber || '').trim().toLowerCase() === 'prototipo') {
      quote.orderNumber = getNextOrderNumber();
      if (quote.status === 'Prototipo') quote.status = 'Prospecto';
    }
  }

  function dataUrlToBlobSafe(dataUrl) {
    const [header, data] = String(dataUrl || '').split(',');
    const mimeType = header?.match(/data:(.*?);base64/)?.[1] || 'application/octet-stream';
    const binary = atob(data || '');
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return new Blob([bytes], { type: mimeType });
  }

  function createAttachmentRecord(overrides = {}) {
    const sizeBytes = Math.max(0, Number(overrides.sizeBytes || 0) || 0);
    const sizeKb = Number(overrides.sizeKb || Math.round(sizeBytes / 1024) || 0) || 0;
    return {
      id: String(overrides.id || uid('att')),
      fileName: String(overrides.fileName || overrides.originalName || 'documento.pdf'),
      mimeType: String(overrides.mimeType || 'application/octet-stream'),
      sizeBytes,
      sizeKb,
      storagePath: String(overrides.storagePath || ''),
      dataUrl: String(overrides.dataUrl || ''),
      createdAt: String(overrides.createdAt || new Date().toISOString()),
      category: String(overrides.category || '')
    };
  }

  function normalizeAttachments(source) {
    const items = Array.isArray(source) ? source : [];
    return items
      .map((item) => createAttachmentRecord(item))
      .filter((item) => item.fileName && (item.dataUrl || item.storagePath));
  }

  function getOwnerAttachments(owner, legacyResolver = null) {
    const base = normalizeAttachments(owner?.attachments || []);
    if (base.length || typeof legacyResolver !== 'function') return base;
    const legacy = legacyResolver(owner);
    return legacy ? [createAttachmentRecord(legacy)] : [];
  }

  function getPrimaryAttachment(owner, legacyResolver = null) {
    return getOwnerAttachments(owner, legacyResolver)[0] || null;
  }

  async function storeAttachmentFromFile(file, category = '') {
    if (!file) throw new Error('No se recibió archivo para adjuntar.');
    const dataUrl = await readFileAsDataUrl(file);
    return createAttachmentRecord({
      id: uid('att'),
      fileName: file.name || 'documento.bin',
      mimeType: String(file.type || '').trim() || 'application/octet-stream',
      sizeBytes: Number(file.size || 0) || 0,
      storagePath: '',
      dataUrl,
      createdAt: new Date().toISOString(),
      category
    });
  }

  async function resolveAttachmentDataUrl(attachment) {
    return String(attachment?.dataUrl || '');
  }

  function legacyOrderInvoiceAttachment(order) {
    if (!order?.invoicePdfDataUrl) return null;
    return {
      id: uid('att-legacy-order'),
      fileName: order.invoicePdfName || `${order.orderNumber || 'ot'}-boleta.pdf`,
      mimeType: order.invoicePdfMimeType || 'application/pdf',
      sizeKb: Number(order.invoicePdfSizeKb || 0) || 0,
      dataUrl: order.invoicePdfDataUrl,
      category: 'invoice'
    };
  }

  function legacyFinanceAttachment(entry) {
    if (!entry?.pdfDataUrl) return null;
    return {
      id: uid('att-legacy-finance'),
      fileName: entry.pdfName || 'comprobante.pdf',
      mimeType: entry.pdfMimeType || 'application/pdf',
      sizeKb: Number(entry.pdfSizeKb || 0) || 0,
      dataUrl: entry.pdfDataUrl,
      category: 'finance'
    };
  }

  function legacyExpenseAttachment(entry) {
    if (!entry?.pdfDataUrl) return null;
    return {
      id: uid('att-legacy-expense'),
      fileName: entry.pdfName || 'comprobante.pdf',
      mimeType: entry.pdfMimeType || 'application/pdf',
      sizeKb: Number(entry.pdfSizeKb || 0) || 0,
      dataUrl: entry.pdfDataUrl,
      category: 'expense'
    };
  }

  const DESIRED_CATEGORY_SUGGESTIONS = [
    'Herramienta eléctrica',
    'Herramienta manual',
    'Herramienta de medición',
    'Maquinaria',
    'Equipo de seguridad',
    'Accesorio',
    'Consumible',
    'Mobiliario de taller',
    'Equipo informático'
  ];

  const DESIRED_STATUS_OPTIONS = ['Operativo', 'Nuevo', 'Usado', 'En reparación', 'De baja'];

  const defaultDesiredDraft = () => ({
    name: '',
    sku: '',
    category: '',
    brand: '',
    model: '',
    status: 'Operativo',
    purchaseDate: new Date().toISOString().slice(0, 10),
    supplier: '',
    cost: 0,
    location: '',
    notes: '',
    entryDate: new Date().toISOString().slice(0, 10),
    imageDataUrl: '',
    imageName: '',
    imageMimeType: '',
    imageSizeKb: 0,
    offers: []
  });

  function normalizeDesiredItem(item = {}) {
    const notes = String(item.notes || item.description || '');
    const purchaseDate = item.purchaseDate || item.entryDate || new Date().toISOString().slice(0, 10);
    return {
      id: item.id || uid('des'),
      name: String(item.name || '').trim(),
      sku: String(item.sku || ''),
      category: String(item.category || ''),
      brand: String(item.brand || ''),
      model: String(item.model || ''),
      status: String(item.status || 'Operativo'),
      purchaseDate,
      supplier: String(item.supplier || ''),
      cost: Number(item.cost || 0) || 0,
      location: String(item.location || ''),
      notes,
      description: notes,
      entryDate: purchaseDate,
      imageDataUrl: item.imageDataUrl || '',
      imageName: item.imageName || '',
      imageMimeType: item.imageMimeType || '',
      imageSizeKb: Number(item.imageSizeKb || 0) || 0,
      expanded: Boolean(item.expanded),
      offers: Array.isArray(item.offers) ? item.offers.map((offer) => ({
        id: offer.id || uid('off'),
        price: Number(offer.price || 0) || 0,
        link: String(offer.link || ''),
        entryDate: offer.entryDate || new Date().toISOString().slice(0, 10)
      })) : []
    };
  }

  function collectDesiredCategories() {
    const seen = new Map();
    DESIRED_CATEGORY_SUGGESTIONS.forEach((cat) => seen.set(cat.toLowerCase(), cat));
    (state.inventory?.desiredItems || []).forEach((item) => {
      const cat = String(item.category || '').trim();
      if (cat && !seen.has(cat.toLowerCase())) seen.set(cat.toLowerCase(), cat);
    });
    return Array.from(seen.values());
  }

  const expensePeriodConfig = {
    mensual: { label: 'Mensual', entries: 12 },
    trimestral: { label: 'Trimestral', entries: 4 },
    semestral: { label: 'Semestral', entries: 2 },
    anual: { label: 'Anual', entries: 1 }
  };

  const financeCategories = [
    'Ventas',
    'Materiales',
    'Gastos Administrativos',
    'Salida General',
    'Sueldo',
    'Herramientas',
    'Ingreso de Capital',
    'Ahorros (DAP)'
  ];

  // Expense type catalogue — shared by Module 7 cards and Module 9 Gasto entries
  const expenseTypeOptions = [
    { value: 'Gastos Generales',   color: '#2563eb' },
    { value: 'Gastos Tributarios', color: '#f59e0b' },
    { value: 'Gastos Digitales',   color: '#7c3aed' },
    { value: 'Otros gastos',       color: '#6b7280' }
  ];

  function getExpenseTypeColor(type) {
    return expenseTypeOptions.find((t) => t.value === type)?.color || '#6b7280';
  }

  function createFinanceEntry(overrides = {}) {
    return {
      id: overrides.id || uid('fin'),
      date: overrides.date || new Date().toISOString().slice(0, 10),
      category: financeCategories.includes(overrides.category) ? overrides.category : 'Ventas',
      orderId: String(overrides.orderId || ''),
      orderRef: String(overrides.orderRef || ''),
      gastoType: String(overrides.gastoType || ''),
      expenseCardId: String(overrides.expenseCardId || ''),
      employeeId: String(overrides.employeeId || ''),
      employeeRef: String(overrides.employeeRef || ''),
      title: String(overrides.title || ''),
      detail: String(overrides.detail || ''),
      income: Math.max(0, Number(overrides.income || 0) || 0),
      expense: Math.max(0, Number(overrides.expense || 0) || 0),
      ivaIncluded: Boolean(overrides.ivaIncluded),
      savingsEndDate: String(overrides.savingsEndDate || ''),
      attachments: normalizeAttachments(overrides.attachments || []),
      pdfDataUrl: String(overrides.pdfDataUrl || ''),
      pdfName: String(overrides.pdfName || ''),
      pdfMimeType: String(overrides.pdfMimeType || ''),
      pdfSizeKb: Number(overrides.pdfSizeKb || 0) || 0,
      createdAt: overrides.createdAt || new Date().toISOString()
    };
  }

  function buildFinancePrintHTML(allEntries, initialBalance, openingIvaCredit) {
    const now = new Date();
    const fechaGen = now.toLocaleDateString('es-CL', { day: '2-digit', month: 'long', year: 'numeric' });
    const horaGen  = now.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' });

    // Running rows (sorted oldest→newest for correct balance accumulation)
    const runningRows = getFinanceRunningRows(allEntries, initialBalance);
    // Display newest first (reverse)
    const displayRows = [...runningRows].reverse();

    // ── TABLE ROWS ──────────────────────────────────────────────────
    let prevMonth = null;
    const tableRows = displayRows.map((row) => {
      const rowMonth = String(row.date || '').slice(0, 7);
      let monthSep = '';
      if (rowMonth !== prevMonth) {
        prevMonth = rowMonth;
        monthSep = `<tr style="background:#f0f4ff;"><td colspan="7" style="font-size:8pt;font-weight:700;color:#1d4ed8;border:1px solid #c7d2fe;padding:3px 6px;">${sanitize(formatMonthLabel(rowMonth))}</td></tr>`;
      }
      const isSavings = row.category === 'Ahorros (DAP)';
      const isIncome  = Number(row.income) > 0;
      const amountColor = isIncome ? '#15803d' : (isSavings ? '#0891b2' : '#dc2626');
      const ivaAmt = row.ivaIncluded ? Math.round((Number(row.income) > 0 ? Number(row.income) : Number(row.expense) || 0) * 0.19 / 1.19) : 0;
      const balNeg = row.runningBalance < 0;
      return monthSep + `<tr>
        <td style="white-space:nowrap;font-size:8pt;">${sanitize(formatFinanceDate(row.date))}</td>
        <td style="font-size:8pt;">${sanitize(row.category)}</td>
        <td style="max-width:200px;">${sanitize(row.title)}${row.detail ? `<br><span style="font-size:7.5pt;color:#6b7280;">${sanitize(row.detail)}</span>` : ''}</td>
        <td style="text-align:right;color:#15803d;">${Number(row.income) > 0 ? formatCurrency(row.income) : ''}</td>
        <td style="text-align:right;color:${amountColor};">${Number(row.expense) > 0 ? formatCurrency(row.expense) : ''}</td>
        <td style="text-align:right;${balNeg ? 'color:#dc2626;' : ''}">${formatCurrency(row.runningBalance)}</td>
        <td style="text-align:right;color:#6b7280;font-size:8pt;">${ivaAmt > 0 ? formatCurrency(ivaAmt) : ''}</td>
      </tr>`;
    }).join('');

    // ── KPIs ──────────────────────────────────────────────────────────
    const totalIncome  = allEntries.reduce((s, e) => s + (Number(e.income) || 0), 0);
    const totalExpense = allEntries.reduce((s, e) => s + (Number(e.expense) || 0), 0);
    const finalBalance = Number(initialBalance || 0) + totalIncome - totalExpense;
    const printIvaRate = Number(state.scenario?.ivaRate) > 0 ? Number(state.scenario.ivaRate) : 0.19;
    const printIvaLedger = getFinanceIvaLedger(allEntries, openingIvaCredit, printIvaRate);
    const ivaNeto = printIvaLedger.totalToPayHistoric;
    const ivaRemanenteActual = printIvaLedger.currentRemanente;

    const currentMonth = now.toISOString().slice(0, 7);
    const currentMonthEntries = allEntries.filter((e) => String(e.date || '').startsWith(currentMonth));
    const ventasMes   = currentMonthEntries.filter((e) => e.category === 'Ventas').reduce((s, e) => s + (Number(e.income) || 0), 0);
    const egresoOpMes = currentMonthEntries.filter((e) => ['Materiales','Gastos Administrativos','Salida General','Herramientas'].includes(e.category)).reduce((s, e) => s + (Number(e.expense) || 0), 0);
    const sueldosMes  = currentMonthEntries.filter((e) => e.category === 'Sueldo').reduce((s, e) => s + (Number(e.expense) || 0), 0);
    const margenOp    = ventasMes > 0 ? ((ventasMes - egresoOpMes) / ventasMes * 100).toFixed(1) : null;

    const kpiHtml = `
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:20px;">
        ${[
          { label: 'Total ingresos',  val: formatCurrency(totalIncome),  color: '#15803d' },
          { label: 'Total egresos',   val: formatCurrency(totalExpense),  color: '#dc2626' },
          { label: 'Saldo final',     val: formatCurrency(finalBalance),  color: finalBalance >= 0 ? '#1d4ed8' : '#dc2626' },
          { label: 'IVA pagado (histórico, con arrastre)', val: formatCurrency(ivaNeto), color: '#d97706' },
          { label: 'Remanente crédito fiscal hoy', val: formatCurrency(ivaRemanenteActual), color: '#16a34a' },
          { label: `Ventas ${formatMonthLabel(currentMonth)}`, val: formatCurrency(ventasMes), color: '#15803d' },
          { label: `Sueldos ${formatMonthLabel(currentMonth)}`, val: formatCurrency(sueldosMes), color: '#7c3aed' },
          margenOp !== null
            ? { label: `Margen op. ${formatMonthLabel(currentMonth)}`, val: margenOp + '%', color: Number(margenOp) >= 0 ? '#15803d' : '#dc2626' }
            : { label: `Margen op. ${formatMonthLabel(currentMonth)}`, val: 'Sin ventas', color: '#6b7280' },
          { label: 'Saldo inicial', val: formatCurrency(initialBalance || 0), color: '#111' },
        ].map((k) => `
          <div style="border:1px solid #e5e7eb;border-radius:6px;padding:7px 10px;">
            <div style="font-size:7.5pt;color:#6b7280;margin-bottom:2px;">${k.label}</div>
            <div style="font-size:12pt;font-weight:700;color:${k.color};">${k.val}</div>
          </div>`).join('')}
      </div>`;

    // ── CATEGORY TOTALS ──────────────────────────────────────────────
    const catTotals = getFinanceCategoryTotals(allEntries, '');
    const catRows = catTotals.map((ct) => `
      <tr>
        <td>${sanitize(ct.category)}</td>
        <td style="text-align:right;color:#15803d;">${ct.income > 0 ? formatCurrency(ct.income) : '—'}</td>
        <td style="text-align:right;color:#dc2626;">${ct.expense > 0 ? formatCurrency(ct.expense) : '—'}</td>
        <td style="text-align:right;font-weight:700;color:${ct.net >= 0 ? '#15803d' : '#dc2626'};">${formatCurrency(ct.net)}</td>
      </tr>`).join('');

    // ── MONTHLY TOTALS ──────────────────────────────────────────────
    const availMonths = getAvailableFinanceMonths(allEntries);
    let prevMonthInc = null;
    const monthRows = availMonths.map((month) => {
      const me = allEntries.filter((e) => String(e.date || '').startsWith(month));
      const inc = me.reduce((s, e) => s + (Number(e.income) || 0), 0);
      const exp = me.reduce((s, e) => s + (Number(e.expense) || 0), 0);
      const net = inc - exp;
      let varHtml = '—';
      if (prevMonthInc !== null && prevMonthInc !== 0) {
        const varPct = ((inc - prevMonthInc) / prevMonthInc * 100).toFixed(1);
        varHtml = `<span style="color:${Number(varPct) >= 0 ? '#15803d' : '#dc2626'};">${Number(varPct) >= 0 ? '+' : ''}${varPct}%</span>`;
      }
      prevMonthInc = inc;
      return `<tr>
        <td style="white-space:nowrap;">${sanitize(formatMonthLabel(month))}</td>
        <td style="text-align:right;color:#15803d;">${formatCurrency(inc)}</td>
        <td style="text-align:right;color:#dc2626;">${formatCurrency(exp)}</td>
        <td style="text-align:right;font-weight:700;color:${net >= 0 ? '#15803d' : '#dc2626'};">${formatCurrency(net)}</td>
        <td style="text-align:right;">${varHtml}</td>
        <td style="text-align:right;color:#6b7280;">${me.length}</td>
      </tr>`;
    }).join('');

    // ── IVA SUMMARY ──────────────────────────────────────────────────
    const printIvaRatePercent = Math.round(printIvaRate * 100);
    const printIvaFactor = printIvaRate / (1 + printIvaRate);
    const ivaSalesTotal = allEntries.filter((e) => e.ivaIncluded && Number(e.income) > 0).reduce((s, e) => s + (Number(e.income) || 0), 0);
    const ivaBuyTotal   = allEntries.filter((e) => e.ivaIncluded && Number(e.expense) > 0).reduce((s, e) => s + (Number(e.expense) || 0), 0);
    const ivaDebito     = Math.round(ivaSalesTotal * printIvaFactor);
    const ivaCredito    = Math.round(ivaBuyTotal * printIvaFactor);
    const ivaNetoFinal  = ivaNeto;

    // ── CHARTS ───────────────────────────────────────────────────────
    const barChart   = allEntries.length >= 2 ? buildFinanceBarChartSVG(allEntries) : '';
    const donutChart = allEntries.length >= 1 ? buildFinanceDonutSVG(allEntries) : '';

    return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <title>Finanzas — ERM Proyecta</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0;}
    body{font-family:Arial,Helvetica,sans-serif;font-size:10pt;color:#111;background:#fff;}
    h2{font-size:12pt;font-weight:700;border-bottom:2px solid #e5e7eb;padding-bottom:4px;margin-bottom:12px;color:#111;}
    .section{margin-bottom:22px;}
    table{width:100%;border-collapse:collapse;margin-bottom:0;font-size:9pt;}
    .chart-row{display:grid;grid-template-columns:3fr 2fr;gap:16px;align-items:start;}
    .iva-row{display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid #f3f4f6;font-size:9pt;}
    .iva-total{display:flex;justify-content:space-between;padding:6px 0 0;font-weight:700;border-top:2px solid #d1d5db;margin-top:4px;font-size:10pt;}
    .iva-label{font-size:8pt;color:#6b7280;font-weight:700;margin:10px 0 4px;text-transform:uppercase;letter-spacing:.04em;}
    .header{border-bottom:3px solid #1d4ed8;padding-bottom:8px;margin-bottom:20px;}
    .header h1{font-size:16pt;color:#1d4ed8;font-weight:700;}
    .header p{font-size:8.5pt;color:#6b7280;margin-top:3px;}
    .ppm-note{background:#fff7ed;border:1px solid #fed7aa;border-radius:5px;padding:8px 10px;font-size:8.5pt;color:#92400e;margin-top:10px;}
    @media print{
      body{-webkit-print-color-adjust:exact;print-color-adjust:exact;}
      .section{page-break-inside:avoid;}
      .page-break{page-break-before:always;}
      tr{page-break-inside:avoid;}
    }
    @page{size:letter portrait;margin:1.8cm 1.5cm 2cm 1.5cm;}
  </style>
</head>
<body>
  <div class="header">
    <h1>ERM Proyecta — Reporte de Finanzas</h1>
    <p>Generado el ${sanitize(fechaGen)} a las ${sanitize(horaGen)} &nbsp;·&nbsp; ${allEntries.length} movimiento${allEntries.length !== 1 ? 's' : ''}</p>
  </div>

  <!-- KPIs -->
  <div class="section">
    <h2>Indicadores globales</h2>
    ${kpiHtml}
  </div>

  <!-- Gráficos -->
  ${(barChart || donutChart) ? `
  <div class="section">
    <h2>Gráficos</h2>
    <div class="chart-row">
      <div>${barChart}</div>
      <div>${donutChart}</div>
    </div>
  </div>` : ''}

  <!-- Tabla completa -->
  <div class="section page-break">
    <h2>Tabla de movimientos (${allEntries.length} registros)</h2>
    <table>
      <thead>
        <tr>
          <th>Fecha</th>
          <th>Categoría</th>
          <th>Título / Detalle</th>
          <th style="text-align:right;">Ingreso</th>
          <th style="text-align:right;">Egreso</th>
          <th style="text-align:right;">Saldo</th>
          <th style="text-align:right;">IVA</th>
        </tr>
      </thead>
      <tbody>${tableRows}</tbody>
      <tfoot>
        <tr style="background:#f9fafb;font-weight:700;">
          <td colspan="3">Total</td>
          <td style="text-align:right;color:#15803d;">${formatCurrency(totalIncome)}</td>
          <td style="text-align:right;color:#dc2626;">${formatCurrency(totalExpense)}</td>
          <td style="text-align:right;">${formatCurrency(finalBalance)}</td>
          <td></td>
        </tr>
      </tfoot>
    </table>
  </div>

  <!-- Totales por categoría -->
  <div class="section">
    <h2>Totales por categoría</h2>
    <table>
      <thead>
        <tr>
          <th>Categoría</th>
          <th style="text-align:right;">Ingresos</th>
          <th style="text-align:right;">Egresos</th>
          <th style="text-align:right;">Neto</th>
        </tr>
      </thead>
      <tbody>${catRows}</tbody>
    </table>
  </div>

  <!-- Totales por mes -->
  <div class="section">
    <h2>Totales por mes</h2>
    <table>
      <thead>
        <tr>
          <th>Mes</th>
          <th style="text-align:right;">Ingresos</th>
          <th style="text-align:right;">Egresos</th>
          <th style="text-align:right;">Neto</th>
          <th style="text-align:right;">Var. ingresos</th>
          <th style="text-align:right;">Movimientos</th>
        </tr>
      </thead>
      <tbody>${monthRows || '<tr><td colspan="6" style="color:#6b7280;">Sin datos</td></tr>'}</tbody>
    </table>
  </div>

  <!-- Resumen IVA -->
  <div class="section">
    <h2>Resumen IVA (F29)</h2>
    <div class="iva-label">IVA Débito — lo que cobraste de más a tus clientes</div>
    <div class="iva-row"><span>Ventas con IVA incluido (bruto)</span><span>${formatCurrency(ivaSalesTotal)}</span></div>
    <div class="iva-row"><span>IVA débito (${printIvaRatePercent}%)</span><span style="color:#dc2626;font-weight:700;">${formatCurrency(ivaDebito)}</span></div>
    <div class="iva-label" style="margin-top:10px;">IVA Crédito — lo que pagaste en compras con factura</div>
    <div class="iva-row"><span>Compras con factura y con IVA incluido (bruto)</span><span>${formatCurrency(ivaBuyTotal)}</span></div>
    <div class="iva-row"><span>IVA crédito registrado en Finanzas (${printIvaRatePercent}%)</span><span style="color:#15803d;font-weight:700;">${formatCurrency(ivaCredito)}</span></div>
    <div class="iva-row"><span>+ Crédito fiscal inicial (previo a la app, ingresado a mano)</span><span style="color:#15803d;font-weight:700;">${formatCurrency(printIvaLedger.openingCredit)}</span></div>
    <div class="iva-total"><span>IVA efectivamente pagado en total (mes a mes, con arrastre de crédito)</span><span style="color:${ivaNetoFinal > 0 ? '#dc2626' : '#15803d'};">${formatCurrency(ivaNetoFinal)}</span></div>
    <div class="iva-total"><span>Remanente de crédito fiscal disponible hoy</span><span style="color:#15803d;">${formatCurrency(ivaRemanenteActual)}</span></div>
    <div class="ppm-note"><strong>¿Y el PPM?</strong> El PPM es un porcentaje de tus ventas brutas definido individualmente por el SII. Revísalo en tu Carpeta Tributaria en sii.cl o consulta con tu contador.</div>
  </div>
</body>
</html>`;
  }

  function getFinanceRunningRows(entries, initialBalance) {
    const sorted = [...entries].sort((a, b) => {
      const da = a.date || '9999';
      const db = b.date || '9999';
      if (da !== db) return da.localeCompare(db);
      return (a.createdAt || '').localeCompare(b.createdAt || '');
    });
    let running = Number(initialBalance) || 0;
    return sorted.map((entry) => {
      running += (Number(entry.income) || 0) - (Number(entry.expense) || 0);
      return { ...entry, runningBalance: running };
    });
  }

  function getFinanceMonthSummary(entries, monthFilter) {
    const source = monthFilter
      ? entries.filter((e) => String(e.date || '').startsWith(monthFilter))
      : entries;
    const totalIncome = source.reduce((s, e) => s + (Number(e.income) || 0), 0);
    const totalExpense = source.reduce((s, e) => s + (Number(e.expense) || 0), 0);
    const ivaCollected = source
      .filter((e) => e.ivaIncluded && Number(e.income) > 0)
      .reduce((s, e) => s + Math.round((Number(e.income) || 0) * 0.19 / 1.19), 0);
    const ivaCredit = source
      .filter((e) => e.ivaIncluded && Number(e.expense) > 0)
      .reduce((s, e) => s + Math.round((Number(e.expense) || 0) * 0.19 / 1.19), 0);
    const ivaToPay = Math.max(0, ivaCollected - ivaCredit);
    return { totalIncome, totalExpense, ivaCollected, ivaCredit, ivaToPay, count: source.length };
  }

  // Calcula el IVA a declarar mes a mes, arrastrando el remanente de crédito fiscal que no
  // alcanza a usarse (tal como exige la ley: el crédito no usado pasa al período siguiente).
  // openingCredit permite partir con un crédito fiscal previo a la app (ej.: compras/obras
  // anteriores a usar el sistema), que de otro modo la app no tiene forma de conocer porque
  // no está conectada al SII.
  function getFinanceIvaLedger(entries, openingCredit, ivaRate) {
    const rate = Number(ivaRate) > 0 ? Number(ivaRate) : 0.19;
    const ivaFactor = rate / (1 + rate);
    const months = getAvailableFinanceMonths(entries).slice().sort(); // cronológico ascendente
    let carry = Math.max(0, Number(openingCredit) || 0);
    const byMonth = {};

    const rows = months.map((monthKey) => {
      const monthEntries = entries.filter((e) => String(e.date || '').startsWith(monthKey));
      const ivaDebito = monthEntries
        .filter((e) => e.ivaIncluded && Number(e.income) > 0)
        .reduce((s, e) => s + Math.round((Number(e.income) || 0) * ivaFactor), 0);
      const ivaCreditoMes = monthEntries
        .filter((e) => e.ivaIncluded && Number(e.expense) > 0)
        .reduce((s, e) => s + Math.round((Number(e.expense) || 0) * ivaFactor), 0);
      const remanenteInicio = carry;
      const creditoDisponible = remanenteInicio + ivaCreditoMes;
      const ivaToPay = Math.max(0, ivaDebito - creditoDisponible);
      const remanenteFin = Math.max(0, creditoDisponible - ivaDebito);
      carry = remanenteFin;
      const row = { monthKey, ivaDebito, ivaCreditoMes, remanenteInicio, creditoDisponible, ivaToPay, remanenteFin };
      byMonth[monthKey] = row;
      return row;
    });

    return {
      openingCredit: Math.max(0, Number(openingCredit) || 0),
      rows,
      byMonth,
      currentRemanente: carry,
      totalToPayHistoric: rows.reduce((s, r) => s + r.ivaToPay, 0)
    };
  }

  function getFinanceCategoryTotals(entries, categoryFilter) {
    const source = categoryFilter && categoryFilter !== 'Todas'
      ? entries.filter((e) => e.category === categoryFilter)
      : entries;
    const map = {};
    source.forEach((e) => {
      const cat = e.category || 'Varios';
      if (!map[cat]) map[cat] = { income: 0, expense: 0 };
      map[cat].income += Number(e.income) || 0;
      map[cat].expense += Number(e.expense) || 0;
    });
    return Object.entries(map)
      .map(([category, totals]) => ({ category, ...totals, net: totals.income - totals.expense }))
      .sort((a, b) => Math.abs(b.net) - Math.abs(a.net));
  }

  function formatMonthLabel(yyyyMM) {
    const [year, month] = String(yyyyMM || '').split('-');
    if (!year || !month) return yyyyMM || '';
    const monthNames = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
    return `${monthNames[parseInt(month, 10) - 1] || month} ${year}`;
  }

  function formatFinanceDate(isoDate) {
    const value = String(isoDate || '').trim();
    const parts = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (parts) return `${parts[3]}/${parts[2]}/${parts[1]}`;
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) {
      return date.toLocaleDateString('es-CL', { day: '2-digit', month: '2-digit', year: 'numeric' });
    }
    return value || '-';
  }

  function buildFinanceBarChartSVG(entries) {
    const availMonths = getAvailableFinanceMonths(entries).slice(0, 12).reverse();
    if (!availMonths.length) return '<p class="help">Sin datos suficientes para el gráfico.</p>';
    const data = availMonths.map((month) => {
      const me = entries.filter((e) => String(e.date || '').startsWith(month));
      const label = formatMonthLabel(month).split(' ')[0].slice(0, 3) + '\'' + month.slice(2, 4);
      return {
        label,
        income:  me.reduce((s, e) => s + (Number(e.income)  || 0), 0),
        expense: me.reduce((s, e) => s + (Number(e.expense) || 0), 0),
      };
    });
    const maxVal = Math.max(...data.map((d) => Math.max(d.income, d.expense)), 1);
    const W = 560, H = 230, padL = 62, padR = 10, padT = 12, padB = 52;
    const chartW = W - padL - padR;
    const chartH = H - padT - padB;
    const n = data.length;
    const groupW = chartW / n;
    const barW = Math.min(Math.floor(groupW * 0.34), 28);
    const fmtVal = (v) => v >= 1000000 ? (v / 1000000).toFixed(1) + 'M' : v >= 1000 ? (v / 1000).toFixed(0) + 'k' : v.toFixed(0);
    const gridSteps = 4;
    let gridLines = '';
    for (let i = 0; i <= gridSteps; i++) {
      const y = padT + chartH - (i / gridSteps) * chartH;
      const val = maxVal * i / gridSteps;
      gridLines += `<line x1="${padL}" y1="${y.toFixed(1)}" x2="${W - padR}" y2="${y.toFixed(1)}" stroke="#e5e7eb" stroke-width="1" stroke-dasharray="3,3"/>`;
      gridLines += `<text x="${(padL - 4).toFixed(1)}" y="${(y + 3.5).toFixed(1)}" text-anchor="end" font-size="9" fill="#9ca3af">$${fmtVal(val)}</text>`;
    }
    let bars = '';
    let xLabels = '';
    const baseY = padT + chartH;
    data.forEach((d, i) => {
      const cx = padL + i * groupW + groupW / 2;
      const incomeH = Math.max((d.income  / maxVal) * chartH, d.income  > 0 ? 2 : 0);
      const expenseH = Math.max((d.expense / maxVal) * chartH, d.expense > 0 ? 2 : 0);
      const ix = cx - barW - 1;
      const ex = cx + 1;
      bars += `<rect class="fin-anim-bar fin-hoverable-bar" data-fin-tooltip="${d.label} · Ingresos: ${formatCurrency(d.income)}" style="animation-delay:${40 + i * 55}ms" x="${ix.toFixed(1)}" y="${(baseY - incomeH).toFixed(1)}"  width="${barW}" height="${incomeH.toFixed(1)}"  fill="#16a34a" opacity="0.82" rx="2"/>`;
      bars += `<rect class="fin-anim-bar fin-hoverable-bar" data-fin-tooltip="${d.label} · Egresos: ${formatCurrency(d.expense)}" style="animation-delay:${70 + i * 55}ms" x="${ex.toFixed(1)}" y="${(baseY - expenseH).toFixed(1)}" width="${barW}" height="${expenseH.toFixed(1)}" fill="#dc2626" opacity="0.82" rx="2"/>`;
      xLabels += `<text x="${cx.toFixed(1)}" y="${(baseY + 16).toFixed(1)}" text-anchor="middle" font-size="9" fill="#9ca3af">${d.label}</text>`;
    });
    const legend = [
      `<rect x="${padL}"       y="${H - 14}" width="10" height="10" fill="#16a34a" rx="2"/>`,
      `<text x="${padL + 13}"  y="${H - 5}"  font-size="10" fill="#6b7280">Ingresos</text>`,
      `<rect x="${padL + 72}"  y="${H - 14}" width="10" height="10" fill="#dc2626" rx="2"/>`,
      `<text x="${padL + 85}"  y="${H - 5}"  font-size="10" fill="#6b7280">Egresos</text>`,
    ].join('');
    return `<svg class="fin-chart-svg fin-chart-svg-bar" viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;display:block;" xmlns="http://www.w3.org/2000/svg">
      ${gridLines}
      <line x1="${padL}" y1="${padT}" x2="${padL}" y2="${baseY}" stroke="#e5e7eb" stroke-width="1"/>
      <line x1="${padL}" y1="${baseY}" x2="${W - padR}" y2="${baseY}" stroke="#e5e7eb" stroke-width="1"/>
      ${bars}${xLabels}${legend}
    </svg>`;
  }

  // Generic category donut — type: 'income' | 'expense'
  function buildFinanceCategoryDonutSVG(entries, type) {
    const catColors = { Ventas: '#16a34a', Materiales: '#2563eb', 'Gastos Administrativos': '#d97706', 'Salida General': '#b45309', Sueldo: '#7c3aed', Herramientas: '#0891b2', 'Ingreso de Capital': '#059669', 'Ahorros (DAP)': '#0e7490' };
    const amtByCat = {};
    entries.forEach((e) => {
      const amt = type === 'income' ? Number(e.income) : Number(e.expense);
      if (amt > 0) {
        const cat = e.category || 'Varios';
        amtByCat[cat] = (amtByCat[cat] || 0) + amt;
      }
    });
    const total = Object.values(amtByCat).reduce((s, v) => s + v, 0);
    if (!total) return `<p class="help">Sin ${type === 'income' ? 'ingresos' : 'egresos'} registrados.</p>`;
    const cats = Object.entries(amtByCat).sort((a, b) => b[1] - a[1]);
    const cx = 105, cy = 105, r = 80, innerR = 46;
    let startAngle = -Math.PI / 2;
    let paths = '';
    let legendItems = '';
    const fmtShort = (v) => v >= 1000000 ? '$' + (v / 1000000).toFixed(1) + 'M' : v >= 1000 ? '$' + (v / 1000).toFixed(0) + 'k' : '$' + v.toFixed(0);
    if (cats.length === 1) {
      const onlyColor = catColors[cats[0][0]] || '#6b7280';
      paths = `<circle class="fin-anim-slice fin-hoverable-slice" data-fin-tooltip="${cats[0][0]} · 100.0% · ${formatCurrency(cats[0][1])}" style="animation-delay:70ms" cx="${cx}" cy="${cy}" r="${((r + innerR) / 2).toFixed(2)}" fill="none" stroke="${onlyColor}" stroke-width="${(r - innerR).toFixed(2)}" opacity="0.85"/>`;
    } else {
      cats.forEach(([cat, val], i) => {
        const pct = val / total;
        const angle = pct * 2 * Math.PI;
        const endAngle = startAngle + angle;
        const largeArc = angle > Math.PI ? 1 : 0;
        const x1 = cx + r * Math.cos(startAngle), y1 = cy + r * Math.sin(startAngle);
        const x2 = cx + r * Math.cos(endAngle),   y2 = cy + r * Math.sin(endAngle);
        const x3 = cx + innerR * Math.cos(endAngle),   y3 = cy + innerR * Math.sin(endAngle);
        const x4 = cx + innerR * Math.cos(startAngle), y4 = cy + innerR * Math.sin(startAngle);
        const color = catColors[cat] || '#6b7280';
        paths += `<path class="fin-anim-slice fin-hoverable-slice" data-fin-tooltip="${cat} · ${(pct * 100).toFixed(1)}% · ${formatCurrency(val)}" style="animation-delay:${70 + i * 75}ms" d="M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${r} ${r} 0 ${largeArc} 1 ${x2.toFixed(2)} ${y2.toFixed(2)} L ${x3.toFixed(2)} ${y3.toFixed(2)} A ${innerR} ${innerR} 0 ${largeArc} 0 ${x4.toFixed(2)} ${y4.toFixed(2)} Z" fill="${color}" opacity="0.85"/>`;
        startAngle = endAngle;
      });
    }
    cats.forEach(([cat, val], i) => {
      const pct = val / total;
      const color = catColors[cat] || '#6b7280';
      const ly = 26 + i * 27;
      legendItems += `<rect x="218" y="${ly - 11}" width="14" height="14" fill="${color}" rx="3"/>`;
      legendItems += `<text x="238" y="${ly}" font-size="11.5" font-weight="600" fill="var(--text)">${cat}</text>`;
      legendItems += `<text x="238" y="${ly + 15}" font-size="10.5" fill="#9ca3af">${(pct * 100).toFixed(1)}%  ·  <tspan class="fin-anim-number" data-fin-value="${Math.round(val)}" data-fin-format="currency-short">$0</tspan></text>`;
    });
    const centerLabel = `<text x="${cx}" y="${cy - 6}" text-anchor="middle" font-size="10" fill="#9ca3af">Total ${type === 'income' ? 'ingresos' : 'egresos'}</text>`;
    const centerTotal = `<text x="${cx}" y="${cy + 12}" text-anchor="middle" font-size="13" font-weight="700" fill="var(--text)" class="fin-anim-number" data-fin-value="${Math.round(total)}" data-fin-format="currency-short">$0</text>`;
    return `<svg class="fin-chart-svg fin-chart-svg-donut" viewBox="0 0 420 236" style="width:100%;max-width:460px;height:auto;display:block;" xmlns="http://www.w3.org/2000/svg">
      ${paths}${centerLabel}${centerTotal}${legendItems}
    </svg>`;
  }

  // Alias for backward compatibility (print function uses this)
  function buildFinanceDonutSVG(entries) {
    return buildFinanceCategoryDonutSVG(entries, 'expense');
  }

  // Mini donut for one month — compact legend with color + percentage + CLP
  function buildFinanceMiniDonutSVG(entries, type, month) {
    const catColors = { Ventas: '#16a34a', Materiales: '#2563eb', 'Gastos Administrativos': '#d97706', 'Salida General': '#b45309', Sueldo: '#7c3aed', Herramientas: '#0891b2', 'Ingreso de Capital': '#059669', 'Ahorros (DAP)': '#0e7490' };
    const monthEntries = month ? entries.filter((e) => String(e.date || '').startsWith(month)) : entries;
    const amtByCat = {};
    monthEntries.forEach((e) => {
      const amt = type === 'income' ? Number(e.income) : Number(e.expense);
      if (amt > 0) {
        const cat = e.category || 'Varios';
        amtByCat[cat] = (amtByCat[cat] || 0) + amt;
      }
    });
    const total = Object.values(amtByCat).reduce((s, v) => s + v, 0);
    const monthLabel = month ? (formatMonthLabel(month).split(' ')[0].slice(0, 3) + '\'' + month.slice(2, 4)) : '';
    const W = 124, H = 116;
    const cx = 62, cy = 36, r = 28, innerR = 16;
    if (!total) {
      return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;display:block;" xmlns="http://www.w3.org/2000/svg">
        <text x="8" y="11" text-anchor="start" font-size="7.4" font-weight="600" fill="#9ca3af">${monthLabel}</text>
        <circle cx="${cx}" cy="${cy}" r="${(r + innerR) / 2}" fill="none" stroke="#e5e7eb" stroke-width="${r - innerR}"/>
        <text x="${cx}" y="${cy + 4}" text-anchor="middle" font-size="8" fill="#d1d5db">—</text>
        <text x="${cx}" y="86" text-anchor="middle" font-size="8.1" fill="#9ca3af">Sin datos</text>
      </svg>`;
    }
    const cats = Object.entries(amtByCat).sort((a, b) => b[1] - a[1]);
    const legendRows = cats.length <= 2
      ? cats
      : [
        cats[0],
        cats[1],
        ['Otros', cats.slice(2).reduce((s, [, v]) => s + v, 0)]
      ];
    let startAngle = -Math.PI / 2;
    let paths = '';
    let miniLegend = '';
    if (cats.length === 1) {
      const onlyColor = catColors[cats[0][0]] || '#6b7280';
      paths = `<circle class="fin-anim-slice fin-hoverable-slice" data-fin-tooltip="${cats[0][0]} · 100.0% · ${formatCurrency(cats[0][1])}" style="animation-delay:40ms" cx="${cx}" cy="${cy}" r="${((r + innerR) / 2).toFixed(2)}" fill="none" stroke="${onlyColor}" stroke-width="${(r - innerR).toFixed(2)}" opacity="0.85"/>`;
    } else {
      cats.forEach(([cat, val], i) => {
        const pct = val / total;
        const angle = pct * 2 * Math.PI;
        const endAngle = startAngle + angle;
        const largeArc = angle > Math.PI ? 1 : 0;
        const x1 = cx + r * Math.cos(startAngle), y1 = cy + r * Math.sin(startAngle);
        const x2 = cx + r * Math.cos(endAngle),   y2 = cy + r * Math.sin(endAngle);
        const x3 = cx + innerR * Math.cos(endAngle),   y3 = cy + innerR * Math.sin(endAngle);
        const x4 = cx + innerR * Math.cos(startAngle), y4 = cy + innerR * Math.sin(startAngle);
        const color = catColors[cat] || '#6b7280';
        paths += `<path class="fin-anim-slice fin-hoverable-slice" data-fin-tooltip="${cat} · ${(pct * 100).toFixed(1)}% · ${formatCurrency(val)}" style="animation-delay:${40 + i * 60}ms" d="M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${r} ${r} 0 ${largeArc} 1 ${x2.toFixed(2)} ${y2.toFixed(2)} L ${x3.toFixed(2)} ${y3.toFixed(2)} A ${innerR} ${innerR} 0 ${largeArc} 0 ${x4.toFixed(2)} ${y4.toFixed(2)} Z" fill="${color}" opacity="0.85"/>`;
        startAngle = endAngle;
      });
    }
    legendRows.forEach(([cat, val], i) => {
      const color = catColors[cat] || '#6b7280';
      const pct = (val / total) * 100;
      const y = 78 + i * 10;
      miniLegend += `<rect x="22" y="${y - 5}" width="6" height="6" fill="${color}" rx="1.5"/>`;
      miniLegend += `<text x="32" y="${y}" font-size="7.1" fill="#6b7280">${pct.toFixed(1)}%</text>`;
      miniLegend += `<text x="62" y="${y}" font-size="7.1" fill="var(--text)"><tspan class="fin-anim-number" data-fin-value="${Math.round(val)}" data-fin-format="currency-short">$0</tspan></text>`;
    });
    return `<svg class="fin-chart-svg fin-chart-svg-mini-donut" viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;display:block;" xmlns="http://www.w3.org/2000/svg">
      <text x="8" y="11" text-anchor="start" font-size="7.4" font-weight="600" fill="#9ca3af">${monthLabel}</text>
      ${paths}
      ${miniLegend}
      <text x="${cx}" y="${cy + 4}" text-anchor="middle" font-size="8.5" font-weight="600" fill="var(--text)" class="fin-anim-number" data-fin-value="${Math.round(total)}" data-fin-format="currency-short">$0</text>
    </svg>`;
  }

  function formatFinanceAnimatedValue(value, format) {
    const num = Number(value) || 0;
    if (format === 'currency-short') {
      if (num >= 1000000) return '$' + (num / 1000000).toFixed(1) + 'M';
      if (num >= 1000) return '$' + (num / 1000).toFixed(0) + 'k';
      return '$' + Math.round(num);
    }
    if (format === 'hours-1d') {
      return `${num.toFixed(1)}h`;
    }
    if (format === 'hours-0d') {
      return `${Math.round(num)}h`;
    }
    return String(Math.round(num));
  }

  function animateFinanceNumberElement(el, durationMs) {
    const target = Number(el.dataset.finValue || 0);
    const format = el.dataset.finFormat || 'number';
    if (!Number.isFinite(target)) return;
    const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduceMotion) {
      el.textContent = formatFinanceAnimatedValue(target, format);
      return;
    }
    const startAt = performance.now();
    const endAt = startAt + durationMs;
    const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
    const frame = (now) => {
      const t = Math.min(1, (now - startAt) / (endAt - startAt));
      const current = target * easeOutCubic(t);
      el.textContent = formatFinanceAnimatedValue(current, format);
      if (t < 1) requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }

  function isElementMostlyVisible(el, minVisibleRatio = 0.35) {
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    const vh = window.innerHeight || document.documentElement.clientHeight || 0;
    if (rect.height <= 0 || vh <= 0) return false;
    const visiblePx = Math.max(0, Math.min(rect.bottom, vh) - Math.max(rect.top, 0));
    return (visiblePx / rect.height) >= minVisibleRatio;
  }

  function triggerFinanceChartAnimation(svg) {
    if (!svg || svg.dataset.finAnimated === '1') return;
    svg.dataset.finAnimated = '1';
    svg.classList.add('is-in-view');
    const duration = svg.classList.contains('fin-chart-svg-mini-donut') ? 1250 : 1450;
    svg.querySelectorAll('.fin-anim-number').forEach((numEl) => {
      animateFinanceNumberElement(numEl, duration);
    });
  }

  function setupFinanceChartAnimations() {
    if (!refs.mainPanel) return;
    if (financeChartObserver) {
      financeChartObserver.disconnect();
      financeChartObserver = null;
    }
    const allCharts = refs.mainPanel.querySelectorAll('.fin-chart-svg');
    if (!allCharts.length) return;

    allCharts.forEach((svg) => {
      svg.classList.remove('is-in-view');
      svg.dataset.finAnimated = '0';
    });

    const onVisibility = (svg) => {
      const details = svg.closest('details');
      if (details && !details.open) return;
      triggerFinanceChartAnimation(svg);
    };

    financeChartObserver = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting && entry.intersectionRatio >= 0.35) {
          onVisibility(entry.target);
          financeChartObserver.unobserve(entry.target);
        }
      });
    }, { threshold: [0.2, 0.35, 0.6] });

    allCharts.forEach((svg) => {
      financeChartObserver.observe(svg);
    });

    refs.mainPanel.querySelectorAll('.finance-section-details').forEach((details) => {
      details.addEventListener('toggle', () => {
        if (!details.open) return;
        details.querySelectorAll('.fin-chart-svg').forEach((svg) => {
          if (svg.dataset.finAnimated === '1') return;
          if (isElementMostlyVisible(svg, 0.28)) {
            onVisibility(svg);
            if (financeChartObserver) financeChartObserver.unobserve(svg);
          }
        });
      });
    });
  }

  function setupFinanceChartTooltips() {
    if (!refs.mainPanel) return;
    refs.mainPanel.querySelectorAll('.fin-chart-tooltip').forEach((el) => el.remove());

    const tooltip = document.createElement('div');
    tooltip.className = 'fin-chart-tooltip';
    refs.mainPanel.appendChild(tooltip);

    const targets = refs.mainPanel.querySelectorAll('.fin-hoverable-bar, .fin-hoverable-slice');
    if (!targets.length) return;

    const hide = () => {
      tooltip.classList.remove('is-visible');
    };

    const place = (evt) => {
      const pad = 14;
      const x = Math.min((window.innerWidth || 0) - 180, evt.clientX + pad);
      const y = Math.max(8, evt.clientY + pad);
      tooltip.style.left = `${x}px`;
      tooltip.style.top = `${y}px`;
    };

    targets.forEach((el) => {
      const text = el.getAttribute('data-fin-tooltip');
      if (!text) return;

      el.addEventListener('mouseenter', (evt) => {
        tooltip.textContent = text;
        tooltip.classList.add('is-visible');
        place(evt);
      });
      el.addEventListener('mousemove', place);
      el.addEventListener('mouseleave', hide);
      el.addEventListener('blur', hide);
    });
  }

  function getAvailableFinanceMonths(entries) {
    const months = new Set();
    entries.forEach((e) => {
      const m = String(e.date || '').slice(0, 7);
      if (m.length === 7) months.add(m);
    });
    return [...months].sort().reverse();
  }

  function getFinanceQuickOutflowTypes() {
    const raw = Array.isArray(state.ui?.financeQuickOutflowTypes) ? state.ui.financeQuickOutflowTypes : [];
    const unique = [];
    raw.forEach((item) => {
      const type = String(item || '').trim();
      if (!type) return;
      if (!unique.some((t) => t.toLowerCase() === type.toLowerCase())) unique.push(type);
    });
    state.ui.financeQuickOutflowTypes = unique;
    return unique;
  }

  function saveFinanceQuickOutflowType(rawType) {
    const type = String(rawType || '').trim();
    if (!type) return;
    const current = getFinanceQuickOutflowTypes();
    if (current.some((t) => t.toLowerCase() === type.toLowerCase())) return;
    state.ui.financeQuickOutflowTypes = [type, ...current].slice(0, 60);
  }

  function defaultFinanceDraft() {
    // Ventas is the default category — always starts with ivaIncluded = true (legal requirement)
    return createFinanceEntry({ date: new Date().toISOString().slice(0, 10), ivaIncluded: true });
  }

  function handleFinanceOTChange(orderId) {
    const otInfoBox = document.getElementById('fin-ot-info');
    const titleInput = document.getElementById('fin-title');
    const titleActions = document.getElementById('fin-title-actions');

    if (!orderId) {
      if (otInfoBox) otInfoBox.innerHTML = '';
      if (titleActions) titleActions.innerHTML = '';
      return;
    }

    const order = (state.orders || []).find((o) => o.id === orderId);
    if (!order) return;

    const qs = order.quoteSummary || {};
    const totalPrice = Number(qs.effectiveGross || 0);
    const abonoPrice = Math.round(totalPrice * 0.5);

    if (otInfoBox) {
      const hasInvoice = Boolean(getPrimaryAttachment(order, legacyOrderInvoiceAttachment));
      const invoiceStatus = hasInvoice
        ? `<span style="color:#16a34a;font-size:11px;font-weight:600;">✓ Boleta/factura adjunta</span>`
        : `<span style="color:#dc2626;font-size:11px;font-weight:600;">⚠ ¡Sin boleta/factura adjunta!</span>`;
      otInfoBox.innerHTML = `<span style="font-size:11px;color:var(--muted);">Total: <strong style="color:var(--brand)">${formatCurrency(totalPrice)}</strong> &nbsp;·&nbsp; Abono 50%: <strong style="color:var(--brand)">${formatCurrency(abonoPrice)}</strong></span> &nbsp;·&nbsp; ${invoiceStatus}`;
    }

    if (titleInput && !titleInput.value.trim()) {
      titleInput.value = String(order.orderTitle || '').trim();
    }

    if (titleActions) {
      const hasAbono = String(titleInput?.value || '').toLowerCase().includes('abono');
      titleActions.innerHTML = `<button type="button" class="btn btn-soft btn-xs" data-action="toggle-finance-abono">${hasAbono ? '− Quitar "Abono"' : '+ Agregar "Abono"'}</button>`;
    }
  }

  function handleFinanceCategoryChange(category) {
    const contextZone = document.getElementById('fin-context-zone');
    const incomeField = document.getElementById('fin-income');
    const expenseField = document.getElementById('fin-expense');

    // Clear abono button when not Ventas
    if (category !== 'Ventas') {
      const titleActions = document.getElementById('fin-title-actions');
      if (titleActions) titleActions.innerHTML = '';
    }

    // Apply income/expense default locking by category
    if (category === 'Ventas' || category === 'Ingreso de Capital') {
      if (incomeField) incomeField.disabled = false;
      if (expenseField) { expenseField.disabled = true; expenseField.value = '0'; }
    } else if (category === 'Materiales' || category === 'Gastos Administrativos' || category === 'Salida General' || category === 'Sueldo' || category === 'Herramientas' || category === 'Ahorros (DAP)') {
      if (incomeField) { incomeField.disabled = true; incomeField.value = '0'; }
      if (expenseField) expenseField.disabled = false;
    } else {
      if (incomeField) incomeField.disabled = false;
      if (expenseField) expenseField.disabled = false;
    }

    if (!contextZone) return;

    if (category === 'Ventas') {
      // Show OT selector
      const orderOptions = (state.orders || [])
        .slice()
        .sort((a, b) => String(a.orderNumber || '').localeCompare(String(b.orderNumber || ''), 'es', { numeric: true }))
        .map((o) => `<option value="${sanitize(o.id)}" data-ref="${sanitize(o.orderNumber || '')}">${sanitize(o.orderNumber || '')} · ${sanitize(o.orderTitle || '')}</option>`)
        .join('');
      contextZone.innerHTML = `
        <div class="fin-context-field">
          <div>
            <label>OT asociada</label>
            <select id="fin-order"><option value="">Sin OT</option>${orderOptions}</select>
          </div>
          <div id="fin-ot-info"></div>
        </div>`;
    } else if (category === 'Materiales') {
      // Show material group + material picker
      const groups = [...new Set((state.database?.materials || []).map((m) => m.group).filter(Boolean))].sort();
      const groupOptions = groups.map((g) => `<option value="${sanitize(g)}">${sanitize(g)}</option>`).join('');
      const materialOptions = (state.database?.materials || [])
        .filter((m) => !groups.length || m.group === groups[0])
        .map((m) => `<option value="${sanitize(m.name)}" data-id="${sanitize(m.id)}">${sanitize(m.name)}</option>`)
        .join('');
      contextZone.innerHTML = `
        <div class="fin-context-field">
          <div>
            <label>Grupo</label>
            <select id="fin-mat-group">
              <option value="">Sin definir</option>
              ${groupOptions}
            </select>
          </div>
          <div>
            <label>Insumo</label>
            <select id="fin-mat-item">
              <option value="">— elige insumo —</option>
              ${materialOptions}
            </select>
          </div>
        </div>`;
    } else if (category === 'Gastos Administrativos') {
      // Show expense type + expense card picker
      const gastoTypeOpts = expenseTypeOptions.map((t) =>
        `<option value="${sanitize(t.value)}">${sanitize(t.value)}</option>`
      ).join('');
      const allCardOptions = (state.expenses?.cards || [])
        .map((c) => `<option value="${sanitize(c.id)}">${sanitize(c.name)} · ${sanitize(String(c.baseYear || ''))}</option>`)
        .join('');
      contextZone.innerHTML = `
        <div class="fin-context-field">
          <div>
            <label>Tipo de gasto</label>
            <select id="fin-gasto-type">
              <option value="">Sin tipo</option>
              ${gastoTypeOpts}
            </select>
          </div>
          <div>
            <label>Card de gasto</label>
            <select id="fin-gasto-card">
              <option value="">Sin asignar</option>
              ${allCardOptions}
            </select>
          </div>
        </div>`;
    } else if (category === 'Salida General') {
      const quickTypes = getFinanceQuickOutflowTypes();
      const quickTypeOpts = quickTypes
        .map((type) => `<option value="${sanitize(type)}">${sanitize(type)}</option>`)
        .join('');
      contextZone.innerHTML = `
        <div class="fin-context-field">
          <div>
            <label>Tipo guardado</label>
            <select id="fin-salida-general-type-select">
              <option value="">Seleccionar tipo guardado</option>
              ${quickTypeOpts}
            </select>
          </div>
          <div>
            <label>Tipo (manual)</label>
            <input type="text" id="fin-salida-general-type-input" maxlength="80" placeholder="Ej: Bencina, peaje, retiro, caja chica" />
          </div>
        </div>`;
    } else if (category === 'Sueldo') {
      // Show OT selector + employee selector for salary entry
      const sueldoOrderOpts = (state.orders || [])
        .slice()
        .sort((a, b) => String(a.orderNumber || '').localeCompare(String(b.orderNumber || ''), 'es', { numeric: true }))
        .map((o) => `<option value="${sanitize(o.id)}" data-ref="${sanitize(o.orderNumber || '')}" data-title="${sanitize(o.orderTitle || '')}">${sanitize(o.orderNumber || '')} · ${sanitize(o.orderTitle || '')}</option>`)
        .join('');
      const sueldoEmpOpts = (state.scenario?.employees || [])
        .map((e) => `<option value="${sanitize(e.id)}">${sanitize(e.name)}</option>`)
        .join('');
      contextZone.innerHTML = `
        <div class="fin-context-field">
          <div>
            <label>OT asociada</label>
            <select id="fin-sueldo-ot">
              <option value="">Sin OT</option>
              ${sueldoOrderOpts}
            </select>
          </div>
          <div>
            <label>Empleado</label>
            <select id="fin-sueldo-employee">
              <option value="">Sin asignar</option>
              ${sueldoEmpOpts}
            </select>
          </div>
          <div id="fin-sueldo-info" style="align-self:flex-end;"></div>
        </div>`;
    } else if (category === 'Herramientas') {
      contextZone.innerHTML = `
        <div class="fin-context-field">
          <div style="align-self:flex-end;">
            <label>Documento de compra (PDF)</label>
            <div style="display:flex;align-items:center;gap:8px;margin-top:4px;">
              <input type="file" id="fin-herramienta-pdf" accept="application/pdf" style="display:none;" />
              <button type="button" class="btn btn-soft btn-xs" data-action="pick-herramienta-pdf">+ Subir boleta/factura</button>
            </div>
          </div>
        </div>`;
    } else if (category === 'Ingreso de Capital') {
      contextZone.innerHTML = '';
    } else if (category === 'Ahorros (DAP)') {
      const savedDate = state.ui.financeDraft?.savingsEndDate || '';
      contextZone.innerHTML = `
        <div class="fin-context-field">
          <div>
            <label>Fecha de término del depósito</label>
            <input type="date" id="fin-savings-end-date" value="${sanitize(savedDate)}" />
          </div>
        </div>`;
    } else {
      contextZone.innerHTML = '';
    }
  }

  function handleFinanceGastoTypeChange(type) {
    const cardSel = document.getElementById('fin-gasto-card');
    if (!cardSel) return;
    const cards = (state.expenses?.cards || []).filter((c) => !type || c.expenseType === type);
    cardSel.innerHTML = `<option value="">Sin asignar</option>` +
      cards.map((c) => `<option value="${sanitize(c.id)}">${sanitize(c.name)} · ${sanitize(String(c.baseYear || ''))}</option>`).join('');
  }

  function handleFinanceGastoCardChange(cardId) {
    if (!cardId) return;
    const card = (state.expenses?.cards || []).find((c) => c.id === cardId);
    if (!card || !card.expenseType) return;
    const typeSel = document.getElementById('fin-gasto-type');
    if (!typeSel) return;
    // Only auto-fill when type is currently unset
    if (typeSel.value === '') {
      typeSel.value = card.expenseType;
      // Re-populate the card list filtered to this type, keeping the current selection
      const cardSel = document.getElementById('fin-gasto-card');
      if (cardSel) {
        const filtered = (state.expenses?.cards || []).filter((c) => c.expenseType === card.expenseType);
        cardSel.innerHTML = `<option value="">Sin asignar</option>` +
          filtered.map((c) => `<option value="${sanitize(c.id)}" ${c.id === cardId ? 'selected' : ''}>${sanitize(c.name)} · ${sanitize(String(c.baseYear || ''))}</option>`).join('');
      }
    }
  }

  function handleFinanceSueldoOTChange(orderId) {
    const infoBox = document.getElementById('fin-sueldo-info');
    const titleInput = document.getElementById('fin-title');
    const detailInput = document.getElementById('fin-detail');
    const titleActions = document.getElementById('fin-title-actions');
    if (!orderId) {
      if (infoBox) infoBox.innerHTML = '';
      if (titleActions) titleActions.innerHTML = '';
      return;
    }
    const order = (state.orders || []).find((o) => o.id === orderId);
    if (!order) return;
    // Auto-fill title with OT number, detail with OT title
    if (titleInput && !titleInput.value.trim()) {
      titleInput.value = String(order.orderNumber || '').trim();
    }
    if (detailInput && !detailInput.value.trim()) {
      detailInput.value = String(order.orderTitle || '').trim();
    }
    if (titleActions) {
      const hasSueldo = String(titleInput?.value || '').toLowerCase().includes('sueldo');
      titleActions.innerHTML = `<button type="button" class="btn btn-soft btn-xs" data-action="toggle-finance-sueldo">${hasSueldo ? '− Quitar "Sueldo"' : '+ Agregar "Sueldo"'}</button>`;
    }
    _updateFinanceSueldoInfo(order, document.getElementById('fin-sueldo-employee')?.value || '');
  }

  function handleFinanceSueldoEmployeeChange(empId) {
    const otSel = document.getElementById('fin-sueldo-ot');
    const orderId = otSel?.value || '';
    const order = orderId ? (state.orders || []).find((o) => o.id === orderId) : null;
    _updateFinanceSueldoInfo(order, empId);
  }

  function _updateFinanceSueldoInfo(order, empId) {
    const infoBox = document.getElementById('fin-sueldo-info');
    if (!infoBox) return;
    if (!order) { infoBox.innerHTML = ''; return; }
    const qs = order.quoteSummary || {};
    const laborTotal = Number(qs.laborTotal || 0);
    const laborLines = Array.isArray(qs.laborLines) ? qs.laborLines : [];
    const empLines = empId ? laborLines.filter((l) => l.employeeId === empId) : [];
    const empTotal = empLines.reduce((s, l) => s + Number(l.lineTotal || 0), 0);
    const empHours = empLines.reduce((s, l) => s + Number(l.hours || 0), 0);
    let html = `<span style="font-size:11px;color:var(--muted);">Costo M.O. OT: <strong style="color:var(--brand);">${formatCurrency(laborTotal)}</strong>`;
    if (empId && empLines.length > 0) {
      html += ` &nbsp;·&nbsp; Empleado: <strong style="color:var(--brand);">${formatCurrency(empTotal)}</strong> (${empHours.toLocaleString('es-CL', { maximumFractionDigits: 2 })} h)`;
    } else if (empId) {
      html += ` &nbsp;·&nbsp; <span style="color:var(--muted);">Sin horas registradas para este empleado en esta OT</span>`;
    }
    html += '</span>';
    infoBox.innerHTML = html;
    // Also pre-fill expense field with employee amount if available
    const expField = document.getElementById('fin-expense');
    if (expField && empTotal > 0 && Number(expField.value) === 0) {
      expField.value = empTotal;
    }
  }

  function handleFinanceMaterialGroupChange(group) {
    const matItemSel = document.getElementById('fin-mat-item');
    if (!matItemSel) return;
    const mats = (state.database?.materials || []).filter((m) => !group || m.group === group);
    matItemSel.innerHTML = `<option value="">— elige insumo —</option>` +
      mats.map((m) => `<option value="${sanitize(m.name)}" data-id="${sanitize(m.id)}" data-cost="${Number(m.unitCost ?? m.baseCost ?? 0) || 0}">${sanitize(m.name)}</option>`).join('');
  }

  const expenseColorOptions = [
    '#2563eb',
    '#dc2626',
    '#16a34a',
    '#f59e0b',
    '#7c3aed',
    '#0ea5e9',
    '#111827',
    '#f97316'
  ];

  const getExpenseEntryCount = (period) => expensePeriodConfig[period]?.entries || 12;

  function createExpenseEntry(index = 0) {
    return {
      id: uid('exp-entry'),
      label: `Cuota ${index + 1}`,
      amount: 0,
      date: '',
      status: 'no-pagado',
      notes: '',
      attachments: [],
      pdfDataUrl: '',
      pdfName: '',
      pdfMimeType: '',
      pdfSizeKb: 0
    };
  }

  function normalizeExpenseEntries(entries, period) {
    const expected = getExpenseEntryCount(period);
    const source = Array.isArray(entries) ? entries : [];
    return Array.from({ length: expected }, (_, index) => {
      const current = source[index] || createExpenseEntry(index);
      return {
        ...createExpenseEntry(index),
        ...current,
        label: current.label || `Cuota ${index + 1}`,
        amount: Number(current.amount || 0) || 0,
        status: current.status === 'pagado' ? 'pagado' : 'no-pagado',
        notes: String(current.notes || ''),
        attachments: normalizeAttachments(current.attachments || []),
        pdfDataUrl: String(current.pdfDataUrl || ''),
        pdfName: String(current.pdfName || ''),
        pdfMimeType: String(current.pdfMimeType || ''),
        pdfSizeKb: Number(current.pdfSizeKb || 0) || 0
      };
    });
  }

  function createExpenseCard(overrides = {}) {
    const period = expensePeriodConfig[overrides.period] ? overrides.period : 'mensual';
    const entrySource = overrides.entries || [];
    return {
      id: overrides.id || uid('exp-card'),
      name: String(overrides.name || 'Nuevo gasto').trim(),
      color: overrides.color || '#2563eb',
      description: String(overrides.description || ''),
      baseYear: String(overrides.baseYear || new Date().getFullYear()),
      period,
      expenseType: String(overrides.expenseType || ''),
      entries: normalizeExpenseEntries(entrySource, period)
    };
  }

  function getExpenseSummary(card) {
    const entries = card?.entries || [];
    const paidEntries = entries.filter((entry) => entry.status === 'pagado');
    const totalPaid = paidEntries.reduce((sum, entry) => sum + (Number(entry.amount) || 0), 0);
    const totalAmount = entries.reduce((sum, entry) => sum + (Number(entry.amount) || 0), 0);
    const average = entries.length ? totalAmount / entries.length : 0;
    const complete = entries.length > 0 && paidEntries.length === entries.length;
    return {
      totalPaid,
      average,
      paidCount: paidEntries.length,
      totalCount: entries.length,
      complete
    };
  }

  function getAttendancePeople() {
    const externalPeople = [...(state.database.externalResources || [])]
      .filter((item) => String(item?.name || '').trim())
      .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'es'))
      .map((item) => String(item.name || '').trim());
    return ['Andrés', ...externalPeople];
  }

  function toLocalDateValue(dateInput) {
    const date = dateInput instanceof Date ? dateInput : new Date(dateInput || Date.now());
    if (Number.isNaN(date.getTime())) return '';
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  function toLocalTimeValue(dateInput) {
    const date = dateInput instanceof Date ? dateInput : new Date(dateInput || Date.now());
    if (Number.isNaN(date.getTime())) return '';
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${hours}:${minutes}`;
  }

  function formatAttendanceDate(dateInput) {
    const date = new Date(dateInput || '');
    if (Number.isNaN(date.getTime())) return '-';
    return date.toLocaleDateString('es-CL');
  }

  function formatAttendanceTime(dateInput) {
    const date = new Date(dateInput || '');
    if (Number.isNaN(date.getTime())) return '-';
    return date.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' });
  }

  function formatDurationFromMs(valueMs) {
    const safeMs = Math.max(0, Number(valueMs) || 0);
    const totalSeconds = Math.floor(safeMs / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }

  function getAttendancePauseMs(session, nowMs = Date.now()) {
    if (!session) return 0;
    let total = Math.max(0, Number(session.pausedAccumulatedMs) || 0);
    if (session.isPaused && session.pauseStartedAt) {
      const startedAtMs = new Date(session.pauseStartedAt).getTime();
      if (!Number.isNaN(startedAtMs) && nowMs > startedAtMs) {
        total += nowMs - startedAtMs;
      }
    }
    return total;
  }

  function getAttendanceTotalMs(checkInAt, checkOutAt) {
    const checkIn = new Date(checkInAt || '');
    const checkOut = new Date(checkOutAt || '');
    if (Number.isNaN(checkIn.getTime()) || Number.isNaN(checkOut.getTime())) return 0;
    const diffMs = checkOut.getTime() - checkIn.getTime();
    if (!(diffMs > 0)) return 0;
    return diffMs;
  }

  function getAttendanceWorkedMs(checkInAt, checkOutAt, pauseMs = 0) {
    const totalMs = getAttendanceTotalMs(checkInAt, checkOutAt);
    return Math.max(0, totalMs - Math.max(0, Number(pauseMs) || 0));
  }

  function getAttendanceRecordWorkedMs(record) {
    if (!record || typeof record !== 'object') return 0;
    const explicitWorked = Number(record.workedMs);
    if (Number.isFinite(explicitWorked) && explicitWorked >= 0) return explicitWorked;
    return getAttendanceWorkedMs(record.checkInAt, record.checkOutAt, record.pauseMs);
  }

  function getAttendanceRecordTotalMs(record) {
    if (!record || typeof record !== 'object') return 0;
    const explicitTotal = Number(record.totalMs);
    if (Number.isFinite(explicitTotal) && explicitTotal >= 0) return explicitTotal;
    return getAttendanceTotalMs(record.checkInAt, record.checkOutAt);
  }

  function getAttendanceDurationLabel(checkInAt, checkOutAt, pauseMs = 0) {
    const workedMs = getAttendanceWorkedMs(checkInAt, checkOutAt, pauseMs);
    if (!(workedMs > 0)) return '-';
    const totalMinutes = Math.round(workedMs / 60000);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return `${hours}h ${String(minutes).padStart(2, '0')}m`;
  }

  function getAttendancePauseLabel(pauseMs = 0) {
    const totalMinutes = Math.round(Math.max(0, Number(pauseMs) || 0) / 60000);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return `${hours}h ${String(minutes).padStart(2, '0')}m`;
  }

  function getAttendanceWorkSegmentsLabel(segments) {
    const list = Array.isArray(segments) ? segments : [];
    const cleaned = list.filter((seg) => seg && seg.startAt && seg.endAt);
    if (!cleaned.length) return '';
    return cleaned.map((seg) => `${formatAttendanceTime(seg.startAt)}-${formatAttendanceTime(seg.endAt)}`).join(' · ');
  }

  function getAttendanceDailyStats(records) {
    const source = Array.isArray(records) ? records : [];
    const map = {};
    source.forEach((record) => {
      const dayKey = toLocalDateValue(record.checkInAt || '');
      if (!dayKey) return;
      if (!map[dayKey]) {
        map[dayKey] = {
          dayKey,
          label: formatAttendanceDate(record.checkInAt),
          workedMs: 0,
          pauseMs: 0,
          totalMs: 0,
          tramos: 0,
          sessions: 0
        };
      }
      const workedMs = getAttendanceRecordWorkedMs(record);
      const pauseMs = Math.max(0, Number(record.pauseMs) || 0);
      const totalMs = getAttendanceRecordTotalMs(record) || Math.max(0, workedMs + pauseMs);
      const tramos = Array.isArray(record.workSegments) && record.workSegments.length
        ? record.workSegments.filter((seg) => seg && seg.startAt && seg.endAt).length
        : 1;
      map[dayKey].workedMs += workedMs;
      map[dayKey].pauseMs += pauseMs;
      map[dayKey].totalMs += totalMs;
      map[dayKey].tramos += Math.max(1, tramos);
      map[dayKey].sessions += 1;
    });
    return Object.values(map).sort((a, b) => a.dayKey.localeCompare(b.dayKey));
  }

  function buildAttendanceWorkedBarChartSVG(statsInput) {
    const stats = (Array.isArray(statsInput) ? statsInput : []).slice(-18);
    if (!stats.length) return '<p class="help">Sin datos de asistencia para graficar.</p>';
    const W = 620, H = 230, padL = 58, padR = 12, padT = 14, padB = 52;
    const chartW = W - padL - padR;
    const chartH = H - padT - padB;
    const maxVal = Math.max(...stats.map((d) => d.workedMs), 1);
    const stepW = chartW / stats.length;
    const barW = Math.min(24, Math.max(8, Math.floor(stepW * 0.62)));
    const fmtHours = (ms) => `${(ms / 3600000).toFixed(1)}h`;
    let grid = '';
    for (let i = 0; i <= 4; i++) {
      const y = padT + chartH - (i / 4) * chartH;
      const val = maxVal * i / 4;
      grid += `<line x1="${padL}" y1="${y.toFixed(1)}" x2="${W - padR}" y2="${y.toFixed(1)}" stroke="#e5e7eb" stroke-width="1"/>`;
      grid += `<text x="${padL - 5}" y="${(y + 3).toFixed(1)}" text-anchor="end" font-size="9" fill="#9ca3af">${fmtHours(val)}</text>`;
    }
    let bars = '';
    let labels = '';
    const baseY = padT + chartH;
    stats.forEach((d, i) => {
      const x = padL + i * stepW + (stepW - barW) / 2;
      const h = Math.max(2, (d.workedMs / maxVal) * chartH);
      const shortLabel = d.label.split('/').slice(0, 2).join('/');
      bars += `<rect x="${x.toFixed(1)}" y="${(baseY - h).toFixed(1)}" width="${barW}" height="${h.toFixed(1)}" fill="#2563eb" rx="2"><title>${d.label} · Trabajo: ${getAttendancePauseLabel(d.workedMs)}</title></rect>`;
      labels += `<text x="${(x + barW / 2).toFixed(1)}" y="${(baseY + 14).toFixed(1)}" text-anchor="middle" font-size="8.5" fill="#9ca3af">${shortLabel}</text>`;
    });
    return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;display:block;" xmlns="http://www.w3.org/2000/svg">${grid}${bars}${labels}</svg>`;
  }

  function buildAttendanceWorkedVsPauseSVG(statsInput) {
    const stats = (Array.isArray(statsInput) ? statsInput : []).slice(-18);
    if (!stats.length) return '<p class="help">Sin datos de asistencia para graficar.</p>';
    const W = 620, H = 230, padL = 58, padR = 12, padT = 14, padB = 52;
    const chartW = W - padL - padR;
    const chartH = H - padT - padB;
    const maxVal = Math.max(...stats.map((d) => d.totalMs), 1);
    const stepW = chartW / stats.length;
    const barW = Math.min(24, Math.max(8, Math.floor(stepW * 0.62)));
    const fmtHours = (ms) => `${(ms / 3600000).toFixed(1)}h`;
    let grid = '';
    for (let i = 0; i <= 4; i++) {
      const y = padT + chartH - (i / 4) * chartH;
      const val = maxVal * i / 4;
      grid += `<line x1="${padL}" y1="${y.toFixed(1)}" x2="${W - padR}" y2="${y.toFixed(1)}" stroke="#e5e7eb" stroke-width="1"/>`;
      grid += `<text x="${padL - 5}" y="${(y + 3).toFixed(1)}" text-anchor="end" font-size="9" fill="#9ca3af">${fmtHours(val)}</text>`;
    }
    let bars = '';
    let labels = '';
    const baseY = padT + chartH;
    stats.forEach((d, i) => {
      const x = padL + i * stepW + (stepW - barW) / 2;
      const workH = Math.max(0, (d.workedMs / maxVal) * chartH);
      const pauseH = Math.max(0, (d.pauseMs / maxVal) * chartH);
      const shortLabel = d.label.split('/').slice(0, 2).join('/');
      bars += `<rect x="${x.toFixed(1)}" y="${(baseY - workH).toFixed(1)}" width="${barW}" height="${workH.toFixed(1)}" fill="#16a34a" rx="2"><title>${d.label} · Trabajo: ${getAttendancePauseLabel(d.workedMs)}</title></rect>`;
      if (pauseH > 0) {
        bars += `<rect x="${x.toFixed(1)}" y="${(baseY - workH - pauseH).toFixed(1)}" width="${barW}" height="${pauseH.toFixed(1)}" fill="#f59e0b" rx="2"><title>${d.label} · Pausa: ${getAttendancePauseLabel(d.pauseMs)}</title></rect>`;
      }
      labels += `<text x="${(x + barW / 2).toFixed(1)}" y="${(baseY + 14).toFixed(1)}" text-anchor="middle" font-size="8.5" fill="#9ca3af">${shortLabel}</text>`;
    });
    const legend = `<rect x="${padL}" y="${H - 14}" width="10" height="10" fill="#16a34a" rx="2"/><text x="${padL + 13}" y="${H - 5}" font-size="10" fill="#6b7280">Trabajo</text><rect x="${padL + 84}" y="${H - 14}" width="10" height="10" fill="#f59e0b" rx="2"/><text x="${padL + 97}" y="${H - 5}" font-size="10" fill="#6b7280">Pausa</text>`;
    return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;display:block;" xmlns="http://www.w3.org/2000/svg">${grid}${bars}${labels}${legend}</svg>`;
  }

  function buildAttendanceTramosChartSVG(statsInput) {
    const stats = (Array.isArray(statsInput) ? statsInput : []).slice(-18);
    if (!stats.length) return '<p class="help">Sin datos de asistencia para graficar.</p>';
    const W = 620, H = 230, padL = 58, padR = 12, padT = 14, padB = 52;
    const chartW = W - padL - padR;
    const chartH = H - padT - padB;
    const maxVal = Math.max(...stats.map((d) => d.tramos), 1);
    const stepW = chartW / stats.length;
    const barW = Math.min(24, Math.max(8, Math.floor(stepW * 0.52)));
    let bars = '';
    let labels = '';
    const baseY = padT + chartH;
    stats.forEach((d, i) => {
      const x = padL + i * stepW + (stepW - barW) / 2;
      const h = Math.max(2, (d.tramos / maxVal) * chartH);
      const shortLabel = d.label.split('/').slice(0, 2).join('/');
      bars += `<rect x="${x.toFixed(1)}" y="${(baseY - h).toFixed(1)}" width="${barW}" height="${h.toFixed(1)}" fill="#7c3aed" rx="2"><title>${d.label} · Tramos: ${d.tramos}</title></rect>`;
      labels += `<text x="${(x + barW / 2).toFixed(1)}" y="${(baseY + 14).toFixed(1)}" text-anchor="middle" font-size="8.5" fill="#9ca3af">${shortLabel}</text>`;
    });
    return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;display:block;" xmlns="http://www.w3.org/2000/svg">${bars}${labels}</svg>`;
  }

  function buildAttendanceWeeklyTrendSVG(statsInput) {
    const stats = Array.isArray(statsInput) ? statsInput : [];
    if (!stats.length) return '<p class="help">Sin datos de asistencia para graficar.</p>';
    const weekMap = {};
    stats.forEach((d) => {
      const dt = new Date(`${d.dayKey}T00:00:00`);
      if (Number.isNaN(dt.getTime())) return;
      const day = dt.getDay();
      const offset = day === 0 ? -6 : 1 - day;
      const monday = new Date(dt);
      monday.setDate(dt.getDate() + offset);
      const key = toLocalDateValue(monday);
      if (!weekMap[key]) weekMap[key] = { key, workedMs: 0, pauseMs: 0, totalMs: 0, days: 0 };
      weekMap[key].workedMs += d.workedMs;
      weekMap[key].pauseMs += d.pauseMs;
      weekMap[key].totalMs += d.totalMs;
      weekMap[key].days += 1;
    });
    const weeks = Object.values(weekMap)
      .sort((a, b) => a.key.localeCompare(b.key))
      .slice(-10)
      .map((w) => ({
        ...w,
        avgWorkedMs: w.days ? w.workedMs / w.days : 0,
        avgPauseMs: w.days ? w.pauseMs / w.days : 0,
        avgTotalMs: w.days ? w.totalMs / w.days : 0,
        label: formatAttendanceDate(`${w.key}T00:00:00`)
      }));
    if (!weeks.length) return '<p class="help">Sin datos semanales de asistencia.</p>';

    const W = 620, H = 230, padL = 58, padR = 12, padT = 14, padB = 52;
    const chartW = W - padL - padR;
    const chartH = H - padT - padB;
    const maxVal = Math.max(...weeks.map((w) => w.avgTotalMs), 1);
    const stepW = chartW / Math.max(1, weeks.length - 1);
    const yFrom = (ms) => padT + chartH - (ms / maxVal) * chartH;
    const makePath = (field) => weeks.map((w, i) => `${i === 0 ? 'M' : 'L'} ${(padL + i * stepW).toFixed(1)} ${yFrom(w[field]).toFixed(1)}`).join(' ');
    const pWorked = makePath('avgWorkedMs');
    const pPause = makePath('avgPauseMs');
    const pTotal = makePath('avgTotalMs');
    let labels = '';
    weeks.forEach((w, i) => {
      const short = w.label.split('/').slice(0, 2).join('/');
      labels += `<text x="${(padL + i * stepW).toFixed(1)}" y="${(padT + chartH + 14).toFixed(1)}" text-anchor="middle" font-size="8.5" fill="#9ca3af">${short}</text>`;
    });
    const legend = `<rect x="${padL}" y="${H - 14}" width="10" height="10" fill="#16a34a" rx="2"/><text x="${padL + 13}" y="${H - 5}" font-size="10" fill="#6b7280">Prom. trabajo</text><rect x="${padL + 112}" y="${H - 14}" width="10" height="10" fill="#f59e0b" rx="2"/><text x="${padL + 125}" y="${H - 5}" font-size="10" fill="#6b7280">Prom. pausa</text><rect x="${padL + 206}" y="${H - 14}" width="10" height="10" fill="#2563eb" rx="2"/><text x="${padL + 219}" y="${H - 5}" font-size="10" fill="#6b7280">Prom. total</text>`;
    return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;display:block;" xmlns="http://www.w3.org/2000/svg"><path d="${pWorked}" fill="none" stroke="#16a34a" stroke-width="2"/><path d="${pPause}" fill="none" stroke="#f59e0b" stroke-width="2"/><path d="${pTotal}" fill="none" stroke="#2563eb" stroke-width="2"/>${labels}${legend}</svg>`;
  }

  function getAttendanceMonthlyStats(records, yearKey = '') {
    const source = Array.isArray(records) ? records : [];
    const map = {};
    source.forEach((record) => {
      const date = new Date(record.checkInAt || '');
      if (Number.isNaN(date.getTime())) return;
      const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      if (!map[monthKey]) map[monthKey] = { key: monthKey, workedMs: 0, pauseMs: 0, totalMs: 0 };
      const workedMs = getAttendanceRecordWorkedMs(record);
      const pauseMs = Math.max(0, Number(record.pauseMs) || 0);
      const totalMs = getAttendanceRecordTotalMs(record) || Math.max(0, workedMs + pauseMs);
      map[monthKey].workedMs += workedMs;
      map[monthKey].pauseMs += pauseMs;
      map[monthKey].totalMs += totalMs;
    });

    const normalizedYearKey = String(yearKey || '').trim();
    if (/^\d{4}$/.test(normalizedYearKey)) {
      return Array.from({ length: 12 }, (_, index) => {
        const monthKey = `${normalizedYearKey}-${String(index + 1).padStart(2, '0')}`;
        const item = map[monthKey] || { key: monthKey, workedMs: 0, pauseMs: 0, totalMs: 0 };
        const [year] = monthKey.split('-');
        const monthShort = formatMonthLabel(monthKey).split(' ')[0].slice(0, 3);
        return { ...item, key: monthKey, label: `${monthShort}'${String(year).slice(-2)}` };
      });
    }

    return Object.values(map)
      .sort((a, b) => a.key.localeCompare(b.key))
      .slice(-12)
      .map((item) => {
        const [year, month] = item.key.split('-');
        const monthShort = formatMonthLabel(item.key).split(' ')[0].slice(0, 3);
        return { ...item, label: `${monthShort}'${String(year).slice(-2)}` };
      });
  }

  function getAttendanceYearlyStats(records) {
    const source = Array.isArray(records) ? records : [];
    const map = {};
    source.forEach((record) => {
      const date = new Date(record.checkInAt || '');
      if (Number.isNaN(date.getTime())) return;
      const yearKey = String(date.getFullYear());
      if (!map[yearKey]) map[yearKey] = { key: yearKey, workedMs: 0, pauseMs: 0, totalMs: 0 };
      const workedMs = getAttendanceRecordWorkedMs(record);
      const pauseMs = Math.max(0, Number(record.pauseMs) || 0);
      const totalMs = getAttendanceRecordTotalMs(record) || Math.max(0, workedMs + pauseMs);
      map[yearKey].workedMs += workedMs;
      map[yearKey].pauseMs += pauseMs;
      map[yearKey].totalMs += totalMs;
    });
    return Object.values(map)
      .sort((a, b) => a.key.localeCompare(b.key))
      .slice(-8)
      .map((item) => ({ ...item, label: item.key }));
  }

  function getAttendanceLatestMonthKey(records) {
    const source = Array.isArray(records) ? records : [];
    const months = source
      .map((record) => String(record?.checkInAt || '').slice(0, 7))
      .filter((month) => /^\d{4}-\d{2}$/.test(month))
      .sort();
    return months.length ? months[months.length - 1] : '';
  }

  function getAttendanceMonthKeyFromDate(date) {
    const current = date instanceof Date ? date : new Date(date || Date.now());
    if (Number.isNaN(current.getTime())) return '';
    return `${current.getFullYear()}-${String(current.getMonth() + 1).padStart(2, '0')}`;
  }

  function getAttendanceMonthWeekRanges(monthKey) {
    if (!/^\d{4}-\d{2}$/.test(String(monthKey || ''))) return [];
    const [yearStr, monthStr] = String(monthKey).split('-');
    const year = Number(yearStr);
    const monthIndex = Number(monthStr) - 1;
    const startDate = new Date(year, monthIndex, 1);
    const endDate = new Date(year, monthIndex + 1, 0);
    const toMidnight = (dateInput) => {
      const date = new Date(dateInput);
      date.setHours(0, 0, 0, 0);
      return date;
    };
    const getMonday = (dateInput) => {
      const date = toMidnight(dateInput);
      const jsDay = date.getDay();
      const offset = jsDay === 0 ? -6 : 1 - jsDay;
      date.setDate(date.getDate() + offset);
      return date;
    };

    const weeks = [];
    let cursor = getMonday(startDate);
    let weekIndex = 1;
    while (cursor <= endDate) {
      const weekEnd = new Date(cursor);
      weekEnd.setDate(cursor.getDate() + 6);
      if (weekEnd >= startDate) {
        weeks.push({
          key: `week-${weekIndex}`,
          label: `Semana ${weekIndex}`,
          start: new Date(cursor),
          end: new Date(weekEnd)
        });
        weekIndex += 1;
      }
      cursor.setDate(cursor.getDate() + 7);
    }
    return weeks;
  }

  function getAttendanceMonthWeekEntryStats(monthEntryStats, monthKey, weekKey) {
    const stats = Array.isArray(monthEntryStats) ? monthEntryStats : [];
    const weekRanges = getAttendanceMonthWeekRanges(monthKey);
    const selectedWeek = weekRanges.find((week) => week.key === weekKey);
    if (!selectedWeek) return stats;
    const start = new Date(selectedWeek.start);
    const end = new Date(selectedWeek.end);
    return stats.filter((day) => {
      const dayDate = new Date(`${day.dayKey}T00:00:00`);
      return dayDate >= start && dayDate <= end;
    });
  }

  function shiftAttendanceMonthKey(monthKey, monthOffset = 0) {
    if (!/^\d{4}-\d{2}$/.test(String(monthKey || ''))) return '';
    const [yearStr, monthStr] = String(monthKey).split('-');
    const date = new Date(Number(yearStr), Number(monthStr) - 1, 1);
    if (Number.isNaN(date.getTime())) return '';
    date.setMonth(date.getMonth() + Number(monthOffset || 0));
    return getAttendanceMonthKeyFromDate(date);
  }

  function getAttendanceSelectableMonthKeys(records) {
    const source = Array.isArray(records) ? records : [];
    const currentMonthKey = getAttendanceMonthKeyFromDate(new Date());
    const previousMonthKey = shiftAttendanceMonthKey(currentMonthKey, -1);
    const set = new Set(
      source
        .map((record) => String(record?.checkInAt || '').slice(0, 7))
        .filter((month) => /^\d{4}-\d{2}$/.test(month))
    );
    if (currentMonthKey) set.add(currentMonthKey);
    if (previousMonthKey) set.add(previousMonthKey);
    return Array.from(set).sort((a, b) => b.localeCompare(a));
  }

  function getAttendanceMonthlyEntryStats(records, monthKey) {
    const source = Array.isArray(records) ? records : [];
    if (!/^\d{4}-\d{2}$/.test(String(monthKey || ''))) return [];
    const map = {};
    source
      .filter((record) => String(record?.checkInAt || '').startsWith(monthKey))
      .sort((a, b) => new Date(a.checkInAt || 0).getTime() - new Date(b.checkInAt || 0).getTime())
      .forEach((record, idx) => {
        const dt = new Date(record.checkInAt || '');
        if (Number.isNaN(dt.getTime())) return;
        const day = String(dt.getDate()).padStart(2, '0');
        const dayKey = toLocalDateValue(record.checkInAt || '');
        if (!map[dayKey]) {
          map[dayKey] = {
            id: `day-${dayKey}`,
            day,
            dayKey,
            label: `${day}`,
            checkInAt: record.checkInAt,
            workedMs: 0,
            pauseMs: 0,
            totalMs: 0,
            entries: []
          };
        }
        const workedMs = getAttendanceRecordWorkedMs(record);
        const pauseMs = Math.max(0, Number(record.pauseMs) || 0);
        const totalMs = getAttendanceRecordTotalMs(record) || Math.max(0, workedMs + pauseMs);
        map[dayKey].entries.push({
          id: record.id || `entry-${idx}`,
          entryIndex: map[dayKey].entries.length + 1,
          employeeName: String(record.employeeName || ''),
          checkInAt: record.checkInAt,
          checkOutAt: record.checkOutAt,
          workedMs,
          pauseMs,
          totalMs
        });
        map[dayKey].workedMs += workedMs;
        map[dayKey].pauseMs += pauseMs;
        map[dayKey].totalMs += totalMs;
      });

    return Object.values(map)
      .sort((a, b) => a.dayKey.localeCompare(b.dayKey));
  }

  function getAttendanceWeekComparisonStats(recordsInput, monthKey, selectedWeekKey = 'all') {
    const records = Array.isArray(recordsInput) ? recordsInput : [];
    const monthRecords = records
      .filter((record) => String(record?.checkInAt || '').startsWith(String(monthKey || '')))
      .sort((a, b) => new Date(a.checkInAt || 0).getTime() - new Date(b.checkInAt || 0).getTime());
    if (!monthRecords.length) {
      return {
        weekdays: [],
        currentWeekStartKey: '',
        currentWeekEndKey: '',
        previousWeekStartKey: '',
        previousWeekEndKey: ''
      };
    }

    const anchorDate = new Date(monthRecords[monthRecords.length - 1].checkInAt || '');
    if (Number.isNaN(anchorDate.getTime())) {
      return {
        weekdays: [],
        currentWeekStartKey: '',
        currentWeekEndKey: '',
        previousWeekStartKey: '',
        previousWeekEndKey: ''
      };
    }

    const toMidnight = (dateInput) => {
      const date = new Date(dateInput);
      date.setHours(0, 0, 0, 0);
      return date;
    };
    const getMonday = (dateInput) => {
      const date = toMidnight(dateInput);
      const jsDay = date.getDay();
      const offset = jsDay === 0 ? -6 : 1 - jsDay;
      date.setDate(date.getDate() + offset);
      return date;
    };
    const shiftDays = (dateInput, days) => {
      const date = new Date(dateInput);
      date.setDate(date.getDate() + days);
      return date;
    };

    const weekRanges = getAttendanceMonthWeekRanges(monthKey);
    const selectedWeek = selectedWeekKey && selectedWeekKey !== 'all'
      ? weekRanges.find((week) => week.key === selectedWeekKey)
      : null;

    const currentWeekStart = selectedWeek ? toMidnight(selectedWeek.start) : getMonday(anchorDate);
    const currentWeekEnd = selectedWeek ? toMidnight(selectedWeek.end) : shiftDays(currentWeekStart, 6);
    const previousWeekStart = shiftDays(currentWeekStart, -7);
    const previousWeekEnd = shiftDays(previousWeekStart, 6);
    const currentWeekLimit = shiftDays(currentWeekStart, 7);
    const previousWeekLimit = new Date(currentWeekStart);

    const weekdayLabels = ['Lun', 'Mar', 'Mie', 'Jue', 'Vie', 'Sab', 'Dom'];
    const weekdays = weekdayLabels.map((label, index) => ({
      id: `weekday-${index + 1}`,
      weekdayIndex: index + 1,
      label,
      currentWorkedMs: 0,
      currentPauseMs: 0,
      currentTotalMs: 0,
      previousWorkedMs: 0,
      currentEntries: []
    }));

    monthRecords.forEach((record, recordIdx) => {
      const date = new Date(record?.checkInAt || '');
      if (Number.isNaN(date.getTime())) return;
      const day = toMidnight(date);
      const jsDay = day.getDay();
      const weekdayIndex = jsDay === 0 ? 6 : jsDay - 1;
      const target = weekdays[weekdayIndex];
      if (!target) return;

      const workedMs = getAttendanceRecordWorkedMs(record);
      const pauseMs = Math.max(0, Number(record.pauseMs) || 0);
      const totalMs = getAttendanceRecordTotalMs(record) || Math.max(0, workedMs + pauseMs);

      if (day >= currentWeekStart && day < currentWeekLimit) {
        target.currentEntries.push({
          id: record.id || `week-current-entry-${recordIdx}`,
          entryIndex: target.currentEntries.length + 1,
          employeeName: String(record.employeeName || ''),
          checkInAt: record.checkInAt,
          checkOutAt: record.checkOutAt,
          workedMs,
          pauseMs,
          totalMs
        });
        target.currentWorkedMs += workedMs;
        target.currentPauseMs += pauseMs;
        target.currentTotalMs += totalMs;
      } else if (day >= previousWeekStart && day < previousWeekLimit) {
        target.previousWorkedMs += workedMs;
      }
    });

    weekdays.forEach((item) => {
      item.currentEntries.sort((a, b) => new Date(a.checkInAt || 0).getTime() - new Date(b.checkInAt || 0).getTime());
      item.currentEntries.forEach((entry, idx) => {
        entry.entryIndex = idx + 1;
      });
    });

    return {
      weekdays,
      currentWeekStartKey: toLocalDateValue(currentWeekStart),
      currentWeekEndKey: toLocalDateValue(currentWeekEnd),
      previousWeekStartKey: toLocalDateValue(previousWeekStart),
      previousWeekEndKey: toLocalDateValue(previousWeekEnd)
    };
  }

  function buildAttendanceWeekdayEntriesBarsSVG(recordsInput, monthKey, selectedWeekKey = 'all') {
    const weekStats = getAttendanceWeekComparisonStats(recordsInput, monthKey, selectedWeekKey);
    const weekdays = weekStats.weekdays;
    const hasData = weekdays.some((day) => day.currentTotalMs > 0 || day.previousWorkedMs > 0);
    if (!hasData) return '<p class="help">Sin datos suficientes para comparar semana actual y anterior.</p>';

    const totalCurrentWeekMs = weekdays.reduce((sum, day) => sum + day.currentTotalMs, 0);
    const totalPreviousWeekMs = weekdays.reduce((sum, day) => sum + day.previousWorkedMs, 0);
    const chartItems = [
      ...weekdays,
      {
        id: 'weekday-total',
        label: 'Total',
        isTotal: true,
        currentTotalMs: totalCurrentWeekMs,
        previousWorkedMs: totalPreviousWeekMs,
        currentEntries: []
      }
    ];

    const W = 620, H = 188, padL = 44, padR = 10, padT = 14, padB = 42;
    const chartW = W - padL - padR;
    const chartH = H - padT - padB;
    const weekdayLabels = ['Lun', 'Mar', 'Mie', 'Jue', 'Vie', 'Sab', 'Dom'];
    const currentWeekDateLabels = weekStats.currentWeekStartKey ? Array.from({ length: weekdays.length }, (_, index) => {
      const dayDate = new Date(`${weekStats.currentWeekStartKey}T00:00:00`);
      dayDate.setDate(dayDate.getDate() + index);
      const day = String(dayDate.getDate()).padStart(2, '0');
      const month = String(dayDate.getMonth() + 1).padStart(2, '0');
      return `${day}/${month}`;
    }) : [];
    const maxDailyVal = Math.max(...weekdays.map((d) => Math.max(d.currentTotalMs, d.previousWorkedMs)), 1);
    const maxVal = maxDailyVal;
    const stepW = chartW / chartItems.length;
    const barW = Math.min(22, Math.max(10, Math.floor(stepW * 0.56)));
    const baseY = padT + chartH;
    const entryColors = ['#16a34a', '#0ea5a4', '#0f766e', '#14532d', '#22c55e'];
    let bars = '';
    let labels = '';
    let previousPoints = '';

    chartItems.forEach((d, i) => {
      const x = padL + i * stepW + (stepW - barW) / 2;
      const totalHours = (d.currentTotalMs / 3600000).toFixed(1);
      let currentTop = baseY;

      const scaledCurrentMs = d.isTotal ? Math.min(d.currentTotalMs, maxDailyVal) : d.currentTotalMs;
      if (d.isTotal) {
        const totalH = Math.max(0, (scaledCurrentMs / maxVal) * chartH);
        if (totalH > 0) {
          const totalY = baseY - totalH;
          const totalTooltip = `Total semanal actual · Trabajo: ${getAttendancePauseLabel(d.currentTotalMs)}`;
          bars += `<rect class="fin-anim-bar fin-hoverable-bar" data-fin-tooltip="${sanitize(totalTooltip)}" style="animation-delay:${40 + i * 26}ms" x="${x.toFixed(1)}" y="${totalY.toFixed(1)}" width="${barW}" height="${totalH.toFixed(1)}" fill="#2563eb" rx="2"></rect>`;
        }
      } else {
        d.currentEntries.forEach((entry, entryIdx) => {
          const workH = Math.max(0, (entry.workedMs / maxVal) * chartH);
          if (workH <= 0) return;
          const y = currentTop - workH;
          const color = entryColors[entryIdx % entryColors.length];
          const tooltipText = `${d.label} · Entrada ${entry.entryIndex} · ${entry.employeeName || 'Sin nombre'} · ${formatAttendanceDate(entry.checkInAt)} · ${formatAttendanceTime(entry.checkInAt)}-${formatAttendanceTime(entry.checkOutAt)} · Trabajo: ${getAttendancePauseLabel(entry.workedMs)}`;
          bars += `<rect class="fin-anim-bar fin-hoverable-bar" data-fin-tooltip="${sanitize(tooltipText)}" style="animation-delay:${35 + i * 26 + entryIdx * 12}ms" x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW}" height="${workH.toFixed(1)}" fill="${color}" rx="2"></rect>`;
          currentTop = y;
        });
      }

      const dateLabel = currentWeekDateLabels[i] ? `${d.label} ${currentWeekDateLabels[i]}` : d.label;
      labels += `<text x="${(x + barW / 2).toFixed(1)}" y="${(baseY + 12).toFixed(1)}" text-anchor="middle" font-size="8" fill="#9ca3af">${sanitize(dateLabel)}</text>`;
      if (d.currentTotalMs > 0) {
        const topY = baseY - ((scaledCurrentMs / maxVal) * chartH);
        bars += `<text x="${(x + barW / 2).toFixed(1)}" y="${(topY - 4).toFixed(1)}" text-anchor="middle" font-size="7.4" fill="#6b7280" class="fin-anim-number" data-fin-value="${totalHours}" data-fin-format="hours-1d">0.0h</text>`;
      }

      const pointX = x + barW / 2;
      const scaledPreviousMs = d.isTotal ? Math.min(d.previousWorkedMs, maxDailyVal) : d.previousWorkedMs;
      const pointY = baseY - ((scaledPreviousMs / maxVal) * chartH);
      const prevHoursLabel = (d.previousWorkedMs / 3600000).toFixed(1);
      const prevTooltip = d.isTotal
        ? `Total semanal anterior: ${prevHoursLabel}h trabajadas`
        : `${d.label} · Semana anterior: ${prevHoursLabel}h trabajadas`;
      previousPoints += `<circle class="fin-hoverable-bar" data-fin-tooltip="${sanitize(prevTooltip)}" cx="${pointX.toFixed(1)}" cy="${pointY.toFixed(1)}" r="3.5" fill="#dc2626" stroke="#ffffff" stroke-width="1.1"></circle>`;
    });

    const maxEntriesPerDay = Math.max(1, ...weekdays.map((d) => d.currentEntries.length));
    const legendEntries = Math.min(3, maxEntriesPerDay);
    let legend = '';
    for (let i = 0; i < legendEntries; i += 1) {
      const x = padL + i * 80;
      legend += `<rect x="${x}" y="${H - 16}" width="8" height="8" fill="${entryColors[i]}" rx="1.5"/>`;
      legend += `<text x="${x + 11}" y="${H - 9}" font-size="8.5" fill="#6b7280">Entrada ${i + 1}</text>`;
    }
    if (maxEntriesPerDay > legendEntries) {
      const x = padL + legendEntries * 80;
      legend += `<text x="${x}" y="${H - 9}" font-size="8.5" fill="#6b7280">+${maxEntriesPerDay - legendEntries} entrada(s)</text>`;
    }
    const currentRangeLabel = weekStats.currentWeekStartKey && weekStats.currentWeekEndKey
      ? `${formatAttendanceDate(`${weekStats.currentWeekStartKey}T00:00:00`)} - ${formatAttendanceDate(`${weekStats.currentWeekEndKey}T00:00:00`)}`
      : '-';
    const previousRangeLabel = weekStats.previousWeekStartKey && weekStats.previousWeekEndKey
      ? `${formatAttendanceDate(`${weekStats.previousWeekStartKey}T00:00:00`)} - ${formatAttendanceDate(`${weekStats.previousWeekEndKey}T00:00:00`)}`
      : '-';
    const pointLegendX = padL + Math.max(220, legendEntries * 80 + 8);
    legend += `<rect x="${pointLegendX}" y="${H - 16}" width="8" height="8" fill="#2563eb" rx="1.5"/>`;
    legend += `<text x="${pointLegendX + 11}" y="${H - 9}" font-size="8.5" fill="#6b7280">Total semanal actual</text>`;
    legend += `<circle cx="${pointLegendX + 122}" cy="${H - 12}" r="3" fill="#dc2626" stroke="#ffffff" stroke-width="1"/>`;
    legend += `<text x="${pointLegendX + 130}" y="${H - 9}" font-size="8.5" fill="#6b7280">Semana anterior</text>`;
    legend += `<text x="${W - padR}" y="${H - 19}" text-anchor="end" font-size="8.2" fill="#6b7280">Actual: ${sanitize(currentRangeLabel)}</text>`;
    legend += `<text x="${W - padR}" y="${H - 9}" text-anchor="end" font-size="8.2" fill="#9ca3af">Anterior: ${sanitize(previousRangeLabel)}</text>`;

    return `<svg class="fin-chart-svg fin-chart-svg-bar" viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;display:block;" xmlns="http://www.w3.org/2000/svg"><line x1="${padL}" y1="${baseY}" x2="${W - padR}" y2="${baseY}" stroke="#e5e7eb" stroke-width="1"/>${bars}${previousPoints}${labels}${legend}</svg>`;
  }

  function buildAttendanceMonthEntriesBarsSVG(entriesInput, monthKey, previousMonthEntriesInput = [], weekLabel = '') {
    const days = Array.isArray(entriesInput) ? entriesInput : [];
    if (!days.length) return '<p class="help">Sin registros en el mes seleccionado.</p>';

    const previousMonthDays = Array.isArray(previousMonthEntriesInput) ? previousMonthEntriesInput : [];
    const previousDayMap = {};
    previousMonthDays.forEach((day) => {
      if (day?.day) previousDayMap[String(day.day)] = day;
    });

    const W = 620, H = 188, padL = 44, padR = 10, padT = 14, padB = 42;
    const chartW = W - padL - padR;
    const chartH = H - padT - padB;
    const currentTotalMs = days.reduce((sum, day) => sum + (Number(day.totalMs) || 0), 0);
    const previousTotalMs = previousMonthDays.reduce((sum, day) => sum + (Number(day.totalMs) || 0), 0);
    const maxDayVal = Math.max(...days.map((day) => Number(day.totalMs) || 0), 1);
    const chartItems = [
      ...days,
      {
        id: 'month-total',
        label: 'Total',
        day: 'Total',
        dayKey: '',
        totalMs: currentTotalMs,
        entries: [],
        isTotal: true
      }
    ];
    const maxVal = maxDayVal;
    const stepW = chartW / chartItems.length;
    const barW = Math.min(14, Math.max(2, Math.floor(stepW * 0.72)));
    const baseY = padT + chartH;
    const entryColors = ['#16a34a', '#0ea5a4', '#0f766e', '#14532d', '#22c55e'];
    let bars = '';
    let labels = '';
    let previousPoints = '';
    const showTopNumbers = chartItems.length <= 20;

    chartItems.forEach((d, i) => {
      const x = padL + i * stepW + (stepW - barW) / 2;
      const totalHours = ((Number(d.totalMs) || 0) / 3600000).toFixed(1);
      let currentTop = baseY;

      if (d.isTotal) {
        const cappedTotalMs = Math.min(Number(d.totalMs) || 0, maxDayVal);
        const height = Math.max(2, (cappedTotalMs / maxVal) * chartH);
        const y = baseY - height;
        bars += `<rect class="fin-anim-bar fin-hoverable-bar" data-fin-tooltip="${sanitize(`Total del mes actual · ${totalHours}h`)}" style="animation-delay:${35 + i * 24}ms" x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW}" height="${height.toFixed(1)}" fill="#2563eb" rx="2"></rect>`;
        if (showTopNumbers) {
          bars += `<text x="${(x + barW / 2).toFixed(1)}" y="${(y - 4).toFixed(1)}" text-anchor="middle" font-size="7.4" fill="#6b7280" class="fin-anim-number" data-fin-value="${totalHours}" data-fin-format="hours-1d">0.0h</text>`;
        }
        labels += `<text x="${(x + barW / 2).toFixed(1)}" y="${(baseY + 12).toFixed(1)}" text-anchor="middle" font-size="7.8" fill="#9ca3af">${d.label}</text>`;
        const cappedPreviousTotalMs = Math.min(previousTotalMs, maxDayVal);
        const previousPointY = baseY - ((cappedPreviousTotalMs / maxVal) * chartH);
        previousPoints += `<circle class="fin-hoverable-bar" data-fin-tooltip="${sanitize(`Total del mes anterior · ${(previousTotalMs / 3600000).toFixed(1)}h`)}" cx="${(x + barW / 2).toFixed(1)}" cy="${previousPointY.toFixed(1)}" r="2.8" fill="#dc2626" stroke="#ffffff" stroke-width="1"></circle>`;
        return;
      }

      d.entries.forEach((entry, entryIdx) => {
        const workH = Math.max(0, (entry.workedMs / maxVal) * chartH);
        if (workH <= 0) return;
        const y = currentTop - workH;
        const color = entryColors[entryIdx % entryColors.length];
        const tooltipText = `${formatAttendanceDate(entry.checkInAt)} · Entrada ${entry.entryIndex} · ${formatAttendanceTime(entry.checkInAt)}-${formatAttendanceTime(entry.checkOutAt)} · Trabajo: ${getAttendancePauseLabel(entry.workedMs)}`;
        bars += `<rect class="fin-anim-bar fin-hoverable-bar" data-fin-tooltip="${sanitize(tooltipText)}" style="animation-delay:${35 + i * 24 + entryIdx * 14}ms" x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW}" height="${workH.toFixed(1)}" fill="${color}" rx="2"></rect>`;
        currentTop = y;
      });

      if (i % Math.max(1, Math.floor(chartItems.length / 14)) === 0 || chartItems.length <= 14) {
        const dateLabel = weekLabel && d.dayKey
          ? `${String(new Date(`${d.dayKey}T00:00:00`).getDate()).padStart(2, '0')}/${String(new Date(`${d.dayKey}T00:00:00`).getMonth() + 1).padStart(2, '0')}`
          : d.label;
        labels += `<text x="${(x + barW / 2).toFixed(1)}" y="${(baseY + 12).toFixed(1)}" text-anchor="middle" font-size="7.8" fill="#9ca3af">${sanitize(dateLabel)}</text>`;
      }
      const topY = baseY - ((Number(d.totalMs) || 0) / maxVal) * chartH;
      if (showTopNumbers) {
        bars += `<text x="${(x + barW / 2).toFixed(1)}" y="${(topY - 4).toFixed(1)}" text-anchor="middle" font-size="7.4" fill="#6b7280" class="fin-anim-number" data-fin-value="${totalHours}" data-fin-format="hours-1d">0.0h</text>`;
      }
      const previousDayTotalMs = previousDayMap[String(d.day)]?.totalMs || 0;
      const previousDayHours = (previousDayTotalMs / 3600000).toFixed(1);
      const cappedPreviousDayTotalMs = Math.min(previousDayTotalMs, maxDayVal);
      const previousPointY = baseY - ((cappedPreviousDayTotalMs / maxVal) * chartH);
      const previousTooltip = `${d.label} · Mes anterior: ${previousDayHours}h trabajadas`;
      previousPoints += `<circle class="fin-hoverable-bar" data-fin-tooltip="${sanitize(previousTooltip)}" cx="${(x + barW / 2).toFixed(1)}" cy="${previousPointY.toFixed(1)}" r="2.8" fill="#dc2626" stroke="#ffffff" stroke-width="1"></circle>`;
    });

    const maxEntriesPerDay = Math.max(1, ...days.map((d) => d.entries.length));
    const legendEntries = Math.min(3, maxEntriesPerDay);
    let legend = '';
    for (let i = 0; i < legendEntries; i += 1) {
      const x = padL + i * 80;
      legend += `<rect x="${x}" y="${H - 16}" width="8" height="8" fill="${entryColors[i]}" rx="1.5"/>`;
      legend += `<text x="${x + 11}" y="${H - 9}" font-size="8.5" fill="#6b7280">Entrada ${i + 1}</text>`;
    }
    if (maxEntriesPerDay > legendEntries) {
      const x = padL + legendEntries * 80;
      legend += `<text x="${x}" y="${H - 9}" font-size="8.5" fill="#6b7280">+${maxEntriesPerDay - legendEntries} entrada(s)</text>`;
    }
    const previousLegendX = padL + Math.max(250, legendEntries * 80 + 8);
    legend += `<circle cx="${previousLegendX}" cy="${H - 12}" r="3" fill="#dc2626" stroke="#ffffff" stroke-width="1"></circle>`;
    legend += `<text x="${previousLegendX + 8}" y="${H - 9}" font-size="8.5" fill="#6b7280">Mes anterior</text>`;
    legend += `<text x="${W - padR}" y="${H - 9}" text-anchor="end" font-size="8.5" fill="#9ca3af">${sanitize(weekLabel ? `${weekLabel} · ${formatMonthLabel(monthKey)}` : formatMonthLabel(monthKey))}</text>`;

    return `<svg class="fin-chart-svg fin-chart-svg-bar" viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;display:block;" xmlns="http://www.w3.org/2000/svg"><line x1="${padL}" y1="${baseY}" x2="${W - padR}" y2="${baseY}" stroke="#e5e7eb" stroke-width="1"/>${bars}${previousPoints}${labels}${legend}</svg>`;
  }

  function buildAttendanceCompactWorkedChartSVG(statsInput) {
    const stats = Array.isArray(statsInput) ? statsInput : [];
    if (!stats.length) return '<p class="help">Sin datos para graficar.</p>';
    const W = 520, H = 192, padL = 44, padR = 10, padT = 16, padB = 48;
    const chartW = W - padL - padR;
    const chartH = H - padT - padB;
    const maxVal = Math.max(...stats.map((d) => d.workedMs), 1);
    const stepW = chartW / stats.length;
    const barW = Math.min(18, Math.max(6, Math.floor(stepW * 0.62)));
    const baseY = padT + chartH;
    const toHours = (ms) => ms / 3600000;
    let bars = '';
    let labels = '';
    let previousPoints = '';
    const showTopNumbers = stats.length <= 9;
    const labelStep = stats.length > 10 ? 2 : 1;
    stats.forEach((d, i) => {
      const x = padL + i * stepW + (stepW - barW) / 2;
      const h = d.workedMs > 0 ? Math.max(2, (d.workedMs / maxVal) * chartH) : 0;
      const hours = toHours(d.workedMs);
      if (h > 0) {
        bars += `<rect class="fin-anim-bar" style="animation-delay:${40 + i * 45}ms" x="${x.toFixed(1)}" y="${(baseY - h).toFixed(1)}" width="${barW}" height="${h.toFixed(1)}" fill="#2563eb" rx="2"><title>${d.label} · Trabajo: ${getAttendancePauseLabel(d.workedMs)}</title></rect>`;
      }
      if (showTopNumbers) {
        bars += `<text x="${(x + barW / 2).toFixed(1)}" y="${(baseY - h - 5).toFixed(1)}" text-anchor="middle" font-size="8" fill="#6b7280" class="fin-anim-number" data-fin-value="${hours.toFixed(1)}" data-fin-format="hours-1d">0.0h</text>`;
      }
      if (i % labelStep === 0 || i === stats.length - 1) {
        labels += `<text x="${(x + barW / 2).toFixed(1)}" y="${(baseY + 12).toFixed(1)}" text-anchor="middle" font-size="8" fill="#9ca3af">${sanitize(d.label)}</text>`;
      }
      const previousWorkedMs = i > 0 ? Math.max(0, Number(stats[i - 1]?.workedMs) || 0) : 0;
      const previousHours = (previousWorkedMs / 3600000).toFixed(1);
      const pointY = baseY - ((previousWorkedMs / maxVal) * chartH);
      const pointTooltip = `${d.label} · Período anterior: ${previousHours}h trabajadas`;
      previousPoints += `<circle class="fin-hoverable-bar" data-fin-tooltip="${sanitize(pointTooltip)}" cx="${(x + barW / 2).toFixed(1)}" cy="${pointY.toFixed(1)}" r="3" fill="#dc2626" stroke="#ffffff" stroke-width="1"></circle>`;
    });
    const legend = `<circle cx="${padL + 2}" cy="${H - 12}" r="3" fill="#dc2626" stroke="#ffffff" stroke-width="1"></circle><text x="${padL + 10}" y="${H - 9}" font-size="8.5" fill="#6b7280">Período anterior</text>`;
    return `<svg class="fin-chart-svg fin-chart-svg-bar" viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;display:block;" xmlns="http://www.w3.org/2000/svg"><line x1="${padL}" y1="${baseY}" x2="${W - padR}" y2="${baseY}" stroke="#e5e7eb" stroke-width="1"/>${bars}${previousPoints}${labels}${legend}</svg>`;
  }

  function buildAttendanceCompactWorkedVsPauseSVG(statsInput) {
    const stats = Array.isArray(statsInput) ? statsInput : [];
    if (!stats.length) return '<p class="help">Sin datos para graficar.</p>';
    const W = 520, H = 178, padL = 44, padR = 10, padT = 16, padB = 36;
    const chartW = W - padL - padR;
    const chartH = H - padT - padB;
    const maxVal = Math.max(...stats.map((d) => d.totalMs), 1);
    const stepW = chartW / stats.length;
    const barW = Math.min(20, Math.max(8, Math.floor(stepW * 0.58)));
    const baseY = padT + chartH;
    const toHours = (ms) => ms / 3600000;
    let bars = '';
    let labels = '';
    stats.forEach((d, i) => {
      const x = padL + i * stepW + (stepW - barW) / 2;
      const workH = Math.max(0, (d.workedMs / maxVal) * chartH);
      const pauseH = Math.max(0, (d.pauseMs / maxVal) * chartH);
      const totalHours = toHours(d.totalMs);
      bars += `<rect class="fin-anim-bar" style="animation-delay:${40 + i * 45}ms" x="${x.toFixed(1)}" y="${(baseY - workH).toFixed(1)}" width="${barW}" height="${workH.toFixed(1)}" fill="#16a34a" rx="2"><title>${d.label} · Trabajo: ${getAttendancePauseLabel(d.workedMs)}</title></rect>`;
      if (pauseH > 0) {
        bars += `<rect class="fin-anim-bar" style="animation-delay:${60 + i * 45}ms" x="${x.toFixed(1)}" y="${(baseY - workH - pauseH).toFixed(1)}" width="${barW}" height="${pauseH.toFixed(1)}" fill="#f59e0b" rx="2"><title>${d.label} · Pausa: ${getAttendancePauseLabel(d.pauseMs)}</title></rect>`;
      }
      bars += `<text x="${(x + barW / 2).toFixed(1)}" y="${(baseY - workH - pauseH - 5).toFixed(1)}" text-anchor="middle" font-size="8" fill="#6b7280" class="fin-anim-number" data-fin-value="${totalHours.toFixed(1)}" data-fin-format="hours-1d">0.0h</text>`;
      labels += `<text x="${(x + barW / 2).toFixed(1)}" y="${(baseY + 12).toFixed(1)}" text-anchor="middle" font-size="8" fill="#9ca3af">${sanitize(d.label)}</text>`;
    });
    const legend = `<rect x="${padL}" y="${H - 14}" width="8" height="8" fill="#16a34a" rx="1.5"/><text x="${padL + 11}" y="${H - 7}" font-size="8.5" fill="#6b7280">Trabajo</text><rect x="${padL + 72}" y="${H - 14}" width="8" height="8" fill="#f59e0b" rx="1.5"/><text x="${padL + 83}" y="${H - 7}" font-size="8.5" fill="#6b7280">Pausa</text>`;
    return `<svg class="fin-chart-svg fin-chart-svg-bar" viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;display:block;" xmlns="http://www.w3.org/2000/svg"><line x1="${padL}" y1="${baseY}" x2="${W - padR}" y2="${baseY}" stroke="#e5e7eb" stroke-width="1"/>${bars}${labels}${legend}</svg>`;
  }

  function buildAttendanceIso(dateValue, timeValue) {
    const [year, month, day] = String(dateValue || '').split('-').map((part) => Number(part));
    const [hours, minutes] = String(timeValue || '').split(':').map((part) => Number(part));
    if (!year || !month || !day || Number.isNaN(hours) || Number.isNaN(minutes)) return '';
    return new Date(year, month - 1, day, hours, minutes, 0, 0).toISOString();
  }

  function getAttendanceRecordById(recordId) {
    return (state.attendance?.records || []).find((record) => record.id === recordId) || null;
  }

  function addMonthsToIso(baseIso, months) {
    const date = new Date(baseIso || Date.now());
    if (Number.isNaN(date.getTime())) return new Date().toISOString();
    date.setMonth(date.getMonth() + Math.max(0, Number(months) || 0));
    return date.toISOString();
  }

  function formatGoalDate(dateInput) {
    const date = new Date(dateInput || '');
    if (Number.isNaN(date.getTime())) return '-';
    return date.toLocaleDateString('es-CL');
  }

  function getGoalStatusLabel(status) {
    if (status === 'logrado') return 'Logrado';
    if (status === 'logrado-en-transcurso') return 'Logrado en el transcurso';
    if (status === 'no-logrado') return 'No logrado';
    return 'En período';
  }

  function renderGoalStatusOptions(selected) {
    const options = [
      { value: 'en-periodo', label: 'En período' },
      { value: 'logrado', label: 'Logrado' },
      { value: 'logrado-en-transcurso', label: 'Logrado en el transcurso' },
      { value: 'no-logrado', label: 'No logrado' }
    ];
    return options
      .map((item) => `<option value="${item.value}" ${item.value === selected ? 'selected' : ''}>${item.label}</option>`)
      .join('');
  }

  function syncAttendanceChronometer() {
    if (attendanceChronoTimer) {
      window.clearInterval(attendanceChronoTimer);
      attendanceChronoTimer = null;
    }

    if (state.currentView !== 'attendance') return;
    const session = state.attendance?.activeSession;
    const output = document.getElementById('attendance-chrono-value');
    if (!output || !session?.checkInAt) return;

    const renderNow = () => {
      const checkInMs = new Date(session.checkInAt).getTime();
      if (Number.isNaN(checkInMs)) {
        output.textContent = '00:00:00';
        return;
      }
      const nowMs = Date.now();
      const totalMs = Math.max(0, nowMs - checkInMs);
      const pauseMs = getAttendancePauseMs(session, nowMs);
      const workedMs = Math.max(0, totalMs - pauseMs);
      output.textContent = formatDurationFromMs(workedMs);
    };

    renderNow();
    attendanceChronoTimer = window.setInterval(renderNow, 1000);
  }

  function syncAttendanceCommentsInput() {
    if (!state.attendance?.activeSession) return;
    const input = document.getElementById('attendance-comments');
    if (!input) return;

    const updateComments = () => {
      if (state.attendance?.activeSession) {
        state.attendance.activeSession.comments = String(input.value || '').trim();
        window.ERMStorage.save(state);
      }
    };

    input.removeEventListener('input', updateComments);
    input.addEventListener('input', updateComments);
  }

  function syncAttendanceEditCommentsInput() {
    const recordId = state.ui.attendanceEditingId;
    if (!recordId) return;
    const record = getAttendanceRecordById(recordId);
    if (!record) return;

    const input = document.getElementById('attendance-edit-comments');
    if (!input) return;

    const updateComments = () => {
      const currentRecord = getAttendanceRecordById(recordId);
      if (currentRecord) {
        currentRecord.comments = String(input.value || '').trim();
        window.ERMStorage.save(state);
      }
    };

    input.removeEventListener('input', updateComments);
    input.addEventListener('input', updateComments);
  }

  function confirmSafe(message) {
    try {
      if (typeof window.confirm !== 'function') return true;
      return window.confirm(message);
    } catch (error) {
      console.warn('No se pudo abrir el diálogo de confirmación.', error);
      return true;
    }
  }

  function idsEqual(left, right) {
    return String(left ?? '') === String(right ?? '');
  }

  function findOrderById(orderId) {
    return (state.orders || []).find((item) => idsEqual(item.id, orderId)) || null;
  }

  function stampBaseUpdate(baseKey, options = {}) {
    const stamp = new Date().toISOString();
    if (baseKey === 'scenario') state.ui.baseScenarioUpdatedAt = stamp;
    if (baseKey === 'database') state.ui.baseDatabaseUpdatedAt = stamp;
    if (baseKey === 'productTypes') state.ui.baseProductTypesUpdatedAt = stamp;
    if (baseKey === 'external') state.ui.baseExternalUpdatedAt = stamp;
    if (baseKey === 'contacts') state.ui.baseContactsUpdatedAt = stamp;
    if (baseKey === 'orders') state.ui.baseOrdersUpdatedAt = stamp;
    if (baseKey === 'expenses') state.ui.baseExpensesUpdatedAt = stamp;
    if (baseKey === 'desired') state.ui.baseDesiredUpdatedAt = stamp;
    if (baseKey === 'attendance') state.ui.baseAttendanceUpdatedAt = stamp;
    if (baseKey === 'finance') state.ui.baseFinanceUpdatedAt = stamp;

    // La asistencia registra sus propios mensajes (turno iniciado/cerrado) en logActivity.
    if (!options.silent && baseKey !== 'attendance') {
      logActivity(`Dato guardado: ${baseLabels[baseKey] || baseKey}`);
    }
  }

  function logActivity(message) {
    const text = String(message || '').trim();
    if (!text) return;
    state.ui.activityLog = Array.isArray(state.ui.activityLog) ? state.ui.activityLog : [];
    state.ui.activityLog.unshift({ message: text, at: new Date().toISOString() });
    if (state.ui.activityLog.length > 40) state.ui.activityLog.length = 40;
    renderActivityLog();
  }

  function formatActivityTimestamp(iso) {
    const parsed = new Date(iso);
    if (Number.isNaN(parsed.getTime())) return '';
    return parsed.toLocaleString('es-CL');
  }

  function renderActivityLog() {
    const entries = Array.isArray(state.ui?.activityLog) ? state.ui.activityLog : [];
    if (refs.activityLogLatest) {
      refs.activityLogLatest.textContent = entries.length ? entries[0].message : 'Sin actividad reciente';
    }
    if (refs.activityLogList) {
      refs.activityLogList.innerHTML = entries.length
        ? entries.map((entry) => `
            <div class="activity-log-entry">
              <span class="activity-log-entry-msg">${sanitize(entry.message)}</span>
              <span class="activity-log-entry-at">${sanitize(formatActivityTimestamp(entry.at))}</span>
            </div>
          `).join('')
        : '<div class="activity-log-empty">Sin actividad reciente.</div>';
    }
  }

  function formatBaseStatus(stamp) {
    if (!stamp) return 'sin importar';
    const parsed = new Date(stamp);
    if (Number.isNaN(parsed.getTime())) return 'sin importar';
    return parsed.toLocaleString('es-CL');
  }

  function getBaseStatusRows() {
    return [
      ['scenario', state.ui.baseScenarioUpdatedAt],
      ['database', state.ui.baseDatabaseUpdatedAt],
      ['productTypes', state.ui.baseProductTypesUpdatedAt],
      ['external', state.ui.baseExternalUpdatedAt],
      ['contacts', state.ui.baseContactsUpdatedAt],
      ['orders', state.ui.baseOrdersUpdatedAt],
      ['desired', state.ui.baseDesiredUpdatedAt],
      ['expenses', state.ui.baseExpensesUpdatedAt],
      ['attendance', state.ui.baseAttendanceUpdatedAt],
      ['finance', state.ui.baseFinanceUpdatedAt]
    ];
  }

  function clearBaseStatus(baseKey) {
    if (baseKey === 'scenario') state.ui.baseScenarioUpdatedAt = null;
    if (baseKey === 'database') state.ui.baseDatabaseUpdatedAt = null;
    if (baseKey === 'productTypes') state.ui.baseProductTypesUpdatedAt = null;
    if (baseKey === 'external') state.ui.baseExternalUpdatedAt = null;
    if (baseKey === 'contacts') state.ui.baseContactsUpdatedAt = null;
    if (baseKey === 'orders') state.ui.baseOrdersUpdatedAt = null;
    if (baseKey === 'expenses') state.ui.baseExpensesUpdatedAt = null;
    if (baseKey === 'desired') state.ui.baseDesiredUpdatedAt = null;
    if (baseKey === 'attendance') state.ui.baseAttendanceUpdatedAt = null;
    if (baseKey === 'finance') state.ui.baseFinanceUpdatedAt = null;
  }

  function clearBaseData(baseKey) {
    const defaults = window.ERMDefaults || {};

    if (baseKey === 'scenario') {
      state.scenario = JSON.parse(JSON.stringify(defaults.scenario || state.scenario));
      state.ui.scenarioLocked = false;
      state.ui.lastScenarioSavedAt = null;
      clearBaseStatus('scenario');
      return;
    }

    if (baseKey === 'database') {
      state.database.materials = [];
      state.quote.materials = [];
      state.ui.editingMaterialId = null;
      state.ui.databaseDraft = null;
      state.ui.databaseFilter = 'Todos';
      clearBaseStatus('database');
      return;
    }

    if (baseKey === 'productTypes') {
      state.database.productTypes = [];
      state.ui.editingProductTypeId = null;
      state.ui.productTypeDraft = null;
      clearBaseStatus('productTypes');
      return;
    }

    if (baseKey === 'external') {
      const externalIds = new Set((state.database.externalResources || []).map((item) => item.id));
      state.database.externalResources = [];
      state.quote.labor = (state.quote.labor || []).map((item) => (
        externalIds.has(item.employeeId)
          ? { ...item, employeeId: '', rate: 0 }
          : item
      ));
      state.ui.editingExternalResourceId = null;
      state.ui.externalResourceDraft = null;
      clearBaseStatus('external');
      return;
    }

    if (baseKey === 'contacts') {
      state.contacts = [];
      state.quote.customerId = '';
      state.quote.customerName = '';
      state.ui.editingContactId = null;
      state.ui.contactDraft = null;
      clearBaseStatus('contacts');
      return;
    }

    if (baseKey === 'orders') {
      state.orders = [];
      state.ui.selectedOrderId = null;
      state.ui.editingOrderId = null;
      clearBaseStatus('orders');
      return;
    }

    if (baseKey === 'desired') {
      state.inventory.desiredItems = [];
      state.ui.editingDesiredId = null;
      state.ui.desiredDraft = null;
      clearBaseStatus('desired');
      return;
    }

    if (baseKey === 'expenses') {
      state.expenses.cards = [];
      state.ui.selectedExpenseId = null;
      state.ui.expenseDraft = null;
      clearBaseStatus('expenses');
      return;
    }

    if (baseKey === 'attendance') {
      state.attendance = state.attendance || { activeSession: null, records: [] };
      state.attendance.activeSession = null;
      state.attendance.records = [];
      state.ui.attendanceEditingId = null;
      clearBaseStatus('attendance');
    }

    if (baseKey === 'finance') {
      state.finance = state.finance || { initialBalance: 0, entries: [] };
      state.finance.initialBalance = 0;
      state.finance.entries = [];
      state.ui.editingFinanceId = null;
      state.ui.financeDraft = null;
      state.ui.financeMonthFilter = '';
      state.ui.financeCategoryFilter = 'Todas';
      clearBaseStatus('finance');
    }
  }

  function showSaveCheck(moduleKey) {
    const mapping = {
      database: [
        ['Base de Datos interna', state.ui.baseDatabaseUpdatedAt],
        ['Base de Tipos de producto', state.ui.baseProductTypesUpdatedAt],
        ['Base Ayuda Externa', state.ui.baseExternalUpdatedAt]
      ],
      contacts: [
        ['Base de Clientes', state.ui.baseContactsUpdatedAt]
      ]
    };

    const rows = mapping[moduleKey] || [];
    if (!rows.length) {
      window.alert('No hay información de guardado para este módulo.');
      return;
    }

    const pending = rows.filter(([, stamp]) => !stamp).map(([label]) => label);
    if (pending.length) {
      window.alert(`Botón de guardado: pendiente en ${pending.join(', ')}.`);
      return;
    }

    const detail = rows
      .map(([label, stamp]) => `${label}: ${formatBaseStatus(stamp)}`)
      .join('\n');
    window.alert(`Botón de guardado: todo actualizado correctamente.\n\n${detail}`);
  }

  function renderSaveFeedback(slotKey) {
    const map = state.ui.saveFeedbackMap || {};
    const payload = map[slotKey];
    if (!payload) return '';
    const cls = payload.status === 'ok' ? 'ok' : 'error';
    return `<span class="save-feedback ${cls}">${sanitize(payload.message || '')}</span>`;
  }

  function triggerSaveFeedback(slotKey, baseKey) {
    state.ui.saveFeedbackMap = state.ui.saveFeedbackMap || {};
    try {
      if (baseKey) stampBaseUpdate(baseKey);
      window.ERMStorage.save(state);
      state.ui.saveFeedbackMap[slotKey] = { status: 'ok', message: '¡guardado con exito!' };
    } catch (error) {
      console.error(error);
      state.ui.saveFeedbackMap[slotKey] = { status: 'error', message: 'error al guardar' };
    }

    if (saveFeedbackTimers[slotKey]) window.clearTimeout(saveFeedbackTimers[slotKey]);
    saveFeedbackTimers[slotKey] = window.setTimeout(() => {
      if (!state.ui.saveFeedbackMap) return;
      delete state.ui.saveFeedbackMap[slotKey];
      // Skip render if an interactive element has focus to avoid stealing it mid-typing
      const focused = document.activeElement;
      const isEditing = focused && (focused.tagName === 'INPUT' || focused.tagName === 'TEXTAREA' || focused.tagName === 'SELECT') && refs.mainPanel?.contains(focused);
      if (!isEditing) render();
    }, 2200);

    render();
  }

  function openExternalLink(url) {
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  function init() {
    refs.mainPanel = document.getElementById('main-panel');
    refs.summaryPanel = document.getElementById('summary-panel');
    refs.layout = document.querySelector('.layout');
    refs.scenarioImportInput = document.getElementById('scenario-import-input');
    refs.dbImportInput = document.getElementById('db-import-input');
    refs.productTypesImportInput = document.getElementById('product-types-import-input');
    refs.externalResourcesImportInput = document.getElementById('external-resources-import-input');
    refs.contactImportInput = document.getElementById('contacts-import-input');
    refs.orderImportInput = document.getElementById('order-import-input');
    refs.expenseImportInput = document.getElementById('expense-import-input');
    refs.desiredImportInput = document.getElementById('desired-import-input');
    refs.attendanceImportInput = document.getElementById('attendance-import-input');
    refs.financeImportInput = document.getElementById('finance-import-input');
    refs.allBasesImportInput = document.getElementById('all-bases-import-input');
    refs.recoverAttachmentsInput = document.getElementById('recover-attachments-input');
    refs.notesModal = document.getElementById('notes-modal');
    refs.notesInput = document.getElementById('notes-general-input');
    refs.notesPanelCard = document.getElementById('notes-panel-card');
    refs.notesPanelDrag = document.getElementById('notes-panel-drag');
    refs.footerAppVersion = document.getElementById('footer-app-version');
    refs.themeToggleBtn = document.getElementById('theme-toggle-btn');
    refs.aiBriefModal = document.getElementById('ai-brief-modal');
    refs.aiBriefContent = document.getElementById('ai-brief-content');
    refs.attendanceRecordModal = document.getElementById('attendance-record-modal');
    refs.attendanceRecordModalBody = document.getElementById('attendance-record-modal-body');
    refs.pickerModal = document.getElementById('picker-modal');
    refs.pickerModalTitle = document.getElementById('picker-modal-title');
    refs.pickerModalList = document.getElementById('picker-modal-list');
    refs.activityLogWidget = document.getElementById('activity-log-widget');
    refs.activityLogLatest = document.getElementById('activity-log-latest');
    refs.activityLogList = document.getElementById('activity-log-list');
    refs.calculatorModal = document.getElementById('calculator-modal');
    refs.calculatorDisplay = document.getElementById('calculator-display');

    state.ui.notesWindow = state.ui.notesWindow || { x: null, y: null, width: 210, height: 165 };
    const notesWidth = Number(state.ui.notesWindow.width || 0);
    const notesHeight = Number(state.ui.notesWindow.height || 0);
    if ((notesWidth === 520 && notesHeight === 420) || (notesWidth === 420 && notesHeight === 330)) {
      state.ui.notesWindow.width = 210;
      state.ui.notesWindow.height = 165;
    }
    if (!state.ui.generalNotesHtml && state.ui.generalNotes) {
      state.ui.generalNotesHtml = sanitize(state.ui.generalNotes).replaceAll('\n', '<br>');
    }
    state.ui.inlinePdfViewer = state.ui.inlinePdfViewer || null;

    state.expenses = state.expenses || { cards: [] };
    state.expenses.cards = Array.isArray(state.expenses.cards) ? state.expenses.cards.map((card) => createExpenseCard(card)) : [];
    if (!state.expenses.cards.length) {
      state.expenses.cards = [
        createExpenseCard({ name: 'Agua', color: '#2563eb', description: 'Registro anual de consumo y pago de agua.', baseYear: String(new Date().getFullYear()), period: 'mensual' }),
        createExpenseCard({ name: 'Luz', color: '#f39b24', description: 'Registro anual de cuentas eléctricas.', baseYear: String(new Date().getFullYear()), period: 'mensual' }),
        createExpenseCard({ name: 'F29', color: '#4c78d7', description: 'Registro de impuestos y pagos de F29.', baseYear: String(new Date().getFullYear()), period: 'mensual' })
      ];
    }
    if (!state.ui.selectedExpenseId || !state.expenses.cards.some((card) => card.id === state.ui.selectedExpenseId)) {
      state.ui.selectedExpenseId = state.expenses.cards[0]?.id || null;
    }
    if (!state.ui.expenseDraft && state.ui.selectedExpenseId) {
      const selected = state.expenses.cards.find((card) => card.id === state.ui.selectedExpenseId);
      state.ui.expenseDraft = selected ? JSON.parse(JSON.stringify(selected)) : null;
    }
    if (state.ui.theme !== 'dark' && state.ui.theme !== 'light') {
      state.ui.theme = 'light';
    }

    if (isMobileViewport() && state.currentView !== 'mobile-home') {
      state.currentView = 'mobile-home';
    }

    applyTheme(state.ui.theme);
    renderFooterMeta();
    bindEvents();
    render();
    migrateLegacyAttachmentsToUnified();
  }

  async function migrateLegacyAttachmentsToUnified() {
    if (state.ui?.attachmentsUnifiedV1Done) return;

    let changed = false;
    let migratedCount = 0;

    const migrateLegacyAttachment = async (legacy) => (legacy?.dataUrl ? createAttachmentRecord(legacy) : null);

    for (const order of (state.orders || [])) {
      const current = getOwnerAttachments(order, legacyOrderInvoiceAttachment);
      if (current.length) {
        const migrated = await migrateLegacyAttachment(current[0]);
        if (migrated) {
          order.attachments = [migrated];
          changed = true;
          migratedCount += 1;
        }
      }
      order.invoicePdfDataUrl = '';
      order.invoicePdfName = '';
      order.invoicePdfMimeType = '';
      order.invoicePdfSizeKb = 0;
      if (order.quote && typeof order.quote === 'object') {
        order.quote.attachments = normalizeAttachments(order.quote.attachments || order.attachments || []);
        order.quote.invoicePdfDataUrl = '';
        order.quote.invoicePdfName = '';
        order.quote.invoicePdfMimeType = '';
        order.quote.invoicePdfSizeKb = 0;
      }
    }

    for (const entry of (state.finance?.entries || [])) {
      const current = getOwnerAttachments(entry, legacyFinanceAttachment);
      if (current.length) {
        const migrated = await migrateLegacyAttachment(current[0]);
        if (migrated) {
          entry.attachments = [migrated];
          changed = true;
          migratedCount += 1;
        }
      }
      entry.pdfDataUrl = '';
      entry.pdfName = '';
      entry.pdfMimeType = '';
      entry.pdfSizeKb = 0;
    }

    for (const card of (state.expenses?.cards || [])) {
      for (const entry of (card.entries || [])) {
        const current = getOwnerAttachments(entry, legacyExpenseAttachment);
        if (current.length) {
          const migrated = await migrateLegacyAttachment(current[0]);
          if (migrated) {
            entry.attachments = [migrated];
            changed = true;
            migratedCount += 1;
          }
        }
        entry.pdfDataUrl = '';
        entry.pdfName = '';
        entry.pdfMimeType = '';
        entry.pdfSizeKb = 0;
      }
    }

    state.ui = state.ui || {};
    state.ui.attachmentsUnifiedV1Done = true;

    if (changed) {
      stampBaseUpdate('orders');
      stampBaseUpdate('expenses');
      stampBaseUpdate('finance');
      window.ERMStorage.save(state);
      render();
      window.alert(`Migración de adjuntos completada: ${migratedCount} documento(s) convertidos al sistema unificado.`);
      return;
    }

    window.ERMStorage.save(state);
  }

  function bindEvents() {
    document.querySelectorAll('.app-footer a[href^="http"]').forEach((link) => {
      link.addEventListener('click', (event) => {
        event.preventDefault();
        openExternalLink(link.href);
      });
    });

    document.addEventListener('click', async (event) => {
      const viewBtn = event.target.closest('[data-view]');
      if (viewBtn) {
        state.currentView = viewBtn.dataset.view;
        if (state.currentView === 'attendance') {
          state.ui.attendanceAnalyticsMonthKey = getAttendanceMonthKeyFromDate(new Date());
        }
        render();
        return;
      }

      const calcKeyBtn = event.target.closest('[data-calc-digit], [data-calc-op], [data-calc-action]');
      if (calcKeyBtn) {
        handleCalculatorKey(calcKeyBtn);
        return;
      }

      const actionBtn = event.target.closest('[data-action]');
      if (!actionBtn) return;
      const action = actionBtn.dataset.action;

      // Prevent non-button action wrappers from stealing focus when user clicks inputs.
      const clickedEditable = event.target.closest('input, textarea, select');
      if (clickedEditable && !actionBtn.matches('button, a')) return;

      if (action === 'save-state') {
        window.ERMStorage.save(state);
        window.alert('Datos guardados en este navegador.');
      }

      if (action === 'open-notes') {
        if (refs.notesModal?.classList.contains('is-hidden')) {
          openNotesModal();
        } else {
          closeNotesModal();
        }
        return;
      }

      if (action === 'toggle-activity-log') {
        const list = refs.activityLogList;
        const toggleBtn = refs.activityLogWidget?.querySelector('.activity-log-toggle');
        if (!list) return;
        const willShow = list.classList.contains('is-hidden');
        list.classList.toggle('is-hidden', !willShow);
        toggleBtn?.setAttribute('aria-expanded', String(willShow));
        return;
      }

      if (action === 'open-calculator') {
        openCalculatorModal();
        return;
      }

      if (action === 'close-calculator') {
        closeCalculatorModal();
        return;
      }

      if (action === 'open-ai-brief') {
        openAiBriefModal();
        return;
      }

      if (action === 'close-ai-brief') {
        closeAiBriefModal();
        return;
      }

      if (action === 'copy-ai-brief') {
        copyAiBriefToClipboard();
        return;
      }

      if (action === 'toggle-theme') {
        state.ui.theme = state.ui.theme === 'dark' ? 'light' : 'dark';
        applyTheme(state.ui.theme);
        window.ERMStorage.save(state);
        return;
      }

      if (action === 'close-notes') {
        closeNotesModal();
        return;
      }

      if (action === 'save-notes') {
        saveNotesFromModal();
        return;
      }

      if (action === 'clear-notes') {
        state.ui.generalNotes = '';
        state.ui.generalNotesHtml = '';
        if (refs.notesInput) refs.notesInput.innerHTML = '';
        window.ERMStorage.save(state);
        return;
      }

      if (action === 'notes-bold') {
        document.execCommand('bold');
        persistNotesEditorState();
        return;
      }

      if (action === 'notes-bullet') {
        document.execCommand('insertUnorderedList');
        persistNotesEditorState();
        return;
      }

      if (action === 'save-scenario') {
        state.ui.lastScenarioSavedAt = new Date().toLocaleString('es-CL');
        stampBaseUpdate('scenario');
        window.ERMStorage.save(state);
        window.alert('Escenario guardado. El presupuestador y el resto de la app usarán esta base activa.');
        render();
      }

      if (action === 'toggle-scenario-lock') {
        state.ui.scenarioLocked = !state.ui.scenarioLocked;
        if (state.ui.scenarioLocked) {
          state.ui.lastScenarioSavedAt = new Date().toLocaleString('es-CL');
          stampBaseUpdate('scenario');
          window.ERMStorage.save(state);
        }
        render();
      }

      if (action === 'set-database-filter') {
        state.ui.databaseFilter = actionBtn.dataset.filter;
        render();
      }

      if (action === 'set-database-sort') {
        state.ui.databaseSort = actionBtn.dataset.sort;
        render();
      }

      if (action === 'set-database-section') {
        state.ui.databaseSection = actionBtn.dataset.section || 'materials';
        render();
      }

      if (action === 'set-inventory-section') {
        state.ui.inventorySection = actionBtn.dataset.section || 'company';
        render();
      }

      if (action === 'select-expense-card') {
        const selectedId = actionBtn.dataset.id || null;
        const selected = (state.expenses.cards || []).find((card) => card.id === selectedId);
        if (!selected) return;
        state.ui.selectedExpenseId = selected.id;
        state.ui.expenseDraft = JSON.parse(JSON.stringify(selected));
        render();
      }

      if (action === 'add-expense-card') {
        const card = createExpenseCard({
          name: 'Nuevo gasto',
          color: '#2563eb',
          description: '',
          baseYear: String(new Date().getFullYear()),
          period: 'mensual'
        });
        state.expenses.cards.unshift(card);
        state.ui.selectedExpenseId = card.id;
        state.ui.expenseDraft = JSON.parse(JSON.stringify(card));
        stampBaseUpdate('expenses');
        render();
      }

      if (action === 'save-expense-card') {
        saveExpenseCardFromForm();
      }

      if (action === 'reset-expense-draft') {
        const selected = (state.expenses.cards || []).find((card) => card.id === state.ui.selectedExpenseId);
        state.ui.expenseDraft = selected ? JSON.parse(JSON.stringify(selected)) : null;
        render();
      }

      if (action === 'delete-expense-card') {
        if (!confirmSafe('¿Quieres eliminar esta card de gasto?')) return;
        const cardId = actionBtn.dataset.id || state.ui.selectedExpenseId;
        state.expenses.cards = (state.expenses.cards || []).filter((card) => card.id !== cardId);
        state.ui.selectedExpenseId = state.expenses.cards[0]?.id || null;
        const selected = (state.expenses.cards || []).find((card) => card.id === state.ui.selectedExpenseId);
        state.ui.expenseDraft = selected ? JSON.parse(JSON.stringify(selected)) : null;
        stampBaseUpdate('expenses');
        render();
      }

      if (action === 'clear-expense-pdf') {
        const entryId = actionBtn.dataset.entryId;
        const draft = state.ui.expenseDraft || null;
        if (!draft || !entryId) return;
        if (state.ui.inlinePdfViewer?.sourceType === 'expense' && state.ui.inlinePdfViewer?.sourceId === entryId) {
          state.ui.inlinePdfViewer = null;
        }
        draft.entries = (draft.entries || []).map((entry) => {
          if (entry.id !== entryId) return entry;
          return {
            ...entry,
            attachments: [],
            pdfDataUrl: '',
            pdfName: '',
            pdfMimeType: '',
            pdfSizeKb: 0
          };
        });
        render();
      }

      if (action === 'pick-expense-pdf') {
        const entryId = actionBtn.dataset.entryId;
        if (!entryId) return;
        const input = document.getElementById(`expense-pdf-input-${entryId}`);
        if (input && !input.disabled) input.click();
      }

      if (action === 'download-expense-pdf') {
        const draft = state.ui.expenseDraft || null;
        const entryId = actionBtn.dataset.entryId || '';
        const entry = (draft?.entries || []).find((item) => item.id === entryId);
        const attachment = getPrimaryAttachment(entry, legacyExpenseAttachment);
        if (!attachment) return;
        const attachmentDataUrl = await resolveAttachmentDataUrl(attachment);
        if (!attachmentDataUrl) {
          window.alert('No se pudo leer el documento adjunto.');
          return;
        }
        const blob = dataUrlToBlobSafe(attachmentDataUrl);
        downloadBlobFile(blob, attachment.fileName || `comprobante-${entryId}.pdf`);
        return;
      }

      if (action === 'view-expense-pdf') {
        const draft = state.ui.expenseDraft || null;
        const entryId = actionBtn.dataset.entryId || '';
        const entry = (draft?.entries || []).find((item) => item.id === entryId);
        const attachment = getPrimaryAttachment(entry, legacyExpenseAttachment);
        if (!attachment) return;
        const attachmentDataUrl = await resolveAttachmentDataUrl(attachment);
        if (!attachmentDataUrl) {
          window.alert('No se pudo abrir el documento adjunto.');
          return;
        }
        state.ui.inlinePdfViewer = {
          sourceType: 'expense',
          sourceId: entryId,
          dataUrl: attachmentDataUrl,
          fileName: attachment.fileName || `comprobante-${entryId}.pdf`
        };
        renderInlinePdfViewerModal();
        return;
      }

      if (action === 'toggle-expense-entry-status') {
        const entryId = actionBtn.dataset.entryId;
        const draft = state.ui.expenseDraft || null;
        if (!draft || !entryId) return;
        draft.entries = (draft.entries || []).map((entry) => (
          entry.id === entryId
            ? { ...entry, status: entry.status === 'pagado' ? 'no-pagado' : 'pagado' }
            : entry
        ));
        render();
      }

      if (action === 'pick-herramienta-pdf') {
        const input = document.getElementById('fin-herramienta-pdf');
        if (input) input.click();
        return;
      }

      if (action === 'clear-herramienta-pdf') {
        if (!state.ui.financeDraft) return;
        state.ui.financeDraft.attachments = [];
        state.ui.financeDraft.pdfDataUrl = '';
        state.ui.financeDraft.pdfName = '';
        state.ui.financeDraft.pdfMimeType = '';
        state.ui.financeDraft.pdfSizeKb = 0;
        render();
        return;
      }

      if (action === 'download-herramienta-pdf') {
        const d = state.ui.financeDraft;
        const attachment = getPrimaryAttachment(d, legacyFinanceAttachment);
        if (!attachment) return;
        const attachmentDataUrl = await resolveAttachmentDataUrl(attachment);
        if (!attachmentDataUrl) {
          window.alert('No se pudo leer el documento adjunto.');
          return;
        }
        const blob = dataUrlToBlobSafe(attachmentDataUrl);
        downloadBlobFile(blob, attachment.fileName || 'comprobante.pdf');
        return;
      }

      if (action === 'view-herramienta-pdf') {
        const d = state.ui.financeDraft;
        const attachment = getPrimaryAttachment(d, legacyFinanceAttachment);
        if (!attachment) return;
        const attachmentDataUrl = await resolveAttachmentDataUrl(attachment);
        if (!attachmentDataUrl) {
          window.alert('No se pudo abrir el documento adjunto.');
          return;
        }
        state.ui.inlinePdfViewer = {
          sourceType: 'herramienta-draft',
          sourceId: 'draft',
          dataUrl: attachmentDataUrl,
          fileName: attachment.fileName || 'comprobante.pdf'
        };
        renderInlinePdfViewerModal();
        return;
      }

      if (action === 'view-herramienta-entry-pdf') {
        const entryId = actionBtn.dataset.id;
        const entry = (state.finance?.entries || []).find((e) => e.id === entryId);
        const attachment = getPrimaryAttachment(entry, legacyFinanceAttachment);
        if (!attachment) return;
        const attachmentDataUrl = await resolveAttachmentDataUrl(attachment);
        if (!attachmentDataUrl) {
          window.alert('No se pudo abrir el documento adjunto.');
          return;
        }
        state.ui.inlinePdfViewer = {
          sourceType: 'herramienta',
          sourceId: entryId,
          dataUrl: attachmentDataUrl,
          fileName: attachment.fileName || 'comprobante.pdf'
        };
        renderInlinePdfViewerModal();
        return;
      }

      if (action === 'download-herramienta-entry-pdf') {
        const entryId = actionBtn.dataset.id;
        const entry = (state.finance?.entries || []).find((e) => e.id === entryId);
        const attachment = getPrimaryAttachment(entry, legacyFinanceAttachment);
        if (!attachment) return;
        const attachmentDataUrl = await resolveAttachmentDataUrl(attachment);
        if (!attachmentDataUrl) {
          window.alert('No se pudo leer el documento adjunto.');
          return;
        }
        const blob = dataUrlToBlobSafe(attachmentDataUrl);
        downloadBlobFile(blob, attachment.fileName || 'comprobante.pdf');
        return;
      }

      if (action === 'select-expense-color') {
        const draft = state.ui.expenseDraft || null;
        const color = actionBtn.dataset.color || '';
        if (!draft || !expenseColorOptions.includes(color)) return;
        draft.color = color;
        render();
      }

      if (action === 'add-fixed-cost') {
        state.scenario.fixedCosts.push({ id: uid('fc'), name: 'Nuevo costo', periodicity: 'mensual', amount: 0 });
        render();
      }

      if (action === 'remove-fixed-cost') {
        state.scenario.fixedCosts = state.scenario.fixedCosts.filter((item) => item.id !== actionBtn.dataset.id);
        render();
      }

      if (action === 'clear-fixed-costs') {
        if (!confirmSafe('¿Quieres limpiar todos los costos fijos e indirectos de esta tabla?')) return;
        state.scenario.fixedCosts = [];
        render();
      }

      if (action === 'add-employee') {
        state.scenario.employees.push({ id: uid('emp'), name: 'Nuevo empleado', hourlyRate: 0, hoursPerMonth: 160 });
        render();
      }

      if (action === 'remove-employee') {
        state.scenario.employees = state.scenario.employees.filter((item) => item.id !== actionBtn.dataset.id);
        render();
      }

      if (action === 'clear-employees') {
        if (!confirmSafe('¿Quieres limpiar toda la tabla de equipo y sueldos?')) return;
        state.scenario.employees = [];
        render();
      }

      if (action === 'add-scenario-goal') {
        const titleInput = document.getElementById('scenario-goal-title');
        const descriptionInput = document.getElementById('scenario-goal-description');
        const title = String(titleInput?.value || '').trim().slice(0, 80);
        const description = String(descriptionInput?.value || '').trim().slice(0, 220);

        if (!title) {
          window.alert('Escribe un título para el objetivo personal.');
          return;
        }

        const editingGoalId = state.ui.scenarioGoalEditingId || null;
        state.scenario.personalGoals = state.scenario.personalGoals || [];

        if (editingGoalId) {
          state.scenario.personalGoals = (state.scenario.personalGoals || []).map((item) => {
            if (item.id !== editingGoalId) return item;
            return {
              ...item,
              title,
              description
            };
          });
          state.ui.scenarioGoalEditingId = null;
        } else {
          const createdAt = new Date().toISOString();
          const autoCloseAt = addMonthsToIso(createdAt, Math.max(1, Number(state.scenario.periodMonths) || 1));
          state.scenario.personalGoals.unshift({
            id: uid('goal'),
            title,
            description,
            status: 'en-periodo',
            createdAt,
            autoCloseAt,
            achievedDuringAt: null
          });
        }

        stampBaseUpdate('scenario');
        window.ERMStorage.save(state);
        render();
        return;
      }

      if (action === 'cancel-edit-scenario-goal') {
        state.ui.scenarioGoalEditingId = null;
        render();
        return;
      }

      if (action === 'delete-scenario-goal') {
        const goalId = actionBtn.dataset.id || '';
        if (!goalId) return;
        if (!confirmSafe('¿Eliminar este objetivo personal?')) return;
        state.scenario.personalGoals = (state.scenario.personalGoals || []).filter((item) => item.id !== goalId);
        if (state.ui.scenarioGoalEditingId === goalId) {
          state.ui.scenarioGoalEditingId = null;
        }
        stampBaseUpdate('scenario');
        window.ERMStorage.save(state);
        render();
        return;
      }

      if (action === 'edit-scenario-goal') {
        const goalId = actionBtn.dataset.id || '';
        if (!goalId) return;
        const current = (state.scenario.personalGoals || []).find((item) => item.id === goalId);
        if (!current) return;

        state.ui.scenarioGoalEditingId = goalId;
        render();

        // Move focus to the inline entry editor to make editing explicit in desktop/web.
        const titleInput = document.getElementById('scenario-goal-title');
        if (titleInput) {
          titleInput.focus();
          titleInput.select();
        }
        return;
      }

      if (action === 'add-material-line') {
        state.quote.materials.push({
          id: uid('qlm'),
          group: '',
          materialId: '',
          quantity: 0,
          wastePercent: 0,
          comment: ''
        });
        render();
      }

      if (action === 'remove-material-line') {
        state.quote.materials = state.quote.materials.filter((item) => item.id !== actionBtn.dataset.id);
        render();
      }

      if (action === 'clear-material-lines') {
        if (!confirmSafe('¿Quieres limpiar todos los insumos de esta tabla?')) return;
        state.quote.materials = [];
        render();
      }

      if (action === 'open-material-group-picker') {
        openMaterialGroupPicker(actionBtn.dataset.rowId);
        return;
      }

      if (action === 'open-material-option-picker') {
        openMaterialOptionPicker(actionBtn.dataset.rowId);
        return;
      }

      if (action === 'close-picker-modal') {
        closePickerModal();
        return;
      }

      if (action === 'select-material-group') {
        closePickerModal();
        const row = state.quote.materials.find((item) => item.id === actionBtn.dataset.rowId);
        if (row) {
          row.group = actionBtn.dataset.group || '';
          row.materialId = '';
        }
        render();
      }

      if (action === 'select-material-option') {
        closePickerModal();
        const row = state.quote.materials.find((item) => item.id === actionBtn.dataset.rowId);
        const materialId = actionBtn.dataset.materialId || '';
        if (row) {
          // Se permite repetir el mismo insumo en varias líneas para diferenciar
          // a qué parte del producto se destina (ver casilla de comentario por línea).
          row.materialId = materialId;
          const material = state.database.materials.find((item) => item.id === materialId);
          if (material) row.group = material.group;
        }
        render();
      }

      if (action === 'add-labor-line') {
        const firstEmployee = state.scenario.employees[0] || null;
        state.quote.labor.push({
          id: uid('qll'),
          employeeId: firstEmployee?.id || null,
          hours: 1,
          rate: firstEmployee?.hourlyRate || Math.round(window.ERMCalc.averageLaborRate(state.scenario))
        });
        render();
      }

      if (action === 'remove-labor-line') {
        state.quote.labor = state.quote.labor.filter((item) => item.id !== actionBtn.dataset.id);
        render();
      }

      if (action === 'clear-labor-lines') {
        if (!confirmSafe('¿Quieres limpiar toda la tabla de mano de obra?')) return;
        state.quote.labor = [];
        render();
      }

      if (action === 'edit-contact') {
        state.ui.editingContactId = actionBtn.dataset.id;
        state.ui.contactDraft = { ...(state.contacts.find((item) => item.id === actionBtn.dataset.id) || {}) };
        state.currentView = 'contacts';
        render();
      }

      if (action === 'append-whatsapp') {
        const input = actionBtn.closest('.field-with-action')?.querySelector('input[data-contact-draft="whatsapp"]');
        if (input) {
          const current = String(input.value || '').trim();
          const suffix = current ? ', ' : '';
          input.value = `${current}${suffix}`;
          input.focus();
          state.ui.contactDraft = {
            ...(state.ui.contactDraft || {}),
            whatsapp: input.value
          };
        }
      }

      if (action === 'delete-contact') {
        if (!confirmSafe('¿Quieres eliminar este cliente de tu módulo de contactos?')) {
          return;
        }
        state.contacts = state.contacts.filter((item) => item.id !== actionBtn.dataset.id);
        if (state.ui.editingContactId === actionBtn.dataset.id) {
          state.ui.editingContactId = null;
          state.ui.contactDraft = null;
        }
        stampBaseUpdate('contacts');
        render();
      }

      if (action === 'toggle-contact-friend') {
        const current = state.contacts.find((item) => item.id === actionBtn.dataset.id);
        if (current) {
          current.isFriend = !current.isFriend;
          stampBaseUpdate('contacts');
        }
        render();
      }

      if (action === 'save-contact') {
        saveContactFromForm();
      }

      if (action === 'clear-contact-form') {
        if (!confirmSafe('¿Quieres limpiar la ficha del cliente y volver a los valores por defecto?')) return;
        state.ui.editingContactId = null;
        state.ui.contactDraft = null;
        render();
      }

      if (action === 'cancel-edit-contact') {
        state.ui.editingContactId = null;
        state.ui.contactDraft = null;
        render();
      }

      if (action === 'toggle-delivery-state') {
        const orderId = actionBtn.dataset.orderId || '';
        if (orderId) {
          const order = findOrderById(orderId);
          if (order) {
            const nextState = (order.quote?.deliveryState || order.deliveryState || 'Abierta') === 'Entregada' ? 'Abierta' : 'Entregada';
            order.deliveryState = nextState;
            if (order.quote) order.quote.deliveryState = nextState;
          }
          render();
          return;
        }

        state.quote.deliveryState = (state.quote.deliveryState || 'Abierta') === 'Entregada' ? 'Abierta' : 'Entregada';
        render();
        return;
      }

      if (action === 'pick-order-invoice-pdf') {
        const orderId = actionBtn.dataset.orderId || '';
        if (!orderId) return;
        const input = document.getElementById(`order-invoice-input-${orderId}`);
        if (input) input.click();
        return;
      }

      if (action === 'download-order-invoice-pdf') {
        const orderId = actionBtn.dataset.orderId || '';
        const order = findOrderById(orderId);
        const attachment = getPrimaryAttachment(order, legacyOrderInvoiceAttachment);
        if (!attachment) return;
        const attachmentDataUrl = await resolveAttachmentDataUrl(attachment);
        if (!attachmentDataUrl) {
          window.alert('No se pudo leer la boleta/factura adjunta.');
          return;
        }
        const blob = dataUrlToBlobSafe(attachmentDataUrl);
        downloadBlobFile(blob, attachment.fileName || `${order.orderNumber || 'ot'}-boleta.pdf`);
        return;
      }

      if (action === 'view-order-invoice-pdf') {
        const orderId = actionBtn.dataset.orderId || '';
        const order = findOrderById(orderId);
        const attachment = getPrimaryAttachment(order, legacyOrderInvoiceAttachment);
        if (!attachment) return;
        const attachmentDataUrl = await resolveAttachmentDataUrl(attachment);
        if (!attachmentDataUrl) {
          window.alert('No se pudo abrir la boleta/factura adjunta.');
          return;
        }
        state.ui.inlinePdfViewer = {
          sourceType: 'order',
          sourceId: orderId,
          dataUrl: attachmentDataUrl,
          fileName: attachment.fileName || `${order.orderNumber || 'ot'}-boleta.pdf`
        };
        renderInlinePdfViewerModal();
        return;
      }

      if (action === 'close-inline-pdf-viewer') {
        closeInlinePdfViewer();
        return;
      }

      if (action === 'download-inline-pdf-viewer') {
        const viewer = state.ui.inlinePdfViewer;
        if (!viewer?.dataUrl) return;
        const blob = dataUrlToBlobSafe(viewer.dataUrl);
        downloadBlobFile(blob, viewer.fileName || 'documento.pdf');
        return;
      }

      if (action === 'clear-order-invoice-pdf') {
        const orderId = actionBtn.dataset.orderId || '';
        const order = findOrderById(orderId);
        const attachment = getPrimaryAttachment(order, legacyOrderInvoiceAttachment);
        if (!attachment) return;

        if (state.ui.inlinePdfViewer?.sourceType === 'order' && idsEqual(state.ui.inlinePdfViewer?.sourceId, orderId)) {
          state.ui.inlinePdfViewer = null;
        }


        order.attachments = [];
        order.invoicePdfDataUrl = '';
        order.invoicePdfName = '';
        order.invoicePdfMimeType = '';
        order.invoicePdfSizeKb = 0;

        if (order.quote) {
          order.quote.attachments = [];
          order.quote.invoicePdfDataUrl = '';
          order.quote.invoicePdfName = '';
          order.quote.invoicePdfMimeType = '';
          order.quote.invoicePdfSizeKb = 0;
        }

        stampBaseUpdate('orders');
        render();
        return;
      }

      if (action === 'save-order-system') {
        saveCurrentOrderToSystem();
      }

      if (action === 'clear-quote-form') {
        if (!confirmSafe('¿Quieres limpiar todo el presupuestador y volver a sus valores por defecto?')) return;
        state.quote = createFreshQuote();
        state.ui.editingOrderId = null;
        render();
      }

      if (action === 'clear-logistics') {
        if (!confirmSafe('¿Quieres limpiar la logística y volver a Retiro en taller?')) return;
        state.quote.logistics = JSON.parse(JSON.stringify(window.ERMDefaults.quote.logistics));
        render();
      }

      if (action === 'import-order') {
        refs.orderImportInput?.click();
      }

      if (action === 'set-order-filter') {
        state.ui.orderFilter = actionBtn.dataset.filter || 'Todas';
        render();
      }

      if (action === 'toggle-order-sort') {
        state.ui.orderSortByNumber = !state.ui.orderSortByNumber;
        render();
      }

      if (action === 'open-order-card') {
        state.ui.selectedOrderId = actionBtn.dataset.id || null;
        state.currentView = 'orders';
        render();
      }

      if (action === 'go-to-finance-entry') {
        const entryId = actionBtn.dataset.id || '';
        if (!entryId) return;
        state.ui.financeHighlightEntryId = entryId;
        state.currentView = 'finance';
        window.ERMStorage.save(state);
        render();
        // Scroll to the highlighted row after render
        setTimeout(() => {
          const el = document.getElementById(`fin-entry-${entryId}`);
          if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 120);
        return;
      }

      if (action === 'load-order-to-quote') {
        loadOrderIntoQuote(actionBtn.dataset.id);
      }

      if (action === 'delete-order-system') {
        const orderId = actionBtn.dataset.id || '';
        if (!orderId) return;
        if (!confirmSafe('¿Quieres quitar esta OT del panel del sistema?')) {
          return;
        }
        const beforeCount = (state.orders || []).length;
        state.orders = (state.orders || []).filter((item) => !idsEqual(item.id, orderId));
        if ((state.orders || []).length === beforeCount) {
          window.alert('No se pudo eliminar la OT seleccionada del panel.');
          return;
        }
        if (idsEqual(state.ui.selectedOrderId, orderId)) {
          state.ui.selectedOrderId = state.orders[0]?.id || null;
        }
        if (idsEqual(state.ui.editingOrderId, orderId)) {
          state.ui.editingOrderId = null;
        }
        if (state.ui.inlinePdfViewer?.sourceType === 'order' && idsEqual(state.ui.inlinePdfViewer?.sourceId, orderId)) {
          state.ui.inlinePdfViewer = null;
        }
        stampBaseUpdate('orders');
        render();
      }

      if (action === 'select-price-target') {
        const mode = actionBtn.dataset.priceMode || 'target';
        state.quote.selectedPriceMode = mode;
        const calc = window.ERMCalc.calculateQuote(state);
        if (mode === 'breakEven') state.quote.selectedPriceNet = calc.quoteSummary.breakEvenNet;
        if (mode === 'minimum') state.quote.selectedPriceNet = calc.quoteSummary.minimumNet;
        if (mode === 'target') state.quote.selectedPriceNet = calc.quoteSummary.targetUtilityNet;
        if (mode === 'ideal') state.quote.selectedPriceNet = calc.quoteSummary.idealNet;
        if (mode === 'custom' && (state.quote.customPriceGross === undefined || state.quote.customPriceGross === null)) {
          state.quote.customPriceGross = 0;
        }
        render();
      }

      if (action === 'clear-material-form') {
        state.ui.editingMaterialId = null;
        state.ui.databaseDraft = null;
        render();
      }

      if (action === 'save-product-type') {
        saveProductTypeFromForm();
      }

      if (action === 'export-product-types') {
        exportProductTypesBase();
      }

      if (action === 'import-product-types') {
        refs.productTypesImportInput?.click();
      }

      if (action === 'edit-product-type') {
        state.ui.editingProductTypeId = actionBtn.dataset.id;
        state.ui.productTypeDraft = { ...(state.database.productTypes.find((item) => item.id === actionBtn.dataset.id) || {}) };
        render();
      }

      if (action === 'delete-product-type') {
        if (!confirmSafe('¿Eliminar este tipo de producto?')) return;
        const removingId = actionBtn.dataset.id;
        const removing = state.database.productTypes.find((item) => item.id === removingId);
        state.database.productTypes = state.database.productTypes.filter((item) => item.id !== removingId);
        if (removing && state.quote.productName === removing.name) {
          state.quote.productName = '';
        }
        if (state.ui.editingProductTypeId === removingId) {
          state.ui.editingProductTypeId = null;
          state.ui.productTypeDraft = null;
        }
        stampBaseUpdate('productTypes');
        render();
      }

      if (action === 'clear-product-type-form') {
        state.ui.editingProductTypeId = null;
        state.ui.productTypeDraft = null;
        render();
      }

      if (action === 'save-external-resource') {
        saveExternalResourceFromForm();
      }

      if (action === 'export-external-resources') {
        exportExternalResourcesBase();
      }

      if (action === 'import-external-resources') {
        refs.externalResourcesImportInput?.click();
      }

      if (action === 'edit-external-resource') {
        state.ui.editingExternalResourceId = actionBtn.dataset.id;
        state.ui.externalResourceDraft = { ...(state.database.externalResources.find((item) => item.id === actionBtn.dataset.id) || {}) };
        render();
      }

      if (action === 'toggle-external-resource-status') {
        const current = state.database.externalResources.find((item) => item.id === actionBtn.dataset.id);
        if (current) current.status = current.status === 'Inactivo' ? 'Activo' : 'Inactivo';
        stampBaseUpdate('external');
        render();
      }

      if (action === 'delete-external-resource') {
        if (!confirmSafe('¿Eliminar este registro de ayuda externa?')) return;
        const resourceId = actionBtn.dataset.id;
        state.database.externalResources = state.database.externalResources.filter((item) => item.id !== resourceId);
        state.quote.labor = state.quote.labor.map((item) => (item.employeeId === resourceId ? { ...item, employeeId: '', rate: 0 } : item));
        if (state.ui.editingExternalResourceId === resourceId) {
          state.ui.editingExternalResourceId = null;
          state.ui.externalResourceDraft = null;
        }
        stampBaseUpdate('external');
        render();
      }

      if (action === 'export-all-bases') {
        exportAllBases();
      }

      if (action === 'export-all-bases-zip') {
        exportAllBasesAsZip();
      }

      if (action === 'export-full-database') {
        exportFullDatabase();
      }

      if (action === 'import-all-bases' || action === 'import-full-database') {
        refs.allBasesImportInput?.click();
      }

      if (action === 'recover-desktop-attachments') {
        refs.recoverAttachmentsInput?.click();
      }

      if (action === 'delete-base-entry') {
        const baseKey = actionBtn.dataset.baseKey || '';
        if (!baseKey || baseKey === 'inventoryCompany') return;
        const baseName = baseLabels[baseKey] || 'Base';
        const confirmed = confirmSafe(`¿Eliminar completamente ${baseName} del sistema? Esta acción no se puede deshacer.`);
        if (!confirmed) return;
        clearBaseData(baseKey);
        window.ERMStorage.save(state);
        window.alert(`${baseName} eliminada correctamente.`);
        render();
        return;
      }

      if (action === 'delete-all-bases') {
        const confirmed = confirmSafe('¿Eliminar TODAS las bases de la app? Esta acción no se puede deshacer.');
        if (!confirmed) return;
        [
          'scenario',
          'database',
          'productTypes',
          'external',
          'contacts',
          'orders',
          'desired',
          'expenses',
          'attendance',
          'finance'
        ].forEach((key) => clearBaseData(key));
        window.ERMStorage.save(state);
        window.alert('Todas las bases fueron eliminadas correctamente.');
        render();
        return;
      }

      if (action === 'check-in-attendance') {
        state.attendance = state.attendance || { activeSession: null, records: [] };
        state.attendance.records = state.attendance.records || [];

        const employee = String(document.getElementById('attendance-employee')?.value || '').trim();
        const comments = String(document.getElementById('attendance-comments')?.value || '').trim();

        const nowIso = new Date().toISOString();

        if (state.attendance.activeSession) {
          window.alert('Ya existe un turno activo. Marca salida antes de iniciar uno nuevo.');
          return;
        }

        if (!employee) {
          window.alert('Selecciona un empleado para registrar la hora de entrada.');
          return;
        }

        state.attendance.activeSession = {
          id: uid('att-session'),
          employeeName: employee,
          checkInAt: nowIso,
          comments,
          pausedAccumulatedMs: 0,
          isPaused: false,
          pauseStartedAt: null,
          pauseCount: 0,
          workedAccumulatedMs: 0,
          activeWorkStartedAt: nowIso,
          workSegments: []
        };
        stampBaseUpdate('attendance', { silent: true });
        logActivity(`Se inició un turno: ${employee}`);
        window.ERMStorage.save(state);
        render();
        syncAttendanceCommentsInput();
        return;
      }

      if (action === 'toggle-attendance-pause') {
        const activeSession = state.attendance?.activeSession;
        if (!activeSession) {
          window.alert('No hay un turno activo para pausar o reanudar.');
          return;
        }

        const nowIso = new Date().toISOString();
        const nowMs = new Date(nowIso).getTime();
        if (Number.isNaN(nowMs)) return;

        activeSession.workSegments = Array.isArray(activeSession.workSegments) ? activeSession.workSegments : [];
        activeSession.pausedAccumulatedMs = Math.max(0, Number(activeSession.pausedAccumulatedMs) || 0);
        activeSession.pauseCount = Math.max(0, Number(activeSession.pauseCount) || 0);

        if (activeSession.isPaused) {
          const pauseStartedMs = new Date(activeSession.pauseStartedAt || '').getTime();
          if (!Number.isNaN(pauseStartedMs) && nowMs > pauseStartedMs) {
            activeSession.pausedAccumulatedMs += nowMs - pauseStartedMs;
          }
          activeSession.isPaused = false;
          activeSession.pauseStartedAt = null;
          activeSession.activeWorkStartedAt = nowIso;
        } else {
          const activeWorkStartedMs = new Date(activeSession.activeWorkStartedAt || activeSession.checkInAt || '').getTime();
          if (!Number.isNaN(activeWorkStartedMs) && nowMs > activeWorkStartedMs) {
            activeSession.workSegments.push({
              startAt: new Date(activeWorkStartedMs).toISOString(),
              endAt: nowIso
            });
          }
          activeSession.activeWorkStartedAt = null;
          activeSession.isPaused = true;
          activeSession.pauseStartedAt = nowIso;
          activeSession.pauseCount += 1;
        }

        stampBaseUpdate('attendance');
        window.ERMStorage.save(state);
        render();
        syncAttendanceCommentsInput();
        return;
      }

      if (action === 'check-out-attendance') {
        const activeSession = state.attendance.activeSession;
        if (!activeSession) {
          window.alert('No hay un turno activo para marcar salida.');
          return;
        }

        const checkOutAt = new Date().toISOString();
        const checkOutMs = new Date(checkOutAt).getTime();
        const checkInMs = new Date(activeSession.checkInAt || '').getTime();
        if (Number.isNaN(checkOutMs) || Number.isNaN(checkInMs)) {
          window.alert('No se pudo calcular correctamente la duración del turno.');
          return;
        }

        activeSession.workSegments = Array.isArray(activeSession.workSegments) ? activeSession.workSegments : [];
        let pausedAccumulatedMs = Math.max(0, Number(activeSession.pausedAccumulatedMs) || 0);

        if (activeSession.isPaused && activeSession.pauseStartedAt) {
          const pauseStartedMs = new Date(activeSession.pauseStartedAt).getTime();
          if (!Number.isNaN(pauseStartedMs) && checkOutMs > pauseStartedMs) {
            pausedAccumulatedMs += checkOutMs - pauseStartedMs;
          }
        }

        if (!activeSession.isPaused) {
          const activeWorkStartedMs = new Date(activeSession.activeWorkStartedAt || activeSession.checkInAt || '').getTime();
          if (!Number.isNaN(activeWorkStartedMs) && checkOutMs > activeWorkStartedMs) {
            activeSession.workSegments.push({
              startAt: new Date(activeWorkStartedMs).toISOString(),
              endAt: checkOutAt
            });
          }
        }

        const totalMs = Math.max(0, checkOutMs - checkInMs);
        const workedMs = Math.max(0, totalMs - pausedAccumulatedMs);
        const comments = String(document.getElementById('attendance-comments')?.value || '').trim();
        state.attendance.records.unshift({
          id: uid('att-record'),
          employeeName: activeSession.employeeName,
          checkInAt: activeSession.checkInAt,
          checkOutAt,
          totalMs,
          workedMs,
          pauseMs: pausedAccumulatedMs,
          pauseCount: Math.max(0, Number(activeSession.pauseCount) || 0),
          workSegments: activeSession.workSegments
            .filter((seg) => seg && seg.startAt && seg.endAt)
            .map((seg) => ({ startAt: seg.startAt, endAt: seg.endAt })),
          comments: comments || activeSession.comments || ''
        });
        state.attendance.activeSession = null;
        state.ui.attendanceEditingId = null;
        stampBaseUpdate('attendance', { silent: true });
        logActivity(`Se cerró el turno: ${activeSession.employeeName}`);
        window.ERMStorage.save(state);
        render();
        syncAttendanceCommentsInput();
        return;
      }

      if (action === 'view-attendance-record') {
        const recordId = actionBtn.dataset.id;
        if (!recordId) return;
        openAttendanceRecordModal(recordId);
        return;
      }

      if (action === 'close-attendance-record-modal') {
        closeAttendanceRecordModal();
        return;
      }

      if (action === 'edit-attendance-record') {
        const recordId = actionBtn.dataset.id;
        if (!recordId) return;
        if (!getAttendanceRecordById(recordId)) return;
        closeAttendanceRecordModal();
        state.ui.attendanceEditingId = recordId;
        render();
        syncAttendanceEditCommentsInput();
        document.getElementById('attendance-edit-date')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
      }

      if (action === 'cancel-attendance-edit') {
        state.ui.attendanceEditingId = null;
        render();
        return;
      }

      if (action === 'save-attendance-edit') {
        const recordId = state.ui.attendanceEditingId;
        const record = getAttendanceRecordById(recordId);
        if (!record) return;

        const employeeName = String(document.getElementById('attendance-edit-employee')?.value || '').trim();
        const dateValue = String(document.getElementById('attendance-edit-date')?.value || '').trim();
        const checkInTime = String(document.getElementById('attendance-edit-checkin')?.value || '').trim();
        const checkOutTime = String(document.getElementById('attendance-edit-checkout')?.value || '').trim();
        const comments = String(document.getElementById('attendance-edit-comments')?.value || '').trim();

        if (!employeeName || !dateValue || !checkInTime || !checkOutTime) {
          window.alert('Completa fecha, empleado, hora de entrada y hora de salida para guardar.');
          return;
        }

        const checkInAt = buildAttendanceIso(dateValue, checkInTime);
        const checkOutAt = buildAttendanceIso(dateValue, checkOutTime);
        if (!checkInAt || !checkOutAt) {
          window.alert('No se pudo interpretar la fecha u hora ingresada.');
          return;
        }

        if (!(new Date(checkOutAt).getTime() > new Date(checkInAt).getTime())) {
          window.alert('La hora de salida debe ser posterior a la hora de entrada.');
          return;
        }

        const editedTotalMs = getAttendanceTotalMs(checkInAt, checkOutAt);
        state.attendance.records = (state.attendance.records || []).map((item) => (
          item.id === recordId
            ? {
              ...item,
              employeeName,
              checkInAt,
              checkOutAt,
              totalMs: editedTotalMs,
              workedMs: editedTotalMs,
              comments
            }
            : item
        ));

        state.ui.attendanceEditingId = null;
        stampBaseUpdate('attendance');
        window.ERMStorage.save(state);
        render();
        return;
      }

      if (action === 'delete-attendance-record') {
        const recordId = actionBtn.dataset.id;
        if (!recordId) return;
        if (!confirmSafe('¿Eliminar este registro de asistencia?')) return;
        closeAttendanceRecordModal();
        state.attendance.records = (state.attendance.records || []).filter((item) => item.id !== recordId);
        if (state.ui.attendanceEditingId === recordId) state.ui.attendanceEditingId = null;
        stampBaseUpdate('attendance');
        window.ERMStorage.save(state);
        render();
        return;
      }

      if (action === 'save-all-bases-now') {
        const baseKeys = ['scenario', 'database', 'productTypes', 'external', 'contacts', 'orders', 'desired', 'expenses', 'attendance', 'finance'];
        baseKeys.forEach((key) => stampBaseUpdate(key, { silent: true }));
        logActivity('Se guardaron todas las bases de datos');
        triggerSaveFeedback('backup', null);
      }

      if (action === 'export-scenario-base') {
        exportScenarioBase();
      }

      if (action === 'import-scenario-base') {
        refs.scenarioImportInput?.click();
      }

      if (action === 'import-orders-base') {
        refs.orderImportInput?.click();
      }

      if (action === 'import-expenses-base') {
        refs.expenseImportInput?.click();
      }

      if (action === 'import-desired-base') {
        refs.desiredImportInput?.click();
      }

      if (action === 'import-attendance-base') {
        refs.attendanceImportInput?.click();
      }

      if (action === 'export-orders-base') {
        exportOrdersBase();
      }

      if (action === 'export-expenses-base') {
        exportExpensesBase();
      }

      if (action === 'export-desired-base') {
        exportDesiredEquipmentBase();
      }

      if (action === 'export-attendance-base') {
        exportAttendanceBase();
      }

      if (action === 'import-finance-base') {
        refs.financeImportInput?.click();
      }

      if (action === 'export-finance-base') {
        exportFinanceBase();
      }

      if (action === 'print-finance-pdf') {
        const allEntries = state.finance?.entries || [];
        const initialBalance = Number(state.finance?.initialBalance || 0);
        const openingIvaCredit = Number(state.finance?.ivaCreditBalance || 0);
        const html = buildFinancePrintHTML(allEntries, initialBalance, openingIvaCredit);
        const win = window.open('', '_blank');
        if (!win) {
          window.alert('El navegador bloqueó la ventana emergente. Permite ventanas emergentes para esta app e intenta de nuevo.');
          return;
        }
        win.document.write(html);
        win.document.close();
        win.focus();
        // Slight delay to ensure CSS/fonts are parsed before print dialog
        setTimeout(() => { try { win.print(); } catch (_) {} }, 600);
        return;
      }

      if (action === 'add-finance-entry') {
        state.finance = state.finance || { initialBalance: 0, entries: [] };
        const date = String(document.getElementById('fin-date')?.value || '').trim();
        const category = String(document.getElementById('fin-category')?.value || 'Varios');
        // Context zone: OT for Ventas/Abono venta, material group/item for Materiales
        const orderSelect = document.getElementById('fin-order');
        const orderId = String(orderSelect?.value || '');
        const selectedOption = orderSelect?.options[orderSelect?.selectedIndex];
        const otRef = orderId ? String(selectedOption?.dataset?.ref || '') : '';
        const matGroup = String(document.getElementById('fin-mat-group')?.value || '');
        const matItem = document.getElementById('fin-mat-item');
        const matItemName = matItem ? String(matItem.options[matItem.selectedIndex]?.text || '').replace('— elige insumo —', '').trim() : '';
        const gastoType = String(document.getElementById('fin-gasto-type')?.value || '');
        const salidaGeneralType = String(document.getElementById('fin-salida-general-type-input')?.value || '').trim();
        const resolvedGastoType = category === 'Salida General' ? salidaGeneralType : gastoType;
        const gastoCardSel = document.getElementById('fin-gasto-card');
        const expenseCardId = String(gastoCardSel?.value || '');
        const gastoCardName = expenseCardId ? String(gastoCardSel?.options[gastoCardSel?.selectedIndex]?.text || '') : '';
        // Sueldo-specific
        const sueldoOtSel = document.getElementById('fin-sueldo-ot');
        const sueldoOtId = String(sueldoOtSel?.value || '');
        const sueldoOtRef = sueldoOtId ? String(sueldoOtSel?.options[sueldoOtSel?.selectedIndex]?.dataset?.ref || '') : '';
        const sueldoEmpSel = document.getElementById('fin-sueldo-employee');
        const employeeId = String(sueldoEmpSel?.value || '');
        const employeeRef = employeeId ? String(sueldoEmpSel?.options[sueldoEmpSel?.selectedIndex]?.text || '') : '';
        const orderRef = category === 'Ventas' ? otRef
          : category === 'Materiales' ? (matGroup || '')
          : category === 'Gastos Administrativos' ? (gastoCardName || resolvedGastoType || '')
          : category === 'Salida General' ? (resolvedGastoType || '')
          : category === 'Sueldo' ? (employeeRef || sueldoOtRef || '')
          : category === 'Herramientas' ? ''
          : '';
        // Attachment for Herramientas
        const finDraftPdf = state.ui.financeDraft || {};
        const draftAttachments = category === 'Herramientas'
          ? getOwnerAttachments(finDraftPdf, legacyFinanceAttachment)
          : [];
        const income = Math.max(0, parseClpNumber(document.getElementById('fin-income')?.value || 0));
        const expense = Math.max(0, parseClpNumber(document.getElementById('fin-expense')?.value || 0));
        const title = String(document.getElementById('fin-title')?.value || '').trim();
        const detail = String(document.getElementById('fin-detail')?.value || '').trim();
        const ivaIncluded = Boolean(document.getElementById('fin-iva-included')?.checked);
        const savingsEndDate = String(document.getElementById('fin-savings-end-date')?.value || '').trim();

        if (!date) {
          window.alert('Ingresa la fecha del movimiento.');
          return;
        }
        if (income === 0 && expense === 0) {
          window.alert('Ingresa un ingreso o egreso distinto de cero.');
          return;
        }
        if (category === 'Salida General' && !resolvedGastoType) {
          window.alert('Ingresa el tipo manual para Salida General.');
          return;
        }

        // For Materiales with no manual title: use material name if selected
        const resolvedTitle = title
          || (category === 'Materiales' && matItemName ? matItemName : '')
          || (category === 'Salida General' ? resolvedGastoType : '');
        if (!resolvedTitle) {
          window.alert('Ingresa un título para el movimiento.');
          return;
        }
        const resolvedOrderId = category === 'Ventas' ? orderId
          : category === 'Sueldo' ? sueldoOtId
          : '';
        const editingEntryId = state.ui.financeEditingEntryId || null;
        if (editingEntryId) {
          // Update existing entry
          const editIdx = (state.finance.entries || []).findIndex((e) => e.id === editingEntryId);
          if (editIdx >= 0) {
            const existingEntry = state.finance.entries[editIdx];
            const existingAttachments = getOwnerAttachments(existingEntry, legacyFinanceAttachment);
            const resolvedAttachments = category === 'Herramientas'
              ? (draftAttachments.length ? draftAttachments : existingAttachments)
              : [];
            state.finance.entries[editIdx] = createFinanceEntry({
              ...existingEntry,
              date, category, orderId: resolvedOrderId, orderRef, gastoType: resolvedGastoType, expenseCardId, employeeId, employeeRef,
              title: resolvedTitle, detail, income, expense, ivaIncluded, savingsEndDate,
              attachments: resolvedAttachments,
              pdfDataUrl: '',
              pdfName: '',
              pdfMimeType: '',
              pdfSizeKb: 0
            });
            if (category === 'Salida General') saveFinanceQuickOutflowType(resolvedGastoType);
          }
          state.ui.financeEditingEntryId = null;
        } else {
          const entry = createFinanceEntry({
            date,
            category,
            orderId: resolvedOrderId,
            orderRef,
            gastoType: resolvedGastoType,
            expenseCardId,
            employeeId,
            employeeRef,
            title: resolvedTitle,
            detail,
            income,
            expense,
            ivaIncluded,
            savingsEndDate,
            attachments: draftAttachments,
            pdfDataUrl: '',
            pdfName: '',
            pdfMimeType: '',
            pdfSizeKb: 0
          });
          state.finance.entries.unshift(entry);
          if (category === 'Salida General') saveFinanceQuickOutflowType(resolvedGastoType);
        }
        state.ui.financeDraft = defaultFinanceDraft();
        stampBaseUpdate('finance');
        window.ERMStorage.save(state);
        render();
        return;
      }

      if (action === 'clear-finance-form') {
        state.ui.financeDraft = defaultFinanceDraft();
        state.ui.financeEditingEntryId = null;
        render();
        return;
      }

      if (action === 'finance-page-prev') {
        state.ui.financePage = Math.max(0, (Number(state.ui.financePage) || 0) - 1);
        render();
        return;
      }

      if (action === 'finance-page-next') {
        state.ui.financePage = (Number(state.ui.financePage) || 0) + 1;
        render();
        return;
      }

      if (action === 'edit-finance-entry') {
        const entryId = actionBtn.dataset.id;
        const entry = (state.finance?.entries || []).find((e) => e.id === entryId);
        if (!entry) return;
        state.ui.financeDraft = JSON.parse(JSON.stringify(entry));
        state.ui.financeEditingEntryId = entryId;
        state.ui.editingFinanceId = null;
        render();
        document.querySelector('.finance-entry-form')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
      }

      if (action === 'cancel-finance-edit') {
        state.ui.editingFinanceId = null;
        state.ui.financeEditingEntryId = null;
        state.ui.financeDraft = defaultFinanceDraft();
        render();
        return;
      }

      if (action === 'save-finance-edit') {
        const entryId = actionBtn.dataset.id;
        if (!entryId) return;
        const index = (state.finance?.entries || []).findIndex((e) => e.id === entryId);
        if (index < 0) return;

        const date = String(document.getElementById('edit-fin-date')?.value || '').trim();
        const category = String(document.getElementById('edit-fin-category')?.value || 'Varios');
        const orderSelect = document.getElementById('edit-fin-order');
        const orderId = String(orderSelect?.value || '');
        const selectedOption = orderSelect?.options[orderSelect?.selectedIndex];
        const orderRef = orderId ? String(selectedOption?.dataset?.ref || '') : '';
        const income = Math.max(0, parseClpNumber(document.getElementById('edit-fin-income')?.value || 0));
        const expense = Math.max(0, parseClpNumber(document.getElementById('edit-fin-expense')?.value || 0));
        const title = String(document.getElementById('edit-fin-title')?.value || '').trim();
        const detail = String(document.getElementById('edit-fin-detail')?.value || '').trim();
        const ivaIncluded = Boolean(document.getElementById('edit-fin-iva-included')?.checked);

        if (!date) {
          window.alert('Ingresa la fecha del movimiento.');
          return;
        }
        if (income === 0 && expense === 0) {
          window.alert('Ingresa un ingreso o egreso distinto de cero.');
          return;
        }
        if (!title) {
          window.alert('Ingresa un título para el movimiento.');
          return;
        }

        state.finance.entries[index] = createFinanceEntry({
          ...state.finance.entries[index],
          date,
          category,
          orderId,
          orderRef,
          title,
          detail,
          income,
          expense,
          ivaIncluded
        });
        state.ui.editingFinanceId = null;
        stampBaseUpdate('finance');
        window.ERMStorage.save(state);
        render();
        return;
      }

      if (action === 'delete-finance-entry') {
        const entryId = actionBtn.dataset.id;
        const entry = (state.finance?.entries || []).find((e) => e.id === entryId);
        const label = entry ? `"${entry.title || entry.date}"` : 'este movimiento';
        if (!confirmSafe(`¿Eliminar ${label}? Esta acción no se puede deshacer.`)) return;
        state.finance.entries = (state.finance.entries || []).filter((e) => e.id !== entryId);
        if (state.ui.editingFinanceId === entryId) state.ui.editingFinanceId = null;
        stampBaseUpdate('finance');
        window.ERMStorage.save(state);
        render();
        return;
      }

      if (action === 'save-finance-initial-balance') {
        const val = parseClpNumber(document.getElementById('finance-initial-balance')?.value || 0);
        state.finance = state.finance || { initialBalance: 0, entries: [] };
        state.finance.initialBalance = Math.max(0, val);
        state.finance.initialBalanceLocked = true;
        stampBaseUpdate('finance');
        window.ERMStorage.save(state);
        render();
        return;
      }

      if (action === 'toggle-finance-balance-lock') {
        state.finance = state.finance || { initialBalance: 0, entries: [] };
        state.finance.initialBalanceLocked = !state.finance.initialBalanceLocked;
        window.ERMStorage.save(state);
        render();
        return;
      }

      if (action === 'save-finance-iva-credit-balance') {
        const val = parseClpNumber(document.getElementById('finance-iva-credit-balance')?.value || 0);
        state.finance = state.finance || { initialBalance: 0, ivaCreditBalance: 0, entries: [] };
        state.finance.ivaCreditBalance = Math.max(0, val);
        state.finance.ivaCreditBalanceLocked = true;
        stampBaseUpdate('finance');
        window.ERMStorage.save(state);
        render();
        return;
      }

      if (action === 'toggle-finance-iva-credit-lock') {
        state.finance = state.finance || { initialBalance: 0, ivaCreditBalance: 0, entries: [] };
        state.finance.ivaCreditBalanceLocked = !state.finance.ivaCreditBalanceLocked;
        window.ERMStorage.save(state);
        render();
        return;
      }

      if (action === 'change-finance-month-filter') {
        state.ui.financeMonthFilter = String(document.getElementById('fin-month-filter')?.value || '');
        render();
        return;
      }

      if (action === 'change-finance-category-filter') {
        state.ui.financeCategoryFilter = String(document.getElementById('fin-cat-filter')?.value || 'Todas');
        render();
        return;
      }

      if (action === 'clear-finance-filters') {
        state.ui.financeMonthFilter = '';
        state.ui.financeCategoryFilter = 'Todas';
        render();
        return;
      }

      if (action === 'toggle-finance-abono') {
        const titleInput = document.getElementById('fin-title');
        if (!titleInput) return;
        const t = titleInput.value;
        if (t.toLowerCase().includes('abono')) {
          titleInput.value = t.replace(/\s*[·\-]\s*[Aa]bono\b/g, '').replace(/\b[Aa]bono\b\s*[·\-]?\s*/g, '').trim();
        } else {
          titleInput.value = (t ? t + ' · Abono' : 'Abono').trim();
        }
        const titleActions = document.getElementById('fin-title-actions');
        if (titleActions) {
          const nowHasAbono = titleInput.value.toLowerCase().includes('abono');
          titleActions.innerHTML = `<button type="button" class="btn btn-soft btn-xs" data-action="toggle-finance-abono">${nowHasAbono ? '− Quitar "Abono" del nombre' : '+ Agregar "Abono" al nombre'}</button>`;
        }
        return;
      }

      if (action === 'toggle-finance-sueldo') {
        const titleInput = document.getElementById('fin-title');
        if (!titleInput) return;
        const t = titleInput.value;
        if (t.toLowerCase().includes('sueldo')) {
          titleInput.value = t.replace(/\s*[·\-]\s*[Ss]ueldo\b/g, '').replace(/\b[Ss]ueldo\b\s*[·\-]?\s*/g, '').trim();
        } else {
          titleInput.value = (t ? t + ' · Sueldo' : 'Sueldo').trim();
        }
        const titleActions = document.getElementById('fin-title-actions');
        if (titleActions) {
          const nowHasSueldo = titleInput.value.toLowerCase().includes('sueldo');
          titleActions.innerHTML = `<button type="button" class="btn btn-soft btn-xs" data-action="toggle-finance-sueldo">${nowHasSueldo ? '− Quitar "Sueldo" del nombre' : '+ Agregar "Sueldo" al nombre'}</button>`;
        }
        return;
      }

      if (action === 'add-desired-offer-row') {
        state.ui.desiredDraft = state.ui.desiredDraft || defaultDesiredDraft();
        state.ui.desiredDraft.offers = state.ui.desiredDraft.offers || [];
        state.ui.desiredDraft.offers.push({ id: uid('off'), price: 0, link: '', entryDate: new Date().toISOString().slice(0, 10) });
        render();
      }

      if (action === 'remove-desired-offer-row') {
        const offerId = actionBtn.dataset.offerId;
        state.ui.desiredDraft = state.ui.desiredDraft || defaultDesiredDraft();
        state.ui.desiredDraft.offers = (state.ui.desiredDraft.offers || []).filter((item) => item.id !== offerId);
        if (!(state.ui.desiredDraft.offers || []).length) {
          state.ui.desiredDraft.offers = [{ id: uid('off'), price: 0, link: '', entryDate: new Date().toISOString().slice(0, 10) }];
        }
        render();
      }

      if (action === 'save-desired-item') {
        saveDesiredItemFromForm();
      }

      if (action === 'clear-desired-form') {
        state.ui.editingDesiredId = null;
        state.ui.desiredDraft = defaultDesiredDraft();
        render();
      }

      if (action === 'edit-desired-item') {
        const current = (state.inventory.desiredItems || []).find((item) => item.id === actionBtn.dataset.id);
        if (!current) return;
        state.ui.editingDesiredId = current.id;
        state.ui.desiredDraft = JSON.parse(JSON.stringify(current));
        if (!(state.ui.desiredDraft.offers || []).length) {
          state.ui.desiredDraft.offers = [{ id: uid('off'), price: 0, link: '', entryDate: new Date().toISOString().slice(0, 10) }];
        }
        render();
      }

      if (action === 'delete-desired-item') {
        if (!confirmSafe('¿Eliminar este equipo del inventario?')) return;
        const desiredId = actionBtn.dataset.id;
        state.inventory.desiredItems = (state.inventory.desiredItems || []).filter((item) => item.id !== desiredId);
        if (state.ui.editingDesiredId === desiredId) {
          state.ui.editingDesiredId = null;
          state.ui.desiredDraft = defaultDesiredDraft();
        }
        stampBaseUpdate('database');
        stampBaseUpdate('desired');
        render();
      }

      if (action === 'toggle-desired-status') {
        const current = (state.inventory.desiredItems || []).find((item) => item.id === actionBtn.dataset.id);
        if (current) {
          current.status = current.status === 'Inactivo' ? 'Activo' : 'Inactivo';
          stampBaseUpdate('database');
          stampBaseUpdate('desired');
        }
        render();
      }

      if (action === 'toggle-desired-expand') {
        const current = (state.inventory.desiredItems || []).find((item) => item.id === actionBtn.dataset.id);
        if (current) current.expanded = !current.expanded;
        render();
      }

      if (action === 'clear-external-resource-form') {
        state.ui.editingExternalResourceId = null;
        state.ui.externalResourceDraft = null;
        render();
      }

      if (action === 'apply-min-price') {
        const calc = window.ERMCalc.calculateQuote(state);
        state.quote.selectedPriceMode = 'minimum';
        state.quote.selectedPriceNet = calc.quoteSummary.minimumNet;
        render();
      }

      if (action === 'apply-ideal-price') {
        const calc = window.ERMCalc.calculateQuote(state);
        state.quote.selectedPriceMode = 'ideal';
        state.quote.selectedPriceNet = calc.quoteSummary.idealNet;
        render();
      }

      if (action === 'edit-material') {
        state.ui.editingMaterialId = actionBtn.dataset.id;
        state.ui.databaseDraft = { ...(state.database.materials.find((item) => item.id === actionBtn.dataset.id) || {}) };
        state.currentView = 'database';
        render();
      }

      if (action === 'duplicate-material') {
        const source = state.database.materials.find((item) => item.id === actionBtn.dataset.id);
        if (source) {
          state.ui.editingMaterialId = null;
          state.ui.databaseDraft = {
            ...source,
            name: `${source.name} (copia)`,
            createdAt: new Date().toLocaleDateString('es-CL')
          };
          state.currentView = 'database';
        }
        render();
      }

      if (action === 'toggle-material-status') {
        const current = state.database.materials.find((item) => item.id === actionBtn.dataset.id);
        if (current) {
          current.status = current.status === 'Inactivo' ? 'Activo' : 'Inactivo';
        }
        render();
      }

      if (action === 'remove-material-image') {
        state.ui.databaseDraft = {
          ...(state.ui.databaseDraft || {}),
          imageDataUrl: '',
          imageName: '',
          imageMimeType: '',
          imageSizeKb: 0
        };
        render();
      }

      if (action === 'cancel-edit-material') {
        state.ui.editingMaterialId = null;
        state.ui.databaseDraft = null;
        render();
      }

      if (action === 'delete-material') {
        if (!confirmSafe('¿Estás seguro de que quieres eliminar este registro de la base de datos interna?')) {
          return;
        }
        state.database.materials = state.database.materials.filter((item) => item.id !== actionBtn.dataset.id);
        state.quote.materials = state.quote.materials.filter((item) => item.materialId !== actionBtn.dataset.id);
        if (state.ui.editingMaterialId === actionBtn.dataset.id) {
          state.ui.editingMaterialId = null;
          state.ui.databaseDraft = null;
        }
        stampBaseUpdate('database');
        render();
      }

      if (action === 'save-material') {
        saveMaterialFromForm();
      }

      if (action === 'export-order-json') {
        exportCurrentOrder();
      }

      if (action === 'export-order-print') {
        exportPrintableOrderSheet();
      }

      if (action === 'export-logistics-label') {
        exportLogisticsLabelSheet();
      }

      if (action === 'export-database') {
        exportDatabase('json');
      }

      if (action === 'export-database-csv') {
        exportDatabase('csv');
      }

      if (action === 'import-database') {
        refs.dbImportInput?.click();
      }

      if (action === 'export-contacts') {
        exportContacts();
      }

      if (action === 'import-contacts') {
        refs.contactImportInput?.click();
      }

      if (action === 'print-summary') {
        state.currentView = 'summary';
        render();
        window.print();
      }
    });

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && refs.notesModal && !refs.notesModal.classList.contains('is-hidden')) {
        closeNotesModal();
        return;
      }
      if (event.key === 'Escape' && refs.attendanceRecordModal && !refs.attendanceRecordModal.classList.contains('is-hidden')) {
        closeAttendanceRecordModal();
        return;
      }
      if (event.key === 'Escape' && refs.pickerModal && !refs.pickerModal.classList.contains('is-hidden')) {
        closePickerModal();
        return;
      }
      if (event.key === 'Escape' && state.ui.inlinePdfViewer?.dataUrl) {
        closeInlinePdfViewer();
      }
    });

    refs.dbImportInput?.addEventListener('change', async (event) => {
      const file = event.target.files?.[0];
      if (file) {
        await importDatabaseFromFile(file);
      }
      event.target.value = '';
    });

    refs.scenarioImportInput?.addEventListener('change', async (event) => {
      const file = event.target.files?.[0];
      if (file) {
        await importScenarioFromFile(file);
      }
      event.target.value = '';
    });

    refs.contactImportInput?.addEventListener('change', async (event) => {
      const file = event.target.files?.[0];
      if (file) {
        await importContactsFromFile(file);
      }
      event.target.value = '';
    });

    refs.productTypesImportInput?.addEventListener('change', async (event) => {
      const file = event.target.files?.[0];
      if (file) {
        await importProductTypesFromFile(file);
      }
      event.target.value = '';
    });

    refs.externalResourcesImportInput?.addEventListener('change', async (event) => {
      const file = event.target.files?.[0];
      if (file) {
        await importExternalResourcesFromFile(file);
      }
      event.target.value = '';
    });

    refs.orderImportInput?.addEventListener('change', async (event) => {
      const file = event.target.files?.[0];
      if (file) {
        await importOrdersFromFiles([file]);
      }
      event.target.value = '';
    });

    refs.expenseImportInput?.addEventListener('change', async (event) => {
      const file = event.target.files?.[0];
      if (file) {
        await importExpensesFromFile(file);
      }
      event.target.value = '';
    });

    refs.desiredImportInput?.addEventListener('change', async (event) => {
      const file = event.target.files?.[0];
      if (file) {
        await importDesiredEquipmentFromFile(file);
      }
      event.target.value = '';
    });

    refs.attendanceImportInput?.addEventListener('change', async (event) => {
      const file = event.target.files?.[0];
      if (file) {
        await importAttendanceFromFile(file);
      }
      event.target.value = '';
    });

    refs.financeImportInput?.addEventListener('change', async (event) => {
      const file = event.target.files?.[0];
      if (file) {
        await importFinanceFromFile(file);
      }
      event.target.value = '';
    });

    refs.allBasesImportInput?.addEventListener('change', async (event) => {
      const files = Array.from(event.target.files || []);
      if (files.length) {
        await importAllBasesFromFiles(files);
      }
      event.target.value = '';
    });

    refs.recoverAttachmentsInput?.addEventListener('change', async (event) => {
      const files = Array.from(event.target.files || []);
      if (files.length) {
        await recoverDesktopAttachments(files);
      }
      event.target.value = '';
    });

    document.addEventListener('change', async (event) => {
      const target = event.target;
      if (!target?.dataset?.orderInvoicePdf) return;
      const file = target.files?.[0];
      const orderId = target.dataset.orderId || '';
      if (!file || !orderId) return;

      if (!isPdfFile(file)) {
        window.alert('Solo se permiten archivos PDF para boleta/factura.');
        target.value = '';
        return;
      }

      const maxSizeBytes = 10 * 1024 * 1024;
      if (file.size > maxSizeBytes) {
        window.alert('El PDF supera el límite de 10 MB.');
        target.value = '';
        return;
      }

      try {
        const attachment = await storeAttachmentFromFile(file, 'order-invoice');
        const order = (state.orders || []).find((item) => item.id === orderId);
        if (!order) return;
        const previousAttachment = getPrimaryAttachment(order, legacyOrderInvoiceAttachment);
        if (previousAttachment) {
        }

        order.attachments = [attachment];
        order.invoicePdfDataUrl = '';
        order.invoicePdfName = '';
        order.invoicePdfMimeType = '';
        order.invoicePdfSizeKb = 0;
        if (order.quote) {
          order.quote.attachments = [attachment];
          order.quote.invoicePdfDataUrl = '';
          order.quote.invoicePdfName = '';
          order.quote.invoicePdfMimeType = '';
          order.quote.invoicePdfSizeKb = 0;
        }
        stampBaseUpdate('orders');
        render();
      } catch (error) {
        console.error(error);
        window.alert('No se pudo cargar la boleta/factura en PDF.');
      } finally {
        target.value = '';
      }
    });

    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      const target = event.target;
      if (!target || target.tagName === 'TEXTAREA' || target.type === 'file') return;

      const shouldCommitOnEnter = Boolean(
        target.dataset.model
        || target.dataset.collection
        || target.dataset.expenseDraft
        || target.dataset.expenseEntryField
        || target.dataset.dbDraft
        || target.dataset.contactDraft
        || target.dataset.productTypeDraft
        || target.dataset.externalResourceDraft
        || target.dataset.desiredDraft
        || target.dataset.desiredOfferField
      );

      if (!shouldCommitOnEnter) return;
      event.preventDefault();
      target.dispatchEvent(new Event('change', { bubbles: true }));
      target.blur();
    });

    document.addEventListener('change', (event) => {
      const target = event.target;

      if (target.id === 'material-image') {
        handleMaterialImageFile(target.files?.[0]);
        return;
      }

      if (target.id === 'desired-image') {
        handleDesiredImageFile(target.files?.[0]);
        return;
      }

      if (target.id === 'fin-order') {
        handleFinanceOTChange(target.value);
        return;
      }

      if (target.id === 'attendance-analytics-month') {
        state.ui.attendanceAnalyticsMonthKey = String(target.value || '').trim();
        if (!state.ui.attendanceAnalyticsWeekKey || !getAttendanceMonthWeekRanges(state.ui.attendanceAnalyticsMonthKey).some((week) => week.key === state.ui.attendanceAnalyticsWeekKey)) {
          state.ui.attendanceAnalyticsWeekKey = 'all';
        }
        window.ERMStorage.save(state);
        render();
        return;
      }

      if (target.id === 'attendance-analytics-week') {
        state.ui.attendanceAnalyticsWeekKey = String(target.value || 'all').trim();
        window.ERMStorage.save(state);
        render();
        return;
      }

      if (target.id === 'fin-category') {
        // Clear current form values before changing context
        const titleInput   = document.getElementById('fin-title');
        const detailInput  = document.getElementById('fin-detail');
        const incomeInput  = document.getElementById('fin-income');
        const expenseInput = document.getElementById('fin-expense');
        if (titleInput)   titleInput.value   = '';
        if (detailInput)  detailInput.value  = '';
        if (incomeInput)  incomeInput.value  = '0';
        if (expenseInput) expenseInput.value = '0';
        handleFinanceCategoryChange(target.value);
        // Ventas and Ingreso de Capital always start with IVA checked
        const ivaCheckbox = document.getElementById('fin-iva-included');
        if (ivaCheckbox) ivaCheckbox.checked = (target.value === 'Ventas' || target.value === 'Ingreso de Capital');
        return;
      }

      if (target.id === 'fin-mat-group') {
        handleFinanceMaterialGroupChange(target.value);
        return;
      }

      if (target.id === 'fin-gasto-type') {
        handleFinanceGastoTypeChange(target.value);
        return;
      }

      if (target.id === 'fin-gasto-card') {
        handleFinanceGastoCardChange(target.value);
        return;
      }

      if (target.id === 'fin-salida-general-type-select') {
        const typeInput = document.getElementById('fin-salida-general-type-input');
        const selectedType = String(target.value || '').trim();
        if (typeInput && selectedType) typeInput.value = selectedType;
        const titleInput = document.getElementById('fin-title');
        if (titleInput && !titleInput.value.trim() && selectedType) titleInput.value = selectedType;
        return;
      }

      if (target.id === 'fin-salida-general-type-input') {
        const typed = String(target.value || '').trim();
        const titleInput = document.getElementById('fin-title');
        if (titleInput && !titleInput.value.trim() && typed) titleInput.value = typed;
        return;
      }

      if (target.id === 'fin-sueldo-ot') {
        handleFinanceSueldoOTChange(target.value);
        return;
      }

      if (target.id === 'fin-sueldo-employee') {
        handleFinanceSueldoEmployeeChange(target.value);
        return;
      }

      if (target.id === 'fin-mat-item') {
        const selectedOpt = target.options[target.selectedIndex];
        const label = selectedOpt?.text || '';
        const titleInput = document.getElementById('fin-title');
        if (titleInput && !titleInput.value.trim() && label && label !== '— elige insumo —') {
          titleInput.value = label;
        }
        // Suggest the material's internal base cost in the expense field
        const rawCost = Number(selectedOpt?.dataset?.cost || 0);
        const costHint = document.getElementById('fin-mat-cost-hint');
        if (rawCost > 0) {
          const expenseInput = document.getElementById('fin-expense');
          if (expenseInput) {
            expenseInput.value = formatNumber(rawCost);
            expenseInput.dispatchEvent(new Event('input'));
          }
          if (costHint) costHint.innerHTML = `Valor BD: <strong style="color:var(--brand);">${formatCurrency(rawCost)}</strong>`;
        } else if (costHint) {
          costHint.innerHTML = '';
        }
        return;
      }

      if (target.dataset.expenseEntryPdf === 'true') {
        handleExpensePdfFile(target.files?.[0], target.dataset.entryId || '').finally(() => {
          target.value = '';
        });
        return;
      }

      if (target.id === 'fin-herramienta-pdf') {
        const file = target.files?.[0];
        if (!file) return;
        if (!isPdfFile(file)) { window.alert('Solo se permiten archivos PDF.'); target.value = ''; return; }
        if (file.size > 10 * 1024 * 1024) { window.alert('El PDF supera el límite de 10 MB.'); target.value = ''; return; }
        storeAttachmentFromFile(file, 'finance-herramienta').then(async (attachment) => {
          const previousAttachment = getPrimaryAttachment(state.ui.financeDraft, legacyFinanceAttachment);
          if (previousAttachment) {
          }
          state.ui.financeDraft = state.ui.financeDraft || {};
          state.ui.financeDraft.attachments = [attachment];
          state.ui.financeDraft.pdfDataUrl = '';
          state.ui.financeDraft.pdfName = '';
          state.ui.financeDraft.pdfMimeType = '';
          state.ui.financeDraft.pdfSizeKb = 0;
          render();
        }).catch((error) => {
          console.error(error);
          window.alert('No se pudo cargar el PDF seleccionado.');
        }).finally(() => {
          target.value = '';
        });
        return;
      }

      if (target.dataset.expenseDraft) {
        state.ui.expenseDraft = state.ui.expenseDraft || createExpenseCard({ period: 'mensual' });
        const key = target.dataset.expenseDraft;
        let value = parseValue(target);
        if (key === 'baseYear') {
          value = String(value || '').replace(/[^0-9]/g, '').slice(0, 4);
        }
        if (key === 'period') {
          const currentEntries = Array.isArray(state.ui.expenseDraft.entries) ? state.ui.expenseDraft.entries : [];
          const entriesToDrop = currentEntries.slice(getExpenseEntryCount(value));
          const wouldLoseData = entriesToDrop.some((entry) => (
            Number(entry?.amount || 0) > 0 ||
            entry?.status === 'pagado' ||
            String(entry?.notes || '').trim() ||
            (Array.isArray(entry?.attachments) && entry.attachments.length > 0) ||
            entry?.pdfDataUrl
          ));
          if (wouldLoseData && !window.confirm(`Cambiar el período descartará ${entriesToDrop.length} cuota(s) que ya tienen montos, comprobantes o estado de pago cargados. ¿Deseas continuar?`)) {
            render();
            return;
          }
        }
        state.ui.expenseDraft[key] = value;
        if (key === 'period') {
          state.ui.expenseDraft.entries = normalizeExpenseEntries(state.ui.expenseDraft.entries, value);
        }
        const draftToSave = state.ui.expenseDraft;
        if (expenseAutoSaveTimers['__card__']) window.clearTimeout(expenseAutoSaveTimers['__card__']);
        expenseAutoSaveTimers['__card__'] = window.setTimeout(() => {
          if (!String(draftToSave.name || '').trim() || !String(draftToSave.baseYear || '').trim()) return;
          const cardIndex = (state.expenses.cards || []).findIndex((c) => String(c.id) === String(draftToSave.id));
          if (cardIndex >= 0) {
            state.expenses.cards[cardIndex] = JSON.parse(JSON.stringify(draftToSave));
          }
          triggerSaveFeedback('expenses', 'expenses');
        }, 900);
        // Only re-render for structural fields; text inputs just update state without destroying focus
        if (key === 'period' || key === 'expenseType') render();
        return;
      }

      if (target.dataset.expenseEntryField) {
        const draft = state.ui.expenseDraft;
        const entryId = target.dataset.entryId;
        const field = target.dataset.expenseEntryField;
        if (!draft || !entryId || !field) return;
        draft.entries = (draft.entries || []).map((entry) => {
          if (entry.id !== entryId) return entry;
          return {
            ...entry,
            [field]: field === 'amount' ? (Number(parseValue(target)) || 0) : parseValue(target)
          };
        });
        render();
        return;
      }

      if (target.dataset.dbDraft) {
        state.ui.databaseDraft = {
          ...(state.ui.databaseDraft || {}),
          [target.dataset.dbDraft]: parseValue(target)
        };
        if (target.dataset.dbDraft === 'groupSelection' && target.value !== '__new__') {
          state.ui.databaseDraft.group = target.value;
        }
        return;
      }

      if (target.dataset.contactDraft) {
        state.ui.contactDraft = {
          ...(state.ui.contactDraft || {}),
          [target.dataset.contactDraft]: parseValue(target)
        };
        return;
      }

      if (target.dataset.productTypeDraft) {
        state.ui.productTypeDraft = {
          ...(state.ui.productTypeDraft || {}),
          [target.dataset.productTypeDraft]: parseValue(target)
        };
        return;
      }

      if (target.dataset.externalResourceDraft) {
        state.ui.externalResourceDraft = {
          ...(state.ui.externalResourceDraft || {}),
          [target.dataset.externalResourceDraft]: parseValue(target)
        };
        if (target.dataset.externalResourceDraft === 'type') {
          render();
        }
        return;
      }

      if (target.dataset.desiredDraft) {
        state.ui.desiredDraft = {
          ...(state.ui.desiredDraft || defaultDesiredDraft()),
          [target.dataset.desiredDraft]: parseValue(target)
        };
        return;
      }

      if (target.dataset.desiredOfferField) {
        const offerId = target.dataset.offerId;
        const field = target.dataset.desiredOfferField;
        state.ui.desiredDraft = state.ui.desiredDraft || defaultDesiredDraft();
        state.ui.desiredDraft.offers = (state.ui.desiredDraft.offers || []).map((item) => (
          item.id === offerId ? { ...item, [field]: parseValue(target) } : item
        ));
        return;
      }

      if (target.dataset.scenarioGoalStatus) {
        const goalId = target.dataset.scenarioGoalStatus;
        const nextStatus = String(target.value || 'en-periodo');
        const allowedStatus = new Set(['logrado', 'logrado-en-transcurso', 'no-logrado', 'en-periodo']);
        if (!allowedStatus.has(nextStatus)) return;

        state.scenario.personalGoals = (state.scenario.personalGoals || []).map((item) => {
          if (item.id !== goalId) return item;
          const next = { ...item, status: nextStatus };
          if (nextStatus === 'logrado-en-transcurso' && !next.achievedDuringAt) {
            next.achievedDuringAt = new Date().toISOString();
          }
          return next;
        });

        stampBaseUpdate('scenario');
        window.ERMStorage.save(state);
        render();
        return;
      }

      if (target.dataset.model) {
        setByPath(state, target.dataset.model, parseValue(target));

        if (target.dataset.model === 'quote.customPriceGross') {
          state.quote.selectedPriceMode = 'custom';
        }

        if (target.dataset.model === 'quote.customerId') {
          if (target.value === '__prospecto__') {
            state.quote.customerName = 'Cliente prospecto';
          }
          const contact = state.contacts.find((item) => item.id === target.value);
          if (contact) {
            state.quote.customerName = contact.name || contact.company || '';
            state.quote.logistics.recipientName = contact.name || contact.company || '';
            state.quote.logistics.recipientRut = contact.rut || '';
            state.quote.logistics.recipientEmail = contact.email || '';
            state.quote.logistics.recipientPhone = contact.whatsapp || '';
            state.quote.logistics.address = contact.address || '';
            state.quote.logistics.district = contact.district || '';
          }
        }

        if (target.dataset.model === 'quote.productName') {
          normalizeQuotePrototypeState(state.quote);
          render();
          return;
        }

        if (target.dataset.model === 'quote.logistics.mode') {
          if (target.value === 'metro' && !state.quote.logistics.passageCost) {
            state.quote.logistics.passageCost = 1500;
          }
          if (target.value === 'domicilio') {
            if (!state.quote.logistics.fuelEfficiencyKmL) state.quote.logistics.fuelEfficiencyKmL = 14;
            if (!state.quote.logistics.fuelPricePerLiter) state.quote.logistics.fuelPricePerLiter = 1300;
            if (!state.quote.logistics.deliveryHourRate) {
              state.quote.logistics.deliveryHourRate = Math.round(window.ERMCalc.averageLaborRate(state.scenario));
            }
          }
        }

        if (target.dataset.model === 'quote.pieceQuantity') {
          const parsedQty = Math.round(Number(state.quote.pieceQuantity));
          state.quote.pieceQuantity = Number.isFinite(parsedQty) && parsedQty >= 1 ? parsedQty : 1;
        }

        const mustRerenderMain = target.dataset.model === 'quote.customerId'
          || target.dataset.model === 'quote.logistics.mode'
          || target.dataset.model === 'quote.status'
          || target.dataset.model === 'quote.pieceQuantity';
        const isScenarioModel = String(target.dataset.model || '').startsWith('scenario.');
        if (mustRerenderMain || (isScenarioModel && state.currentView === 'scenario')) {
          render();
          return;
        }

        window.ERMStorage.save(state);
        if (state.currentView === 'quote') {
          const calc = window.ERMCalc.calculateQuote(state);
          renderSummary(calc);
        }
        return;
      }

      if (target.dataset.collection) {
        updateCollectionItem(target.dataset.collection, target.dataset.id, target.dataset.key, parseValue(target));

        let mustRerenderMain = false;

        if (target.dataset.collection === 'scenario.employees' && target.dataset.key === 'hourlyRate') {
          const employeeId = target.dataset.id;
          const newRate = Number(target.value) || 0;
          state.quote.labor = (state.quote.labor || []).map((line) => (
            line.employeeId === employeeId ? { ...line, rate: newRate } : line
          ));
        }

        if (target.dataset.collection === 'quote.materials') {
          const row = state.quote.materials.find((item) => item.id === target.dataset.id);
          if (row && target.dataset.key === 'group') {
            row.group = target.value || '';
            row.materialId = '';
            mustRerenderMain = true;
          }
          if (row && target.dataset.key === 'materialId') {
            // Se permite repetir el mismo insumo en varias líneas (distintas partes del producto).
            const material = state.database.materials.find((item) => item.id === target.value);
            if (material) {
              row.group = material.group;
            }
            mustRerenderMain = true;
          }
          if (row && (target.dataset.key === 'quantity' || target.dataset.key === 'wastePercent')) {
            mustRerenderMain = true;
          }
        }

        if (target.dataset.collection === 'quote.labor' && target.dataset.key === 'employeeId') {
          const employee = state.scenario.employees.find((item) => item.id === target.value);
          const external = state.database.externalResources.find((item) => item.id === target.value && item.status !== 'Inactivo');
          const row = state.quote.labor.find((item) => item.id === target.dataset.id);
          if (row) {
            if (external) {
              row.rate = Number(external.hourlyRate || 0);
              row.customEmployeeName = external.name || '';
            } else if (employee) {
              row.rate = employee.hourlyRate;
              row.customEmployeeName = '';
            } else {
              row.rate = 0;
              row.customEmployeeName = '';
            }
          }
          mustRerenderMain = true;
        }

        if (target.dataset.collection === 'quote.labor' && (target.dataset.key === 'hours' || target.dataset.key === 'rate')) {
          mustRerenderMain = true;
        }

        const isScenarioCollection = String(target.dataset.collection || '').startsWith('scenario.');
        if (mustRerenderMain || (isScenarioCollection && state.currentView === 'scenario')) {
          render();
          return;
        }

        window.ERMStorage.save(state);
        if (state.currentView === 'quote') {
          const calc = window.ERMCalc.calculateQuote(state);
          renderSummary(calc);
        }
        return;
      }
    });

    document.addEventListener('input', (event) => {
      if (event.target?.id === 'notes-general-input') {
        handleNotesEditorInput();
      }
      if (event.target?.id === 'fin-salida-general-type-input') {
        const typed = String(event.target.value || '').trim();
        const titleInput = document.getElementById('fin-title');
        if (titleInput && !titleInput.value.trim() && typed) {
          titleInput.value = typed;
        }
      }
      if (event.target?.id === 'fin-income') {
        const expField = document.getElementById('fin-expense');
        if (expField) {
          const hasValue = parseClpNumber(event.target.value) > 0;
          expField.disabled = hasValue;
          if (hasValue) expField.value = '0';
        }
      }
      if (event.target?.id === 'fin-expense') {
        const incField = document.getElementById('fin-income');
        if (incField) {
          const hasValue = parseClpNumber(event.target.value) > 0;
          incField.disabled = hasValue;
          if (hasValue) incField.value = '0';
        }
      }

      // Auto-save edits inside Gastos entries (debounced)
      if (event.target && event.target.dataset && event.target.dataset.expenseEntryField) {
        const entryId = String(event.target.dataset.entryId || '');
        const field = String(event.target.dataset.expenseEntryField || '');
        const draft = state.ui.expenseDraft;
        if (draft && Array.isArray(draft.entries)) {
          const idx = draft.entries.findIndex((e) => String(e.id) === entryId);
          if (idx >= 0) {
            let newVal = event.target.value;
            if (field === 'amount') {
              const raw = String(newVal || '').replace(/\./g, '').replace(/,/g, '.');
              newVal = Number(raw) || 0;
            }
            draft.entries[idx][field] = newVal;
            state.ui.expenseDraft = draft;

            if (expenseAutoSaveTimers[entryId]) window.clearTimeout(expenseAutoSaveTimers[entryId]);
            expenseAutoSaveTimers[entryId] = window.setTimeout(() => {
              // apply draft back to main expenses.cards (replace the card matching draft.id)
              const cardIndex = (state.expenses.cards || []).findIndex((c) => String(c.id) === String(draft.id));
              if (cardIndex >= 0) {
                state.expenses.cards[cardIndex] = JSON.parse(JSON.stringify(draft));
              }
              // persist and mark base updated, show feedback
              triggerSaveFeedback('expenses', 'expenses');
            }, 900);
          }
        }
      }
    });

    // Global focus/blur formatting for CLP inputs
    document.addEventListener('focusin', (event) => {
      const t = event.target;
      if (t && t.tagName === 'INPUT' && t.dataset && t.dataset.format === 'clp') {
        unformatInputNumberDisplay(t);
      }
    });

    document.addEventListener('focusout', (event) => {
      const t = event.target;
      if (t && t.tagName === 'INPUT' && t.dataset && t.dataset.format === 'clp') {
        formatInputNumberDisplay(t);
      }
    });

    document.addEventListener('keydown', (event) => {
      if (event.target?.id === 'notes-general-input' && event.key === 'Enter') {
        normalizeDashBullets();
      }
    });

    refs.notesPanelDrag?.addEventListener('mousedown', startNotesDrag);
    window.addEventListener('mousemove', moveNotesDrag);
    window.addEventListener('mouseup', stopNotesDrag);

  }

  function openNotesModal() {
    if (!refs.notesModal) return;
    refs.notesModal.classList.remove('is-hidden');
    refs.notesModal.setAttribute('aria-hidden', 'false');
    applyNotesPanelGeometry();
    if (refs.notesInput) refs.notesInput.innerHTML = state.ui.generalNotesHtml || '';
    refs.notesInput?.focus();
  }

  function closeInlinePdfViewer() {
    state.ui.inlinePdfViewer = null;
    renderInlinePdfViewerModal();
  }

  function renderInlinePdfViewerModal() {
    const rootId = 'inline-pdf-viewer-root';
    let root = document.getElementById(rootId);
    if (!root) {
      root = document.createElement('div');
      root.id = rootId;
      document.body.appendChild(root);
    }

    const viewer = state.ui.inlinePdfViewer;
    if (!viewer?.dataUrl) {
      root.innerHTML = '';
      return;
    }

    root.innerHTML = `
      <div class="notes-modal pdf-viewer-modal" role="dialog" aria-modal="true" aria-label="Visor PDF">
        <div class="notes-modal-backdrop" data-action="close-inline-pdf-viewer"></div>
        <div class="notes-modal-card pdf-viewer-card">
          <div class="section-title">
            <div>
              <h3>Visor PDF interno</h3>
              <p class="subtitle">${sanitize(viewer.fileName || 'Documento PDF')}</p>
            </div>
            <div class="inline-actions">
              <button class="btn btn-soft" data-action="download-inline-pdf-viewer">Descargar PDF</button>
              <button class="btn btn-primary" data-action="close-inline-pdf-viewer">Cerrar</button>
            </div>
          </div>
          <div class="pdf-viewer-frame-wrap">
            <iframe class="pdf-viewer-frame" src="${viewer.dataUrl}" title="Documento PDF" loading="eager"></iframe>
          </div>
        </div>
      </div>
    `;
  }

  function openAiBriefModal() {
    if (!refs.aiBriefModal) return;
    refs.aiBriefModal.classList.remove('is-hidden');
    refs.aiBriefModal.setAttribute('aria-hidden', 'false');
    if (refs.aiBriefContent) {
      refs.aiBriefContent.value = AI_PROJECT_CONTEXT_TEXT;
      refs.aiBriefContent.scrollTop = 0;
    }
  }

  function closeAiBriefModal() {
    if (!refs.aiBriefModal) return;
    refs.aiBriefModal.classList.add('is-hidden');
    refs.aiBriefModal.setAttribute('aria-hidden', 'true');
  }

  function openAttendanceRecordModal(recordId) {
    const record = getAttendanceRecordById(recordId);
    if (!record || !refs.attendanceRecordModal || !refs.attendanceRecordModalBody) return;
    const dk = toLocalDateValue(record.checkInAt || '');
    const dayTotalMs = (state.attendance.records || [])
      .filter((item) => toLocalDateValue(item.checkInAt || '') === dk)
      .reduce((sum, item) => sum + getAttendanceRecordWorkedMs(item), 0);

    refs.attendanceRecordModalBody.innerHTML = `
      <div class="attendance-record-modal-row"><span>Fecha</span><span>${sanitize(formatAttendanceDate(record.checkInAt))}</span></div>
      <div class="attendance-record-modal-row"><span>Empleado</span><span>${sanitize(record.employeeName || '-')}</span></div>
      <div class="attendance-record-modal-row"><span>Entrada</span><span>${sanitize(formatAttendanceTime(record.checkInAt))}</span></div>
      <div class="attendance-record-modal-row"><span>Salida</span><span>${sanitize(formatAttendanceTime(record.checkOutAt))}</span></div>
      <div class="attendance-record-modal-row"><span>Tiempo trabajado</span><span>${sanitize(getAttendancePauseLabel(getAttendanceRecordWorkedMs(record)))}</span></div>
      <div class="attendance-record-modal-row"><span>Total del día</span><span>${sanitize(getAttendancePauseLabel(dayTotalMs))}</span></div>
      <div class="attendance-record-modal-row"><span>Comentarios</span><span>${sanitize(record.comments || '') || '—'}</span></div>
      <div class="attendance-record-modal-actions">
        <button class="btn btn-soft" data-action="edit-attendance-record" data-id="${record.id}">${iconSvg('edit')} Editar</button>
        <button class="btn btn-soft" data-action="delete-attendance-record" data-id="${record.id}">${iconSvg('trash')} Eliminar</button>
      </div>
    `;
    refs.attendanceRecordModal.classList.remove('is-hidden');
    refs.attendanceRecordModal.setAttribute('aria-hidden', 'false');
  }

  function closeAttendanceRecordModal() {
    if (!refs.attendanceRecordModal) return;
    refs.attendanceRecordModal.classList.add('is-hidden');
    refs.attendanceRecordModal.setAttribute('aria-hidden', 'true');
  }

  function openPickerModal(title, listHtml) {
    if (!refs.pickerModal || !refs.pickerModalList) return;
    if (refs.pickerModalTitle) refs.pickerModalTitle.textContent = title;
    refs.pickerModalList.innerHTML = listHtml || '<div class="empty-option">Sin opciones disponibles.</div>';
    refs.pickerModal.classList.remove('is-hidden');
    refs.pickerModal.setAttribute('aria-hidden', 'false');
  }

  function closePickerModal() {
    if (!refs.pickerModal) return;
    refs.pickerModal.classList.add('is-hidden');
    refs.pickerModal.setAttribute('aria-hidden', 'true');
  }

  function getMaterialGroupsList() {
    return [...new Set((state.database.materials || []).map((item) => item.group).filter(Boolean))];
  }

  function openMaterialGroupPicker(rowId) {
    const row = (state.quote.materials || []).find((item) => item.id === rowId);
    if (!row) return;
    const groups = getMaterialGroupsList();
    const currentGroup = row.group || groups[0] || '';
    const listHtml = groups.length
      ? groups.map((group) => `
        <button type="button" class="custom-dropdown-option ${group === currentGroup ? 'active' : ''}" data-action="select-material-group" data-row-id="${rowId}" data-group="${sanitize(group)}">
          <span class="option-name">${sanitize(group)}</span>
        </button>
      `).join('')
      : '<div class="empty-option">No hay grupos disponibles.</div>';
    openPickerModal('Selecciona un grupo', listHtml);
  }

  function openMaterialOptionPicker(rowId) {
    const row = (state.quote.materials || []).find((item) => item.id === rowId);
    if (!row) return;
    const groups = getMaterialGroupsList();
    const currentGroup = row.group || groups[0] || '';
    const filteredMaterials = currentGroup
      ? (state.database.materials || []).filter((material) => material.group === currentGroup)
      : [];
    const listHtml = filteredMaterials.length
      ? filteredMaterials.map((material) => `
        <button type="button" class="custom-dropdown-option ${material.id === row.materialId ? 'active' : ''}" data-action="select-material-option" data-row-id="${rowId}" data-material-id="${material.id}">
          <span class="option-name">${sanitize(material.name)}</span>
          <span class="option-meta">${sanitize(material.provider || '')}</span>
        </button>
      `).join('')
      : '<div class="empty-option">No hay insumos disponibles para este grupo.</div>';
    openPickerModal('Selecciona un insumo', listHtml);
  }

  const calculatorState = { display: '0', storedValue: null, pendingOp: null, awaitingNext: false };

  function openCalculatorModal() {
    if (!refs.calculatorModal) return;
    calculatorState.display = '0';
    calculatorState.storedValue = null;
    calculatorState.pendingOp = null;
    calculatorState.awaitingNext = false;
    renderCalculatorDisplay();
    refs.calculatorModal.classList.remove('is-hidden');
    refs.calculatorModal.setAttribute('aria-hidden', 'false');
  }

  function closeCalculatorModal() {
    if (!refs.calculatorModal) return;
    refs.calculatorModal.classList.add('is-hidden');
    refs.calculatorModal.setAttribute('aria-hidden', 'true');
  }

  function renderCalculatorDisplay() {
    if (refs.calculatorDisplay) refs.calculatorDisplay.value = calculatorState.display;
  }

  function applyCalculatorOperator(a, b, op) {
    switch (op) {
      case '+': return a + b;
      case '-': return a - b;
      case '*': return a * b;
      case '/': return b === 0 ? 0 : a / b;
      default: return b;
    }
  }

  function handleCalculatorKey(keyBtn) {
    const digit = keyBtn.dataset.calcDigit;
    const op = keyBtn.dataset.calcOp;
    const action = keyBtn.dataset.calcAction;

    if (digit !== undefined) {
      if (digit === '.') {
        if (calculatorState.awaitingNext) {
          calculatorState.display = '0.';
          calculatorState.awaitingNext = false;
        } else if (!calculatorState.display.includes('.')) {
          calculatorState.display += '.';
        }
      } else if (calculatorState.display === '0' || calculatorState.awaitingNext) {
        calculatorState.display = digit;
        calculatorState.awaitingNext = false;
      } else {
        calculatorState.display += digit;
      }
    } else if (op) {
      const current = Number(calculatorState.display);
      if (calculatorState.storedValue !== null && !calculatorState.awaitingNext) {
        calculatorState.storedValue = applyCalculatorOperator(calculatorState.storedValue, current, calculatorState.pendingOp);
        calculatorState.display = String(calculatorState.storedValue);
      } else {
        calculatorState.storedValue = current;
      }
      calculatorState.pendingOp = op;
      calculatorState.awaitingNext = true;
    } else if (action === 'equals') {
      if (calculatorState.storedValue !== null && calculatorState.pendingOp) {
        const current = Number(calculatorState.display);
        calculatorState.display = String(applyCalculatorOperator(calculatorState.storedValue, current, calculatorState.pendingOp));
        calculatorState.storedValue = null;
        calculatorState.pendingOp = null;
        calculatorState.awaitingNext = true;
      }
    } else if (action === 'clear') {
      calculatorState.display = '0';
      calculatorState.storedValue = null;
      calculatorState.pendingOp = null;
      calculatorState.awaitingNext = false;
    } else if (action === 'backspace') {
      calculatorState.display = calculatorState.display.length > 1 ? calculatorState.display.slice(0, -1) : '0';
    }

    renderCalculatorDisplay();
  }

  async function copyAiBriefToClipboard() {
    try {
      await navigator.clipboard.writeText(AI_PROJECT_CONTEXT_TEXT);
      window.alert('Base IA del proyecto copiado.');
    } catch (error) {
      window.alert('No se pudo copiar automáticamente. Puedes copiarlo manualmente desde el cuadro.');
    }
  }

  function renderFooterMeta() {
    if (refs.footerAppVersion) {
      refs.footerAppVersion.textContent = `Versión ${APP_VERSION} estable`;
    }
    if (refs.themeToggleBtn) {
      refs.themeToggleBtn.textContent = state.ui.theme === 'dark' ? '☼' : '☾';
      refs.themeToggleBtn.title = state.ui.theme === 'dark' ? 'Cambiar a tema claro' : 'Cambiar a tema oscuro';
      refs.themeToggleBtn.setAttribute('aria-label', refs.themeToggleBtn.title);
    }
  }

  function applyTheme(theme) {
    const mode = theme === 'dark' ? 'dark' : 'light';
    document.body.classList.toggle('theme-dark', mode === 'dark');
    renderFooterMeta();
  }


  function closeNotesModal() {
    if (!refs.notesModal) return;
    persistNotesEditorState();
    saveNotesPanelGeometry();
    refs.notesModal.classList.add('is-hidden');
    refs.notesModal.setAttribute('aria-hidden', 'true');
  }

  function saveNotesFromModal() {
    persistNotesEditorState();
    window.ERMStorage.save(state);
  }

  function persistNotesEditorState() {
    const html = String(refs.notesInput?.innerHTML || '').trim();
    state.ui.generalNotesHtml = html;
    state.ui.generalNotes = String(refs.notesInput?.innerText || '').trim();
  }

  function handleNotesEditorInput() {
    normalizeDashBullets();
    persistNotesEditorState();
    if (notesAutoSaveTimer) window.clearTimeout(notesAutoSaveTimer);
    notesAutoSaveTimer = window.setTimeout(() => {
      window.ERMStorage.save(state);
    }, 250);
  }

  function normalizeDashBullets() {
    if (!refs.notesInput) return;
    const blocks = refs.notesInput.querySelectorAll('div, p');
    blocks.forEach((block) => {
      const text = String(block.textContent || '');
      if (!/^\s*-\s+/.test(text)) return;
      const content = text.replace(/^\s*-\s+/, '').trim();
      const ul = document.createElement('ul');
      const li = document.createElement('li');
      li.textContent = content;
      ul.appendChild(li);
      block.replaceWith(ul);
    });
  }

  function applyNotesPanelGeometry() {
    if (!refs.notesPanelCard) return;
    const width = Math.max(180, Math.min(window.innerWidth - 24, Number(state.ui.notesWindow?.width) || 210));
    const height = Math.max(150, Math.min(window.innerHeight - 24, Number(state.ui.notesWindow?.height) || 165));
    const x = Number.isFinite(Number(state.ui.notesWindow?.x))
      ? Number(state.ui.notesWindow.x)
      : Math.max(12, window.innerWidth - width - 20);
    const y = Number.isFinite(Number(state.ui.notesWindow?.y))
      ? Number(state.ui.notesWindow.y)
      : Math.max(12, window.innerHeight - height - 86);

    refs.notesPanelCard.style.width = `${width}px`;
    refs.notesPanelCard.style.height = `${height}px`;
    refs.notesPanelCard.style.left = `${Math.max(8, Math.min(window.innerWidth - width - 8, x))}px`;
    refs.notesPanelCard.style.top = `${Math.max(8, Math.min(window.innerHeight - height - 8, y))}px`;
  }

  function saveNotesPanelGeometry() {
    if (!refs.notesPanelCard) return;
    state.ui.notesWindow = {
      x: Number.parseFloat(refs.notesPanelCard.style.left) || 0,
      y: Number.parseFloat(refs.notesPanelCard.style.top) || 0,
      width: refs.notesPanelCard.offsetWidth,
      height: refs.notesPanelCard.offsetHeight
    };
    window.ERMStorage.save(state);
  }

  function startNotesDrag(event) {
    if (!refs.notesPanelCard || refs.notesModal?.classList.contains('is-hidden')) return;
    notesDragState = {
      offsetX: event.clientX - refs.notesPanelCard.offsetLeft,
      offsetY: event.clientY - refs.notesPanelCard.offsetTop
    };
    event.preventDefault();
  }

  function moveNotesDrag(event) {
    if (!notesDragState || !refs.notesPanelCard) return;
    const maxX = Math.max(8, window.innerWidth - refs.notesPanelCard.offsetWidth - 8);
    const maxY = Math.max(8, window.innerHeight - refs.notesPanelCard.offsetHeight - 8);
    const nextX = Math.max(8, Math.min(maxX, event.clientX - notesDragState.offsetX));
    const nextY = Math.max(8, Math.min(maxY, event.clientY - notesDragState.offsetY));
    refs.notesPanelCard.style.left = `${nextX}px`;
    refs.notesPanelCard.style.top = `${nextY}px`;
  }

  function stopNotesDrag() {
    if (!notesDragState) return;
    notesDragState = null;
    saveNotesPanelGeometry();
  }

  function parseValue(target) {
    if (target.dataset.percent === 'true') {
      return (Number(target.value) || 0) / 100;
    }
    if (target.dataset && target.dataset.format === 'clp') {
      const raw = String(target.value || '').replace(/\./g, '').replace(/,/g, '.');
      return Number(raw) || 0;
    }
    if (target.type === 'number') {
      return Number(target.value) || 0;
    }
    return target.value;
  }

  function updateCollectionItem(path, id, key, value) {
    const list = getArrayByPath(path);
    const item = list.find((entry) => entry.id === id);
    if (item) item[key] = value;
  }

  function parseCreatedAtTimestamp(value) {
    const raw = String(value || '').trim();
    if (!raw) return 0;

    const directTs = Date.parse(raw);
    if (Number.isFinite(directTs)) return directTs;

    const parts = raw.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})$/);
    if (!parts) return 0;

    const day = Number(parts[1]);
    const month = Number(parts[2]);
    const yearRaw = Number(parts[3]);
    const year = yearRaw < 100 ? 2000 + yearRaw : yearRaw;
    const normalized = new Date(year, Math.max(0, month - 1), day).getTime();
    return Number.isFinite(normalized) ? normalized : 0;
  }

  function saveMaterialFromForm() {
    const groupSelection = document.getElementById('material-group-select').value.trim();
    const newGroup = document.getElementById('material-new-group')?.value.trim() || '';
    const calculationUnit = document.getElementById('material-calculation-unit').value.trim();
    const group = groupSelection === '__new__' ? newGroup : groupSelection;
    const name = document.getElementById('material-name').value.trim();
    const baseCost = parseClpNumber(document.getElementById('material-base-cost').value);
    const notes = document.getElementById('material-notes').value.trim();

    const provider = document.getElementById('material-provider').value.trim();
    const supplierAddress = document.getElementById('material-supplier-address').value.trim();
    const supplierContact = document.getElementById('material-supplier-contact').value.trim();
    const payload = buildDatabaseRecord({
      group,
      name,
      calculationUnit,
      baseCost,
      notes,
      provider,
      supplierAddress,
      supplierContact,
      createdAt: state.ui.databaseDraft?.createdAt,
      status: state.ui.databaseDraft?.status,
      imageDataUrl: state.ui.databaseDraft?.imageDataUrl || '',
      imageName: state.ui.databaseDraft?.imageName || '',
      imageMimeType: state.ui.databaseDraft?.imageMimeType || '',
      imageSizeKb: state.ui.databaseDraft?.imageSizeKb || 0
    });

    const needsExtraData = ['cm2', 'rendimiento'].includes(payload.calculationUnit) && payload.unitCost <= 0;

    if (!payload.group || !payload.name || !payload.calculationUnit || baseCost <= 0 || needsExtraData || !Number.isFinite(payload.unitCost)) {
      window.alert('Completa grupo, nombre, costo y los datos requeridos por la unidad de cálculo.');
      return;
    }

    if (state.ui.editingMaterialId) {
      const current = state.database.materials.find((item) => item.id === state.ui.editingMaterialId);
      Object.assign(current, payload);
    } else {
      state.database.materials.push({ id: uid('mat'), ...payload });
    }

    state.ui.editingMaterialId = null;
    state.ui.databaseDraft = null;
    state.ui.databaseFilter = 'Todos';
    stampBaseUpdate('database');
    render();
  }

  function saveProductTypeFromForm() {
    const draft = state.ui.productTypeDraft || {};
    const name = String(draft.name || '').trim();
    const comments = String(draft.comments || '').trim();

    if (!name) {
      window.alert('Ingresa un nombre para el tipo de producto.');
      return;
    }

    const duplicate = (state.database.productTypes || []).find((item) => item.id !== state.ui.editingProductTypeId && item.name.toLowerCase() === name.toLowerCase());
    if (duplicate) {
      window.alert('Ese tipo de producto ya existe.');
      return;
    }

    const payload = {
      name,
      comments,
      createdAt: draft.createdAt || new Date().toLocaleDateString('es-CL')
    };

    if (state.ui.editingProductTypeId) {
      const current = state.database.productTypes.find((item) => item.id === state.ui.editingProductTypeId);
      if (current) Object.assign(current, payload);
    } else {
      state.database.productTypes.push({ id: uid('ptype'), ...payload });
    }

    state.ui.editingProductTypeId = null;
    state.ui.productTypeDraft = null;
    stampBaseUpdate('productTypes');
    render();
  }

  function saveExternalResourceFromForm() {
    const draft = state.ui.externalResourceDraft || {};
    const name = String(draft.name || '').trim();
    const rawType = String(draft.type || 'ayuda').trim() || 'ayuda';
    const type = String(rawType).toLowerCase() === 'landmark' ? 'Landmark' : rawType;
    const isLandmark = String(type).toLowerCase() === 'landmark';
    const hourlyRate = Number(draft.hourlyRate || 0) || 0;
    const description = String(draft.description || '').trim();
    const phone = String(draft.phone || '').trim();
    const instagram = String(draft.instagram || '').trim();
    const facebook = String(draft.facebook || '').trim();
    const email = String(draft.email || '').trim();
    const website = String(draft.website || '').trim();
    const status = draft.status === 'Inactivo' ? 'Inactivo' : 'Activo';

    if (!name) {
      window.alert('Ingresa un nombre para el proveedor.');
      return;
    }

    const payload = {
      type: normalizeProviderType(type),
      name,
      description,
      phone,
      instagram,
      facebook,
      email,
      website,
      status,
      createdAt: draft.createdAt || new Date().toLocaleDateString('es-CL')
    };

    if (state.ui.editingExternalResourceId) {
      const current = state.database.externalResources.find((item) => item.id === state.ui.editingExternalResourceId);
      if (current) Object.assign(current, payload);
    } else {
      state.database.externalResources.push({ id: uid('ext'), ...payload });
    }

    state.ui.editingExternalResourceId = null;
    state.ui.externalResourceDraft = null;
    stampBaseUpdate('external');
    render();
  }

  function saveDesiredItemFromForm() {
    const draft = state.ui.desiredDraft || defaultDesiredDraft();
    const name = String(draft.name || '').trim();

    if (!name) {
      window.alert('Ingresa el nombre del equipamiento.');
      return;
    }

    const notes = String(draft.notes ?? draft.description ?? '').trim();
    const purchaseDate = draft.purchaseDate || draft.entryDate || new Date().toISOString().slice(0, 10);
    const payload = {
      name,
      sku: String(draft.sku || '').trim(),
      category: String(draft.category || '').trim(),
      brand: String(draft.brand || '').trim(),
      model: String(draft.model || '').trim(),
      status: String(draft.status || 'Operativo').trim() || 'Operativo',
      purchaseDate,
      supplier: String(draft.supplier || '').trim(),
      cost: Number(draft.cost || 0) || 0,
      location: String(draft.location || '').trim(),
      notes,
      description: notes,
      entryDate: purchaseDate,
      imageDataUrl: draft.imageDataUrl || '',
      imageName: draft.imageName || '',
      imageMimeType: draft.imageMimeType || '',
      imageSizeKb: Number(draft.imageSizeKb || 0) || 0,
      expanded: false,
      offers: (draft.offers || []).map((offer) => ({
        id: offer.id || uid('off'),
        price: Number(offer.price || 0) || 0,
        link: String(offer.link || '').trim(),
        entryDate: offer.entryDate || new Date().toISOString().slice(0, 10)
      })).filter((offer) => offer.link || offer.price > 0)
    };

    if (state.ui.editingDesiredId) {
      const current = (state.inventory.desiredItems || []).find((item) => item.id === state.ui.editingDesiredId);
      if (current) Object.assign(current, payload);
    } else {
      state.inventory.desiredItems = state.inventory.desiredItems || [];
      state.inventory.desiredItems.unshift({ id: uid('des'), ...payload });
    }

    state.ui.editingDesiredId = null;
    state.ui.desiredDraft = defaultDesiredDraft();
    stampBaseUpdate('database');
    stampBaseUpdate('desired');
    render();
  }

  function saveExpenseCardFromForm() {
    const draft = state.ui.expenseDraft ? createExpenseCard(state.ui.expenseDraft) : null;
    if (!draft) {
      window.alert('No hay datos de gasto para guardar.');
      return;
    }

    if (!String(draft.name || '').trim()) {
      window.alert('Ingresa un nombre para la card de gasto.');
      return;
    }

    if (!String(draft.baseYear || '').trim()) {
      window.alert('Ingresa el año base para la card.');
      return;
    }

    const index = (state.expenses.cards || []).findIndex((card) => card.id === draft.id);
    if (index >= 0) {
      state.expenses.cards[index] = draft;
    } else {
      state.expenses.cards.unshift(draft);
    }

    state.ui.selectedExpenseId = draft.id;
    state.ui.expenseDraft = JSON.parse(JSON.stringify(draft));
    stampBaseUpdate('expenses');
    render();
  }

  async function handleExpensePdfFile(file, entryId) {
    if (!file || !entryId || !state.ui.expenseDraft) return;

    if (!isPdfFile(file)) {
      window.alert('Solo se permiten archivos PDF en este módulo.');
      render();
      return;
    }

    const maxSizeBytes = 10 * 1024 * 1024;
    if (file.size > maxSizeBytes) {
      window.alert('El PDF supera el límite de 10 MB.');
      render();
      return;
    }

    try {
      const previousEntry = (state.ui.expenseDraft.entries || []).find((entry) => entry.id === entryId);
      const previousAttachment = getPrimaryAttachment(previousEntry, legacyExpenseAttachment);
      if (previousAttachment) {
      }

      const attachment = await storeAttachmentFromFile(file, 'expense-entry');
      state.ui.expenseDraft.entries = (state.ui.expenseDraft.entries || []).map((entry) => (
        entry.id === entryId
          ? {
            ...entry,
            attachments: [attachment],
            pdfDataUrl: '',
            pdfName: '',
            pdfMimeType: '',
            pdfSizeKb: 0
          }
          : entry
      ));
      render();
    } catch (error) {
      console.error(error);
      window.alert('No se pudo cargar el PDF seleccionado.');
    }
  }

  function exportExpensesBase() {
    const payload = {
      app: 'AndiApp',
      exportedAt: new Date().toISOString(),
      expenses: (state.expenses.cards || []).map((card) => createExpenseCard(card))
    };
    downloadBlobFile(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }), getBackupFileName('expenses'));
  }

  function exportDesiredEquipmentBase() {
    const payload = {
      app: 'AndiApp',
      exportedAt: new Date().toISOString(),
      desiredItems: state.inventory.desiredItems || []
    };
    downloadBlobFile(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }), getBackupFileName('desired'));
  }

  function exportAttendanceBase() {
    const payload = {
      app: 'AndiApp',
      exportedAt: new Date().toISOString(),
      attendance: {
        activeSession: state.attendance?.activeSession || null,
        records: state.attendance?.records || []
      }
    };
    downloadBlobFile(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }), getBackupFileName('attendance'));
  }

  function exportFinanceBase() {
    const payload = {
      app: 'AndiApp',
      exportedAt: new Date().toISOString(),
      finance: {
        initialBalance: state.finance?.initialBalance || 0,
        ivaCreditBalance: state.finance?.ivaCreditBalance || 0,
        ivaCreditBalanceLocked: Boolean(state.finance?.ivaCreditBalanceLocked),
        entries: state.finance?.entries || [],
        quickOutflowTypes: getFinanceQuickOutflowTypes()
      }
    };
    downloadBlobFile(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }), getBackupFileName('finance'));
  }

  async function importFinanceFromFile(file) {
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const finance = parsed?.finance;
      if (!finance || typeof finance !== 'object') {
        window.alert('El archivo no contiene una base de finanzas válida.');
        return;
      }
      state.finance = state.finance || { initialBalance: 0, entries: [] };
      state.finance.initialBalance = Math.max(0, Number(finance.initialBalance || 0) || 0);
      if (finance.ivaCreditBalance !== undefined) {
        state.finance.ivaCreditBalance = Math.max(0, Number(finance.ivaCreditBalance || 0) || 0);
      }
      if (finance.ivaCreditBalanceLocked !== undefined) {
        state.finance.ivaCreditBalanceLocked = Boolean(finance.ivaCreditBalanceLocked);
      }
      state.finance.entries = (Array.isArray(finance.entries) ? finance.entries : []).map((entry) => createFinanceEntry(entry));
      state.ui.financeQuickOutflowTypes = Array.isArray(finance.quickOutflowTypes)
        ? finance.quickOutflowTypes.map((t) => String(t || '').trim()).filter(Boolean)
        : getFinanceQuickOutflowTypes();
      state.ui.editingFinanceId = null;
      state.ui.financeDraft = null;
      stampBaseUpdate('finance');
      render();
      window.alert(`Base de finanzas importada correctamente (${state.finance.entries.length} movimientos).`);
    } catch (error) {
      console.error(error);
      window.alert('No se pudo importar la base de finanzas.');
    }
  }

  async function importExpensesFromFile(file) {
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const source = Array.isArray(parsed?.expenses) ? parsed.expenses : [];
      if (!source.length) {
        window.alert('El archivo no contiene una base de gastos válida.');
        return;
      }

      state.expenses.cards = source.map((card) => createExpenseCard(card));
      state.ui.selectedExpenseId = state.expenses.cards[0]?.id || null;
      state.ui.expenseDraft = state.expenses.cards[0] ? JSON.parse(JSON.stringify(state.expenses.cards[0])) : null;
      stampBaseUpdate('expenses');
      render();
      window.alert(`Base de gastos importada correctamente (${state.expenses.cards.length} cards).`);
    } catch (error) {
      console.error(error);
      window.alert('No se pudo importar la base de gastos.');
    }
  }

  async function importDesiredEquipmentFromFile(file) {
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const source = Array.isArray(parsed?.desiredItems) ? parsed.desiredItems : [];
      if (!source.length) {
        window.alert('El archivo no contiene una base de equipamiento deseado válida.');
        return;
      }

      state.inventory.desiredItems = source.map(normalizeDesiredItem).filter((item) => item.name);

      stampBaseUpdate('desired');
      render();
      window.alert(`Base de equipamiento deseado importada (${state.inventory.desiredItems.length} registros).`);
    } catch (error) {
      console.error(error);
      window.alert('No se pudo importar la base de equipamiento deseado.');
    }
  }

  async function importAttendanceFromFile(file) {
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const attendance = parsed?.attendance;
      if (!attendance || typeof attendance !== 'object') {
        window.alert('El archivo no contiene una base de asistencia válida.');
        return;
      }

      const activeSession = attendance?.activeSession && typeof attendance.activeSession === 'object'
        ? {
          id: attendance.activeSession.id || uid('att-session'),
          employeeName: String(attendance.activeSession.employeeName || '').trim(),
          checkInAt: attendance.activeSession.checkInAt || null,
          comments: String(attendance.activeSession.comments || ''),
          pausedAccumulatedMs: Math.max(0, Number(attendance.activeSession.pausedAccumulatedMs) || 0),
          isPaused: Boolean(attendance.activeSession.isPaused),
          pauseStartedAt: attendance.activeSession.pauseStartedAt || null,
          pauseCount: Math.max(0, Number(attendance.activeSession.pauseCount) || 0),
          workedAccumulatedMs: Math.max(0, Number(attendance.activeSession.workedAccumulatedMs) || 0),
          activeWorkStartedAt: attendance.activeSession.activeWorkStartedAt || attendance.activeSession.checkInAt || null,
          workSegments: (Array.isArray(attendance.activeSession.workSegments) ? attendance.activeSession.workSegments : [])
            .filter((seg) => seg && seg.startAt)
            .map((seg) => ({ startAt: seg.startAt, endAt: seg.endAt || null }))
        }
        : null;

      state.attendance = state.attendance || { activeSession: null, records: [] };
      state.attendance.activeSession = activeSession?.employeeName && activeSession?.checkInAt ? activeSession : null;
      state.attendance.records = (Array.isArray(attendance?.records) ? attendance.records : []).map((item) => ({
        id: item.id || uid('att-record'),
        employeeName: String(item.employeeName || '').trim(),
        checkInAt: item.checkInAt || '',
        checkOutAt: item.checkOutAt || '',
        totalMs: Math.max(0, Number(item.totalMs) || 0),
        workedMs: Math.max(0, Number(item.workedMs) || 0),
        pauseMs: Math.max(0, Number(item.pauseMs) || 0),
        pauseCount: Math.max(0, Number(item.pauseCount) || 0),
        workSegments: (Array.isArray(item.workSegments) ? item.workSegments : [])
          .filter((seg) => seg && seg.startAt && seg.endAt)
          .map((seg) => ({ startAt: seg.startAt, endAt: seg.endAt })),
        comments: String(item.comments || '')
      })).filter((item) => item.employeeName && item.checkInAt && item.checkOutAt);

      state.ui.attendanceEditingId = null;
      stampBaseUpdate('attendance');
      render();
      window.alert(`Base de asistencia importada (${state.attendance.records.length} registros${state.attendance.activeSession ? ' y 1 turno activo' : ''}).`);
    } catch (error) {
      console.error(error);
      window.alert('No se pudo importar la base de asistencia.');
    }
  }

  function getNextContactNumber() {
    return (state.contacts || []).reduce((max, item) => Math.max(max, Number(item.clientNumber) || 0), 0) + 1;
  }

  function getNextOrderNumber() {
    const max = (state.orders || []).reduce((acc, item) => {
      const match = String(item.orderNumber || '').match(/(\d+)/);
      return Math.max(acc, match ? Number(match[1]) : 0);
    }, 0);
    return `OT-${String(max + 1).padStart(3, '0')}`;
  }

  function createFreshQuote() {
    const firstEmployee = state.scenario.employees?.[0] || null;
    return {
      ...JSON.parse(JSON.stringify(window.ERMDefaults.quote)),
      orderTitle: '',
      customerId: '',
      customerName: '',
      productName: '',
      isPrototype: false,
      quoteDate: new Date().toISOString().slice(0, 10),
      orderNumber: getNextOrderNumber(),
      status: 'Prospecto',
      deliveryState: 'Abierta',
      description: '',
      estimatedDeliveryDate: '',
      selectedPriceMode: 'target',
      selectedPriceNet: 0,
      customPriceGross: 0,
      materials: [],
      labor: firstEmployee ? [{
        id: uid('qll'),
        employeeId: firstEmployee.id,
        assignmentType: 'hora',
        hours: 1,
        rate: firstEmployee.hourlyRate || Math.round(window.ERMCalc.averageLaborRate(state.scenario)),
        directLabel: '',
        directCost: 0
      }] : [],
      logistics: JSON.parse(JSON.stringify(window.ERMDefaults.quote.logistics))
    };
  }

  function saveContactFromForm() {
    const draft = state.ui.contactDraft || {};
    const payload = {
      clientNumber: Number(draft.clientNumber) || getNextContactNumber(),
      type: draft.type || 'persona',
      name: String(draft.name || '').trim(),
      company: String(draft.company || '').trim(),
      rut: String(draft.rut || '').trim(),
      firstContactDate: draft.firstContactDate || new Date().toISOString().slice(0, 10),
      address: String(draft.address || '').trim(),
      district: String(draft.district || '').trim(),
      whatsapp: normalizePhoneList(draft.whatsapp),
      instagram: String(draft.instagram || '').trim(),
      email: String(draft.email || '').trim(),
      facebook: String(draft.facebook || '').trim(),
      website: String(draft.website || '').trim(),
      comments: String(draft.comments || '').trim(),
      isFriend: draft.isFriend === true || draft.isFriend === 'true'
    };

    if (!payload.name) {
      window.alert('Ingresa al menos el nombre del cliente para guardar la ficha.');
      return;
    }

    if (state.ui.editingContactId) {
      const current = state.contacts.find((item) => item.id === state.ui.editingContactId);
      if (current) {
        const nameChanged = current.name !== payload.name;
        Object.assign(current, payload);
        if (nameChanged) syncCustomerNameAcrossOrders(current.id, current.name);
      }
    } else {
      state.contacts.push({ id: uid('cli'), ...payload });
    }

    state.ui.editingContactId = null;
    state.ui.contactDraft = null;
    stampBaseUpdate('contacts');
    render();
  }

  function syncCustomerNameAcrossOrders(customerId, newName) {
    (state.orders || []).forEach((order) => {
      if (order.customerId !== customerId) return;
      order.customerName = newName;
      if (order.quote) order.quote.customerName = newName;
    });
    if (state.quote?.customerId === customerId) {
      state.quote.customerName = newName;
    }
  }

  async function downloadBlobFile(blob, filename) {
    const safeName = String(filename || 'archivo.dat');

    if (window.showSaveFilePicker) {
      try {
        const extMatch = safeName.match(/\.([a-zA-Z0-9]+)$/);
        const suggestedExt = extMatch ? `.${extMatch[1].toLowerCase()}` : '';
        const picker = await window.showSaveFilePicker({
          suggestedName: safeName,
          types: [{
            description: 'Archivo',
            accept: {
              [blob.type || 'application/octet-stream']: suggestedExt ? [suggestedExt] : ['.*']
            }
          }]
        });
        const writable = await picker.createWritable();
        await writable.write(blob);
        await writable.close();
        return;
      } catch (error) {
        if (error?.name === 'AbortError') return;
        console.warn('No se pudo guardar con selector de ubicación, se usará descarga estándar.', error);
      }
    }

    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = safeName;
    link.click();
    URL.revokeObjectURL(url);
  }

  function buildCurrentOrderRecord() {
    const calc = window.ERMCalc.calculateQuote(state);
    normalizeQuotePrototypeState(state.quote);
    const quoteAttachments = getOwnerAttachments(state.quote, legacyOrderInvoiceAttachment);
    return {
      id: state.ui.editingOrderId || uid('ot'),
      orderNumber: state.quote.orderNumber || 'OT-SIN-NUMERO',
      orderTitle: state.quote.orderTitle || 'Orden sin título',
      productName: state.quote.productName || '',
      customerId: state.quote.customerId || '',
      customerName: state.quote.customerName || '',
      quoteDate: state.quote.quoteDate || new Date().toISOString().slice(0, 10),
      estimatedDeliveryDate: state.quote.estimatedDeliveryDate || '',
      status: state.quote.status || 'Prospecto',
      deliveryState: state.quote.deliveryState || 'Abierta',
      isPrototype: Boolean(state.quote.isPrototype),
      savedAt: new Date().toISOString(),
      attachments: quoteAttachments,
      invoicePdfDataUrl: '',
      invoicePdfName: '',
      invoicePdfMimeType: '',
      invoicePdfSizeKb: 0,
      quote: JSON.parse(JSON.stringify(state.quote)),
      quoteSummary: JSON.parse(JSON.stringify(calc.quoteSummary)),
      scenarioSnapshot: JSON.parse(JSON.stringify(state.scenario))
    };
  }

  function getOrderRequiredMissingFields() {
    const missing = [];
    const orderTitle = String(state.quote?.orderTitle || '').trim();
    const orderNumber = String(state.quote?.orderNumber || '').trim();
    const customerId = String(state.quote?.customerId || '').trim();

    if (!orderTitle) missing.push('Nombre de la OT');
    if (!orderNumber) missing.push('Numero de OT');
    if (!customerId && !state.quote?.isPrototype) missing.push('Cliente asociado');

    return missing;
  }

  function alertOrderRequiredMissingFields(actionLabel) {
    const missing = getOrderRequiredMissingFields();
    if (!missing.length) return false;

    window.alert([
      `No se puede ${actionLabel} porque faltan campos obligatorios:`,
      ...missing.map((item) => `- ${item}`)
    ].join('\n'));
    return true;
  }

  function saveCurrentOrderToSystem() {
    normalizeQuotePrototypeState(state.quote);
    if (alertOrderRequiredMissingFields('guardar la OT en el Panel OT')) return;

    const record = buildCurrentOrderRecord();
    const existingIndex = state.ui.editingOrderId
      ? (state.orders || []).findIndex((item) => item.id === state.ui.editingOrderId)
      : -1;

    if (existingIndex >= 0) {
      record.id = state.orders[existingIndex].id;
      const existingAttachments = getOwnerAttachments(state.orders[existingIndex], legacyOrderInvoiceAttachment);
      record.attachments = record.attachments.length ? record.attachments : existingAttachments;
      state.orders[existingIndex] = record;
    } else {
      state.orders.unshift(record);
    }

    state.ui.selectedOrderId = record.id;
    state.ui.editingOrderId = null;
    state.ui.orderFilter = 'Todas';
    state.quote = createFreshQuote();
    state.currentView = 'orders';
    stampBaseUpdate('orders');
    window.alert(existingIndex >= 0 ? 'OT actualizada en el sistema.' : 'OT guardada en el sistema y sumada al Panel OT.');
    render();
  }

  async function importOrdersFromFiles(files) {
    let added = 0;
    let updated = 0;
    let failed = 0;
    let firstImportedId = null;

    const sourceFiles = files.slice(0, 1);

    for (const file of sourceFiles) {
      try {
        const text = await file.text();
        const parsed = JSON.parse(text);
        const batch = Array.isArray(parsed?.orders)
          ? parsed.orders.map((orderEntry) => ({
            order: orderEntry.quote || orderEntry.order || orderEntry,
            quoteSummary: orderEntry.quoteSummary || {},
            scenarioSnapshot: orderEntry.scenarioSnapshot || {}
          }))
          : [];

        if (!batch.length) {
          failed += 1;
          continue;
        }

        batch.forEach((entry) => {
          const record = {
            id: uid('ot'),
            orderNumber: entry.order.orderNumber || 'OT-IMPORTADA',
            orderTitle: entry.order.orderTitle || 'Orden importada',
            productName: entry.order.productName || '',
            customerId: entry.order.customerId || '',
            customerName: entry.order.customerName || '',
            quoteDate: entry.order.quoteDate || new Date().toISOString().slice(0, 10),
            estimatedDeliveryDate: entry.order.estimatedDeliveryDate || '',
            status: entry.order.status || 'Prospecto',
            deliveryState: entry.order.deliveryState || 'Abierta',
            isPrototype: Boolean(entry.order.isPrototype || entry.order.status === 'Prototipo'),
            savedAt: new Date().toISOString(),
            attachments: normalizeAttachments(entry.order.attachments || []),
            invoicePdfDataUrl: entry.order.invoicePdfDataUrl || '',
            invoicePdfName: entry.order.invoicePdfName || '',
            invoicePdfMimeType: entry.order.invoicePdfMimeType || '',
            invoicePdfSizeKb: Number(entry.order.invoicePdfSizeKb || 0) || 0,
            quote: entry.order,
            quoteSummary: entry.quoteSummary || {},
            scenarioSnapshot: entry.scenarioSnapshot || {}
          };

          const existingIndex = (state.orders || []).findIndex((item) => item.orderNumber === record.orderNumber);
          if (existingIndex >= 0) {
            record.id = state.orders[existingIndex].id;
            state.orders[existingIndex] = record;
            updated += 1;
          } else {
            state.orders.unshift(record);
            added += 1;
          }

          if (!firstImportedId) firstImportedId = record.id;
        });
      } catch (error) {
        console.error(error);
        failed += 1;
      }
    }

    if (firstImportedId) {
      state.ui.selectedOrderId = firstImportedId;
      state.ui.orderFilter = 'Todas';
      state.currentView = 'orders';
      stampBaseUpdate('orders');
      render();
      window.alert(`Base OT importada: ${added} OT agregadas y ${updated} actualizadas.${failed ? ` ${failed} archivo(s) no se pudieron leer.` : ''}`);
      return;
    }

    window.alert('No se pudo importar la Base OT. Revisa que el JSON contenga una lista válida en "orders".');
  }

  async function importOrderFromFile(file) {
    await importOrdersFromFiles([file]);
  }

  function loadOrderIntoQuote(orderId) {
    const record = findOrderById(orderId);
    if (!record?.quote) {
      window.alert('No fue posible cargar esta OT en el presupuestador.');
      return;
    }

    state.quote = {
      ...JSON.parse(JSON.stringify(window.ERMDefaults.quote)),
      ...JSON.parse(JSON.stringify(record.quote))
    };
    const orderAttachments = getOwnerAttachments(record, legacyOrderInvoiceAttachment);
    state.quote.estimatedDeliveryDate = record.estimatedDeliveryDate || state.quote.estimatedDeliveryDate || '';
    state.quote.isPrototype = Boolean(record.isPrototype || state.quote.isPrototype || record.status === 'Prototipo');
    state.quote.attachments = orderAttachments;
    state.quote.invoicePdfDataUrl = '';
    state.quote.invoicePdfName = '';
    state.quote.invoicePdfMimeType = '';
    state.quote.invoicePdfSizeKb = 0;
    normalizeQuotePrototypeState(state.quote);
    state.ui.selectedOrderId = record.id;
    state.ui.editingOrderId = record.id;
    state.currentView = 'quote';
    render();
  }

  function exportCurrentOrder() {
    normalizeQuotePrototypeState(state.quote);
    if (alertOrderRequiredMissingFields('exportar la OT')) return;

    const record = buildCurrentOrderRecord();
    const clean = (value, fallback) => String(value || fallback)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 40) || fallback;

    const filename = `${clean(record.orderNumber, 'OT')}_${clean(record.orderTitle, 'Orden')}_${clean(record.customerName, 'Cliente')}.json`;
    const payload = {
      appName: state.appName,
      exportedAt: new Date().toISOString(),
      order: record.quote,
      quoteSummary: record.quoteSummary,
      scenarioSnapshot: record.scenarioSnapshot
    };

    downloadBlobFile(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }), filename);
  }

  function getOrderPrintablePdfFilename(record) {
    const clean = (value, fallback) => String(value || fallback)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 40) || fallback;

    return `${clean(record.orderNumber, 'OT')}_${clean(record.orderTitle, 'Orden')}_${clean(record.customerName, 'Cliente')}.pdf`;
  }

  function exportPrintableOrderSheet() {
    normalizeQuotePrototypeState(state.quote);
    if (alertOrderRequiredMissingFields('exportar la OT para PDF')) return;

    const jsPDFCtor = window.jspdf?.jsPDF;
    if (typeof jsPDFCtor !== 'function') {
      window.alert('No se pudo inicializar el exportador PDF. Reinicia la app e intenta nuevamente.');
      return;
    }

    const record = buildCurrentOrderRecord();
    const calc = window.ERMCalc.calculateQuote(state);
    const summary = calc.quoteSummary || {};
    const scenario = calc.scenarioSummary || {};
    const quote = record.quote || {};
    const doc = new jsPDFCtor({ orientation: 'portrait', unit: 'mm', format: 'letter' });

    const pageW = 215.9;
    const pageH = 279.4;
    const margin = 10;
    const maxX = pageW - margin;
    const maxY = pageH - margin;
    const contentW = pageW - margin * 2;
    const normalText = [15, 15, 15];
    const mutedText = [80, 80, 80];
    const lineColor = [25, 25, 25];
    let y = 13;

    const clipText = (text, maxWidth) => {
      const source = String(text || '-').replace(/\s+/g, ' ').trim();
      if (!source) return '-';
      if (doc.getTextWidth(source) <= maxWidth) return source;
      let out = source;
      while (out.length > 1 && doc.getTextWidth(`${out}...`) > maxWidth) {
        out = out.slice(0, -1);
      }
      return `${out}...`;
    };

    const ensureSpace = (requiredHeight) => {
      if (y + requiredHeight <= maxY) return;
      doc.addPage('letter', 'portrait');
      y = 13;
    };

    const sectionTitle = (text) => {
      ensureSpace(8);
      doc.setFillColor(242, 242, 242);
      doc.setDrawColor(...lineColor);
      doc.rect(margin, y - 4, contentW, 6, 'FD');
      doc.setTextColor(...normalText);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9.5);
      doc.text(String(text || '').toUpperCase(), margin + 2, y);
      y += 4;
    };

    const printMetaPair = (label, value, x, top, width) => {
      doc.setDrawColor(...lineColor);
      doc.rect(x, top, width, 11, 'S');
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.3);
      doc.setTextColor(...mutedText);
      doc.text(label, x + 1.6, top + 3);

      const source = String(value || '-').replace(/\s+/g, ' ').trim() || '-';
      const innerW = width - 3.2;
      const maxFont = 9;
      const minFont = 5.4;
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(...normalText);

      // 1) Try to fit the whole text on a single line by shrinking the font.
      let fontSize = maxFont;
      doc.setFontSize(fontSize);
      while (fontSize > minFont && doc.getTextWidth(source) > innerW) {
        fontSize = Math.max(minFont, fontSize - 0.2);
        doc.setFontSize(fontSize);
      }

      if (doc.getTextWidth(source) <= innerW) {
        doc.text(source, x + 1.6, top + 8);
        return;
      }

      // 2) Still too wide: wrap onto two lines at the smallest font, and if the
      //    second line overflows, clip only that overflow with an ellipsis.
      fontSize = minFont;
      doc.setFontSize(fontSize);
      const lines = doc.splitTextToSize(source, innerW);
      const first = lines[0] || '-';
      let second = lines.length > 1 ? lines.slice(1).join(' ') : '';
      if (second) {
        while (second.length > 1 && doc.getTextWidth(`${second}...`) > innerW) {
          second = second.slice(0, -1);
        }
        if (doc.getTextWidth(second) > innerW) second = `${second}...`;
        else if ((lines.length > 1 ? lines.slice(1).join(' ') : '').length > second.length) second = `${second}...`;
      }
      doc.text(first, x + 1.6, top + 6.2);
      if (second) doc.text(second, x + 1.6, top + 9.6);
    };

    const drawSimpleTable = (config) => {
      const rows = Array.isArray(config.rows) ? config.rows : [];
      const columns = Array.isArray(config.columns) ? config.columns : [];
      const align = Array.isArray(config.align) ? config.align : [];
      const rowHeight = Number(config.rowHeight || 4.5);
      const headerHeight = rowHeight + 0.6;
      const sectionName = String(config.sectionName || 'Tabla');
      const footer = config.footer && typeof config.footer === 'object' ? config.footer : null;

      const drawHeaderRow = () => {
        ensureSpace(headerHeight + rowHeight);
        doc.setFillColor(242, 242, 242);
        doc.setDrawColor(...lineColor);
        doc.rect(margin, y, contentW, headerHeight, 'FD');

        let xCursor = margin;
        columns.forEach((col, idx) => {
          if (idx > 0) doc.line(xCursor, y, xCursor, y + headerHeight);
          doc.setFont('helvetica', 'bold');
          doc.setFontSize(7.1);
          doc.setTextColor(...normalText);
          doc.text(clipText(col.label, col.width - 2), xCursor + 1, y + 3.2);
          xCursor += col.width;
        });
        y += headerHeight;
      };

      drawHeaderRow();

      rows.forEach((row, rowIndex) => {
        if (y + rowHeight > maxY) {
          doc.addPage('letter', 'portrait');
          y = 13;
          sectionTitle(`${sectionName} (continuacion)`);
          drawHeaderRow();
        }

        doc.rect(margin, y, contentW, rowHeight, 'S');
        let x = margin;
        columns.forEach((col, idx) => {
          if (idx > 0) doc.line(x, y, x, y + rowHeight);
          const val = String(row[idx] ?? '-');
          const safeVal = clipText(val, col.width - 2.2);
          doc.setFont('helvetica', 'normal');
          doc.setFontSize(7.4);
          doc.setTextColor(...normalText);
          if (align[idx] === 'right') {
            doc.text(safeVal, x + col.width - 1.1, y + 3.1, { align: 'right' });
          } else {
            doc.text(safeVal, x + 1.1, y + 3.1);
          }
          x += col.width;
        });
        y += rowHeight;

        if (rowIndex === rows.length - 1) {
          y += 0.8;
        }
      });

      if (!rows.length) {
        ensureSpace(rowHeight);
        doc.rect(margin, y, contentW, rowHeight, 'S');
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7.4);
        doc.setTextColor(...normalText);
        doc.text('Sin registros.', margin + 1.1, y + 3.1);
        y += rowHeight + 0.8;
      }

      if (footer) {
        const spanCount = Math.max(1, Math.min(columns.length - 1, Number(footer.labelSpan || (columns.length - 1))));
        const labelWidth = columns.slice(0, spanCount).reduce((sum, col) => sum + col.width, 0);
        const valueWidth = columns.slice(spanCount).reduce((sum, col) => sum + col.width, 0);

        ensureSpace(rowHeight + 0.4);
        doc.setFillColor(247, 247, 247);
        doc.rect(margin, y, labelWidth, rowHeight, 'FD');
        doc.rect(margin + labelWidth, y, valueWidth, rowHeight, 'FD');
        doc.setDrawColor(...lineColor);
        doc.rect(margin, y, contentW, rowHeight, 'S');
        doc.line(margin + labelWidth, y, margin + labelWidth, y + rowHeight);

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(7.7);
        doc.setTextColor(...normalText);
        doc.text(clipText(String(footer.label || 'Total'), labelWidth - 2.2), margin + 1.1, y + 3.2);
        doc.text(clipText(String(footer.value || '-'), valueWidth - 2.2), margin + labelWidth + valueWidth - 1.1, y + 3.2, { align: 'right' });
        y += rowHeight + 1.2;
      }
    };

    const logisticsModeMap = {
      retiro: 'Retiro en taller',
      metro: 'Entrega en Metro',
      domicilio: 'Entrega a domicilio',
      starken: 'Envio por Starken'
    };

    const materialRows = (summary.materialLines || []).map((line, index) => ([
      String(index + 1),
      String(line.group || line.material?.group || '-'),
      String(line.material?.name || '-') + (String(line.comment || '').trim() ? ` (${String(line.comment).trim()})` : ''),
      Number(line.quantity || 0).toLocaleString('es-CL', { maximumFractionDigits: 2 }),
      String(line.material?.unit || '-'),
      formatCurrency(line.lineTotal || 0)
    ]));

    const laborRows = (summary.laborLines || []).map((line, index) => ([
      String(index + 1),
      String(line.employee?.name || line.externalResource?.name || '-'),
      Number(line.hours || 0).toLocaleString('es-CL', { maximumFractionDigits: 2 }),
      formatCurrency(line.realRate || line.rate || 0),
      formatCurrency(line.lineTotal || 0)
    ]));

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(13);
    doc.setTextColor(...normalText);
    doc.text('ORDEN DE TRABAJO · RESPALDO PDF', margin, y);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(...mutedText);
    doc.text(`Generado: ${new Date().toLocaleString('es-CL', { hour12: false })}`, maxX, y, { align: 'right' });
    y += 7;

    sectionTitle('Datos generales');
    const colW = (pageW - margin * 2 - 6) / 4;
    printMetaPair('Numero OT', record.orderNumber || '-', margin, y, colW);
    printMetaPair('Titulo', record.orderTitle || '-', margin + colW + 2, y, colW);
    printMetaPair('Cliente', record.customerName || '-', margin + (colW + 2) * 2, y, colW);
    printMetaPair('Producto', record.productName || '-', margin + (colW + 2) * 3, y, colW);
    y += 13;
    printMetaPair('Fecha ingreso', record.quoteDate || '-', margin, y, colW);
    printMetaPair('Entrega estimada', record.estimatedDeliveryDate || '-', margin + colW + 2, y, colW);
    printMetaPair('Estado OT', record.status || '-', margin + (colW + 2) * 2, y, colW);
    printMetaPair('Modo logistica', logisticsModeMap[quote.logistics?.mode] || 'Retiro en taller', margin + (colW + 2) * 3, y, colW);
    y += 15;

    sectionTitle('Insumos de la OT');
    drawSimpleTable({
      sectionName: 'Insumos de la OT',
      columns: [
        { label: '#', width: 8 },
        { label: 'Grupo', width: 30 },
        { label: 'Insumo', width: 74 },
        { label: 'Cant.', width: 20 },
        { label: 'Unidad', width: 20 },
        { label: 'Total', width: 43.9 }
      ],
      align: ['left', 'left', 'left', 'right', 'left', 'right'],
      rows: materialRows,
      footer: {
        label: 'Total insumos',
        value: formatCurrency(summary.materialsTotal || 0),
        labelSpan: 5
      }
    });

    y += 4;
    sectionTitle('Mano de obra');
    drawSimpleTable({
      sectionName: 'Mano de obra',
      columns: [
        { label: '#', width: 8 },
        { label: 'Recurso', width: 86 },
        { label: 'Horas', width: 22 },
        { label: 'Valor hora', width: 32 },
        { label: 'Total', width: 47.9 }
      ],
      align: ['left', 'left', 'right', 'right', 'right'],
      rows: laborRows,
      footer: {
        label: 'Total mano de obra',
        value: formatCurrency(summary.laborTotal || 0),
        labelSpan: 4
      }
    });

    y += 5;

    sectionTitle('Resumen de costos');
    const pieceQuantity = Number(summary.pieceQuantity || 1);
    const kpis = [
      ['Total insumos', formatCurrency(summary.materialsTotal || 0)],
      ['Total mano de obra', formatCurrency(summary.laborTotal || 0)],
      ['Total CIF', formatCurrency(summary.cifTotal || 0)],
      ['Costo de una unidad', formatCurrency(summary.unitCost || 0)],
      ['Unidades', String(pieceQuantity)],
      ['Subtotal produccion', formatCurrency(summary.productionCost || 0)],
      ['Total logistica', formatCurrency(summary.logisticsTotal || 0)],
      ['Costo total OT', formatCurrency(summary.totalCost || 0)],
      ['Horas imputadas', `${Number(summary.totalLaborHours || 0).toLocaleString('es-CL', { maximumFractionDigits: 2 })} h`],
      ['Tasa CIF/h', formatCurrency(scenario.cifPerHour || 0)],
      ['Margen real', formatPercent(summary.realMargin || 0)]
    ];

    const kpiW = (pageW - margin * 2 - 6) / 4;
    const kpiRowCount = Math.ceil(kpis.length / 4);
    ensureSpace(kpiRowCount * 13 + 2);
    kpis.forEach((item, idx) => {
      const row = Math.floor(idx / 4);
      const col = idx % 4;
      const x = margin + col * (kpiW + 2);
      const boxY = y + row * 13;
      doc.rect(x, boxY, kpiW, 11, 'S');
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.2);
      doc.setTextColor(...mutedText);
      doc.text(item[0], x + 1.3, boxY + 3);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8.6);
      doc.setTextColor(...normalText);
      doc.text(clipText(item[1], kpiW - 3), x + 1.3, boxY + 8);
    });
    y += kpiRowCount * 13 + 3;

    const logisticsText = [
      quote.logistics?.address ? `Direccion: ${quote.logistics.address}` : '',
      quote.logistics?.district ? `Comuna: ${quote.logistics.district}` : '',
      quote.logistics?.metroStation ? `Metro: ${quote.logistics.metroStation}` : '',
      quote.logistics?.recipientName ? `Recibe: ${quote.logistics.recipientName}` : '',
      quote.logistics?.notes ? `Notas: ${quote.logistics.notes}` : ''
    ].filter(Boolean).join(' | ');
    if (logisticsText) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.4);
      doc.setTextColor(...mutedText);
      const wrapped = doc.splitTextToSize(logisticsText, pageW - margin * 2);
      doc.text(wrapped, margin, y);
      y += wrapped.length * 3.2 + 2;
    }

    y += 1;
    sectionTitle('Escenarios de precios de venta (neto)');
    const priceSelection = buildPriceSelectionData(calc);
    const selectedMode = String(summary.selectedPriceMode || 'target');
    const priceRows = [
      ...priceSelection.options.map((option) => [
        option.key === selectedMode ? 'X' : '',
        option.label,
        formatCurrency(option.price || 0),
        formatPercent(option.margin || 0),
        formatCurrency(option.profit || 0)
      ]),
      [
        selectedMode === 'custom' ? 'X' : '',
        'Precio definido',
        formatCurrency(priceSelection.custom.net || 0),
        formatPercent(priceSelection.custom.margin || 0),
        formatCurrency(priceSelection.custom.profit || 0)
      ]
    ];

    drawSimpleTable({
      sectionName: 'Escenarios de precios de venta',
      columns: [
        { label: 'Sel', width: 14 },
        { label: 'Escenario', width: 74 },
        { label: 'Precio neto', width: 34 },
        { label: 'Margen', width: 24 },
        { label: 'Utilidad', width: 49.9 }
      ],
      align: ['left', 'left', 'right', 'right', 'right'],
      rows: priceRows
    });
    ensureSpace(12);
    y += 4;

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.8);
    doc.setTextColor(...normalText);
    doc.text(`Escenario seleccionado: ${getPriceModeMeta(selectedMode).label}`, margin, y);
    y += 4.5;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.6);
    doc.setTextColor(...mutedText);
    doc.text(`Estado: ${summary.selectedStatus?.text || 'Dentro de las metas definidas'}`, margin, y);

    y += 7;
    sectionTitle('Precio final de venta');
    const effectiveNet = Number(summary.effectiveNet || 0);
    const effectiveGross = Number(summary.effectiveGross || 0);
    const effectiveIva = Math.max(0, Math.round((effectiveGross - effectiveNet) * 100) / 100);
    const effectiveProfit = Number(summary.contribution || 0);
    const finalPriceRows = [
      ['Precio neto seleccionado', formatCurrency(effectiveNet)],
      ['IVA', formatCurrency(effectiveIva)],
      ['Precio final con IVA', formatCurrency(effectiveGross)],
      ['Utilidad', formatCurrency(effectiveProfit)]
    ];
    ensureSpace(finalPriceRows.length * 8 + 8);
    finalPriceRows.forEach((row, idx) => {
      const boxY = y + idx * 8;
      doc.rect(margin, boxY, pageW - margin * 2, 7, 'S');
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.setTextColor(...normalText);
      doc.text(row[0], margin + 1.6, boxY + 4.5);
      doc.setFont('helvetica', 'bold');
      doc.text(clipText(row[1], pageW - margin * 2 - 20), maxX - 1.6, boxY + 4.5, { align: 'right' });
    });
    y += finalPriceRows.length * 8;

    ensureSpace(22);
    const sigY = maxY - 14;
    doc.line(margin, sigY, margin + 86, sigY);
    doc.line(maxX - 86, sigY, maxX, sigY);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.6);
    doc.setTextColor(...mutedText);
    doc.text('Firma responsable OT', margin, sigY + 3.5);
    doc.text('Firma cliente / recepcion', maxX - 86, sigY + 3.5);

    const pdfBlob = doc.output('blob');
    const fileName = getOrderPrintablePdfFilename(record);
    downloadBlobFile(pdfBlob, fileName);
  }

  function getLogisticsLabelPdfFilename(record) {
    const clean = (value, fallback) => String(value || fallback)
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-zA-Z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 40) || fallback;

    return `ETIQUETA_${clean(record.orderNumber, 'OT')}_${clean(record.customerName, 'Cliente')}.pdf`;
  }

  function buildLogisticsLabelRows(logistics) {
    const mode = logistics?.mode || 'retiro';
    const val = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();
    const modeLabel = {
      retiro: 'Retiro en taller',
      metro: 'Entrega en Metro',
      domicilio: 'Entrega a domicilio',
      starken: 'Envío por Starken'
    }[mode] || 'Retiro en taller';

    const rows = [['Modalidad', modeLabel]];

    if (mode === 'metro') {
      rows.push(['Estación de Metro acordada', val(logistics.metroStation)]);
      rows.push(['Comentarios', val(logistics.notes)]);
    } else if (mode === 'domicilio') {
      rows.push(['Dirección', val(logistics.address)]);
      rows.push(['Comuna', val(logistics.district)]);
      rows.push(['Comentarios', val(logistics.notes)]);
    } else if (mode === 'starken') {
      rows.push(['Cliente', val(logistics.recipientName)]);
      rows.push(['RUT cliente', val(logistics.recipientRut)]);
      rows.push(['Dirección de envío', val(logistics.address)]);
      rows.push(['Comuna', val(logistics.district)]);
      rows.push(['Teléfono', val(logistics.recipientPhone)]);
      rows.push(['Correo', val(logistics.recipientEmail)]);
      rows.push(['Comentarios', val(logistics.notes)]);
    } else {
      rows.push(['Comentarios', val(logistics.notes)]);
    }

    return rows;
  }

  function exportLogisticsLabelSheet() {
    normalizeQuotePrototypeState(state.quote);

    const jsPDFCtor = window.jspdf?.jsPDF;
    if (typeof jsPDFCtor !== 'function') {
      window.alert('No se pudo inicializar el exportador PDF. Reinicia la app e intenta nuevamente.');
      return;
    }

    const logistics = state.quote.logistics || {};
    const mode = logistics.mode || 'retiro';
    if (mode === 'retiro' && !String(logistics.notes || '').trim()) {
      window.alert('El retiro en taller no tiene comentarios, por lo que no hay datos para generar la etiqueta.');
      return;
    }

    const record = buildCurrentOrderRecord();
    const rows = buildLogisticsLabelRows(logistics);

    // Hoja tamaño carta = soporte universal (cualquier impresora la acepta).
    // Dentro se dibuja una etiqueta compacta tipo post-it, anclada arriba a la
    // izquierda y con altura ajustada al contenido (cuadrada o rectangular).
    const doc = new jsPDFCtor({ orientation: 'portrait', unit: 'mm', format: 'letter' });
    const ink = [17, 17, 17];
    const muted = [110, 110, 110];
    const hairline = [30, 30, 30];

    const labelX = 14;
    const labelY = 14;
    const labelW = 92;
    const padX = 6;
    const padTop = 7;
    const padBottom = 6;
    const innerW = labelW - padX * 2;
    const minLabelH = 52;

    const HEAD_FS = 11.5;
    const CAPTION_FS = 7.6;
    const VALUE_FS = 12;
    const HEAD_LH = 4.8;
    const CAPTION_LH = 4.0;
    const VALUE_LH = 5.6;
    const ROW_GAP = 2.4;
    const RULE_GAP = 3.4;

    // ---- medición ----
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(HEAD_FS);
    const headLines = doc.splitTextToSize('ETIQUETA DE DESPACHO', innerW);

    const measured = rows.map(([label, rawValue]) => {
      const value = String(rawValue || '').trim() || '—';
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(VALUE_FS);
      return { caption: String(label).toUpperCase(), valueLines: doc.splitTextToSize(value, innerW) };
    });

    const headerH = headLines.length * HEAD_LH + RULE_GAP;
    const bodyH = measured.reduce((acc, f) => acc + CAPTION_LH + f.valueLines.length * VALUE_LH + ROW_GAP, 0);
    const labelH = Math.max(minLabelH, padTop + headerH + bodyH + padBottom);

    // ---- dibujo ----
    doc.setDrawColor(...hairline);
    doc.setLineWidth(0.5);
    doc.rect(labelX, labelY, labelW, labelH, 'S');

    let cy = labelY + padTop;
    const textX = labelX + padX;

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(HEAD_FS);
    doc.setTextColor(...ink);
    headLines.forEach((ln) => {
      cy += HEAD_LH - 1.3;
      doc.text(ln, textX, cy);
      cy += 1.3;
    });

    cy += RULE_GAP - 1.6;
    doc.setDrawColor(...hairline);
    doc.setLineWidth(0.4);
    doc.line(textX, cy, labelX + labelW - padX, cy);
    cy += 1.6;

    measured.forEach((f) => {
      cy += CAPTION_LH;
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(CAPTION_FS);
      doc.setTextColor(...muted);
      doc.text(f.caption, textX, cy - 0.9);

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(VALUE_FS);
      doc.setTextColor(...ink);
      f.valueLines.forEach((ln) => {
        cy += VALUE_LH;
        doc.text(ln, textX, cy - 1.1);
      });
      cy += ROW_GAP;
    });

    const pdfBlob = doc.output('blob');
    downloadBlobFile(pdfBlob, getLogisticsLabelPdfFilename(record));
  }

  function exportContacts() {
    const payload = {
      app: 'AndiApp',
      exportedAt: new Date().toISOString(),
      contacts: state.contacts || []
    };
    downloadBlobFile(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }), getBackupFileName('contacts'));
  }

  function exportScenarioBase() {
    const payload = {
      app: 'AndiApp',
      exportedAt: new Date().toISOString(),
      scenario: state.scenario || {}
    };
    downloadBlobFile(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }), getBackupFileName('scenario'));
  }

  function exportProductTypesBase() {
    const payload = {
      app: 'AndiApp',
      exportedAt: new Date().toISOString(),
      productTypes: state.database.productTypes || []
    };
    downloadBlobFile(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }), getBackupFileName('productTypes'));
  }

  function exportExternalResourcesBase() {
    const payload = {
      app: 'AndiApp',
      exportedAt: new Date().toISOString(),
      externalResources: state.database.externalResources || []
    };
    downloadBlobFile(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }), getBackupFileName('external'));
  }

  function exportOrdersBase() {
    const payload = {
      app: 'AndiApp',
      exportedAt: new Date().toISOString(),
      orders: (state.orders || []).map((record) => ({
        orderNumber: record.orderNumber || 'OT-SIN-NUMERO',
        orderTitle: record.orderTitle || 'Orden sin título',
        productName: record.productName || '',
        customerId: record.customerId || '',
        customerName: record.customerName || '',
        quoteDate: record.quoteDate || '',
        estimatedDeliveryDate: record.estimatedDeliveryDate || record.quote?.estimatedDeliveryDate || '',
        status: record.status || 'Prospecto',
        deliveryState: record.deliveryState || 'Abierta',
        isPrototype: Boolean(record.isPrototype || record.quote?.isPrototype),
        savedAt: record.savedAt || new Date().toISOString(),
        attachments: getOwnerAttachments(record, legacyOrderInvoiceAttachment),
        invoicePdfDataUrl: record.invoicePdfDataUrl || record.quote?.invoicePdfDataUrl || '',
        invoicePdfName: record.invoicePdfName || record.quote?.invoicePdfName || '',
        invoicePdfMimeType: record.invoicePdfMimeType || record.quote?.invoicePdfMimeType || '',
        invoicePdfSizeKb: Number(record.invoicePdfSizeKb || record.quote?.invoicePdfSizeKb || 0) || 0,
        quote: {
          ...(record.quote || {}),
          attachments: getOwnerAttachments(record.quote || record, legacyOrderInvoiceAttachment)
        },
        quoteSummary: record.quoteSummary || {},
        scenarioSnapshot: record.scenarioSnapshot || {}
      }))
    };
    downloadBlobFile(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }), getBackupFileName('orders'));
  }

  async function exportAllBases() {
    const exportedAt = new Date().toISOString();
    const files = [
      {
        filename: getBackupFileName('scenario'),
        payload: { app: 'AndiApp', exportedAt, scenario: state.scenario || {} }
      },
      {
        filename: getBackupFileName('database'),
        payload: { app: 'AndiApp', exportedAt, materials: state.database.materials || [] }
      },
      {
        filename: getBackupFileName('productTypes'),
        payload: { app: 'AndiApp', exportedAt, productTypes: state.database.productTypes || [] }
      },
      {
        filename: getBackupFileName('external'),
        payload: { app: 'AndiApp', exportedAt, externalResources: state.database.externalResources || [] }
      },
      {
        filename: getBackupFileName('contacts'),
        payload: { app: 'AndiApp', exportedAt, contacts: state.contacts || [] }
      },
      {
        filename: getBackupFileName('orders'),
        payload: {
          app: 'AndiApp',
          exportedAt,
          orders: (state.orders || []).map((record) => ({
            orderNumber: record.orderNumber || 'OT-SIN-NUMERO',
            orderTitle: record.orderTitle || 'Orden sin titulo',
            productName: record.productName || '',
            customerId: record.customerId || '',
            customerName: record.customerName || '',
            quoteDate: record.quoteDate || '',
            estimatedDeliveryDate: record.estimatedDeliveryDate || record.quote?.estimatedDeliveryDate || '',
            status: record.status || 'Prospecto',
            deliveryState: record.deliveryState || 'Abierta',
            isPrototype: Boolean(record.isPrototype || record.quote?.isPrototype),
            savedAt: record.savedAt || exportedAt,
            attachments: getOwnerAttachments(record, legacyOrderInvoiceAttachment),
            invoicePdfDataUrl: record.invoicePdfDataUrl || record.quote?.invoicePdfDataUrl || '',
            invoicePdfName: record.invoicePdfName || record.quote?.invoicePdfName || '',
            invoicePdfMimeType: record.invoicePdfMimeType || record.quote?.invoicePdfMimeType || '',
            invoicePdfSizeKb: Number(record.invoicePdfSizeKb || record.quote?.invoicePdfSizeKb || 0) || 0,
            quote: {
              ...(record.quote || {}),
              attachments: getOwnerAttachments(record.quote || record, legacyOrderInvoiceAttachment)
            },
            quoteSummary: record.quoteSummary || {},
            scenarioSnapshot: record.scenarioSnapshot || {}
          }))
        }
      },
      {
        filename: getBackupFileName('expenses'),
        payload: { app: 'AndiApp', exportedAt, expenses: (state.expenses.cards || []).map((card) => createExpenseCard(card)) }
      },
      {
        filename: getBackupFileName('desired'),
        payload: { app: 'AndiApp', exportedAt, desiredItems: state.inventory.desiredItems || [] }
      },
      {
        filename: getBackupFileName('attendance'),
        payload: {
          app: 'AndiApp',
          exportedAt,
          attendance: {
            activeSession: state.attendance?.activeSession || null,
            records: state.attendance?.records || []
          }
        }
      },
      {
        filename: getBackupFileName('finance'),
        payload: {
          app: 'AndiApp',
          exportedAt,
          finance: {
            initialBalance: state.finance?.initialBalance || 0,
            ivaCreditBalance: state.finance?.ivaCreditBalance || 0,
            ivaCreditBalanceLocked: Boolean(state.finance?.ivaCreditBalanceLocked),
            entries: state.finance?.entries || []
          }
        }
      }
    ];

    if (window.showDirectoryPicker) {
      try {
        const rootDir = await window.showDirectoryPicker({ mode: 'readwrite' });
        const permitted = await ensureWritePermission(rootDir);
        if (permitted) {
          for (const entry of files) {
            const handle = await rootDir.getFileHandle(entry.filename, { create: true });
            const writable = await handle.createWritable();
            await writable.write(JSON.stringify(entry.payload, null, 2));
            await writable.close();
          }
          window.alert(`Respaldo separado completado en la carpeta seleccionada (${files.length} archivos).`);
          return;
        }
      } catch (error) {
        if (error?.name === 'AbortError') return;
        console.warn('No se pudo exportar en carpeta seleccionada, se usará descarga estándar.', error);
      }
    }

    files.forEach((entry) => {
      downloadBlobFile(new Blob([JSON.stringify(entry.payload, null, 2)], { type: 'application/json' }), entry.filename);
    });
    window.alert(`Se descargaron todas las bases disponibles en archivos separados (${files.length} archivos).`);
  }

  async function exportAllBasesAsZip() {
    if (!window.JSZip) {
      window.alert('No se pudo inicializar la libreria de compresion ZIP.');
      return;
    }

    try {
      const exportedAt = new Date().toISOString();
      const token = getBackupDateToken(new Date());
      const zipName = `RESPALDO_COMPLETO_ANDIAPP_${token}.zip`;

      const files = [
        {
          filename: getBackupFileName('scenario'),
          payload: {
            app: 'AndiApp',
            exportedAt,
            scenario: state.scenario || {}
          }
        },
        {
          filename: getBackupFileName('database'),
          payload: {
            app: 'AndiApp',
            exportedAt,
            materials: state.database.materials || []
          }
        },
        {
          filename: getBackupFileName('productTypes'),
          payload: {
            app: 'AndiApp',
            exportedAt,
            productTypes: state.database.productTypes || []
          }
        },
        {
          filename: getBackupFileName('external'),
          payload: {
            app: 'AndiApp',
            exportedAt,
            externalResources: state.database.externalResources || []
          }
        },
        {
          filename: getBackupFileName('contacts'),
          payload: {
            app: 'AndiApp',
            exportedAt,
            contacts: state.contacts || []
          }
        },
        {
          filename: getBackupFileName('orders'),
          payload: {
            app: 'AndiApp',
            exportedAt,
            orders: (state.orders || []).map((record) => ({
              orderNumber: record.orderNumber || 'OT-SIN-NUMERO',
              orderTitle: record.orderTitle || 'Orden sin titulo',
              productName: record.productName || '',
              customerId: record.customerId || '',
              customerName: record.customerName || '',
              quoteDate: record.quoteDate || '',
              estimatedDeliveryDate: record.estimatedDeliveryDate || record.quote?.estimatedDeliveryDate || '',
              status: record.status || 'Prospecto',
              deliveryState: record.deliveryState || 'Abierta',
              isPrototype: Boolean(record.isPrototype || record.quote?.isPrototype),
              savedAt: record.savedAt || exportedAt,
              attachments: getOwnerAttachments(record, legacyOrderInvoiceAttachment),
              invoicePdfDataUrl: record.invoicePdfDataUrl || record.quote?.invoicePdfDataUrl || '',
              invoicePdfName: record.invoicePdfName || record.quote?.invoicePdfName || '',
              invoicePdfMimeType: record.invoicePdfMimeType || record.quote?.invoicePdfMimeType || '',
              invoicePdfSizeKb: Number(record.invoicePdfSizeKb || record.quote?.invoicePdfSizeKb || 0) || 0,
              quote: {
                ...(record.quote || {}),
                attachments: getOwnerAttachments(record.quote || record, legacyOrderInvoiceAttachment)
              },
              quoteSummary: record.quoteSummary || {},
              scenarioSnapshot: record.scenarioSnapshot || {}
            }))
          }
        },
        {
          filename: getBackupFileName('expenses'),
          payload: {
            app: 'AndiApp',
            exportedAt,
            expenses: (state.expenses.cards || []).map((card) => createExpenseCard(card))
          }
        },
        {
          filename: getBackupFileName('desired'),
          payload: {
            app: 'AndiApp',
            exportedAt,
            desiredItems: state.inventory.desiredItems || []
          }
        },
        {
          filename: getBackupFileName('attendance'),
          payload: {
            app: 'AndiApp',
            exportedAt,
            attendance: {
              activeSession: state.attendance?.activeSession || null,
              records: state.attendance?.records || []
            }
          }
        },
        {
          filename: getBackupFileName('finance'),
          payload: {
            app: 'AndiApp',
            exportedAt,
            finance: {
              initialBalance: state.finance?.initialBalance || 0,
              ivaCreditBalance: state.finance?.ivaCreditBalance || 0,
              ivaCreditBalanceLocked: Boolean(state.finance?.ivaCreditBalanceLocked),
              entries: state.finance?.entries || []
            }
          }
        }
      ];

      const zip = new window.JSZip();
      files.forEach((entry) => {
        zip.file(entry.filename, JSON.stringify(entry.payload, null, 2));
      });

      const blob = await zip.generateAsync({
        type: 'blob',
        compression: 'DEFLATE',
        compressionOptions: { level: 6 }
      });

      downloadBlobFile(blob, zipName);
      window.alert(`Respaldo ZIP generado correctamente (${files.length} bases).`);
    } catch (error) {
      console.error(error);
      window.alert('No se pudo generar el archivo ZIP de respaldo.');
    }
  }

  // Ramas de estado que constituyen "la base de datos total" de la app.
  // Se excluye 'ui' (banderas efímeras: filtros, borradores, tema).
  const FULL_DB_BRANCHES = ['scenario', 'quote', 'database', 'contacts', 'orders', 'inventory', 'expenses', 'attendance', 'finance'];

  function exportFullDatabase() {
    const exportedAt = new Date().toISOString();
    const token = getBackupDateToken(new Date());
    const snapshot = {};
    FULL_DB_BRANCHES.forEach((key) => {
      snapshot[key] = JSON.parse(JSON.stringify(state[key] ?? (window.ERMDefaults[key] ?? null)));
    });
    const payload = {
      app: 'AndiApp',
      kind: 'full-database',
      appVersion: window.ERM_APP_VERSION || '',
      exportedAt,
      state: snapshot
    };
    downloadBlobFile(
      new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }),
      `BASE_COMPLETA_${token}_ANDIAPP.json`
    );
    window.alert('Se descargó la BASE DE DATOS COMPLETA de la app en un solo archivo (incluye Inventario y todas las secciones).');
  }

  // Aplica un snapshot de base completa sobre el estado vivo (mutación in situ)
  // y lo pasa por la normalización/migraciones de ERMStorage.
  function applyFullDatabaseState(incoming) {
    if (!incoming || typeof incoming !== 'object') return false;
    FULL_DB_BRANCHES.forEach((key) => {
      if (incoming[key] !== undefined && incoming[key] !== null) {
        state[key] = JSON.parse(JSON.stringify(incoming[key]));
      }
    });
    try {
      window.ERMStorage.save(state);
      const normalized = window.ERMStorage.load();
      FULL_DB_BRANCHES.forEach((key) => {
        if (normalized[key] !== undefined) state[key] = normalized[key];
      });
      window.ERMStorage.save(state);
    } catch (error) {
      console.warn('No se pudo normalizar la base completa importada.', error);
    }
    return true;
  }

  // Reconecta adjuntos de la app de escritorio (storagePath) con los archivos originales
  // elegidos por el usuario y los incrusta como dataUrl.
  async function recoverDesktopAttachments(files) {
    const byName = new Map(files.map((file) => [file.name, file]));
    const pending = [];
    const walk = (node) => {
      if (Array.isArray(node)) { node.forEach(walk); return; }
      if (!node || typeof node !== 'object') return;
      if (typeof node.storagePath === 'string' && node.storagePath && !node.dataUrl) pending.push(node);
      Object.values(node).forEach(walk);
    };
    FULL_DB_BRANCHES.forEach((key) => walk(state[key]));

    const cache = new Map();
    let recovered = 0;
    let missing = 0;
    for (const attachment of pending) {
      const baseName = attachment.storagePath.split('/').pop();
      const file = byName.get(baseName);
      if (!file) { missing += 1; continue; }
      if (!cache.has(baseName)) cache.set(baseName, await readFileAsDataUrl(file));
      attachment.dataUrl = cache.get(baseName);
      attachment.storagePath = '';
      recovered += 1;
    }
    if (recovered) {
      window.ERMStorage.save(state);
      render();
    }
    window.alert(`Adjuntos recuperados: ${recovered}. Sin archivo correspondiente: ${missing}.`);
  }

  async function importScenarioFromFile(file) {
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const scenario = parsed?.scenario || parsed?.scenarioSnapshot || parsed;
      if (!scenario || typeof scenario !== 'object') {
        window.alert('El archivo no corresponde a una base de escenario válida.');
        return;
      }
      state.scenario = {
        ...JSON.parse(JSON.stringify(window.ERMDefaults.scenario)),
        ...scenario,
        projection: {
          ...JSON.parse(JSON.stringify(window.ERMDefaults.scenario.projection)),
          ...(scenario.projection || {})
        }
      };
      stampBaseUpdate('scenario');
      render();
      window.alert('Base de escenario importada correctamente.');
    } catch (error) {
      console.error(error);
      window.alert('No se pudo importar la base de escenario.');
    }
  }

  function normalizeMaterialRecord(item) {
    return {
      id: item.id || uid('mat'),
      group: (item.group === 'Material' ? 'Placas' : item.group) || 'Placas',
      name: item.name || '',
      calculationUnit: item.calculationUnit || 'unidad',
      baseCost: Number(item.baseCost ?? item.unitCost ?? 0) || 0,
      unitCost: Number(item.unitCost ?? item.baseCost ?? 0) || 0,
      unit: item.unit || 'unidad',
      notes: item.notes || '',
      provider: item.provider || item.Proveedor || '',
      supplierAddress: item.supplierAddress || item.DireccionProveedor || '',
      supplierContact: item.supplierContact || item.Contacto || '',
      status: item.status || item.Estado || 'Activo',
      formulaSummary: item.formulaSummary || '',
      createdAt: item.createdAt || item.Fecha || new Date().toLocaleDateString('es-CL'),
      widthCm: Number(item.widthCm || 0) || 0,
      heightCm: Number(item.heightCm || 0) || 0,
      yieldQuantity: Number(item.yieldQuantity || 0) || 0,
      yieldUnit: item.yieldUnit || 'm²',
      imageDataUrl: item.imageDataUrl || item.image || '',
      imageName: item.imageName || '',
      imageMimeType: item.imageMimeType || '',
      imageSizeKb: Number(item.imageSizeKb || 0) || 0
    };
  }

  async function importAllBasesFromFiles(files) {
    let scenarioUpdated = false;
    let databaseUpdated = false;
    let productTypesUpdated = false;
    let externalUpdated = false;
    let contactsUpdated = false;
    let orderRecordsChanged = 0;
    let expensesUpdated = false;
    let desiredUpdated = false;
    let attendanceUpdated = false;
    let financeUpdated = false;

    const parsedPayloads = [];

    for (const file of files) {
      try {
        const lowerName = String(file.name || '').toLowerCase();
        if (lowerName.endsWith('.zip')) {
          if (!window.JSZip) {
            console.warn('No hay soporte ZIP disponible para importar:', file.name);
            continue;
          }
          const zip = await window.JSZip.loadAsync(file);
          const jsonEntries = Object.values(zip.files).filter((entry) => !entry.dir && entry.name.toLowerCase().endsWith('.json'));
          for (const entry of jsonEntries) {
            try {
              const text = await entry.async('string');
              parsedPayloads.push(JSON.parse(text));
            } catch (innerError) {
              console.error('No se pudo leer JSON dentro del ZIP:', entry.name, innerError);
            }
          }
          continue;
        }

        const text = await file.text();
        parsedPayloads.push(JSON.parse(text));
      } catch (error) {
        console.error(error);
      }
    }

    parsedPayloads.forEach((parsed) => {
      // Respaldo de BASE COMPLETA (un solo archivo con todo el estado)
      if (parsed?.kind === 'full-database' && parsed.state && typeof parsed.state === 'object') {
        if (applyFullDatabaseState(parsed.state)) {
          scenarioUpdated = true;
          databaseUpdated = true;
          productTypesUpdated = true;
          externalUpdated = true;
          contactsUpdated = true;
          expensesUpdated = true;
          desiredUpdated = true;
          attendanceUpdated = true;
          financeUpdated = true;
          orderRecordsChanged += (parsed.state.orders || []).length || 1;
        }
        return;
      }

      if (parsed?.scenario || parsed?.scenarioSnapshot) {
        const scenario = parsed.scenario || parsed.scenarioSnapshot;
        state.scenario = {
          ...JSON.parse(JSON.stringify(window.ERMDefaults.scenario)),
          ...scenario,
          projection: {
            ...JSON.parse(JSON.stringify(window.ERMDefaults.scenario.projection)),
            ...(scenario.projection || {})
          }
        };
        scenarioUpdated = true;
      }

      if (Array.isArray(parsed?.materials) || Array.isArray(parsed?.database?.materials)) {
        const source = parsed.materials || parsed.database?.materials || [];
        state.database.materials = source.map(normalizeMaterialRecord).filter((item) => item.name);
        databaseUpdated = true;
      }

      if (Array.isArray(parsed?.productTypes) || Array.isArray(parsed?.database?.productTypes)) {
        const source = parsed.productTypes || parsed.database?.productTypes || [];
        state.database.productTypes = source.map((item) => ({
          id: item.id || uid('ptype'),
          name: String(item.name || '').trim(),
          comments: item.comments || '',
          createdAt: item.createdAt || new Date().toLocaleDateString('es-CL')
        })).filter((item) => item.name);
        productTypesUpdated = true;
      }

      if (Array.isArray(parsed?.externalResources) || Array.isArray(parsed?.database?.externalResources)) {
        const source = parsed.externalResources || parsed.database?.externalResources || [];
        state.database.externalResources = source.map((item) => ({
          id: item.id || uid('ext'),
          type: String(item.type || 'ayuda').toLowerCase() === 'landmark' ? 'Landmark' : (item.type || 'ayuda'),
          name: String(item.name || '').trim(),
          hourlyRate: Number(item.hourlyRate || 0) || 0,
          description: item.description || '',
          phone: String(item.phone || '').trim(),
          instagram: String(item.instagram || '').trim(),
          facebook: String(item.facebook || '').trim(),
          email: String(item.email || '').trim(),
          website: String(item.website || '').trim(),
          status: item.status === 'Inactivo' ? 'Inactivo' : 'Activo',
          createdAt: item.createdAt || new Date().toLocaleDateString('es-CL')
        })).filter((item) => item.name);
        externalUpdated = true;
      }

      if (Array.isArray(parsed?.contacts)) {
        state.contacts = parsed.contacts.map((item) => ({
          id: item.id || uid('cli'),
          clientNumber: Number(item.clientNumber) || 0,
          type: item.type || 'persona',
          name: String(item.name || '').trim(),
          company: String(item.company || '').trim(),
          rut: String(item.rut || '').trim(),
          firstContactDate: item.firstContactDate || new Date().toISOString().slice(0, 10),
          address: String(item.address || '').trim(),
          district: String(item.district || '').trim(),
          whatsapp: String(item.whatsapp || '').trim(),
          instagram: String(item.instagram || '').trim(),
          email: String(item.email || '').trim(),
          facebook: String(item.facebook || '').trim(),
          website: String(item.website || '').trim(),
          comments: String(item.comments || '').trim(),
          isFriend: Boolean(item.isFriend)
        })).filter((item) => item.name);
        contactsUpdated = true;
      }

      if (Array.isArray(parsed?.orders)) {
        const source = parsed.orders || [];
        source.forEach((recordRaw) => {
          const record = {
            id: uid('ot'),
            orderNumber: recordRaw.orderNumber || recordRaw.quote?.orderNumber || 'OT-IMPORTADA',
            orderTitle: recordRaw.orderTitle || recordRaw.quote?.orderTitle || 'Orden importada',
            productName: recordRaw.productName || recordRaw.quote?.productName || '',
            customerId: recordRaw.customerId || recordRaw.quote?.customerId || '',
            customerName: recordRaw.customerName || recordRaw.quote?.customerName || '',
            quoteDate: recordRaw.quoteDate || recordRaw.quote?.quoteDate || new Date().toISOString().slice(0, 10),
            estimatedDeliveryDate: recordRaw.estimatedDeliveryDate || recordRaw.quote?.estimatedDeliveryDate || '',
            status: recordRaw.status || recordRaw.quote?.status || 'Prospecto',
            deliveryState: recordRaw.deliveryState || recordRaw.quote?.deliveryState || 'Abierta',
            isPrototype: Boolean(recordRaw.isPrototype || recordRaw.quote?.isPrototype || recordRaw.status === 'Prototipo' || recordRaw.quote?.status === 'Prototipo'),
            savedAt: new Date().toISOString(),
            attachments: normalizeAttachments(recordRaw.attachments || recordRaw.quote?.attachments || []),
            invoicePdfDataUrl: recordRaw.invoicePdfDataUrl || recordRaw.quote?.invoicePdfDataUrl || '',
            invoicePdfName: recordRaw.invoicePdfName || recordRaw.quote?.invoicePdfName || '',
            invoicePdfMimeType: recordRaw.invoicePdfMimeType || recordRaw.quote?.invoicePdfMimeType || '',
            invoicePdfSizeKb: Number(recordRaw.invoicePdfSizeKb || recordRaw.quote?.invoicePdfSizeKb || 0) || 0,
            quote: recordRaw.quote || recordRaw.order || {},
            quoteSummary: recordRaw.quoteSummary || {},
            scenarioSnapshot: recordRaw.scenarioSnapshot || {}
          };
          const existingIndex = (state.orders || []).findIndex((item) => item.orderNumber === record.orderNumber);
          if (existingIndex >= 0) {
            record.id = state.orders[existingIndex].id;
            state.orders[existingIndex] = record;
            orderRecordsChanged += 1;
          } else {
            state.orders.unshift(record);
            orderRecordsChanged += 1;
          }
        });
      }

      if (parsed?.order) {
        const record = {
          id: uid('ot'),
          orderNumber: parsed.order.orderNumber || 'OT-IMPORTADA',
          orderTitle: parsed.order.orderTitle || 'Orden importada',
          productName: parsed.order.productName || '',
          customerId: parsed.order.customerId || '',
          customerName: parsed.order.customerName || '',
          quoteDate: parsed.order.quoteDate || new Date().toISOString().slice(0, 10),
          estimatedDeliveryDate: parsed.order.estimatedDeliveryDate || '',
          status: parsed.order.status || 'Prospecto',
          deliveryState: parsed.order.deliveryState || 'Abierta',
          isPrototype: Boolean(parsed.order.isPrototype || parsed.order.status === 'Prototipo'),
          savedAt: new Date().toISOString(),
          attachments: normalizeAttachments(parsed.order.attachments || []),
          invoicePdfDataUrl: parsed.order.invoicePdfDataUrl || '',
          invoicePdfName: parsed.order.invoicePdfName || '',
          invoicePdfMimeType: parsed.order.invoicePdfMimeType || '',
          invoicePdfSizeKb: Number(parsed.order.invoicePdfSizeKb || 0) || 0,
          quote: parsed.order,
          quoteSummary: parsed.quoteSummary || {},
          scenarioSnapshot: parsed.scenarioSnapshot || {}
        };
        const existingIndex = (state.orders || []).findIndex((item) => item.orderNumber === record.orderNumber);
        if (existingIndex >= 0) {
          record.id = state.orders[existingIndex].id;
          state.orders[existingIndex] = record;
          orderRecordsChanged += 1;
        } else {
          state.orders.unshift(record);
          orderRecordsChanged += 1;
        }
      }

      if (Array.isArray(parsed?.expenses)) {
        state.expenses.cards = parsed.expenses.map((card) => createExpenseCard(card));
        state.ui.selectedExpenseId = state.expenses.cards[0]?.id || null;
        state.ui.expenseDraft = state.expenses.cards[0] ? JSON.parse(JSON.stringify(state.expenses.cards[0])) : null;
        expensesUpdated = true;
      }

      if (Array.isArray(parsed?.desiredItems)) {
        state.inventory.desiredItems = parsed.desiredItems.map(normalizeDesiredItem).filter((item) => item.name);
        desiredUpdated = true;
      }

      if (parsed?.attendance && typeof parsed.attendance === 'object') {
        const sourceAttendance = parsed.attendance;
        const activeSession = sourceAttendance?.activeSession && typeof sourceAttendance.activeSession === 'object'
          ? {
            id: sourceAttendance.activeSession.id || uid('att-session'),
            employeeName: String(sourceAttendance.activeSession.employeeName || '').trim(),
            checkInAt: sourceAttendance.activeSession.checkInAt || null,
            comments: String(sourceAttendance.activeSession.comments || ''),
            pausedAccumulatedMs: Math.max(0, Number(sourceAttendance.activeSession.pausedAccumulatedMs) || 0),
            isPaused: Boolean(sourceAttendance.activeSession.isPaused),
            pauseStartedAt: sourceAttendance.activeSession.pauseStartedAt || null,
            pauseCount: Math.max(0, Number(sourceAttendance.activeSession.pauseCount) || 0),
            workedAccumulatedMs: Math.max(0, Number(sourceAttendance.activeSession.workedAccumulatedMs) || 0),
            activeWorkStartedAt: sourceAttendance.activeSession.activeWorkStartedAt || sourceAttendance.activeSession.checkInAt || null,
            workSegments: (Array.isArray(sourceAttendance.activeSession.workSegments) ? sourceAttendance.activeSession.workSegments : [])
              .filter((seg) => seg && seg.startAt)
              .map((seg) => ({ startAt: seg.startAt, endAt: seg.endAt || null }))
          }
          : null;

        state.attendance = state.attendance || { activeSession: null, records: [] };
        state.attendance.activeSession = activeSession?.employeeName && activeSession?.checkInAt ? activeSession : null;
        state.attendance.records = (Array.isArray(sourceAttendance?.records) ? sourceAttendance.records : []).map((item) => ({
          id: item.id || uid('att-record'),
          employeeName: String(item.employeeName || '').trim(),
          checkInAt: item.checkInAt || '',
          checkOutAt: item.checkOutAt || '',
          totalMs: Math.max(0, Number(item.totalMs) || 0),
          workedMs: Math.max(0, Number(item.workedMs) || 0),
          pauseMs: Math.max(0, Number(item.pauseMs) || 0),
          pauseCount: Math.max(0, Number(item.pauseCount) || 0),
          workSegments: (Array.isArray(item.workSegments) ? item.workSegments : [])
            .filter((seg) => seg && seg.startAt && seg.endAt)
            .map((seg) => ({ startAt: seg.startAt, endAt: seg.endAt })),
          comments: String(item.comments || '')
        })).filter((item) => item.employeeName && item.checkInAt && item.checkOutAt);

        state.ui.attendanceEditingId = null;
        attendanceUpdated = true;
      }

      if (parsed?.finance && typeof parsed.finance === 'object') {
        const sourceFinance = parsed.finance;
        state.finance = state.finance || { initialBalance: 0, entries: [] };
        state.finance.initialBalance = Math.max(0, Number(sourceFinance.initialBalance || 0) || 0);
        if (sourceFinance.ivaCreditBalance !== undefined) {
          state.finance.ivaCreditBalance = Math.max(0, Number(sourceFinance.ivaCreditBalance || 0) || 0);
        }
        if (sourceFinance.ivaCreditBalanceLocked !== undefined) {
          state.finance.ivaCreditBalanceLocked = Boolean(sourceFinance.ivaCreditBalanceLocked);
        }
        state.finance.entries = (Array.isArray(sourceFinance.entries) ? sourceFinance.entries : []).map((entry) => createFinanceEntry(entry));
        state.ui.editingFinanceId = null;
        state.ui.financeDraft = null;
        financeUpdated = true;
      }
    });

    if (scenarioUpdated) stampBaseUpdate('scenario');
    if (databaseUpdated) stampBaseUpdate('database');
    if (productTypesUpdated) stampBaseUpdate('productTypes');
    if (externalUpdated) stampBaseUpdate('external');
    if (contactsUpdated) stampBaseUpdate('contacts');
    if (orderRecordsChanged > 0) stampBaseUpdate('orders');
    if (expensesUpdated) stampBaseUpdate('expenses');
    if (desiredUpdated) stampBaseUpdate('desired');
    if (attendanceUpdated) stampBaseUpdate('attendance');
    if (financeUpdated) stampBaseUpdate('finance');

    render();
    window.alert('Importación global completada. Se detectaron y cargaron automáticamente las bases compatibles (incluye ZIP).');
  }

  async function importContactsFromFile(file) {
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const importedContacts = Array.isArray(parsed?.contacts) ? parsed.contacts : [];

      if (!importedContacts.length) {
        window.alert('El archivo no contiene una lista válida de clientes.');
        return;
      }

      let added = 0;
      let updated = 0;
      let nextNumber = getNextContactNumber();

      importedContacts.forEach((raw) => {
        const payload = {
          id: raw.id || uid('cli'),
          clientNumber: Number(raw.clientNumber) || nextNumber++,
          type: raw.type || 'persona',
          name: String(raw.name || '').trim(),
          company: String(raw.company || '').trim(),
          rut: String(raw.rut || '').trim(),
          firstContactDate: raw.firstContactDate || new Date().toISOString().slice(0, 10),
          address: String(raw.address || '').trim(),
          district: String(raw.district || '').trim(),
          whatsapp: String(raw.whatsapp || '').trim(),
          instagram: String(raw.instagram || '').trim(),
          email: String(raw.email || '').trim(),
          facebook: String(raw.facebook || '').trim(),
          website: String(raw.website || '').trim(),
          comments: String(raw.comments || '').trim(),
          isFriend: Boolean(raw.isFriend)
        };

        const existingIndex = (state.contacts || []).findIndex((item) =>
          (raw.id && item.id === raw.id)
          || (payload.rut && item.rut === payload.rut)
          || ((item.name || '').trim().toLowerCase() === payload.name.toLowerCase() && (item.company || '').trim().toLowerCase() === payload.company.toLowerCase())
        );

        if (existingIndex >= 0) {
          state.contacts[existingIndex] = { ...state.contacts[existingIndex], ...payload, id: state.contacts[existingIndex].id };
          updated += 1;
        } else if (payload.name) {
          state.contacts.push(payload);
          added += 1;
        }
      });

      stampBaseUpdate('contacts');
      render();
      window.alert(`Clientes importados correctamente: ${added} agregados y ${updated} actualizados.`);
    } catch (error) {
      console.error(error);
      window.alert('No se pudo importar la lista de clientes. Revisa que el JSON provenga de AndiApp.');
    }
  }

  async function ensureWritePermission(handle) {
    if (!handle?.queryPermission || !handle?.requestPermission) return true;
    let permission = await handle.queryPermission({ mode: 'readwrite' });
    if (permission !== 'granted') {
      permission = await handle.requestPermission({ mode: 'readwrite' });
    }
    return permission === 'granted';
  }

  function sanitizeFileName(name) {
    return String(name || 'imagen')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .toLowerCase() || 'imagen';
  }

  function mimeToExtension(mimeType) {
    switch (mimeType) {
      case 'image/png': return 'png';
      case 'image/jpeg': return 'jpg';
      case 'image/webp': return 'webp';
      default: return 'bin';
    }
  }

  function dataUrlToBlob(dataUrl) {
    const [header, data] = String(dataUrl || '').split(',');
    const mimeType = header?.match(/data:(.*?);base64/)?.[1] || 'application/octet-stream';
    const binary = atob(data || '');
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return new Blob([bytes], { type: mimeType });
  }

  async function exportDatabase(format = 'json') {
    const dateStamp = new Date().toISOString().slice(0, 10);

    if (format === 'csv') {
      const rows = (state.database.materials || []).map((item) => ({
        Fecha: item.createdAt || '',
        Grupo: item.group || '',
        Nombre: item.name || '',
        UnidadCalculo: renderCalculationUnitLabel(item.calculationUnit),
        CostoBaseCLP: item.baseCost || 0,
        ResultadoAplicadoCLP: item.unitCost || 0,
        UnidadResultado: item.unit || '',
        Imagen: item.imageName || '',
        Notas: item.notes || '',
        Formula: item.formulaSummary || ''
      }));

      const headers = Object.keys(rows[0] || {
        Fecha: '', Grupo: '', Nombre: '', UnidadCalculo: '', CostoBaseCLP: '', ResultadoAplicadoCLP: '', UnidadResultado: '', Imagen: '', Notas: '', Formula: ''
      });

      const csv = [headers.join(';')].concat(rows.map((row) => headers.map((key) => {
        const value = String(row[key] ?? '').replaceAll('"', '""');
        return `"${value}"`;
      }).join(';'))).join('\n');

      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      downloadBlobFile(blob, `erm_base_datos_interna_${dateStamp}.csv`);
      return;
    }

    const imageEntries = (state.database.materials || [])
      .filter((item) => item.imageDataUrl)
      .map((item) => {
        const extension = mimeToExtension(item.imageMimeType || 'image/webp');
        const fileName = `${sanitizeFileName(item.name || item.id)}-${item.id}.${extension}`;
        return {
          id: item.id,
          name: item.name,
          fileName,
          blob: dataUrlToBlob(item.imageDataUrl)
        };
      });

    const payload = {
      app: 'AndiApp',
      exportedAt: new Date().toISOString(),
      imagesExported: imageEntries.map((entry) => ({ id: entry.id, name: entry.name, fileName: entry.fileName })),
      materials: (state.database.materials || []).map((item) => ({
        ...item,
        imageFileName: imageEntries.find((entry) => entry.id === item.id)?.fileName || ''
      }))
    };

    if (format === 'bundle') {
      if (window.showDirectoryPicker) {
        try {
          const rootDir = await window.showDirectoryPicker({ mode: 'readwrite' });
          const permitted = await ensureWritePermission(rootDir);

          if (!permitted) {
            window.alert('No se concedió permiso de escritura en la carpeta. Se usará la descarga normal como respaldo.');
          } else {
            const imagesFolderName = `erm-proyecta-base-${dateStamp}-imagenes`;
            const imagesDir = await rootDir.getDirectoryHandle(imagesFolderName, { create: true });

            const jsonHandle = await rootDir.getFileHandle(`erm-proyecta-base-${dateStamp}.json`, { create: true });
            let writable = await jsonHandle.createWritable();
            await writable.write(JSON.stringify(payload, null, 2));
            await writable.close();

            for (const entry of imageEntries) {
              const imageHandle = await imagesDir.getFileHandle(entry.fileName, { create: true });
              writable = await imageHandle.createWritable();
              await writable.write(entry.blob);
              await writable.close();
            }

            window.alert(`Exportación completada. Se guardó el JSON en la carpeta elegida y ${imageEntries.length} imagen(es) dentro de ${imagesFolderName}.`);
            return;
          }
        } catch (error) {
          if (error?.name === 'AbortError') {
            return;
          }
          console.error(error);
          window.alert('No fue posible escribir directamente en la carpeta elegida. Se activará la descarga de respaldo.');
        }
      }

      const jsonBlob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      downloadBlobFile(jsonBlob, getBackupFileName('database'));
      imageEntries.forEach((entry) => downloadBlobFile(entry.blob, entry.fileName));
      window.alert(imageEntries.length
        ? 'Se descargó el JSON y las imágenes por separado como respaldo. Guárdalas en una misma carpeta.'
        : 'Se descargó el JSON de la base. No había imágenes asociadas para exportar.');
      return;
    }

    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    downloadBlobFile(blob, getBackupFileName('database'));
  }

  async function importProductTypesFromFile(file) {
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const source = Array.isArray(parsed)
        ? parsed
        : (Array.isArray(parsed.productTypes) ? parsed.productTypes : (Array.isArray(parsed.database?.productTypes) ? parsed.database.productTypes : []));

      if (!Array.isArray(source)) {
        window.alert('El archivo no tiene un formato válido para Tipos de producto.');
        return;
      }

      state.database.productTypes = source.map((item) => ({
        id: item.id || uid('ptype'),
        name: String(item.name || '').trim(),
        comments: item.comments || '',
        createdAt: item.createdAt || new Date().toLocaleDateString('es-CL')
      })).filter((item) => item.name);

      state.ui.editingProductTypeId = null;
      state.ui.productTypeDraft = null;
      stampBaseUpdate('productTypes');
      render();
      window.alert(`Tipos de producto importados: ${state.database.productTypes.length}.`);
    } catch (error) {
      console.error(error);
      window.alert('No se pudo importar Tipos de producto. Revisa el JSON.');
    }
  }

  async function importExternalResourcesFromFile(file) {
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const source = Array.isArray(parsed)
        ? parsed
        : (Array.isArray(parsed.externalResources) ? parsed.externalResources : (Array.isArray(parsed.database?.externalResources) ? parsed.database.externalResources : []));

      if (!Array.isArray(source)) {
        window.alert('El archivo no tiene un formato válido para Proveedores.');
        return;
      }

      state.database.externalResources = source.map((item) => ({
        id: item.id || uid('ext'),
        type: normalizeProviderType(item.type),
        name: String(item.name || '').trim(),
        description: item.description || '',
        phone: String(item.phone || '').trim(),
        instagram: String(item.instagram || '').trim(),
        facebook: String(item.facebook || '').trim(),
        email: String(item.email || '').trim(),
        website: String(item.website || '').trim(),
        status: item.status === 'Inactivo' ? 'Inactivo' : 'Activo',
        createdAt: item.createdAt || new Date().toLocaleDateString('es-CL')
      })).filter((item) => item.name);

      state.ui.editingExternalResourceId = null;
      state.ui.externalResourceDraft = null;
      stampBaseUpdate('external');
      render();
      window.alert(`Proveedores importados: ${state.database.externalResources.length} registros.`);
    } catch (error) {
      console.error(error);
      window.alert('No se pudo importar Proveedores. Revisa el JSON.');
    }
  }

  function getFileExtension(file) {
    const name = String(file?.name || '').trim().toLowerCase();
    if (!name) return '';
    const dotIndex = name.lastIndexOf('.');
    return dotIndex >= 0 ? name.slice(dotIndex + 1) : '';
  }

  function isPdfFile(file) {
    const type = String(file?.type || '').trim().toLowerCase();
    const ext = getFileExtension(file);
    return type === 'application/pdf' || type === 'application/octet-stream' && ext === 'pdf' || ext === 'pdf';
  }

  function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      if (!file) {
        reject(new Error('No se recibió un archivo válido.'));
        return;
      }

      const reader = new FileReader();
      const finish = (result) => resolve(String(result || ''));

      reader.onload = () => finish(String(reader.result || ''));
      reader.onerror = () => {
        if (typeof file.arrayBuffer === 'function') {
          file.arrayBuffer().then((buffer) => {
            const bytes = new Uint8Array(buffer);
            let binary = '';
            bytes.forEach((byte) => {
              binary += String.fromCharCode(byte);
            });
            const mimeType = String(file.type || '').trim() || 'application/octet-stream';
            const base64 = typeof window.btoa === 'function' ? window.btoa(binary) : '';
            finish(`data:${mimeType};base64,${base64}`);
          }).catch(reject);
          return;
        }
        reject(new Error('No se pudo leer el archivo.'));
      };
      reader.readAsDataURL(file);
    });
  }

  async function handleMaterialImageFile(file) {
    if (!file) return;

    const allowedTypes = ['image/webp', 'image/jpeg', 'image/png'];
    const maxSizeBytes = 150 * 1024;

    if (!allowedTypes.includes(file.type)) {
      window.alert('Formato no permitido. Usa idealmente WebP, o también JPG/PNG liviano.');
      render();
      return;
    }

    if (file.size > maxSizeBytes) {
      window.alert('La imagen supera el límite de 150 KB. Reduce su tamaño antes de subirla.');
      render();
      return;
    }

    try {
      const imageDataUrl = await readFileAsDataUrl(file);
      state.ui.databaseDraft = {
        ...(state.ui.databaseDraft || {}),
        imageDataUrl,
        imageName: file.name,
        imageMimeType: file.type,
        imageSizeKb: Math.round(file.size / 1024)
      };
      render();
    } catch (error) {
      console.error(error);
      window.alert('No se pudo cargar la imagen seleccionada.');
    }
  }

  async function handleDesiredImageFile(file) {
    if (!file) return;

    const allowedTypes = ['image/webp', 'image/jpeg', 'image/png'];
    const maxSizeBytes = 200 * 1024;

    if (!allowedTypes.includes(file.type)) {
      window.alert('Formato no permitido para equipamiento. Usa WebP/JPG/PNG.');
      render();
      return;
    }

    if (file.size > maxSizeBytes) {
      window.alert('La imagen de equipamiento supera el límite de 200 KB.');
      render();
      return;
    }

    try {
      const imageDataUrl = await readFileAsDataUrl(file);
      state.ui.desiredDraft = {
        ...(state.ui.desiredDraft || defaultDesiredDraft()),
        imageDataUrl,
        imageName: file.name,
        imageMimeType: file.type,
        imageSizeKb: Math.round(file.size / 1024)
      };
      render();
    } catch (error) {
      console.error(error);
      window.alert('No se pudo cargar la imagen del equipamiento.');
    }
  }

  async function importDatabaseFromFile(file) {
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const source = Array.isArray(parsed) ? parsed : (parsed.materials || parsed.database?.materials || []);

      if (!Array.isArray(source)) {
        window.alert('El archivo no tiene un formato válido para la base de datos interna.');
        return;
      }

      state.database.materials = source.map(normalizeMaterialRecord).filter((item) => item.name);

      state.ui.databaseFilter = 'Todos';
      state.ui.databaseDraft = null;
      state.ui.editingMaterialId = null;
      stampBaseUpdate('database');
      window.ERMStorage.save(state);
      window.alert(`Base interna importada: ${state.database.materials.length} insumos.`);
      render();
    } catch (error) {
      console.error(error);
      window.alert('No se pudo importar el archivo. Revisa que sea un JSON válido exportado desde la app.');
    }
  }

  function render() {
    window.ERMStorage.save(state);
    const calc = window.ERMCalc.calculateQuote(state);
    renderTabs();
    renderMain(calc);
    renderSummary(calc);
    renderInlinePdfViewerModal();
    syncAttendanceChronometer();
    renderActivityLog();
  }

  function captureOpenFinanceDetailsState() {
    if (!refs.mainPanel) return [];
    return Array.from(refs.mainPanel.querySelectorAll('.finance-section-details'))
      .filter((details) => details.open)
      .map((details, index) => {
        const summary = details.querySelector('summary');
        const label = String(summary?.textContent || '').trim().toLowerCase();
        return { index, label };
      });
  }

  function restoreOpenFinanceDetailsState(snapshot) {
    if (!refs.mainPanel || !Array.isArray(snapshot) || !snapshot.length) return;
    const detailsNodes = Array.from(refs.mainPanel.querySelectorAll('.finance-section-details'));
    if (!detailsNodes.length) return;

    const openByLabel = new Set(snapshot.map((item) => item.label).filter(Boolean));
    const openByIndex = new Set(snapshot.map((item) => item.index).filter((i) => Number.isInteger(i) && i >= 0));

    detailsNodes.forEach((details, index) => {
      const summary = details.querySelector('summary');
      const label = String(summary?.textContent || '').trim().toLowerCase();
      if (openByLabel.has(label) || openByIndex.has(index)) {
        details.open = true;
      }
    });
  }

  function renderTabs() {
    document.querySelectorAll('[data-view]').forEach((tab) => {
      tab.classList.toggle('active', tab.dataset.view === state.currentView);
    });
  }

  function renderMain(calc) {
    const detailsSnapshot = (state.currentView === 'attendance' || state.currentView === 'finance')
      ? captureOpenFinanceDetailsState()
      : [];

    // Preserve focused element so re-renders don't steal focus mid-typing
    const preFocus = document.activeElement;
    const preFocusId = preFocus?.id || '';
    const preFocusSelStart = preFocus?.selectionStart ?? null;
    const preFocusSelEnd   = preFocus?.selectionEnd   ?? null;
    const preFocusValue    = preFocus?.value           ?? null;

    if (state.currentView === 'mobile-home') refs.mainPanel.innerHTML = renderMobileHome();
    if (state.currentView === 'scenario') refs.mainPanel.innerHTML = renderScenario(calc);
    if (state.currentView === 'quote') refs.mainPanel.innerHTML = renderQuote(calc);
    if (state.currentView === 'database') refs.mainPanel.innerHTML = renderDatabase();
    if (state.currentView === 'contacts') refs.mainPanel.innerHTML = renderContacts();
    if (state.currentView === 'orders') refs.mainPanel.innerHTML = renderOrdersPanel();
    if (state.currentView === 'inventory') refs.mainPanel.innerHTML = renderInventory();
    if (state.currentView === 'expenses') refs.mainPanel.innerHTML = renderExpensesModule();
    if (state.currentView === 'attendance') {
      refs.mainPanel.innerHTML = renderAttendanceModule();
      syncAttendanceCommentsInput();
      if (state.ui.attendanceEditingId) {
        syncAttendanceEditCommentsInput();
      }
      restoreOpenFinanceDetailsState(detailsSnapshot);
      setupFinanceChartAnimations();
      setupFinanceChartTooltips();
    }
    if (state.currentView === 'finance') {
      refs.mainPanel.innerHTML = renderFinanceModule();
      restoreOpenFinanceDetailsState(detailsSnapshot);
      setupFinanceChartAnimations();
      setupFinanceChartTooltips();
    }
    if (state.currentView === 'backup') refs.mainPanel.innerHTML = renderBackupCenter();
    if (state.currentView === 'summary') refs.mainPanel.innerHTML = renderInternalSummary(calc);
    if (state.currentView === 'docs') refs.mainPanel.innerHTML = renderDocs(calc);

    // Restore focus if an input/textarea inside the panel had focus before re-render
    if (preFocusId && refs.mainPanel?.contains(preFocus) === false) {
      const restored = preFocusId ? document.getElementById(preFocusId) : null;
      if (restored && (restored.tagName === 'INPUT' || restored.tagName === 'TEXTAREA' || restored.tagName === 'SELECT')) {
        restored.focus();
        // Restore cursor position for text inputs (value must still match to avoid overwriting new state)
        if (preFocusSelStart !== null && restored.value === preFocusValue && typeof restored.setSelectionRange === 'function') {
          try { restored.setSelectionRange(preFocusSelStart, preFocusSelEnd); } catch (_) {}
        }
      }
    }
  }

  function renderSummary(calc) {
    if (state.currentView !== 'quote') {
      refs.layout?.classList.add('single-column');
      refs.summaryPanel.innerHTML = '';
      return;
    }

    refs.layout?.classList.remove('single-column');

    const summary = calc.quoteSummary;
    const selectedMeta = getPriceModeMeta(summary.selectedPriceMode);
    const selectedState = summary.selectedStatus || { text: 'Dentro de las metas definidas', tone: 'info', description: '' };
    const marginAchievement = getMarginAchievement(summary);
    const ivaAmount = Math.max(0, (Number(summary.effectiveGross) || 0) - (Number(summary.effectiveNet) || 0));
    const ivaLabelPercent = Math.round((Number(state.scenario?.ivaRate) || 0.19) * 100);

    refs.summaryPanel.innerHTML = `
      <div class="card summary-main-card ${selectedMeta.className} ${marginAchievement.tone === 'gold' ? 'summary-sheen' : ''}">
        <div class="section-title">
          <h3>Resumen en vivo</h3>
          <span class="pill ${selectedState.tone}">${selectedState.text}</span>
        </div>

        <div class="summary-row"><span>Materia prima</span><strong>${formatCurrency(summary.materialsTotal)}</strong></div>
        <div class="summary-row"><span>Mano de obra</span><strong>${formatCurrency(summary.laborTotal)}</strong></div>
        <div class="summary-row"><span>CIF aplicados</span><strong>${formatCurrency(summary.cifTotal)}</strong></div>
        <div class="summary-row"><span>Costo de una unidad</span><strong>${formatCurrency(summary.unitCost)}</strong></div>
        ${(summary.pieceQuantity || 1) > 1 ? `
        <div class="summary-row"><span>Unidades</span><strong>× ${summary.pieceQuantity}</strong></div>
        <div class="summary-row"><span>Subtotal producción</span><strong>${formatCurrency(summary.productionCost)}</strong></div>` : ''}
        <div class="summary-row"><span>Logística</span><strong>${formatCurrency(summary.logisticsTotal)}</strong></div>
        <div class="summary-row summary-row-total"><span>Costo total real</span><strong>${formatCurrency(summary.totalCost)}</strong></div>

        <div class="hr"></div>

        <div class="summary-row"><span>Precio equilibrio</span><strong>${formatCurrency(summary.breakEvenNet)}</strong></div>
        <div class="summary-row"><span>Precio mínimo</span><strong>${formatCurrency(summary.minimumNet)}</strong></div>
        <div class="summary-row"><span>Precio utilidad</span><strong>${formatCurrency(summary.targetUtilityNet)}</strong></div>
        <div class="summary-row"><span>Precio ideal</span><strong>${formatCurrency(summary.idealNet)}</strong></div>

        <div class="hr"></div>

        <div class="summary-row summary-row-selected ${selectedMeta.className}"><span>Precio seleccionado</span><strong>${formatCurrency(summary.effectiveNet)}</strong></div>
        <div class="summary-row"><span><strong>Con IVA</strong></span><strong>${formatCurrency(summary.effectiveGross)}</strong></div>
        <div class="summary-row"><span>IVA ${ivaLabelPercent}%</span><strong>${formatCurrency(ivaAmount)}</strong></div>
        <div class="summary-row"><span>Margen real <span class="margin-star ${marginAchievement.tone}" title="${sanitize(marginAchievement.label)}">${marginAchievement.iconMarkup}</span></span><strong>${formatPercent(summary.realMargin)}</strong></div>
        <div class="summary-row"><span>Utilidad en CLP</span><strong>${formatCurrency(summary.contribution)}</strong></div>
        <p class="help"><span class="summary-selected-tag ${selectedMeta.className}">${selectedMeta.label}</span></p>
        <p class="help">${sanitize(summary.selectedStatus?.description || 'Se mantiene dentro del rango proyectado por el escenario.')}</p>
        <p class="help summary-average-note">Respecto al promedio por orden: ${sanitize(summary.averageSaleSignal?.text || '')}${summary.averageSaleSignal?.value ? ` (OT promedio: ${formatCurrency(summary.averageSaleSignal.value)})` : ''}.</p>
      </div>
    `;
  }

  function renderScenario(calc) {
    const { scenario } = state;
    const projection = calc.scenarioSummary.projection;
    const locked = Boolean(state.ui.scenarioLocked);
    const lockAttr = locked ? 'disabled' : '';
    const lockButtonText = locked ? '■ Desbloquear edición' : '□ Bloquear edición';
    const lockStatus = locked ? 'Escenario bloqueado' : 'Escenario editable';
    const metaReason = projection.recommendedSalesGoal === projection.minimumSalesRequired
      ? 'En este escenario coincide con la venta mínima requerida, porque el margen mínimo ya exige más utilidad que tu meta mensual en CLP.'
      : 'En este escenario supera la venta mínima requerida, porque tu meta mensual en CLP es más exigente que el margen mínimo.';
    const totalHoursPerMonth = scenario.employees.reduce((acc, employee) => acc + Number(employee.hoursPerMonth || 0), 0);
    const totalMonthlySalaries = scenario.employees.reduce((acc, employee) => acc + (Number(employee.hourlyRate || 0) * Number(employee.hoursPerMonth || 0)), 0);
    const totalPeriodSalaries = totalMonthlySalaries * scenario.periodMonths;
    const goals = (scenario.personalGoals || []).map((item) => ({
      id: item.id || uid('goal'),
      title: String(item.title || '').trim().slice(0, 80),
      description: String(item.description || '').trim().slice(0, 220),
      status: ['logrado', 'logrado-en-transcurso', 'no-logrado', 'en-periodo'].includes(item.status) ? item.status : 'en-periodo',
      createdAt: item.createdAt || new Date().toISOString(),
      autoCloseAt: item.autoCloseAt || addMonthsToIso(new Date().toISOString(), Math.max(1, Number(scenario.periodMonths) || 1)),
      achievedDuringAt: item.achievedDuringAt || null
    }));
    const goalsSummary = {
      total: goals.length,
      inPeriod: goals.filter((item) => item.status === 'en-periodo').length,
      achieved: goals.filter((item) => item.status === 'logrado').length,
      achievedDuring: goals.filter((item) => item.status === 'logrado-en-transcurso').length,
      notAchieved: goals.filter((item) => item.status === 'no-logrado').length
    };
    const editingGoalId = state.ui.scenarioGoalEditingId || null;
    const editingGoal = editingGoalId ? goals.find((item) => item.id === editingGoalId) : null;
    const goalTitleValue = sanitize(editingGoal?.title || '');
    const goalDescriptionValue = sanitize(editingGoal?.description || '');

    const fixedRows = scenario.fixedCosts.map((item) => {
      const factor = window.ERMCalc.periodicityFactor(item.periodicity, scenario.periodMonths);
      const total = item.amount * factor;
      return `
        <tr>
          <td><input data-collection="scenario.fixedCosts" data-id="${item.id}" data-key="name" value="${sanitize(item.name)}" /></td>
          <td>
            <select data-collection="scenario.fixedCosts" data-id="${item.id}" data-key="periodicity">
              ${renderPeriodicityOptions(item.periodicity)}
            </select>
          </td>
          <td><input type="text" data-format="clp" data-collection="scenario.fixedCosts" data-id="${item.id}" data-key="amount" value="${formatNumber(item.amount || 0)}" /></td>
          <td>${factor.toFixed(2)}</td>
          <td>${formatCurrency(total)}</td>
          <td><button class="btn btn-soft btn-icon" title="Eliminar costo" aria-label="Eliminar costo" data-action="remove-fixed-cost" data-id="${item.id}">${iconSvg('trash')}</button></td>
        </tr>
      `;
    }).join('');

    const employeeRows = scenario.employees.map((employee) => {
      const monthlySalary = employee.hourlyRate * employee.hoursPerMonth;
      const periodSalary = monthlySalary * scenario.periodMonths;
      return `
        <tr>
          <td><input data-collection="scenario.employees" data-id="${employee.id}" data-key="name" value="${sanitize(employee.name)}" /></td>
          <td><input type="text" data-format="clp" data-collection="scenario.employees" data-id="${employee.id}" data-key="hourlyRate" value="${formatNumber(employee.hourlyRate || 0)}" /></td>
          <td><input type="number" min="0" step="0.5" data-collection="scenario.employees" data-id="${employee.id}" data-key="hoursPerMonth" value="${employee.hoursPerMonth}" /></td>
          <td>${formatCurrency(monthlySalary)}</td>
          <td>${formatCurrency(periodSalary)}</td>
          <td><button class="btn btn-soft btn-icon" title="Eliminar empleado" aria-label="Eliminar empleado" data-action="remove-employee" data-id="${employee.id}">${iconSvg('trash')}</button></td>
        </tr>
      `;
    }).join('');

    return `
      <fieldset class="scenario-edit-area" ${lockAttr}>
      <div class="card">
        <div class="section-title">
          <div>
            <h2>Escenario base</h2>
            <p class="subtitle">Aquí defines el contexto económico del período para calcular tasas confiables por hora.</p>
          </div>
        </div>

        <div class="grid-2">
          <div>
            <label>Período proyectado en meses</label>
            <input type="number" min="1" step="1" data-model="scenario.periodMonths" value="${scenario.periodMonths}" />
          </div>
          <div>
            <label class="label-with-tip">
              <span>Eficiencia productiva real</span>
              ${renderInfoTip('Es el porcentaje de tus horas disponibles que realmente se transforman en trabajo útil. Si tienes 160 horas y una eficiencia de 70%, se consideran 112 horas productivas para repartir sueldos y CIF.')}
            </label>
            <input type="number" min="1" max="100" step="1" data-model="scenario.efficiency" data-percent="true" value="${formatPercentInput(scenario.efficiency)}" />
          </div>
          <div>
            <label>Margen mínimo objetivo</label>
            <input type="number" min="1" max="95" step="1" data-model="scenario.minimumMargin" data-percent="true" value="${formatPercentInput(scenario.minimumMargin)}" />
          </div>
          <div>
            <label>Margen ideal objetivo</label>
            <input type="number" min="1" max="95" step="1" data-model="scenario.idealMargin" data-percent="true" value="${formatPercentInput(scenario.idealMargin)}" />
          </div>
          <div>
            <label>IVA</label>
            <input type="number" min="0" max="100" step="1" data-model="scenario.ivaRate" data-percent="true" value="${formatPercentInput(scenario.ivaRate)}" />
          </div>
        </div>

        <p class="help">Las tasas se calculan sobre horas productivas reales, no sobre horas teóricas. Así evitas cotizar por debajo del costo real de tu empresa. Para una operación de una sola persona, partir entre 70% y 80% suele ser una base prudente.</p>
      </div>

      <div class="card">
        <div class="section-title">
          <div>
            <h3>CIF del período</h3>
            <p class="subtitle">CIF significa Costos Fijos e Indirectos: arriendo, cuentas, software y otros gastos que sostienen la operación. Se suman al período proyectado y luego se reparten sobre las horas productivas para obtener la tasa CIF/h.</p>
          </div>
          <div class="inline-actions action-pair">
            <button class="btn btn-primary btn-add-line-icon" data-action="add-fixed-cost" title="Agregar costo" aria-label="Agregar costo">${iconSvg('plus')}</button>
            <button class="btn btn-soft btn-add-line-icon" data-action="clear-fixed-costs" title="Limpiar tabla" aria-label="Limpiar tabla">${iconSvg('broom')}</button>
          </div>
        </div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Concepto</th>
                <th>Periodicidad</th>
                <th>Monto</th>
                <th class="label-with-tip"><span>Factor</span>${renderInfoTip('Multiplicador que adapta cada costo al período proyectado. Ejemplo: en 1 mes, un costo mensual vale 1 y un costo anual vale 0.08 aproximadamente.')}</th>
                <th>Total en período</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              ${fixedRows}
              <tr class="table-total">
                <td colspan="4"><strong>Total CIF del período</strong></td>
                <td><strong>${formatCurrency(calc.scenarioSummary.fixedCostsTotal)}</strong></td>
                <td></td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div class="card">
        <div class="section-title">
          <div>
            <h3>Equipo y sueldos</h3>
            <p class="subtitle">Aquí defines quién produce y cuánto cuesta su tiempo. El sueldo mensual se calcula como valor hora × horas al mes, y luego se proyecta al período completo.</p>
          </div>
          <div class="inline-actions action-pair">
            <button class="btn btn-primary btn-add-line-icon" data-action="add-employee" title="Agregar empleado" aria-label="Agregar empleado">${iconSvg('plus')}</button>
            <button class="btn btn-soft btn-add-line-icon" data-action="clear-employees" title="Limpiar tabla" aria-label="Limpiar tabla">${iconSvg('broom')}</button>
          </div>
        </div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Nombre</th>
                <th>Valor hora</th>
                <th>Horas al mes</th>
                <th>Sueldo mensual</th>
                <th>Sueldo del período</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              ${employeeRows}
              <tr class="table-total">
                <td><strong>Totales</strong></td>
                <td></td>
                <td><strong>${totalHoursPerMonth.toFixed(1)} h</strong></td>
                <td><strong>${formatCurrency(totalMonthlySalaries)}</strong></td>
                <td><strong>${formatCurrency(totalPeriodSalaries)}</strong></td>
                <td></td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div class="card">
        <div class="section-title">
          <div>
            <h3>Proyección mensual y caja</h3>
            <p class="subtitle">Estos valores se recalculan automáticamente desde el escenario y te ayudan a entender cuánto necesitas vender y cuánto capital debes mover.</p>
          </div>
        </div>

        <div class="kpi-grid kpi-grid-4">
          <div>
            <label class="label-with-tip">
              <span>Compras directas planificadas</span>
              ${renderInfoTip('Estimación del dinero que deberás adelantar para materiales, servicios externos y accesorios del período. El valor de $300.000 es solo un ejemplo editable.')}
            </label>
            <input type="text" min="0" step="1000" data-model="scenario.projection.plannedDirectCosts" data-format="clp" value="${formatNumber(scenario.projection?.plannedDirectCosts || 0)}" />
          </div>
          <div>
            <label class="label-with-tip">
              <span>Abono promedio del cliente</span>
              ${renderInfoTip('Si normalmente cobras 50% al iniciar, escribe 50. Ese abono ayuda a financiar materiales y reduce la caja que debes poner tú.')}
            </label>
            <div class="field-with-suffix">
              <input type="number" min="0" max="100" step="1" data-model="scenario.projection.averageAdvanceRate" data-percent="true" value="${formatPercentInput(scenario.projection?.averageAdvanceRate || 0)}" />
              <span class="input-suffix">%</span>
            </div>
          </div>
          <div>
            <label class="label-with-tip">
              <span>Horas promedio por orden</span>
              ${renderInfoTip('Sirve para convertir tu capacidad mensual en un número aproximado de órdenes equivalentes. No es exacto, pero ayuda a planificar.')}
            </label>
            <input type="number" min="0.25" step="0.25" data-model="scenario.projection.avgHoursPerOrder" value="${scenario.projection?.avgHoursPerOrder || 6}" />
          </div>
          <div>
            <label class="label-with-tip">
              <span>Utilidad objetivo mensual</span>
              ${renderInfoTip('Monto mensual que quieres que quede en la empresa después de pagar costos operativos y compras directas planificadas. Si el período proyectado dura más de un mes, la app multiplica este valor por los meses del período para calcular cuánto debes vender.')}
            </label>
            <input type="text" min="0" step="10000" data-model="scenario.projection.targetMonthlyProfit" data-format="clp" value="${formatNumber(scenario.projection?.targetMonthlyProfit || 0)}" />
            ${(Number(scenario.periodMonths) || 1) > 1 ? `<div class="small">Utilidad objetivo del período (${Number(scenario.periodMonths)} meses): ${formatCurrency(projection.targetPeriodProfit)}</div>` : ''}
          </div>
        </div>

        <div class="projection-columns">
          <div class="projection-column projection-column-equilibrium">
            <div class="projection-column-title">Equilibrio</div>
            <div class="kpi-box"><span>Punto de equilibrio neto</span><strong>${formatCurrency(projection.breakEvenSales)}</strong></div>
            <div class="kpi-box"><span>Venta equilibrio por orden</span><strong>${formatCurrency(projection.breakEvenAverageSalePerOrder)}</strong></div>
            <div class="kpi-box">
              <span class="label-with-tip"><span>Capital de trabajo sugerido</span>${renderInfoTip('Estimación simplificada de la caja que debes poner tú al inicio del período. Se calcula como costo total planificado menos el abono promedio que esperas recibir al comenzar los trabajos.')}</span>
              <strong>${formatCurrency(projection.capitalNeededAtMinimum)}</strong>
            </div>
          </div>

          <div class="projection-column projection-column-minimum">
            <div class="projection-column-title">Meta mínima</div>
            <div class="kpi-box"><span>Venta mínima requerida</span><strong>${formatCurrency(projection.minimumSalesRequired)}</strong></div>
            <div class="kpi-box"><span>Venta mínima por orden</span><strong>${formatCurrency(projection.minimumAverageSalePerOrder)}</strong></div>
            <div class="kpi-box"><span>Utilidad implícita con margen mínimo</span><strong>${formatCurrency(projection.minimumProfit)}</strong></div>
          </div>

          <div class="projection-column projection-column-target">
            <div class="projection-column-title">Meta de utilidad</div>
            <div class="kpi-box"><span>Venta para utilidad objetivo</span><strong>${formatCurrency(projection.salesForTargetProfit)}</strong></div>
            <div class="kpi-box"><span>Venta por orden para utilidad objetivo</span><strong>${formatCurrency(projection.targetAverageSalePerOrder)}</strong></div>
            <div class="kpi-box"><span>Utilidad objetivo del período</span><strong>${formatCurrency(projection.targetPeriodProfit)}</strong></div>
          </div>

          <div class="projection-column projection-column-ideal">
            <div class="projection-column-title">Proyección ideal</div>
            <div class="kpi-box kpi-box-ideal"><span>Proyección ideal</span><strong>${formatCurrency(projection.idealSalesRequired)}</strong></div>
            <div class="kpi-box kpi-box-ideal"><span>Venta ideal por orden</span><strong>${formatCurrency(projection.idealAverageSalePerOrder)}</strong></div>
            <div class="kpi-box kpi-box-ideal"><span>Utilidad implícita ideal</span><strong>${formatCurrency(projection.idealProfit)}</strong></div>
          </div>
        </div>

        <div class="projection-callout projection-callout-minimum">
          <strong>Meta comercial sugerida: ${formatCurrency(projection.recommendedSalesGoal)}</strong>
          <div class="small">Se calcula como el mayor valor entre la venta mínima requerida y la venta para utilidad objetivo. ${metaReason}</div>
        </div>

        <div class="projection-callout projection-callout-ideal">
          <strong>Meta comercial ideal: ${formatCurrency(projection.idealSalesRequired)}</strong>
          <div class="small">Es la meta alineada con tu margen ideal de ${formatPercent(scenario.idealMargin)}. Se muestra destacada como referencia positiva de crecimiento.</div>
        </div>

        <p class="help">
          Fórmula simplificada de caja sugerida: costo total planificado <strong>${formatCurrency(projection.plannedTotalCost)}</strong> menos abono estimado al inicio <strong>${formatCurrency(projection.estimatedAdvanceAtMinimum)}</strong> igual a <strong>${formatCurrency(projection.capitalNeededAtMinimum)}</strong>.
        </p>

        <p class="help">
          Si mantienes un promedio de <strong>${scenario.projection?.avgHoursPerOrder || 6} horas por orden</strong>, tu capacidad del período es de aproximadamente <strong>${projection.equivalentOrdersCapacity.toFixed(1)} órdenes equivalentes</strong>. Al equilibrio, cada orden debería promediar cerca de <strong>${formatCurrency(projection.breakEvenAverageSalePerOrder)}</strong>. Para cumplir el margen mínimo, cerca de <strong>${formatCurrency(projection.minimumAverageSalePerOrder)}</strong>. Y para lograr tu utilidad objetivo del período, cerca de <strong>${formatCurrency(projection.targetAverageSalePerOrder)}</strong> netos.
        </p>
      </div>

      <div class="card scenario-indicators-card">
        <div class="section-title">
          <h3>Indicadores automáticos del escenario</h3>
        </div>
        <div class="kpi-grid">
          <div class="kpi-box"><span>CIF totales del período</span><strong>${formatCurrency(calc.scenarioSummary.fixedCostsTotal)}</strong></div>
          <div class="kpi-box"><span>Sueldos del período</span><strong>${formatCurrency(calc.scenarioSummary.payrollTotal)}</strong></div>
          <div class="kpi-box"><span>Horas productivas</span><strong>${calc.scenarioSummary.availableHours.toFixed(1)} h</strong></div>
          <div class="kpi-box"><span>Tasa CIF por hora</span><strong>${formatCurrency(calc.scenarioSummary.cifPerHour)}</strong></div>
          <div class="kpi-box"><span>Valor hora base</span><strong>${formatCurrency(calc.scenarioSummary.laborReferenceRate)}</strong></div>
          <div class="kpi-box"><span>Margen mínimo / ideal</span><strong>${formatPercent(scenario.minimumMargin)} / ${formatPercent(scenario.idealMargin)}</strong></div>
        </div>
      </div>

      <div class="card scenario-goals-card">
        <div class="section-title">
          <div>
            <h3>Objetivos personales del período</h3>
            <p class="subtitle">Define metas escritas y evalúa su resultado al cierre del período.</p>
          </div>
        </div>

        <div class="goal-entry-row">
          <div>
            <label>Título (máx. 80)</label>
            <input id="scenario-goal-title" maxlength="80" placeholder="Ejemplo: cerrar 12 OT este período" value="${goalTitleValue}" />
          </div>
          <div>
            <label>Descripción (máx. 220)</label>
            <input id="scenario-goal-description" maxlength="220" placeholder="Detalle breve del objetivo" value="${goalDescriptionValue}" />
          </div>
          <div class="goal-entry-action">
            <button class="btn btn-primary btn-add-line-icon" data-action="add-scenario-goal" title="${editingGoal ? 'Guardar edición del objetivo' : 'Agregar objetivo'}" aria-label="${editingGoal ? 'Guardar edición del objetivo' : 'Agregar objetivo'}">${editingGoal ? iconSvg('save') : iconSvg('plus')}</button>
            ${editingGoal ? `<button class="btn btn-soft btn-add-line-icon" data-action="cancel-edit-scenario-goal" title="Cancelar edición" aria-label="Cancelar edición">${iconSvg('close')}</button>` : ''}
          </div>
        </div>

        ${editingGoal ? `<p class="help">Editando objetivo: <strong>${sanitize(editingGoal.title || '')}</strong></p>` : ''}

        <p class="help goal-summary-mini">Resumen: ${goalsSummary.total} total · ${goalsSummary.achieved} logrado · ${goalsSummary.achievedDuring} logrado en transcurso · ${goalsSummary.notAchieved} no logrado · ${goalsSummary.inPeriod} en período</p>

        <div class="table-wrap table-compact">
          <table>
            <thead>
              <tr>
                <th>Título</th>
                <th>Descripción</th>
                <th>Estado</th>
                <th>Creación</th>
                <th>Cierre automático</th>
                <th>Fecha logrado en transcurso</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              ${goals.map((item) => `
                <tr>
                  <td class="goal-title-cell goal-status-${item.status}"><strong>${sanitize(item.title)}</strong></td>
                  <td class="goal-description-cell goal-status-${item.status}">${sanitize(item.description || '-')}</td>
                  <td>
                    <select class="goal-status-select" data-scenario-goal-status="${item.id}" title="Estado del objetivo">
                      ${renderGoalStatusOptions(item.status)}
                    </select>
                  </td>
                  <td>${sanitize(formatGoalDate(item.createdAt))}</td>
                  <td>${sanitize(formatGoalDate(item.autoCloseAt))}</td>
                  <td>${sanitize(item.achievedDuringAt ? formatGoalDate(item.achievedDuringAt) : '-')}</td>
                  <td>
                    <div class="button-group compact-actions goal-actions-inline">
                      <button class="btn btn-soft btn-icon" data-action="edit-scenario-goal" data-id="${item.id}" title="Editar objetivo" aria-label="Editar objetivo">${iconSvg('edit')}</button>
                      <button class="btn btn-soft btn-icon" data-action="delete-scenario-goal" data-id="${item.id}" title="Eliminar objetivo" aria-label="Eliminar objetivo">${iconSvg('trash')}</button>
                    </div>
                  </td>
                </tr>
              `).join('') || '<tr><td colspan="7" class="empty-state">Aún no has agregado objetivos personales para este período.</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>
      </fieldset>

      <div class="card">
        <div class="section-title">
          <div>
            <h3>Confirmación del escenario</h3>
            <p class="subtitle">Confirma esta base para que el presupuestador use estas tasas y proyecciones.</p>
          </div>
        </div>
        <div class="inline-actions">
          <button class="btn btn-primary" data-action="save-scenario">Actualizar Escenario en el Sistema</button>
          <button class="btn btn-soft" data-action="toggle-scenario-lock">${lockButtonText}</button>
        </div>
        <p class="help">${state.ui.lastScenarioSavedAt ? `Último guardado manual: <strong>${sanitize(state.ui.lastScenarioSavedAt)}</strong>.` : 'Todavía no has confirmado manualmente este escenario.'} Una vez guardado, esta configuración será la base activa del presupuestador.</p>
      </div>
    `;
  }

  function getOrderStatusMeta(status) {
    switch (status) {
      case 'Prototipo':
        return { className: 'status-prototype', dot: 'status-dot-black', label: 'Prototipo' };
      case 'Aceptado':
        return { className: 'status-accepted', dot: 'status-dot-purple', label: 'Presupuesto Aceptado' };
      case 'Abonado (no entregado)':
      case 'Pagado (no entregado)': // valor legado
        return { className: 'status-abonado', dot: 'status-dot-blue', label: 'Abonado (no entregado)' };
      case 'Entregado (pagado)':
        return { className: 'status-delivered-paid', dot: 'status-dot-green', label: 'Entregado (pagado)' };
      case 'Entregado (no pagado)':
        return { className: 'status-delivered-unpaid', dot: 'status-dot-orange', label: 'Entregado (no pagado)' };
      case 'Entregado': // valor legado
        return { className: 'status-delivered', dot: 'status-dot-gray', label: 'Entregado' };
      case 'Prospecto':
      default:
        return { className: 'status-prospect', dot: 'status-dot-yellow', label: 'Prospecto' };
    }
  }

  function renderOrderStatusPill(status) {
    const meta = getOrderStatusMeta(status);
    return `<span class="order-status-pill ${meta.className}"><span class="order-status-dot ${meta.dot}"></span>${sanitize(meta.label || status || 'Prospecto')}</span>`;
  }

  function isDeliveryCompleted(deliveryState) {
    const normalized = String(deliveryState || '').trim().toLowerCase();
    return normalized === 'entregada' || normalized === 'entregado';
  }

  function getDeliveryMeta(deliveryState) {
    if (isDeliveryCompleted(deliveryState)) {
      return { className: 'delivery-done', label: 'Entregada', icon: iconSvg('trophy') };
    }
    return { className: 'delivery-open', label: 'En fabricación', icon: '⚒' };
  }

  function renderDeliveryPill(deliveryState) {
    const meta = getDeliveryMeta(deliveryState || 'En fabricación');
    return `<span class="delivery-pill ${meta.className}">${meta.icon} ${meta.label}</span>`;
  }

  function renderDeliveryToggle(deliveryState, orderId = '') {
    const meta = getDeliveryMeta(deliveryState || 'En fabricación');
    return `<button type="button" class="delivery-toggle ${meta.className}" data-action="toggle-delivery-state" ${orderId ? `data-order-id="${orderId}"` : ''}>${meta.icon} ${meta.label}</button>`;
  }

  function renderOrderInvoiceActions(order) {
    const invoiceAttachment = getPrimaryAttachment(order, legacyOrderInvoiceAttachment);
    const hasPdf = Boolean(invoiceAttachment);
    const orderId = order?.id || '';
    const inputId = `order-invoice-input-${orderId}`;
    const fileLabel = invoiceAttachment
      ? `${sanitize(invoiceAttachment.fileName)} (${Number(invoiceAttachment.sizeKb || 0)} KB)`
      : 'Sin PDF';

    return `
      <div class="ot-invoice-block">
        <div class="small ot-invoice-title">Boleta/Factura PDF</div>
        <div class="ot-invoice-actions">
          <button class="btn btn-soft btn-icon" data-action="pick-order-invoice-pdf" data-order-id="${orderId}" title="Subir boleta/factura PDF" aria-label="Subir boleta/factura PDF">${iconSvg('upload')}</button>
          <input id="${inputId}" class="expense-file-hidden-input" type="file" accept="application/pdf,.pdf" data-order-invoice-pdf="true" data-order-id="${orderId}" />
          ${hasPdf
    ? `<button class="btn btn-soft btn-icon" data-action="view-order-invoice-pdf" data-order-id="${orderId}" title="Ver PDF" aria-label="Ver PDF">${iconSvg('eye')}</button>`
    : `<span class="expense-file-icon is-disabled" title="Sin PDF" aria-disabled="true">${iconSvg('eyeClosed')}</span>`}
          ${hasPdf
    ? `<button class="btn btn-soft btn-icon" data-action="download-order-invoice-pdf" data-order-id="${orderId}" title="Descargar PDF" aria-label="Descargar PDF">${iconSvg('download')}</button>`
    : `<span class="expense-file-icon download is-disabled" title="Sin PDF" aria-disabled="true">${iconSvg('download')}</span>`}
          ${hasPdf
    ? `<button class="btn btn-soft btn-icon" data-action="clear-order-invoice-pdf" data-order-id="${orderId}" title="Quitar PDF" aria-label="Quitar PDF">${iconSvg('close')}</button>`
    : `<span class="expense-file-icon clear is-disabled" title="Sin PDF" aria-disabled="true">${iconSvg('close')}</span>`}
        </div>
        <div class="small expense-file-name ot-invoice-file-name">${fileLabel}</div>
      </div>
    `;
  }

  function getPriceModeMeta(mode) {
    switch (mode) {
      case 'breakEven':
        return { label: 'Precio equilibrio', short: 'Equilibrio', className: 'price-tone-break-even' };
      case 'minimum':
        return { label: `Precio ${formatPercent(state.scenario.minimumMargin)} mínimo`, short: 'Mínimo', className: 'price-tone-minimum' };
      case 'ideal':
        return { label: `Precio ${formatPercent(state.scenario.idealMargin)} ideal`, short: 'Ideal', className: 'price-tone-ideal' };
      case 'custom':
        return { label: 'Precio definido', short: 'Definido', className: 'price-tone-custom' };
      case 'target':
      default:
        return { label: 'Precio utilidad objetivo', short: 'Utilidad', className: 'price-tone-target' };
    }
  }

  function getSelectedPriceState(price, summary) {
    if ((Number(price) || 0) < (Number(summary.minimumNet) || 0)) {
      return { text: 'Bajo las metas definidas', tone: 'warn' };
    }
    if ((Number(price) || 0) > (Number(summary.idealNet) || 0)) {
      return { text: 'Sobre las metas definidas', tone: 'ok' };
    }
    return { text: 'Dentro de las metas definidas', tone: 'info' };
  }

  function renderAchievementIcon(tone, count = 0) {
    if (tone === 'warn') {
      return '<span class="achievement-warn-icon" aria-hidden="true">!</span>';
    }

    const safeCount = Math.max(1, Math.min(3, Number(count) || 1));
    const stars = Array.from({ length: safeCount }, (_, index) => (
      `<span class="achievement-star achievement-star-${tone}" style="--i:${index}" aria-hidden="true"><svg class="achv-star" viewBox="0 0 24 24" role="img" aria-hidden="true"><path class="achv-star-shape" d="M12 2.75l2.86 5.79 6.39.93-4.62 4.5 1.09 6.36L12 17.31l-5.72 3.02 1.09-6.36-4.62-4.5 6.39-.93L12 2.75z"/></svg></span>`
    )).join('');

    return `<span class="achievement-stars-row" aria-hidden="true">${stars}</span>`;
  }

  function getMarginAchievement(summary) {
    const price = Number(summary.effectiveNet) || 0;

    if (price <= (Number(summary.breakEvenNet) || 0)) {
      return { iconMarkup: renderAchievementIcon('warn', 0), tone: 'warn', label: 'Precio igual o menor al equilibrio' };
    }
    if (price < (Number(summary.minimumNet) || 0)) {
      return { iconMarkup: renderAchievementIcon('bronze', 1), tone: 'bronze', label: 'Sobre equilibrio, pero bajo el mínimo' };
    }
    if (price <= (Number(summary.idealNet) || 0)) {
      return { iconMarkup: renderAchievementIcon('silver', 2), tone: 'silver', label: 'Dentro del rango mínimo a ideal' };
    }
    return { iconMarkup: renderAchievementIcon('gold', 3), tone: 'gold', label: 'Sobre el porcentaje ideal' };
  }

  function describeAverageOrderValue(price, projection) {
    const current = Number(price) || 0;
    if (current >= (Number(projection.idealAverageSalePerOrder) || 0) && (Number(projection.idealAverageSalePerOrder) || 0) > 0) {
      return 'Cumple el valor promedio ideal por orden';
    }
    if (current >= (Number(projection.targetAverageSalePerOrder) || 0) && (Number(projection.targetAverageSalePerOrder) || 0) > 0) {
      return 'Cumple el valor promedio de utilidad objetivo por orden';
    }
    if (current >= (Number(projection.minimumAverageSalePerOrder) || 0) && (Number(projection.minimumAverageSalePerOrder) || 0) > 0) {
      return 'Cumple el valor promedio mínimo por orden';
    }
    if (current >= (Number(projection.breakEvenAverageSalePerOrder) || 0) && (Number(projection.breakEvenAverageSalePerOrder) || 0) > 0) {
      return 'Cubre el valor promedio de equilibrio por orden';
    }
    return 'Queda bajo el valor promedio proyectado por orden';
  }

  function buildPriceSelectionData(calc) {
    const summary = calc.quoteSummary;
    const projection = calc.scenarioSummary.projection || {};
    const options = [
      {
        key: 'breakEven',
        label: 'Precio equilibrio',
        description: 'Cubre el costo total real.',
        price: summary.breakEvenNet || summary.totalCost
      },
      {
        key: 'minimum',
        label: `Precio ${formatPercent(state.scenario.minimumMargin)} mínimo`,
        description: 'Aplica el margen mínimo.',
        price: summary.minimumNet
      },
      {
        key: 'target',
        label: 'Precio utilidad objetivo',
        description: 'Apunta a la meta de utilidad.',
        price: summary.targetUtilityNet || summary.minimumNet
      },
      {
        key: 'ideal',
        label: `Precio ${formatPercent(state.scenario.idealMargin)} ideal`,
        description: 'Apunta al rango ideal.',
        price: summary.idealNet
      }
    ].map((option) => {
      const profit = (Number(option.price) || 0) - (Number(summary.totalCost) || 0);
      const margin = option.price > 0 ? profit / option.price : 0;
      return {
        ...option,
        profit,
        margin,
        averageText: describeAverageOrderValue(option.price, projection),
        className: getPriceModeMeta(option.key).className,
        selected: summary.selectedPriceMode === option.key
      };
    });

    const customNet = Number(summary.customNet) || 0;
    const customGross = Number(summary.customGross) || 0;
    const customIva = Number(summary.customIvaAmount) || 0;
    const customProfit = customNet - (Number(summary.totalCost) || 0);
    const customMargin = customNet > 0 ? customProfit / customNet : 0;

    return {
      options,
      custom: {
        inputValue: Number(state.quote.customPriceGross) || 0,
        gross: customGross,
        net: customNet,
        iva: customIva,
        profit: customProfit,
        margin: customMargin,
        averageText: describeAverageOrderValue(customNet, projection),
        status: getSelectedPriceState(customNet, summary),
        selected: summary.selectedPriceMode === 'custom'
      }
    };
  }

  function renderQuote(calc) {
    const { quote, scenario, database } = state;
    normalizeQuotePrototypeState(quote);
    const productTypeOptions = (database.productTypes || []).map((item) => item.name).filter(Boolean);
    const hasCurrentProductType = productTypeOptions.includes(quote.productName);
    const isPrototype = Boolean(quote.isPrototype || String(quote.productName || '').trim().toLowerCase() === 'prototipo');
    const selectedProductType = (database.productTypes || []).find((item) => String(item.name || '').trim() === String(quote.productName || '').trim());
    const selectedProductDescription = String(selectedProductType?.comments || '').trim();

    const materialGroups = [...new Set(database.materials.map((item) => item.group).filter(Boolean))];

    const materialRows = calc.quoteSummary.materialLines.map((line) => {
      const currentGroup = line.group || line.material?.group || materialGroups[0] || '';
      const wastePercent = Number(line.wastePercent) || 0;

      const formulaInfo = line.material
        ? `Precio base: ${formatCurrencySmart(line.material.baseCost || 0)} · Factor: ${renderCalculationUnitLabel(line.material.calculationUnit)} · ${line.material.formulaSummary || ''}`
        : 'Selecciona grupo e insumo para ver la fórmula aplicada.';

      return `
        <tr>
          <td class="group-dropdown-cell">
            <button type="button" class="btn btn-soft picker-trigger-btn" data-action="open-material-group-picker" data-row-id="${line.id}" title="${sanitize(currentGroup || 'Selecciona grupo')}">
              <span class="picker-trigger-label">${sanitize(currentGroup || 'Selecciona grupo')}</span>
              <span class="picker-trigger-caret" aria-hidden="true">▾</span>
            </button>
          </td>
          <td class="insumo-cell">
            <button type="button" class="btn btn-soft picker-trigger-btn" data-action="open-material-option-picker" data-row-id="${line.id}" title="${sanitize(line.material?.name || 'Selecciona insumo')}">
              <span class="picker-trigger-label">${sanitize(line.material?.name || 'Selecciona insumo')}</span>
              <span class="picker-trigger-caret" aria-hidden="true">▾</span>
            </button>
            <div class="small">${sanitize(line.material?.provider || '')}</div>
          </td>
          <td class="cell-with-meta compact-cost-cell">
            <div class="unit-cost-inline">
              <strong>${formatCurrencySmart(line.unitCost)}</strong>
              ${renderInfoTip(formulaInfo)}
              ${line.material?.imageDataUrl ? `
                <span class="image-chip image-chip-inline" tabindex="0" aria-label="Ver imagen del insumo">
                  ${iconSvg('download')}
                  <span class="image-tooltip"><img src="${sanitize(line.material.imageDataUrl)}" alt="${sanitize(line.material.name || 'Insumo')}" /></span>
                </span>
              ` : ''}
            </div>
            <div class="small">${sanitize(line.material?.unit || '-')}</div>
          </td>
          <td class="usage-cell">
            <input type="number" min="0" step="0.01" data-collection="quote.materials" data-id="${line.id}" data-key="quantity" value="${line.quantity}" />
            <div class="waste-inline waste-inline-compact">
              <label class="small">Merma %</label>
              <input class="input-sm waste-input-sm" type="number" min="0" step="0.1" data-collection="quote.materials" data-id="${line.id}" data-key="wastePercent" value="${wastePercent}" />
            </div>
          </td>
          <td class="cell-amount">
            <strong>${formatCurrency(line.lineTotal)}</strong>
            <div class="small">Base: ${formatCurrency(line.baseLineTotal || 0)}</div>
            <div class="small">Merma: ${formatCurrency(line.wasteAmount || 0)}</div>
            ${line.material ? `<input class="input-sm material-line-comment" type="text" maxlength="80" data-collection="quote.materials" data-id="${line.id}" data-key="comment" value="${sanitize(line.comment || '')}" placeholder="¿A qué parte corresponde?" title="Comentario: diferencia para qué parte del producto es este insumo" />` : ''}
          </td>
          <td>
            <button class="btn btn-soft btn-icon" title="Eliminar línea" aria-label="Eliminar línea" data-action="remove-material-line" data-id="${line.id}">${iconSvg('trash')}</button>
          </td>
        </tr>
      `;
    }).join('');

    const laborRows = calc.quoteSummary.laborLines.map((line) => {
      const externalResources = (state.database.externalResources || []).filter((item) => item.status !== 'Inactivo');
      const employeeOptions = state.scenario.employees
        .map((employee) => `<option value="${employee.id}" ${employee.id === line.employeeId ? 'selected' : ''}>${sanitize(employee.name)}</option>`)
        .concat(externalResources.map((item) => `<option value="${item.id}" ${item.id === line.employeeId ? 'selected' : ''}>${sanitize(item.name)} · ${sanitize(item.type || 'Ayuda externa')}</option>`))
        .join('');

      const isExternal = Boolean(line.externalResource);
      const rateHelp = isExternal
        ? 'Ayuda externa: se respeta el valor hora ingresado en su subbase, sin corrección por eficiencia.'
        : 'Valor hora real productivo = valor hora nominal dividido por la eficiencia del escenario activo.';

      return `
        <tr>
          <td>
            <select data-collection="quote.labor" data-id="${line.id}" data-key="employeeId">${employeeOptions}</select>
            ${isExternal ? `<div class="small">${sanitize(line.externalResource?.type || 'Ayuda externa')}</div>` : ''}
          </td>
          <td>
            <input type="number" min="0" step="0.25" data-collection="quote.labor" data-id="${line.id}" data-key="hours" value="${line.hours}" />
          </td>
          <td>
            <input type="text" data-format="clp" min="0" step="1" data-collection="quote.labor" data-id="${line.id}" data-key="rate" value="${formatNumber(line.rate || 0)}" />
          </td>
          <td class="cell-with-meta compact-cost-cell">
            <div class="unit-cost-inline"><strong>${formatCurrency(line.realRate || 0)}</strong>${renderInfoTip(rateHelp)}</div>
            <div class="small">${isExternal ? 'Sin corrección por eficiencia' : `E: ${formatPercent(line.efficiencyApplied || scenario.efficiency)}`}</div>
          </td>
          <td class="cell-amount"><strong>${formatCurrency(line.lineTotal)}</strong></td>
          <td class="labor-note-cell">
            ${isExternal
              ? `<span class="small">${sanitize(line.externalResource?.description || 'Sin nota en subbase')}</span>`
              : '<span class="small">—</span>'}
          </td>
          <td><button class="btn btn-soft btn-icon" title="Eliminar línea" aria-label="Eliminar línea" data-action="remove-labor-line" data-id="${line.id}">${iconSvg('trash')}</button></td>
        </tr>
      `;
    }).join('');

    const priceSelection = buildPriceSelectionData(calc);
    const selectedPriceMeta = getPriceModeMeta(calc.quoteSummary.selectedPriceMode || 'target');
    const priceCards = priceSelection.options.map((option) => `
      <button type="button" class="price-choice-card ${option.className} ${option.selected ? 'selected' : ''}" data-action="select-price-target" data-price-mode="${option.key}">
        <span class="price-choice-title">${sanitize(option.label)}</span>
        <strong>${formatCurrency(option.price)}</strong>
        <span class="price-choice-meta">Margen: ${formatPercent(option.margin)}</span>
        <span class="price-choice-meta">Utilidad: ${formatCurrency(option.profit)}</span>
        <span class="price-choice-note">${sanitize(option.averageText)}</span>
      </button>
    `).join('');

    return `
      <div class="card">
        <div class="section-title">
          <div>
            <h2>Ficha Técnica OT</h2>
          </div>
          <div class="inline-actions action-pair">
            <button class="btn btn-soft btn-add-line-icon" data-action="open-calculator" title="Calculadora" aria-label="Calculadora">${iconSvg('calculator')}</button>
            <button class="btn btn-soft btn-add-line-icon" data-action="clear-quote-form" title="Limpiar ficha" aria-label="Limpiar ficha">${iconSvg('broom')}</button>
          </div>
        </div>

        <div class="database-form-layout">
          <div class="form-section">
            <div class="form-section-title">Datos generales</div>
            <div class="database-grid database-grid-3 compact-grid">
              <div class="field-wide-2">
                <label>Título de orden</label>
                <input data-model="quote.orderTitle" value="${sanitize(quote.orderTitle || '')}" placeholder="Ejemplo: Letrero principal cafetería" />
              </div>
              <div class="field-wide-2">
                <label>Cliente asignado</label>
                <select data-model="quote.customerId" ${isPrototype ? 'disabled' : ''}>
                  <option value="">Selecciona un cliente guardado</option>
                  <option value="__prospecto__" ${quote.customerId === '__prospecto__' ? 'selected' : ''}>Cliente prospecto (venta no concretada)</option>
                  ${state.contacts.map((contact) => `<option value="${contact.id}" class="${contact.isFriend ? 'option-friend' : ''}" style="${contact.isFriend ? 'color:#966d00;font-weight:700;' : ''}" ${quote.customerId === contact.id ? 'selected' : ''}>${sanitize(contact.name)}${contact.company ? ` · ${sanitize(contact.company)}` : ''}${contact.isFriend ? ' ★' : ''}</option>`).join('')}
                </select>
              </div>
              <div>
                <label class="label-with-tip"><span>Producto</span>${selectedProductDescription ? renderInfoTip(selectedProductDescription) : ''}</label>
                <select data-model="quote.productName">
                  <option value="">Seleccionar tipo...</option>
                  <option value="Prototipo" style="font-weight:700;" ${quote.productName === 'Prototipo' ? 'selected' : ''}>Prototipo</option>
                  ${productTypeOptions.map((name) => `<option value="${sanitize(name)}" ${quote.productName === name ? 'selected' : ''}>${sanitize(name)}</option>`).join('')}
                  ${quote.productName && !hasCurrentProductType && quote.productName !== 'Prototipo' ? `<option value="${sanitize(quote.productName)}" selected>${sanitize(quote.productName)}</option>` : ''}
                </select>
              </div>
              <div class="field-wide-2 date-pair-grid">
                <div>
                  <label>Fecha de ingreso</label>
                  <input type="date" data-model="quote.quoteDate" value="${sanitize(quote.quoteDate)}" />
                </div>
                <div>
                  <label>Fecha de entrega</label>
                  <input type="date" data-model="quote.estimatedDeliveryDate" value="${sanitize(quote.estimatedDeliveryDate || '')}" ${isPrototype ? 'disabled' : ''} />
                </div>
              </div>
              <div>
                <label class="label-with-tip"><span>Estado</span>${renderInfoTip('Estado comercial de la orden. "Prospecto" es oportunidad abierta; "Presupuesto Aceptado" confirma aprobación; "Abonado (no entregado)" indica pago (total o parcial) recibido con entrega pendiente; "Entregado (pagado)" y "Entregado (no pagado)" cierran la entrega según si el pago está saldado.')}</label>
                <div class="status-field-inline">
                  <select data-model="quote.status" ${isPrototype ? 'disabled' : ''}>
                    <option value="Prospecto" ${quote.status === 'Prospecto' ? 'selected' : ''}>Prospecto</option>
                    <option value="Aceptado" ${quote.status === 'Aceptado' ? 'selected' : ''}>Presupuesto Aceptado</option>
                    <option value="Abonado (no entregado)" ${quote.status === 'Abonado (no entregado)' || quote.status === 'Pagado (no entregado)' ? 'selected' : ''}>Abonado (no entregado)</option>
                    <option value="Entregado (pagado)" ${quote.status === 'Entregado (pagado)' ? 'selected' : ''}>Entregado (pagado)</option>
                    <option value="Entregado (no pagado)" ${quote.status === 'Entregado (no pagado)' ? 'selected' : ''}>Entregado (no pagado)</option>
                    <option value="Prototipo" ${quote.status === 'Prototipo' ? 'selected' : ''}>Prototipo</option>
                  </select>
                  <div class="status-inline-help">${renderOrderStatusPill(quote.status)}</div>
                </div>
              </div>
              <div>
                <label>Número de orden</label>
                <input data-model="quote.orderNumber" value="${sanitize(quote.orderNumber || '')}" placeholder="Ejemplo: OT-001" ${isPrototype ? 'disabled' : ''} />
                <div class="small">${isPrototype ? 'Se fija automáticamente como Prototipo.' : ''}</div>
              </div>
            </div>
          </div>

          <div class="form-section">
            <div class="form-section-title">Descripción inicial</div>
            <textarea data-model="quote.description">${sanitize(quote.description)}</textarea>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="section-title">
          <div>
            <h3>Insumos de la Orden de trabajo</h3>
          </div>
          <div class="inline-actions action-pair">
            <button class="btn btn-primary btn-add-line-icon" data-action="add-material-line" title="Agregar línea" aria-label="Agregar línea">${iconSvg('plus')}</button>
            <button class="btn btn-soft btn-add-line-icon" data-action="clear-material-lines" title="Limpiar tabla" aria-label="Limpiar tabla">${iconSvg('broom')}</button>
          </div>
        </div>
        <div class="table-wrap table-compact quote-work-table">
          <table>
            <thead>
              <tr>
                <th>Grupo</th>
                <th>Insumo</th>
                <th>Costo unitario</th>
                <th>Material usado</th>
                <th>Valor material en uso</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              ${materialRows || '<tr><td colspan="6" class="empty-state">No hay insumos agregados. Crea o importa registros desde la base de datos.</td></tr>'}
              <tr class="table-total materials-total-row">
                <td colspan="4"><strong class="table-total-label">Total insumos de la orden</strong></td>
                <td class="table-total-value-cell"><strong class="table-total-value">${formatCurrency(calc.quoteSummary.materialsTotal)}</strong></td>
                <td></td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div class="card">
        <div class="section-title">
          <div>
            <h3>Mano de obra</h3>
          </div>
          <div class="inline-actions action-pair">
            <button class="btn btn-primary btn-add-line-icon" data-action="add-labor-line" title="Agregar línea" aria-label="Agregar línea">${iconSvg('plus')}</button>
            <button class="btn btn-soft btn-add-line-icon" data-action="clear-labor-lines" title="Limpiar tabla" aria-label="Limpiar tabla">${iconSvg('broom')}</button>
          </div>
        </div>
        <div class="table-wrap table-compact quote-work-table">
          <table>
            <thead>
              <tr>
                <th>Empleado</th>
                <th>Horas</th>
                <th>Valor base</th>
                <th>Valor hora real</th>
                <th>Total</th>
                <th>Notas</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              ${laborRows || '<tr><td colspan="7" class="empty-state">No hay mano de obra agregada.</td></tr>'}
              <tr class="table-total materials-total-row">
                <td colspan="4"><strong class="table-total-label">Total mano de obra</strong></td>
                <td class="table-total-value-cell"><strong class="table-total-value">${formatCurrency(calc.quoteSummary.laborTotal)}</strong></td>
                <td></td>
                <td></td>
              </tr>
            </tbody>
          </table>
        </div>
        <p class="help">La eficiencia ya impacta el valor hora real mostrado en esta tabla.</p>
      </div>

      <div class="card">
        <div class="section-title">
          <div>
            <h3>CIF aplicado a la orden</h3>
          </div>
        </div>
        <div class="kpi-grid kpi-grid-compact-3">
          <div class="kpi-box"><span>Horas imputadas</span><strong>${Number(calc.quoteSummary.totalLaborHours || 0).toLocaleString('es-CL', { maximumFractionDigits: 2 })} h</strong></div>
          <div class="kpi-box"><span>Tasa CIF/h</span><strong>${formatCurrency(calc.scenarioSummary.cifPerHour || 0)}</strong></div>
          <div class="kpi-box"><span>Total CIF aplicado</span><strong>${formatCurrency(calc.quoteSummary.cifTotal || 0)}</strong></div>
        </div>
      </div>

      <div class="card">
        <div class="section-title">
          <div>
            <h3>Cantidad de unidades</h3>
          </div>
        </div>
        <div class="grid-2">
          <div>
            <label class="label-with-tip"><span>Unidades a fabricar</span>${renderInfoTip('Multiplica el costo de producción de una unidad (materia prima + mano de obra + CIF) por la cantidad de piezas iguales. La logística y el despacho se mantienen sin multiplicar porque corresponden a un único envío.')}</label>
            <input type="number" min="1" step="1" data-model="quote.pieceQuantity" value="${Math.max(1, Math.round(Number(quote.pieceQuantity) || 1))}" />
          </div>
        </div>
        <div class="kpi-grid kpi-grid-compact-3">
          <div class="kpi-box"><span>Costo de una unidad</span><strong>${formatCurrency(calc.quoteSummary.unitCost || 0)}</strong></div>
          <div class="kpi-box"><span>Unidades</span><strong>${calc.quoteSummary.pieceQuantity || 1}</strong></div>
          <div class="kpi-box"><span>Subtotal producción (× unidades)</span><strong>${formatCurrency(calc.quoteSummary.productionCost || 0)}</strong></div>
        </div>
      </div>

      <div class="card">
        <details class="finance-section-details">
          <summary>
            Logística y despacho
            <span class="logistics-summary-badge">${sanitize({ retiro: 'Retiro en taller', metro: 'Entrega en Metro', domicilio: 'Entrega a domicilio', starken: 'Envío por Starken' }[quote.logistics.mode] || 'Retiro en taller')} · ${formatCurrency(calc.quoteSummary.logisticsTotal || 0)}</span>
          </summary>
          <div class="finance-section-body">
            <div class="section-title">
              <div></div>
              <div class="inline-actions action-pair">
                <button class="btn btn-soft btn-add-line-icon" data-action="clear-logistics" title="Limpiar logística" aria-label="Limpiar logística">${iconSvg('broom')}</button>
              </div>
            </div>

            <div class="grid-2">
              <div>
                <label>Modalidad</label>
                <select data-model="quote.logistics.mode">
                  <option value="retiro" ${quote.logistics.mode === 'retiro' ? 'selected' : ''}>Retiro en taller</option>
                  <option value="metro" ${quote.logistics.mode === 'metro' ? 'selected' : ''}>Entrega en Metro</option>
                  <option value="domicilio" ${quote.logistics.mode === 'domicilio' ? 'selected' : ''}>Entrega a domicilio</option>
                  <option value="starken" ${quote.logistics.mode === 'starken' ? 'selected' : ''}>Envío por Starken</option>
                </select>
              </div>
            </div>

            ${renderLogisticsFields(quote.logistics, scenario, calc)}
          </div>
        </details>
      </div>

      <div class="card">
        <div class="section-title">
          <div>
            <h3>Precios de venta</h3>
            <p class="subtitle">Selecciona una referencia sugerida o fija un precio manual según valor percibido, marca o negociación.</p>
          </div>
        </div>

        <div class="price-options-grid">
          ${priceCards}
          <div class="price-choice-card price-tone-custom ${priceSelection.custom.selected ? 'selected' : ''}" data-action="select-price-target" data-price-mode="custom">
            <div class="price-choice-title-row">
              <span class="price-choice-title">Precio definido</span>
            </div>
            <input type="text" data-format="clp" min="0" step="1" data-model="quote.customPriceGross" value="${formatNumber(Number(quote.customPriceGross) || 0)}" placeholder="Ingresa precio final (con IVA)" />
            <span class="price-choice-meta">Precio real sin IVA: ${formatCurrency(priceSelection.custom.net)}</span>
            <span class="price-choice-meta">IVA: ${formatCurrency(priceSelection.custom.iva)}</span>
            <span class="price-choice-meta">Margen: ${formatPercent(priceSelection.custom.margin)}</span>
            <span class="price-choice-meta">Utilidad: ${formatCurrency(priceSelection.custom.profit)}</span>
            <span class="price-choice-note">${sanitize(priceSelection.custom.status.text)} · ${sanitize(priceSelection.custom.averageText)}</span>
          </div>
        </div>

        <div class="selection-callout ${selectedPriceMeta.className}">
          <strong>${sanitize(selectedPriceMeta.label)} seleccionado</strong>
          <div class="small">${sanitize(calc.quoteSummary.selectedStatus?.text || 'Dentro de las metas definidas')}. ${sanitize(calc.quoteSummary.averageSaleSignal?.text || '')}.</div>
          ${calc.quoteSummary.selectedPriceMode === 'custom' ? `<div class="small">Neto real: ${formatCurrency(calc.quoteSummary.customNet || 0)} · IVA: ${formatCurrency(calc.quoteSummary.customIvaAmount || 0)}</div>` : ''}
        </div>

        <div class="inline-actions">
          <button class="btn btn-primary" data-action="save-order-system">Incorporar al Panel OT</button>
          <button class="btn btn-soft" data-action="export-order-json">Guardar la OT en mi computador</button>
          <button class="btn btn-soft" data-action="export-order-print">Exportar OT en PDF</button>
          ${(() => {
            const lm = quote.logistics?.mode || 'retiro';
            const showLabelBtn = lm === 'retiro'
              ? Boolean(String(quote.logistics?.notes || '').trim())
              : true;
            return showLabelBtn
              ? `<button class="btn btn-soft" data-action="export-logistics-label">Exportar etiqueta PDF</button>`
              : '';
          })()}
        </div>
      </div>
    `;
  }

  function renderLogisticsFields(logistics, scenario, calc) {
    const breakdown = calc.quoteSummary.logisticsBreakdown || { total: 0 };
    const defaultHourRate = logistics.deliveryHourRate || Math.round(window.ERMCalc.averageLaborRate(scenario));
    const logisticsSummary = `
      <div class="kpi-grid">
        <div class="kpi-box"><span>Total logística y despacho</span><strong>${formatCurrency(calc.quoteSummary.logisticsTotal || 0)}</strong></div>
      </div>
    `;

    if (logistics.mode === 'retiro') {
      return `
        <div class="grid-2">
          <div class="field-wide-2">
            <label>Comentarios / notas</label>
            <textarea data-model="quote.logistics.notes" placeholder="Ejemplo: retiro coordinado para el viernes en la tarde.">${sanitize(logistics.notes)}</textarea>
            <p class="help compact-help">Retiro en taller es la opción por defecto y no suma costo logístico.</p>
          </div>
        </div>
        ${logisticsSummary}
      `;
    }

    if (logistics.mode === 'metro') {
      return `
        <div class="grid-2">
          <div>
            <label>Estación de Metro acordada</label>
            <input data-model="quote.logistics.metroStation" value="${sanitize(logistics.metroStation || '')}" placeholder="Ejemplo: Los Leones" />
          </div>
          <div>
            <label>Pasajes</label>
            <input type="text" data-format="clp" min="0" step="100" data-model="quote.logistics.passageCost" value="${formatNumber(logistics.passageCost || 1500)}" />
          </div>
          <div class="field-wide-2">
            <label>Comentarios / notas</label>
            <textarea data-model="quote.logistics.notes" placeholder="Punto exacto, horario o condiciones de entrega.">${sanitize(logistics.notes)}</textarea>
          </div>
        </div>
        <div class="kpi-grid">
          <div class="kpi-box"><span>Pasajes</span><strong>${formatCurrency(breakdown.passageCost || 1500)}</strong></div>
          <div class="kpi-box"><span>Total logística y despacho</span><strong>${formatCurrency(calc.quoteSummary.logisticsTotal || 0)}</strong></div>
        </div>
      `;
    }

    if (logistics.mode === 'domicilio') {
      return `
        <div class="grid-2">
          <div>
            <label>Dirección</label>
            <input data-model="quote.logistics.address" value="${sanitize(logistics.address)}" />
          </div>
          <div>
            <label>Comuna</label>
            <input data-model="quote.logistics.district" value="${sanitize(logistics.district)}" />
          </div>
          <div>
            <label>Km totales del viaje</label>
            <input type="number" min="0" step="0.1" data-model="quote.logistics.distanceKm" value="${logistics.distanceKm || 0}" />
          </div>
          <div>
            <label class="label-with-tip"><span>Rendimiento estimado km/L</span>${renderInfoTip('Se dejó 14 km/L como referencia inicial editable para tu Honda WR-V 2024, usando una aproximación de consumo mixto. Ajusta este dato según tu rendimiento real en ciudad o carretera.')}</label>
            <input type="number" min="1" step="0.1" data-model="quote.logistics.fuelEfficiencyKmL" value="${logistics.fuelEfficiencyKmL || 14}" />
          </div>
          <div>
            <label>Precio bencina por litro</label>
            <input type="text" data-format="clp" min="0" step="1" data-model="quote.logistics.fuelPricePerLiter" value="${formatNumber(logistics.fuelPricePerLiter || 1300)}" />
          </div>
          <div>
            <label>Peajes / estacionamiento</label>
            <input type="text" data-format="clp" min="0" step="1" data-model="quote.logistics.tollCost" value="${formatNumber(logistics.tollCost || 0)}" />
          </div>
          <div>
            <label>Horas de entrega</label>
            <input type="number" min="0" step="0.25" data-model="quote.logistics.deliveryHours" value="${logistics.deliveryHours || 0}" />
          </div>
          <div>
            <label class="label-with-tip"><span>Valor hora entrega</span>${renderInfoTip('Recomendación: usar la misma hora real productiva del escenario activo, porque el despacho también consume tiempo operativo de la empresa. Ahora se completa automáticamente con esa referencia.')}</label>
            <input type="text" data-format="clp" min="0" step="1" data-model="quote.logistics.deliveryHourRate" value="${formatNumber(defaultHourRate || 0)}" />
          </div>
          <div class="field-wide-2">
            <label>Comentarios / notas</label>
            <textarea data-model="quote.logistics.notes" placeholder="Referencia editable para tu Honda WR-V 2024. Puedes ajustar el rendimiento según tu experiencia real.">${sanitize(logistics.notes)}</textarea>
          </div>
        </div>
        <div class="kpi-grid">
          <div class="kpi-box"><span>Bencina estimada</span><strong>${formatCurrency(breakdown.fuelCost || 0)}</strong></div>
          <div class="kpi-box"><span>Tiempo de entrega</span><strong>${formatCurrency(breakdown.laborComponent || 0)}</strong></div>
          <div class="kpi-box"><span>Total logística y despacho</span><strong>${formatCurrency(calc.quoteSummary.logisticsTotal || 0)}</strong></div>
        </div>
        <p class="help">Sugerencia: usa los kilómetros totales del viaje. La fórmula estima litros consumidos y los convierte a costo real de traslado.</p>
      `;
    }

    return `
      <div class="grid-2">
        <div>
          <label>Cliente</label>
          <input data-model="quote.logistics.recipientName" value="${sanitize(logistics.recipientName)}" placeholder="Nombre cliente o receptor" />
        </div>
        <div>
          <label>RUT cliente</label>
          <input data-model="quote.logistics.recipientRut" value="${sanitize(logistics.recipientRut)}" />
        </div>
        <div>
          <label>Dirección de envío</label>
          <input data-model="quote.logistics.address" value="${sanitize(logistics.address)}" />
        </div>
        <div>
          <label>Comuna</label>
          <input data-model="quote.logistics.district" value="${sanitize(logistics.district)}" />
        </div>
        <div>
          <label>Teléfono</label>
          <input data-model="quote.logistics.recipientPhone" value="${sanitize(logistics.recipientPhone)}" />
        </div>
        <div>
          <label>Correo</label>
          <input data-model="quote.logistics.recipientEmail" value="${sanitize(logistics.recipientEmail)}" />
        </div>
        <div>
          <label>Embalaje</label>
            <input type="text" data-format="clp" min="0" step="1" data-model="quote.logistics.packingCost" value="${formatNumber(logistics.packingCost || 0)}" />
        </div>
        <div>
          <label>Valor Starken</label>
            <input type="text" data-format="clp" min="0" step="1" data-model="quote.logistics.externalCarrierCost" value="${formatNumber(logistics.externalCarrierCost || 0)}" />
        </div>
        <div class="field-wide-2">
          <label>Comentarios / notas</label>
          <textarea data-model="quote.logistics.notes" placeholder="A futuro este bloque podrá conectarse a la ficha del cliente.">${sanitize(logistics.notes)}</textarea>
        </div>
      </div>
      <div class="kpi-grid">
        <div class="kpi-box"><span>Embalaje</span><strong>${formatCurrency(breakdown.packingCost || 0)}</strong></div>
        <div class="kpi-box"><span>Transportista</span><strong>${formatCurrency(breakdown.carrierCost || 0)}</strong></div>
        <div class="kpi-box"><span>Total logística y despacho</span><strong>${formatCurrency(calc.quoteSummary.logisticsTotal || 0)}</strong></div>
      </div>
    `;
  }

  function renderCalculationUnitLabel(value) {
    switch (value) {
      case 'cm2': return '$/cm²';
      case 'rendimiento': return '$/rendimiento';
      case 'min': return '$/min';
      case 'unidad': return '$/unidad';
      default: return '$/unidad';
    }
  }

  function renderCalculationUnitOptions(current) {
    return [
      ['cm2', '$/cm²'],
      ['rendimiento', '$/rendimiento'],
      ['min', '$/min'],
      ['unidad', '$/unidad']
    ].map(([value, label]) => `<option value="${value}" ${current === value ? 'selected' : ''}>${label}</option>`).join('');
  }

  function calculateMaterialPreview(form) {
    const baseCost = Number(form.baseCost) || 0;

    if (form.calculationUnit === 'cm2') {
      const widthCm = Number(form.widthCm) || 0;
      const heightCm = Number(form.heightCm) || 0;
      const area = widthCm * heightCm;
      return {
        unitCost: area > 0 ? baseCost / area : 0,
        referenceUnit: 'cm²',
        description: area > 0
          ? `Plancha de ${widthCm} × ${heightCm} cm = ${area.toFixed(0)} cm² útiles.`
          : 'Ingresa ancho y alto en cm para calcular el costo por superficie.'
      };
    }

    if (form.calculationUnit === 'rendimiento') {
      const yieldQuantity = Number(form.yieldQuantity) || 0;
      const yieldUnit = form.yieldUnit || 'm²';
      return {
        unitCost: yieldQuantity > 0 ? baseCost / yieldQuantity : 0,
        referenceUnit: yieldUnit,
        description: yieldQuantity > 0
          ? `El costo se reparte sobre un rendimiento total de ${yieldQuantity} ${yieldUnit}.`
          : 'Ingresa el rendimiento total del producto para calcular el costo aplicado.'
      };
    }

    if (form.calculationUnit === 'min') {
      return {
        unitCost: baseCost,
        referenceUnit: 'min',
        description: 'El costo ingresado se considera directamente como valor por minuto.'
      };
    }

    return {
      unitCost: baseCost,
      referenceUnit: 'unidad',
      description: 'El costo ingresado se considera directamente como valor por unidad.'
    };
  }

  function renderDatabaseCalculationFields(form) {
    if (form.calculationUnit === 'cm2') {
      return `
        <div class="grid-2 form-extra-block">
          <div>
            <label>Ancho base en cm</label>
            <input id="material-width-cm" type="number" min="0" step="0.1" data-db-draft="widthCm" value="${form.widthCm || ''}" />
          </div>
          <div>
            <label>Alto base en cm</label>
            <input id="material-height-cm" type="number" min="0" step="0.1" data-db-draft="heightCm" value="${form.heightCm || ''}" />
          </div>
        </div>
      `;
    }

    if (form.calculationUnit === 'rendimiento') {
      return `
        <div class="grid-2 form-extra-block">
          <div>
            <label>Rendimiento total</label>
            <input id="material-yield-quantity" type="number" min="0" step="0.01" data-db-draft="yieldQuantity" value="${form.yieldQuantity || ''}" />
          </div>
          <div>
            <label>Unidad del rendimiento</label>
            <select id="material-yield-unit" data-db-draft="yieldUnit">
              ${['m²', 'cm²', 'ml', 'l', 'unidad'].map((unit) => `<option value="${unit}" ${form.yieldUnit === unit ? 'selected' : ''}>${unit}</option>`).join('')}
            </select>
          </div>
        </div>
      `;
    }

    return `
      <div class="help">No necesitas más datos para esta unidad. El costo ingresado se aplicará directamente por ${form.calculationUnit === 'min' ? 'minuto' : 'unidad'}.</div>
    `;
  }

  function buildDatabaseRecord(base) {
    const form = {
      ...base,
      widthCm: Number(document.getElementById('material-width-cm')?.value) || 0,
      heightCm: Number(document.getElementById('material-height-cm')?.value) || 0,
      yieldQuantity: Number(document.getElementById('material-yield-quantity')?.value) || 0,
      yieldUnit: document.getElementById('material-yield-unit')?.value || 'm²'
    };

    const preview = calculateMaterialPreview(form);

    return {
      group: base.group,
      name: base.name,
      calculationUnit: base.calculationUnit,
      baseCost: base.baseCost,
      unitCost: Number(preview.unitCost) || 0,
      unit: preview.referenceUnit,
      notes: base.notes,
      provider: base.provider || '',
      supplierAddress: base.supplierAddress || '',
      supplierContact: base.supplierContact || '',
      status: base.status || 'Activo',
      formulaSummary: preview.description,
      createdAt: base.createdAt || new Date().toLocaleDateString('es-CL'),
      widthCm: form.widthCm,
      heightCm: form.heightCm,
      yieldQuantity: form.yieldQuantity,
      yieldUnit: form.yieldUnit,
      imageDataUrl: base.imageDataUrl || '',
      imageName: base.imageName || '',
      imageMimeType: base.imageMimeType || '',
      imageSizeKb: base.imageSizeKb || 0
    };
  }

  function renderContacts() {
    const editing = state.contacts.find((item) => item.id === state.ui.editingContactId) || {};
    const draft = state.ui.contactDraft || {};
    const nextContactNumber = getNextContactNumber();
    const form = {
      clientNumber: draft.clientNumber ?? editing.clientNumber ?? nextContactNumber,
      type: draft.type ?? editing.type ?? 'persona',
      isFriend: draft.isFriend !== undefined ? (draft.isFriend === true || draft.isFriend === 'true') : (editing.isFriend === true),
      name: draft.name ?? editing.name ?? '',
      company: draft.company ?? editing.company ?? '',
      rut: draft.rut ?? editing.rut ?? '',
      firstContactDate: draft.firstContactDate ?? editing.firstContactDate ?? new Date().toISOString().slice(0, 10),
      address: draft.address ?? editing.address ?? '',
      district: draft.district ?? editing.district ?? '',
      whatsapp: draft.whatsapp ?? editing.whatsapp ?? '',
      instagram: draft.instagram ?? editing.instagram ?? '',
      email: draft.email ?? editing.email ?? '',
      facebook: draft.facebook ?? editing.facebook ?? '',
      website: draft.website ?? editing.website ?? '',
      comments: draft.comments ?? editing.comments ?? ''
    };

    const rows = [...state.contacts]
      .sort((a, b) => (Number(a.clientNumber) || 0) - (Number(b.clientNumber) || 0))
      .map((item) => {
        const clientIcon = item.type === 'empresa' ? '▦' : '◈';
        const friendClass = item.isFriend ? 'is-friend' : '';
        return `
        <tr>
          <td class="client-number-cell"><strong>#${formatNumber(item.clientNumber)}</strong></td>
          <td class="client-type-cell">
            <button class="btn-icon btn-status-plain client-friend-toggle ${friendClass}" data-action="toggle-contact-friend" data-id="${item.id}" title="Marcar cliente amigo" aria-label="Marcar cliente amigo">${clientIcon}</button>
          </td>
          <td>
            <strong class="${item.isFriend ? 'client-friend-name' : ''}">${sanitize(item.name)}${item.isFriend ? '<span class="client-friend-glint"> ✦</span>' : ''}</strong>
            <div class="small">${sanitize(item.type === 'empresa' ? (item.company || 'Empresa') : 'Persona')}</div>
            <div class="small">RUT: ${sanitize(item.rut || '-')}</div>
          </td>
          <td>${sanitize(item.firstContactDate || '-')}</td>
          <td>
            <div class="small">${sanitize(item.address || '-')}</div>
            <div class="small">${sanitize(item.district || '')}</div>
          </td>
          <td>
            ${(() => {
              const contactLines = [];
              const whatsappLines = String(item.whatsapp || '').split(/[,;|]/).map((line) => line.trim()).filter(Boolean);
              whatsappLines.forEach((line) => contactLines.push(`<div class="small">WhatsApp: ${sanitize(line)}</div>`));
              if (item.email) contactLines.push(`<div class="small">Correo: ${sanitize(item.email)}</div>`);
              return contactLines.length
                ? contactLines.join('')
                : '<div class="small">Sin datos de contacto</div>';
            })()}
          </td>
          <td>
            <div class="small">Instagram: ${sanitize(item.instagram || '-')}</div>
            <div class="small">Facebook: ${sanitize(item.facebook || '-')}</div>
            <div class="small">Web: ${sanitize(item.website || '-')}</div>
          </td>
          <td>${sanitize(item.comments || '')}</td>
          <td>
            <div class="button-group compact-actions">
              <button class="btn btn-soft btn-icon" title="Editar cliente" aria-label="Editar cliente" data-action="edit-contact" data-id="${item.id}">${iconSvg('edit')}</button>
              <button class="btn btn-soft btn-icon" title="Eliminar cliente" aria-label="Eliminar cliente" data-action="delete-contact" data-id="${item.id}">${iconSvg('trash')}</button>
            </div>
          </td>
        </tr>
      `;
      }).join('');

    return `
      <div class="card">
        <div class="section-title">
          <div>
            <h2>Ficha de Cliente nuevo</h2>
            <p class="subtitle">Registra tus clientes para reutilizar su información más adelante en despachos, envíos y órdenes de trabajo.</p>
          </div>
        </div>

        <div class="database-form-layout">
          <div class="form-section">
            <div class="form-section-title"><span class="form-step">1</span> Cliente nuevo</div>
            <div class="database-grid database-grid-3 compact-grid">
              <div>
                <label>Tipo</label>
                <select data-contact-draft="type">
                  <option value="persona" ${form.type === 'persona' ? 'selected' : ''}>Persona</option>
                  <option value="empresa" ${form.type === 'empresa' ? 'selected' : ''}>Empresa</option>
                </select>
              </div>
              <div>
                <label>Cliente amigo</label>
                <select data-contact-draft="isFriend">
                  <option value="false" ${!form.isFriend ? 'selected' : ''}>No</option>
                  <option value="true" ${form.isFriend ? 'selected' : ''}>Sí</option>
                </select>
              </div>
              <div>
                <label>Nombre del cliente</label>
                <input data-contact-draft="name" value="${sanitize(form.name)}" placeholder="Nombre completo" />
              </div>
              <div>
                <label>RUT</label>
                <input data-contact-draft="rut" value="${sanitize(form.rut)}" placeholder="12.345.678-9" />
              </div>
              <div>
                <label>Empresa (opcional)</label>
                <input data-contact-draft="company" value="${sanitize(form.company)}" placeholder="Empresa o razón social" />
              </div>
              <div>
                <label>Fecha de primer contacto</label>
                <input type="date" data-contact-draft="firstContactDate" value="${sanitize(form.firstContactDate)}" />
              </div>
              <div class="field-wide-2 form-pair-grid">
                <div>
                  <label>Dirección</label>
                  <input data-contact-draft="address" value="${sanitize(form.address)}" placeholder="Dirección principal" />
                </div>
                <div>
                  <label>Comuna</label>
                  <input data-contact-draft="district" value="${sanitize(form.district)}" placeholder="Comuna" />
                </div>
              </div>
            </div>
          </div>

          <div class="form-section">
            <div class="form-section-title"><span class="form-step">2</span> Contacto</div>
            <div class="database-grid database-grid-3 compact-grid">
              <div>
                <label>Whatsapp</label>
                <div class="field-with-action">
                  <input data-contact-draft="whatsapp" value="${sanitize(form.whatsapp)}" placeholder="+56 ..." />
                  <button type="button" class="btn btn-soft btn-icon" data-action="append-whatsapp" title="Agregar número" aria-label="Agregar número">${iconSvg('plus')}</button>
                </div>
                <div class="small">Usa coma o punto y coma para separar varios números.</div>
              </div>
              <div>
                <label>Instagram</label>
                <input data-contact-draft="instagram" value="${sanitize(form.instagram)}" placeholder="@usuario" />
              </div>
              <div>
                <label>Correo</label>
                <input data-contact-draft="email" value="${sanitize(form.email)}" placeholder="correo@cliente.cl" />
              </div>
              <div>
                <label>Facebook</label>
                <input data-contact-draft="facebook" value="${sanitize(form.facebook)}" placeholder="Perfil o página" />
              </div>
              <div class="field-wide-2">
                <label>Página web</label>
                <input data-contact-draft="website" value="${sanitize(form.website)}" placeholder="https://..." />
              </div>
            </div>
          </div>

          <div class="form-section">
            <div class="form-section-title"><span class="form-step">3</span> Comentarios</div>
            <label>Observaciones o contexto comercial</label>
            <textarea data-contact-draft="comments" placeholder="Preferencias, antecedentes o notas importantes del cliente.">${sanitize(form.comments)}</textarea>
          </div>
        </div>

        <div class="inline-actions action-pair">
          <button class="btn btn-primary" data-action="save-contact">${state.ui.editingContactId ? 'Actualizar cliente' : 'Guardar cliente'}</button>
          <button class="btn btn-soft btn-icon" data-action="clear-contact-form" title="Limpiar ficha" aria-label="Limpiar ficha">${iconSvg('broom')}</button>
          ${state.ui.editingContactId ? '<button class="btn btn-soft" data-action="cancel-edit-contact">Cancelar edición</button>' : ''}
        </div>
      </div>

      <div class="card">
        <div class="section-title">
          <div>
            <h3>Tabla de datos de clientes</h3>
            <p class="subtitle">Base simple y ordenada para tus clientes, lista para conectarse más adelante con el panel de órdenes.</p>
          </div>
          <span class="pill ok">${state.contacts.length} clientes</span>
        </div>

        <div class="table-wrap table-compact">
          <table class="contacts-table">
            <thead>
              <tr>
                <th class="client-number-col">N°</th>
                <th class="client-icon-col"></th>
                <th>Cliente</th>
                <th>Primer contacto</th>
                <th>Dirección</th>
                <th>Contacto</th>
                <th>Redes / web</th>
                <th>Comentarios</th>
                <th></th>
              </tr>
            </thead>
            <tbody>${rows || '<tr><td colspan="9" class="empty-state">Aún no hay clientes guardados. Crea el primero desde la ficha superior.</td></tr>'}</tbody>
          </table>
        </div>

      </div>
    `;
  }

  function renderOrdersPanel() {
    const storedFilter = state.ui.orderFilter || 'Todas';
    const filter = storedFilter === 'Activas' ? 'En fabricación' : storedFilter;
    const selectedOrder = (state.orders || []).find((item) => idsEqual(item.id, state.ui.selectedOrderId)) || state.orders?.[0] || null;
    const visibleOrders = (state.orders || []).filter((item) => {
      const deliveryState = item.deliveryState || item.quote?.deliveryState || 'Abierta';
      if (filter === 'Todas') return true;
      if (filter === 'En fabricación') return !isDeliveryCompleted(deliveryState);
      if (filter === 'Entregadas') return isDeliveryCompleted(deliveryState);
      return item.status === filter;
    });

    const sortByOrderNumber = Boolean(state.ui.orderSortByNumber);
    if (sortByOrderNumber) {
      visibleOrders.sort((a, b) => String(a.orderNumber || '').localeCompare(String(b.orderNumber || ''), undefined, { numeric: true, sensitivity: 'base' }));
    }

    const filterButtons = [
      { key: 'Todas', label: 'Todas' },
      { key: 'Entregadas', label: 'Entregadas' },
      { key: 'En fabricación', label: 'En fabricación' },
      { key: 'Prototipo', label: 'Prototipo' },
      { key: 'Prospecto', label: 'Prospecto' },
      { key: 'Aceptado', label: 'Presupuesto Aceptado' },
      { key: 'Abonado (no entregado)', label: 'Abonado (no entregado)' },
      { key: 'Entregado (pagado)', label: 'Entregado (pagado)' },
      { key: 'Entregado (no pagado)', label: 'Entregado (no pagado)' }
    ].map((item) => {
      return `<button class="btn filter-chip ${filter === item.key ? 'active' : ''}" data-action="set-order-filter" data-filter="${item.key}">${item.label}</button>`;
    }).join('');

    const cards = visibleOrders.map((order) => {
      const meta = getOrderStatusMeta(order.status || 'Prospecto');
      const deliveryState = order.deliveryState || order.quote?.deliveryState || 'Abierta';
      const delivered = isDeliveryCompleted(deliveryState);
      const deliveryMeta = getDeliveryMeta(deliveryState);
      const marginAchievement = getMarginAchievement(order.quoteSummary || {});
      const estimatedDeliveryDate = order.estimatedDeliveryDate || order.quote?.estimatedDeliveryDate || '-';
      const titleRaw = String(order.orderTitle || 'Orden sin título');
      const titleClass = titleRaw.length > 74 ? 'is-very-long' : (titleRaw.length > 48 ? 'is-long' : '');
      return `
        <button type="button" class="ot-card ${meta.className} ${delivered ? 'is-delivered' : ''} ${idsEqual(selectedOrder?.id, order.id) ? 'selected' : ''}" data-action="open-order-card" data-id="${order.id}">
          <div class="ot-card-top">
            ${renderOrderStatusPill(order.status || 'Prospecto')}
            ${renderDeliveryPill(deliveryState)}
          </div>
          <div class="ot-card-body">
            <strong class="ot-card-title ${titleClass}">${sanitize(titleRaw)}</strong>
            <div class="small">${sanitize(order.orderNumber || '-')}</div>
            <div class="small">${sanitize(order.customerName || '-')}</div>
            <div class="small"><strong>Fecha ingreso:</strong> ${sanitize(order.quoteDate || '-')}</div>
            <div class="small"><strong>Fecha entrega:</strong> <strong>${sanitize(estimatedDeliveryDate)}</strong></div>
          </div>
          <div class="ot-card-bottom-row">
            <div class="ot-card-price">${formatCurrency(order.quoteSummary?.effectiveGross || order.priceGross || 0)}</div>
            <div class="ot-card-achievement ${marginAchievement.tone}" title="${sanitize(marginAchievement.label)}">${marginAchievement.iconMarkup}</div>
          </div>
        </button>
      `;
    }).join('');

    const selectedDeliveryState = selectedOrder?.deliveryState || selectedOrder?.quote?.deliveryState || 'Abierta';
    const selectedAchievement = selectedOrder ? getMarginAchievement(selectedOrder.quoteSummary || {}) : { iconMarkup: '', tone: 'warn', label: '' };

    return `
      <div class="card">
        <div class="section-title">
          <div>
            <h2>Panel de Gestión de OT</h2>
            <p class="subtitle">Aquí puedes ver las órdenes guardadas en el sistema y reabrirlas para edición cuando lo necesites.</p>
          </div>
          <div class="inline-actions">
            <button class="btn btn-soft ${sortByOrderNumber ? 'active' : ''}" data-action="toggle-order-sort" title="Ordenar las OT por número de orden">${sortByOrderNumber ? '✓ ' : ''}Ordenar por N° OT</button>
            <span class="pill ok">${(state.orders || []).length} OT</span>
          </div>
        </div>

        <div class="filter-row">${filterButtons}</div>

        <div class="ot-grid">
          ${cards || '<div class="empty-state">Todavía no hay órdenes guardadas en el sistema. Importa la Base OT desde la Central de Descargas.</div>'}
        </div>
      </div>

      ${selectedOrder ? `
        <div class="card">
          <div class="section-title">
            <div>
              <h3>Vista Previa OT seleccionada</h3>
              <p class="subtitle">Puedes revisarla aquí y cargarla nuevamente en el presupuestador en modo visualización y luego edición.</p>
            </div>
            <div class="inline-actions">
              ${renderOrderStatusPill(selectedOrder.status || 'Prospecto')}
              <span class="achievement-pill ${selectedAchievement.tone}" title="${sanitize(selectedAchievement.label)}">${selectedAchievement.iconMarkup} ${sanitize(selectedAchievement.label)}</span>
            </div>
          </div>

          <div class="grid-2">
            <div><strong>Orden:</strong><br />${sanitize(selectedOrder.orderTitle || '-')}</div>
            <div><strong>N°:</strong><br />${sanitize(selectedOrder.orderNumber || '-')}</div>
            <div><strong>Cliente:</strong><br />${sanitize(selectedOrder.customerName || '-')}</div>
            <div><strong>Fecha ingreso:</strong><br />${sanitize(selectedOrder.quoteDate || '-')}</div>
            <div><strong>Fecha entrega:</strong><br /><strong>${sanitize(selectedOrder.estimatedDeliveryDate || selectedOrder.quote?.estimatedDeliveryDate || '-')}</strong></div>
            <div><strong>Producto:</strong><br />${sanitize(selectedOrder.productName || '-')}</div>
          </div>

          <div class="kpi-grid">
            <div class="kpi-box"><span>Precio de venta</span><strong>${formatCurrency(selectedOrder.quoteSummary?.effectiveGross || selectedOrder.priceGross || 0)}</strong></div>
            <div class="kpi-box"><span>Precio neto / IVA</span><strong>${formatCurrency(selectedOrder.quoteSummary?.effectiveNet || 0)}</strong><div class="small">IVA: ${formatCurrency((selectedOrder.quoteSummary?.effectiveGross || 0) - (selectedOrder.quoteSummary?.effectiveNet || 0))}</div></div>
            <div class="kpi-box"><span>Costo real</span><strong>${formatCurrency(selectedOrder.quoteSummary?.totalCost || 0)}</strong></div>
            <div class="kpi-box"><span>Utilidad / margen real</span><strong>${formatCurrency(selectedOrder.quoteSummary?.contribution || 0)}</strong><div class="small">Margen: ${formatPercent(selectedOrder.quoteSummary?.realMargin || 0)} · ${selectedAchievement.iconMarkup}</div></div>
            <div class="kpi-box"><span>Sueldo</span><strong>${formatCurrency(selectedOrder.quoteSummary?.laborTotal || 0)}</strong></div>
            <div class="kpi-box"><span>Entrega</span><div class="ot-preview-toggle-wrap">${renderDeliveryToggle(selectedDeliveryState, selectedOrder.id)}</div>${renderOrderInvoiceActions(selectedOrder)}</div>
          </div>

          ${(() => {
            const linkedEntries = (state.finance?.entries || []).filter(
              (e) => e.category === 'Ventas' && e.orderId && idsEqual(e.orderId, selectedOrder.id)
            ).sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
            if (linkedEntries.length === 0) return '';
            const totalCobrado = linkedEntries.reduce((s, e) => s + (Number(e.income) || 0), 0);
            const rows = linkedEntries.map((e) => `
              <tr>
                <td class="small">${sanitize(formatFinanceDate(e.date))}</td>
                <td><strong>${sanitize(e.title)}</strong>${e.detail ? `<br><span class="small" style="color:var(--muted);">${sanitize(e.detail)}</span>` : ''}</td>
                <td class="finance-income-cell">${formatCurrency(e.income)}</td>
                <td style="text-align:center;">
                  <button class="btn btn-soft btn-xs" data-action="go-to-finance-entry" data-id="${sanitize(e.id)}" title="Ver en Finanzas">↗ Finanzas</button>
                </td>
              </tr>
            `).join('');
            return `
              <div style="margin-top:16px;">
                <div style="font-size:12px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.04em;margin-bottom:8px;">Cobros registrados en Finanzas</div>
                <table style="width:100%;border-collapse:collapse;font-size:13px;">
                  <thead>
                    <tr style="border-bottom:1px solid var(--line);">
                      <th style="text-align:left;padding:4px 8px 4px 0;font-weight:600;color:var(--muted);">Fecha</th>
                      <th style="text-align:left;padding:4px 8px;font-weight:600;color:var(--muted);">Descripción</th>
                      <th style="text-align:right;padding:4px 0 4px 8px;font-weight:600;color:var(--muted);">Monto</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>${rows}</tbody>
                  <tfoot>
                    <tr style="border-top:1px solid var(--line);">
                      <td colspan="2" style="padding:4px 8px 4px 0;font-weight:700;">Total cobrado</td>
                      <td class="finance-income-cell" style="font-weight:700;">${formatCurrency(totalCobrado)}</td>
                      <td></td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            `;
          })()}

          <div class="inline-actions ot-preview-actions">
            <button class="btn btn-primary" data-action="load-order-to-quote" data-id="${selectedOrder.id}">Cargar en presupuestador para editar</button>
            <button class="btn btn-soft" data-action="delete-order-system" data-id="${selectedOrder.id}">Quitar del panel</button>
          </div>
        </div>
      ` : ''}
    `;
  }

  const MOBILE_HOME_SECTIONS = [
    { view: 'attendance', label: 'Asistencia' },
    { view: 'quote', label: 'Presupuestador' },
    { view: 'orders', label: 'Panel OT' },
    { view: 'expenses', label: 'Gastos' },
    { view: 'finance', label: 'Finanzas' },
    { view: 'contacts', label: 'Clientes' },
    { view: 'database', label: 'Base de datos' },
    { view: 'inventory', label: 'Inventario' },
    { view: 'scenario', label: 'Escenario' }
  ];

  function renderMobileHome() {
    const buttons = MOBILE_HOME_SECTIONS.map((section, index) => `
      <button type="button" class="btn mobile-home-btn" data-view="${section.view}">
        <span class="mobile-home-btn-index">${index + 1}.</span>
        <span>${section.label}</span>
      </button>
    `).join('');
    return `
      <div class="card">
        <div class="section-title">
          <div>
            <h2>AndiApp</h2>
            <p class="subtitle">Selecciona el área a la que quieres ir.</p>
          </div>
        </div>
        <div class="mobile-home-menu">${buttons}</div>
      </div>
    `;
  }

  function isMobileViewport() {
    return typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(max-width: 780px)').matches;
  }

  function renderDocs(calc) {
    const projection = calc.scenarioSummary.projection || {};
    return `
      <div class="card docs-card">
        <div class="section-title">
          <div>
            <h2>Ayuda técnica</h2>
            <p class="subtitle">Guía visual y compacta de módulos, criterios y fórmulas usadas por la aplicación.</p>
          </div>
          <span class="pill info">?</span>
        </div>

        <div class="docs-compact">
          <details class="docs-section">
            <summary>1. Escenario</summary>
            <p>Define costos, sueldos, eficiencia e IVA para obtener las tasas base del sistema.</p>
            <div class="docs-formula formula-book"><span class="formula-label">Horas productivas</span><div class="formula-eq"><span class="formula-symbol">=</span><span>horas disponibles × eficiencia</span></div></div>
            <div class="docs-formula formula-book"><span class="formula-label">Valor hora base</span><div class="formula-eq"><span class="formula-symbol">=</span><span class="formula-frac"><span class="formula-top">sueldos del período</span><span class="formula-bottom">horas productivas</span></span></div></div>
            <div class="docs-formula formula-book"><span class="formula-label">Tasa CIF/h</span><div class="formula-eq"><span class="formula-symbol">=</span><span class="formula-frac"><span class="formula-top">CIF del período</span><span class="formula-bottom">horas productivas</span></span></div></div>
          </details>

          <details class="docs-section">
            <summary>2. Proyección mensual</summary>
            <p>Convierte el escenario en metas comerciales y necesidades de caja.</p>
            <div class="docs-formula formula-book"><span class="formula-label">Costo planificado</span><div class="formula-eq"><span class="formula-symbol">=</span><span>CIF + sueldos + compras directas</span></div></div>
            <div class="docs-formula formula-book"><span class="formula-label">Venta mínima</span><div class="formula-eq"><span class="formula-symbol">=</span><span class="formula-frac"><span class="formula-top">costo planificado</span><span class="formula-bottom">1 - margen mínimo</span></span></div></div>
            <div class="docs-formula formula-book"><span class="formula-label">Órdenes equivalentes</span><div class="formula-eq"><span class="formula-symbol">=</span><span class="formula-frac"><span class="formula-top">horas productivas</span><span class="formula-bottom">horas promedio por orden</span></span></div></div>
          </details>

          <details class="docs-section">
            <summary>3. Insumos y mano de obra</summary>
            <p>Calcula el costo directo de cada línea de la OT.</p>
            <div class="docs-formula formula-book"><span class="formula-label">Total insumo</span><div class="formula-eq"><span class="formula-symbol">=</span><span>cantidad × costo unitario + merma</span></div></div>
            <div class="docs-formula formula-book"><span class="formula-label">Merma</span><div class="formula-eq"><span class="formula-symbol">=</span><span>total base × % de merma</span></div></div>
            <div class="docs-formula formula-book"><span class="formula-label">Valor hora real</span><div class="formula-eq"><span class="formula-symbol">=</span><span class="formula-frac"><span class="formula-top">valor hora nominal</span><span class="formula-bottom">eficiencia</span></span></div></div>
          </details>

          <details class="docs-section">
            <summary>4. CIF y logística de la orden</summary>
            <p>Integra costos indirectos y despacho al costo total real.</p>
            <div class="docs-formula formula-book"><span class="formula-label">CIF aplicado</span><div class="formula-eq"><span class="formula-symbol">=</span><span>horas de la orden × CIF por hora</span></div></div>
            <div class="docs-formula formula-book"><span class="formula-label">Costo total real</span><div class="formula-eq"><span class="formula-symbol">=</span><span>(insumos + mano de obra + CIF) × unidades + logística</span></div></div>
            <div class="docs-formula formula-book"><span class="formula-label">Despacho domicilio</span><div class="formula-eq"><span class="formula-symbol">=</span><span>bencina + peajes + estacionamiento + tiempo</span></div></div>
          </details>

          <details class="docs-section">
            <summary>5. Precios y márgenes</summary>
            <p>Entrega referencias de venta y muestra el margen real del trabajo.</p>
            <div class="docs-formula formula-book"><span class="formula-label">Precio objetivo</span><div class="formula-eq"><span class="formula-symbol">=</span><span class="formula-frac"><span class="formula-top">costo total</span><span class="formula-bottom">1 - margen objetivo</span></span></div></div>
            <div class="docs-formula formula-book"><span class="formula-label">Margen real</span><div class="formula-eq"><span class="formula-symbol">=</span><span class="formula-frac"><span class="formula-top">precio neto - costo total</span><span class="formula-bottom">precio neto</span></span></div></div>
            <div class="docs-formula formula-book"><span class="formula-label">Precio con IVA</span><div class="formula-eq"><span class="formula-symbol">=</span><span>precio neto × (1 + IVA)</span></div></div>
            <div class="small">Referencia actual: equilibrio ${formatCurrency(projection.breakEvenSales || 0)} · mínimo ${formatCurrency(projection.minimumSalesRequired || 0)} · ideal ${formatCurrency(projection.idealSalesRequired || 0)}</div>
          </details>
        </div>
      </div>
    `;
  }

  function renderBackupCenter() {
    const rows = getBaseStatusRows();
    const actionByBase = {
      scenario: { exportAction: 'export-scenario-base', importAction: 'import-scenario-base', exportLabel: 'Descargar', importLabel: 'Importar' },
      database: { exportAction: 'export-database', importAction: 'import-database', exportLabel: 'Descargar', importLabel: 'Importar' },
      productTypes: { exportAction: 'export-product-types', importAction: 'import-product-types', exportLabel: 'Descargar', importLabel: 'Importar' },
      external: { exportAction: 'export-external-resources', importAction: 'import-external-resources', exportLabel: 'Descargar', importLabel: 'Importar' },
      contacts: { exportAction: 'export-contacts', importAction: 'import-contacts', exportLabel: 'Descargar', importLabel: 'Importar' },
      orders: { exportAction: 'export-orders-base', importAction: 'import-orders-base', exportLabel: 'Descargar', importLabel: 'Importar' },
      inventoryCompany: { exportAction: '', importAction: '', exportLabel: 'Descargar', importLabel: 'Importar', disabled: true },
      desired: { exportAction: 'export-desired-base', importAction: 'import-desired-base', exportLabel: 'Descargar', importLabel: 'Importar' },
      expenses: { exportAction: 'export-expenses-base', importAction: 'import-expenses-base', exportLabel: 'Descargar', importLabel: 'Importar' },
      attendance: { exportAction: 'export-attendance-base', importAction: 'import-attendance-base', exportLabel: 'Descargar', importLabel: 'Importar' },
      finance: { exportAction: 'export-finance-base', importAction: 'import-finance-base', exportLabel: 'Descargar', importLabel: 'Importar' }
    };

    const tableRows = rows.map(([key, stamp]) => {
      const meta = actionByBase[key];
      const fileName = key === 'inventoryCompany' ? 'EN_DESARROLLO' : getBackupFileName(key);
      const actionsCell = key === 'inventoryCompany'
        ? '<span class="small">En desarrollo</span>'
        : `<div class="button-group compact-actions"><button class="btn btn-soft" ${meta.disabled ? 'disabled' : `data-action="${meta.importAction}"`}>${meta.importLabel}</button><button class="btn btn-primary" ${meta.disabled ? 'disabled' : `data-action="${meta.exportAction}"`}>${meta.exportLabel}</button></div>`;
      const deleteCell = key === 'inventoryCompany'
        ? '<span class="small">-</span>'
        : `<button class="btn btn-soft btn-icon" data-action="delete-base-entry" data-base-key="${sanitize(key)}" title="Eliminar base" aria-label="Eliminar base ${sanitize(baseLabels[key])}">${iconSvg('trash')}</button>`;
      return `
        <tr>
          <td><strong>${sanitize(baseLabels[key])}</strong></td>
          <td>${sanitize(formatBaseStatus(stamp))}</td>
          <td>${actionsCell}</td>
          <td><span class="small">${sanitize(fileName)}</span></td>
          <td>${deleteCell}</td>
        </tr>
      `;
    }).join('');

    return `
      <div class="card">
        <div class="section-title">
          <div>
            <h2>Central de respaldo</h2>
            <p class="subtitle">Controla importación y descarga de todas las bases de la app en un solo lugar. Usa "Guardar Bases" en la parte superior para asegurar el respaldo de todas las bases.</p>
            ${renderSaveFeedback('backup')}
          </div>
        </div>

        <div class="table-wrap table-compact">
          <table>
            <thead>
              <tr>
                <th>Base</th>
                <th>Última actualización</th>
                <th>Acciones</th>
                <th>Nombre de respaldo</th>
                <th>Eliminar</th>
              </tr>
            </thead>
            <tbody>
              ${tableRows}
            </tbody>
          </table>
        </div>

        <div class="inline-actions">
          <button class="btn btn-primary" data-action="export-full-database">Descargar BASE COMPLETA (1 archivo)</button>
          <button class="btn btn-soft" data-action="export-all-bases-zip">Descarga total (ZIP por módulo)</button>
          <button class="btn btn-soft" data-action="import-all-bases">Importar respaldo (BASE COMPLETA o ZIP)</button>
          <button class="btn btn-soft" data-action="recover-desktop-attachments">Recuperar adjuntos de la app de escritorio</button>
          <button class="btn btn-danger" data-action="delete-all-bases">Eliminar todas las bases</button>
        </div>
        <p class="help">«Descargar BASE COMPLETA» genera un único archivo JSON con TODAS las secciones (Escenario, Presupuestador, Base de datos, Clientes, Panel OT, Inventario, Gastos, Asistencia y Finanzas). La Base OT corresponde al panel completo de órdenes guardadas en el sistema; en Presupuestador puedes seguir descargando una OT individual cuando lo necesites.</p>
      </div>
    `;
  }

  function renderFinanceModule() {
    state.finance = state.finance || { initialBalance: 0, ivaCreditBalance: 0, entries: [] };
    state.finance.entries = Array.isArray(state.finance.entries) ? state.finance.entries : [];
    state.finance.initialBalance = Number(state.finance.initialBalance || 0) || 0;
    state.finance.ivaCreditBalance = Math.max(0, Number(state.finance.ivaCreditBalance || 0) || 0);

    const draft = state.ui.financeDraft ? createFinanceEntry(state.ui.financeDraft) : defaultFinanceDraft();
    state.ui.financeDraft = JSON.parse(JSON.stringify(draft));

    const ivaRate = Number(state.scenario?.ivaRate || 0.19);
    const ivaRatePercent = Math.round(ivaRate * 100);

    // KPI calculations
    const allEntries = state.finance.entries;
    const currentMonth = new Date().toISOString().slice(0, 7);
    const monthSummaryCurrentMonth = getFinanceMonthSummary(allEntries, currentMonth);
    const runningRows = getFinanceRunningRows(allEntries, state.finance.initialBalance);
    const currentBalance = runningRows.length > 0
      ? runningRows[runningRows.length - 1].runningBalance
      : state.finance.initialBalance;
    // Ledger de IVA mes a mes, arrastrando el remanente de crédito fiscal (incluye el
    // crédito previo a la app, ingresado a mano porque no hay conexión con el SII).
    const ivaLedger = getFinanceIvaLedger(allEntries, state.finance.ivaCreditBalance, ivaRate);

    // Salary reference from scenario
    const monthlySalary = (state.scenario?.employees || []).reduce((s, emp) => {
      return s + (Number(emp.hourlyRate || 0) * Number(emp.hoursPerMonth || 0));
    }, 0);

    // Pagination
    const FINANCE_PAGE_SIZE = 60;
    state.ui.financePage = Number(state.ui.financePage) >= 0 ? Number(state.ui.financePage) : 0;
    const displayRowsNewestFirst = [...runningRows].reverse();
    const totalPages = Math.max(1, Math.ceil(displayRowsNewestFirst.length / FINANCE_PAGE_SIZE));
    if (state.ui.financePage >= totalPages) state.ui.financePage = totalPages - 1;
    // If navigating to a specific entry, jump to its page
    const pendingHighlight = state.ui.financeHighlightEntryId || null;
    if (pendingHighlight) {
      const highlightIdx = displayRowsNewestFirst.findIndex((r) => r.id === pendingHighlight);
      if (highlightIdx >= 0) state.ui.financePage = Math.floor(highlightIdx / FINANCE_PAGE_SIZE);
    }
    const pageStart = state.ui.financePage * FINANCE_PAGE_SIZE;
    const displayRunningRows = displayRowsNewestFirst.slice(pageStart, pageStart + FINANCE_PAGE_SIZE);

    // Order options for linking
    const orderOptions = (state.orders || [])
      .slice()
      .sort((a, b) => String(a.orderNumber || '').localeCompare(String(b.orderNumber || ''), 'es', { numeric: true }))
      .map((o) => `<option value="${sanitize(o.id)}" data-ref="${sanitize(o.orderNumber || '')}" ${o.id === draft.orderId ? 'selected' : ''}>${sanitize(o.orderNumber || '')} · ${sanitize(o.orderTitle || '')}</option>`)
      .join('');

    // OT info preview for pre-selected OT in form
    const selectedDraftOrder = draft.orderId ? (state.orders || []).find((o) => o.id === draft.orderId) : null;
    let draftOtInfoHtml = '';
    let draftTitleActionsHtml = '';
    if (selectedDraftOrder) {
      const qs = selectedDraftOrder.quoteSummary || {};
      const otTotalPrice = Number(qs.effectiveGross || 0);
      const otAbonoPrice = Math.round(otTotalPrice * 0.5);
      const hasDraftInvoice = Boolean(getPrimaryAttachment(selectedDraftOrder, legacyOrderInvoiceAttachment));
      const draftInvoiceStatus = hasDraftInvoice
        ? `<span style="color:#16a34a;font-size:11px;font-weight:600;">✓ Boleta/factura adjunta</span>`
        : `<span style="color:#dc2626;font-size:11px;font-weight:600;">⚠ ¡Sin boleta/factura adjunta!</span>`;
      draftOtInfoHtml = `<span style="font-size:11px;color:var(--muted);">Total: <strong style="color:var(--brand)">${formatCurrency(otTotalPrice)}</strong> &nbsp;·&nbsp; Abono 50%: <strong style="color:var(--brand)">${formatCurrency(otAbonoPrice)}</strong></span> &nbsp;·&nbsp; ${draftInvoiceStatus}`;
      if (draft.category === 'Ventas') {
        const hasDraftAbono = String(draft.title).toLowerCase().includes('abono');
        draftTitleActionsHtml = `<button type="button" class="btn btn-soft btn-xs" data-action="toggle-finance-abono">${hasDraftAbono ? '− Quitar "Abono"' : '+ Agregar "Abono"'}</button>`;
      } else if (draft.category === 'Sueldo') {
        const hasDraftSueldo = String(draft.title).toLowerCase().includes('sueldo');
        draftTitleActionsHtml = `<button type="button" class="btn btn-soft btn-xs" data-action="toggle-finance-sueldo">${hasDraftSueldo ? '− Quitar "Sueldo"' : '+ Agregar "Sueldo"'}</button>`;
      }
    }

    // Initial context zone HTML based on draft category
    let draftContextZoneHtml = '';
    if (draft.category === 'Ventas') {
      draftContextZoneHtml = `<div class="fin-context-field">
        <div>
          <label>OT asociada</label>
          <select id="fin-order"><option value="">Sin OT</option>${orderOptions}</select>
        </div>
        <div id="fin-ot-info">${draftOtInfoHtml}</div>
      </div>`;
    } else if (draft.category === 'Materiales') {
      const matGroups = [...new Set((state.database?.materials || []).map((m) => m.group).filter(Boolean))].sort();
      const matGroupOptions = matGroups.map((g) => `<option value="${sanitize(g)}">${sanitize(g)}</option>`).join('');
      const firstGroup = matGroups[0] || '';
      const matItems = (state.database?.materials || []).filter((m) => !firstGroup || m.group === firstGroup);
      const matItemOptions = matItems.map((m) => `<option value="${sanitize(m.name)}" data-id="${sanitize(m.id)}" data-cost="${Number(m.baseCost ?? m.unitCost ?? 0) || 0}">${sanitize(m.name)}</option>`).join('');
      draftContextZoneHtml = `<div class="fin-context-field">
        <div>
          <label>Grupo</label>
          <select id="fin-mat-group"><option value="">Sin definir</option>${matGroupOptions}</select>
        </div>
        <div>
          <label>Insumo</label>
          <select id="fin-mat-item"><option value="">— elige insumo —</option>${matItemOptions}</select>
        </div>
        <div id="fin-mat-cost-hint" style="align-self:flex-end;font-size:11px;color:var(--muted);"></div>
      </div>`;
    } else if (draft.category === 'Gastos Administrativos') {
      const gastoTypeOpts = expenseTypeOptions.map((t) =>
        `<option value="${sanitize(t.value)}" ${draft.gastoType === t.value ? 'selected' : ''}>${sanitize(t.value)}</option>`
      ).join('');
      const filteredCards = draft.gastoType
        ? (state.expenses?.cards || []).filter((c) => c.expenseType === draft.gastoType)
        : (state.expenses?.cards || []);
      const gastoCardOpts = filteredCards.map((c) =>
        `<option value="${sanitize(c.id)}" ${draft.expenseCardId === c.id ? 'selected' : ''}>${sanitize(c.name)} · ${sanitize(String(c.baseYear || ''))}</option>`
      ).join('');
      draftContextZoneHtml = `<div class="fin-context-field">
        <div>
          <label>Tipo de gasto</label>
          <select id="fin-gasto-type">
            <option value="" ${!draft.gastoType ? 'selected' : ''}>Sin tipo</option>
            ${gastoTypeOpts}
          </select>
        </div>
        <div>
          <label>Card de gasto</label>
          <select id="fin-gasto-card">
            <option value="">Sin asignar</option>
            ${gastoCardOpts}
          </select>
        </div>
      </div>`;
    } else if (draft.category === 'Salida General') {
      const quickTypes = getFinanceQuickOutflowTypes();
      const quickTypeOpts = quickTypes
        .map((type) => `<option value="${sanitize(type)}" ${draft.gastoType === type ? 'selected' : ''}>${sanitize(type)}</option>`)
        .join('');
      draftContextZoneHtml = `<div class="fin-context-field">
        <div>
          <label>Tipo guardado</label>
          <select id="fin-salida-general-type-select">
            <option value="">Seleccionar tipo guardado</option>
            ${quickTypeOpts}
          </select>
        </div>
        <div>
          <label>Tipo (manual)</label>
          <input type="text" id="fin-salida-general-type-input" maxlength="80" value="${sanitize(draft.gastoType || '')}" placeholder="Ej: Bencina, peaje, retiro, caja chica" />
        </div>
      </div>`;
    } else if (draft.category === 'Sueldo') {
      const sueldoOrderOpts = (state.orders || [])
        .slice()
        .sort((a, b) => String(a.orderNumber || '').localeCompare(String(b.orderNumber || ''), 'es', { numeric: true }))
        .map((o) => `<option value="${sanitize(o.id)}" data-ref="${sanitize(o.orderNumber || '')}" data-title="${sanitize(o.orderTitle || '')}" ${o.id === draft.orderId ? 'selected' : ''}>${sanitize(o.orderNumber || '')} · ${sanitize(o.orderTitle || '')}</option>`)
        .join('');
      const sueldoEmpOpts = (state.scenario?.employees || [])
        .map((e) => `<option value="${sanitize(e.id)}" ${e.id === draft.employeeId ? 'selected' : ''}>${sanitize(e.name)}</option>`)
        .join('');
      // Compute salary info for preselected OT + employee
      let sueldoInfoHtml = '';
      if (draft.orderId) {
        const sueldoOrder = (state.orders || []).find((o) => o.id === draft.orderId);
        if (sueldoOrder) {
          const sqs = sueldoOrder.quoteSummary || {};
          const laborTotal = Number(sqs.laborTotal || 0);
          const laborLines = Array.isArray(sqs.laborLines) ? sqs.laborLines : [];
          const empLines = draft.employeeId ? laborLines.filter((l) => l.employeeId === draft.employeeId) : [];
          const empTotal = empLines.reduce((s, l) => s + Number(l.lineTotal || 0), 0);
          const empHours = empLines.reduce((s, l) => s + Number(l.hours || 0), 0);
          sueldoInfoHtml = `<span style="font-size:11px;color:var(--muted);">Costo M.O. OT: <strong style="color:var(--brand);">${formatCurrency(laborTotal)}</strong>`;
          if (draft.employeeId && empLines.length > 0) {
            sueldoInfoHtml += ` &nbsp;·&nbsp; Empleado: <strong style="color:var(--brand);">${formatCurrency(empTotal)}</strong> (${empHours.toLocaleString('es-CL', { maximumFractionDigits: 2 })} h)`;
          }
          sueldoInfoHtml += '</span>';
        }
      }
      draftContextZoneHtml = `<div class="fin-context-field">
        <div>
          <label>OT asociada</label>
          <select id="fin-sueldo-ot">
            <option value="">Sin OT</option>
            ${sueldoOrderOpts}
          </select>
        </div>
        <div>
          <label>Empleado</label>
          <select id="fin-sueldo-employee">
            <option value="">Sin asignar</option>
            ${sueldoEmpOpts}
          </select>
        </div>
        <div id="fin-sueldo-info" style="align-self:flex-end;">${sueldoInfoHtml}</div>
      </div>`;
    } else if (draft.category === 'Herramientas') {
      const draftAttachment = getPrimaryAttachment(draft, legacyFinanceAttachment);
      const draftHasPdf = Boolean(draftAttachment);
      draftContextZoneHtml = `<div class="fin-context-field">
        <div style="align-self:flex-end;">
          <label>Documento de compra (PDF)</label>
          <div style="display:flex;align-items:center;gap:8px;margin-top:4px;">
            <input type="file" id="fin-herramienta-pdf" accept="application/pdf" style="display:none;" />
            <button type="button" class="btn btn-soft btn-xs" data-action="pick-herramienta-pdf">${draftHasPdf ? '✓ Cambiar PDF' : '+ Subir boleta/factura'}</button>
            ${draftHasPdf ? `<button type="button" class="btn btn-soft btn-xs" data-action="view-herramienta-pdf" title="Ver PDF">Ver</button>
            <button type="button" class="btn btn-soft btn-xs" data-action="download-herramienta-pdf" title="Descargar">Descargar</button>
            <button type="button" class="btn btn-soft btn-xs danger" data-action="clear-herramienta-pdf" title="Quitar PDF">✕</button>` : ''}
          </div>
          ${draftHasPdf ? `<div style="font-size:11px;color:var(--muted);margin-top:4px;">${sanitize(draftAttachment?.fileName || 'documento.pdf')} · ${Number(draftAttachment?.sizeKb || 0)} KB</div>` : ''}
        </div>
      </div>`;
    } else if (draft.category === 'Ingreso de Capital') {
      draftContextZoneHtml = '';
    } else if (draft.category === 'Ahorros (DAP)') {
      draftContextZoneHtml = `<div class="fin-context-field">
        <div>
          <label>Fecha de término del depósito</label>
          <input type="date" id="fin-savings-end-date" value="${sanitize(draft.savingsEndDate || '')}" />
        </div>
      </div>`;
    }

    // Category filter options removed (no filter bar)

    // Category options for form
    const catFormOptions = financeCategories
      .map((c) => `<option value="${sanitize(c)}" ${c === draft.category ? 'selected' : ''}>${sanitize(c)}</option>`)
      .join('');

    // Period totals (all entries)
    const displayMonthSummary = getFinanceMonthSummary(allEntries, '');

    // Page subtotals (only visible rows)
    const pageSubtotalIncome  = displayRunningRows.reduce((s, r) => s + (Number(r.income)  || 0), 0);
    const pageSubtotalExpense = displayRunningRows.reduce((s, r) => s + (Number(r.expense) || 0), 0);

    // Margen operativo mes actual
    const currentMonthEntries = allEntries.filter((e) => String(e.date || '').startsWith(currentMonth));
    const ventasMes     = currentMonthEntries.filter((e) => e.category === 'Ventas').reduce((s, e) => s + (Number(e.income) || 0), 0);
    const egresoOpMes   = currentMonthEntries.filter((e) => ['Materiales', 'Gastos Administrativos', 'Salida General', 'Herramientas'].includes(e.category)).reduce((s, e) => s + (Number(e.expense) || 0), 0);
    const sueldosMes    = currentMonthEntries.filter((e) => e.category === 'Sueldo').reduce((s, e) => s + (Number(e.expense) || 0), 0);
    const margenOpMes   = ventasMes - egresoOpMes;

    // Monthly synthesis rows (latest months first)
    const monthlySynthesis = getAvailableFinanceMonths(allEntries)
      .slice(0, 12)
      .map((monthKey) => {
        const monthEntries = allEntries.filter((e) => String(e.date || '').startsWith(monthKey));
        const monthSummary = getFinanceMonthSummary(monthEntries, '');
        const monthVentas = monthEntries
          .filter((e) => e.category === 'Ventas')
          .reduce((s, e) => s + (Number(e.income) || 0), 0);
        const monthEgresoOperativo = monthEntries
          .filter((e) => ['Materiales', 'Gastos Administrativos', 'Salida General', 'Herramientas'].includes(e.category))
          .reduce((s, e) => s + (Number(e.expense) || 0), 0);
        const monthSueldos = monthEntries
          .filter((e) => e.category === 'Sueldo')
          .reduce((s, e) => s + (Number(e.expense) || 0), 0);
        return {
          monthKey,
          monthLabel: formatMonthLabel(monthKey),
          saldoMes: monthSummary.totalIncome - monthSummary.totalExpense,
          ingresosMes: monthSummary.totalIncome,
          egresosMes: monthSummary.totalExpense,
          ivaMes: ivaLedger.byMonth[monthKey]?.ivaToPay || 0,
          margenMes: monthVentas - monthEgresoOperativo,
          sueldosMes: monthSueldos
        };
      });

    // Ledger rows — with month separator tracking
    const financeEditingEntryId = state.ui.financeEditingEntryId || null;
    const financeHighlightEntryId = state.ui.financeHighlightEntryId || null;
    // Clear highlight after one render so it doesn't persist
    if (financeHighlightEntryId) state.ui.financeHighlightEntryId = null;
    let prevRowMonth = null;
    const ledgerRows = displayRunningRows.map((row, rowIndex) => {
      const isIncome = Number(row.income) > 0;
      const isSavings = row.category === 'Ahorros (DAP)';
      const isHighlighted = row.id === financeHighlightEntryId;
      const rowClass = isIncome ? 'finance-row-income' : (isSavings && Number(row.expense) > 0 ? 'finance-row-savings' : (Number(row.expense) > 0 ? 'finance-row-expense' : ''));
      const balanceNeg = row.runningBalance < 0;
      const rowMonth = String(row.date || '').slice(0, 7);
      const isMonthStart = rowIndex > 0 && rowMonth !== prevRowMonth;
      prevRowMonth = rowMonth;
      const monthStartClass = isMonthStart ? ' finance-row-month-start' : '';

      // IVA amount for this row
      const rowAmount = Number(row.income) > 0 ? Number(row.income) : Number(row.expense) || 0;
      const ivaAmount = row.ivaIncluded && rowAmount > 0 ? Math.round(rowAmount * 0.19 / 1.19) : 0;

      const otForRow = row.orderId ? (state.orders || []).find((o) => o.id === row.orderId) : null;
      const otInvoiceAttachment = getPrimaryAttachment(otForRow, legacyOrderInvoiceAttachment);
      const invoiceIcon = otForRow
        ? (otInvoiceAttachment
          ? `<span title="Boleta/factura adjunta" style="color:#16a34a;font-size:14px;">✓</span>`
          : `<span title="¡Sin boleta/factura adjunta!" style="color:#dc2626;font-size:14px;">⚠</span>`)
        : '';
      // PDF icon for Herramientas row
      const rowAttachment = getPrimaryAttachment(row, legacyFinanceAttachment);
      const rowHasPdf = row.category === 'Herramientas' && Boolean(rowAttachment);
      const pdfDocIcon = row.category === 'Herramientas'
        ? (rowHasPdf
          ? `<span title="PDF adjunto" style="color:#16a34a;font-size:14px;cursor:pointer;" data-action="view-herramienta-entry-pdf" data-id="${sanitize(row.id)}">▤</span>`
          : `<span title="Sin documento adjunto" style="color:#dc2626;font-size:14px;">⚠</span>`)
        : invoiceIcon;

      // Tipo column: for Gastos Administrativos/Salida General show gastoType, for Herramientas show doc type, for Ahorros show end date, for others show orderRef
      let tipoCell;
      if (row.category === 'Gastos Administrativos' || row.category === 'Salida General') {
        const tipoColor = row.category === 'Salida General' ? '#b45309' : getExpenseTypeColor(row.gastoType);
        tipoCell = row.gastoType
          ? `<span style="color:${tipoColor};">${sanitize(row.gastoType)}</span>`
          : '<span style="color:var(--muted);">-</span>';
      } else if (row.category === 'Herramientas') {
        tipoCell = row.ivaIncluded
          ? `<span style="color:#7c3aed;font-size:10px;">Factura</span>`
          : `<span style="color:#6b7280;font-size:10px;">Boleta</span>`;
      } else if (row.category === 'Ahorros (DAP)') {
        tipoCell = row.savingsEndDate
          ? `<span style="font-size:10px;color:var(--muted);">Término: ${sanitize(row.savingsEndDate)}</span>`
          : '<span style="color:var(--muted);">-</span>';
      } else {
        tipoCell = sanitize(row.orderRef || '-');
      }

      const rowDateLabel = formatFinanceDate(row.date);

      return `
        <tr id="fin-entry-${sanitize(row.id)}" class="${rowClass}${monthStartClass}${isHighlighted ? ' finance-row-highlight' : ''}">
          <td><span class="small">${sanitize(rowDateLabel)}</span></td>
          <td><span class="pill ${row.category === 'Ventas' ? 'ok' : 'info'}" style="font-size:10px;padding:2px 7px;">${sanitize(row.category)}</span></td>
          <td><span class="small">${tipoCell}</span></td>
          <td style="text-align:center;">${pdfDocIcon}</td>
          <td><strong>${sanitize(row.title)}</strong>${row.detail ? `<br><span class="small" style="color:var(--muted);">${sanitize(row.detail)}</span>` : ''}${rowHasPdf ? `<br><span class="small" style="color:var(--muted);cursor:pointer;" data-action="view-herramienta-entry-pdf" data-id="${sanitize(row.id)}">${sanitize(rowAttachment?.fileName || 'doc.pdf')}</span>` : ''}</td>
          <td class="finance-income-cell">${Number(row.income) > 0 ? formatCurrency(row.income) : ''}</td>
          <td class="finance-expense-cell">${Number(row.expense) > 0 ? formatCurrency(row.expense) : ''}</td>
          <td class="finance-balance-cell ${balanceNeg ? 'negative' : ''}">${formatCurrency(row.runningBalance)}</td>
          <td><span class="small" style="color:${ivaAmount > 0 ? 'var(--muted)' : 'transparent'};">${ivaAmount > 0 ? formatCurrency(ivaAmount) : '-'}</span></td>
          <td>
            <div class="button-group compact-actions">
              ${rowHasPdf ? `<button class="btn btn-soft btn-icon" data-action="view-herramienta-entry-pdf" data-id="${sanitize(row.id)}" title="Ver PDF" aria-label="Ver PDF">▤</button>` : ''}
              <button class="btn btn-soft btn-icon ${financeEditingEntryId === row.id ? 'btn-active' : ''}" data-action="edit-finance-entry" data-id="${sanitize(row.id)}" title="Editar" aria-label="Editar">${iconSvg('edit')}</button>
              <button class="btn btn-soft btn-icon" data-action="delete-finance-entry" data-id="${sanitize(row.id)}" title="Eliminar" aria-label="Eliminar">${iconSvg('trash')}</button>
            </div>
          </td>
        </tr>
      `;
    }).join('');

    // Category totals (all entries)
    const categoryTotals = getFinanceCategoryTotals(allEntries, '');

    const totalCards = categoryTotals.map((ct) => {
      let subDetail = '';
      if (ct.category === 'Gastos Administrativos') {
        const gastoEntries = allEntries.filter((e) => e.category === 'Gastos Administrativos');
        const typeMap = {};
        gastoEntries.forEach((e) => {
          // Use gastoType directly — not orderRef — to avoid stale/missing links
          const t = e.gastoType && e.gastoType.trim() ? e.gastoType : null;
          if (!t) return; // skip entries with no gastoType (don't pollute totals)
          if (!typeMap[t]) typeMap[t] = { expense: 0 };
          typeMap[t].expense += Number(e.expense) || 0;
        });
        subDetail = Object.entries(typeMap)
          .sort((a, b) => b[1].expense - a[1].expense)
          .map(([type, vals]) => `<div class="cat-row" style="font-size:11px;padding-left:10px;"><span style="color:${getExpenseTypeColor(type)};">↳ ${sanitize(type)}</span><span class="finance-expense-cell">${formatCurrency(vals.expense)}</span></div>`)
          .join('');
      } else if (ct.category === 'Salida General') {
        const generalEntries = allEntries.filter((e) => e.category === 'Salida General');
        const typeMap = {};
        generalEntries.forEach((e) => {
          const t = e.gastoType && e.gastoType.trim() ? e.gastoType : null;
          if (!t) return;
          if (!typeMap[t]) typeMap[t] = { expense: 0 };
          typeMap[t].expense += Number(e.expense) || 0;
        });
        subDetail = Object.entries(typeMap)
          .sort((a, b) => b[1].expense - a[1].expense)
          .map(([type, vals]) => `<div class="cat-row" style="font-size:11px;padding-left:10px;"><span style="color:#b45309;">↳ ${sanitize(type)}</span><span class="finance-expense-cell">${formatCurrency(vals.expense)}</span></div>`)
          .join('');
      } else if (ct.category === 'Materiales') {
        const matEntries = allEntries.filter((e) => e.category === 'Materiales');
        const groupMap = {};
        matEntries.forEach((e) => {
          // orderRef stores the material group for Materiales entries
          const g = e.orderRef && e.orderRef.trim() ? e.orderRef : null;
          if (!g) return;
          if (!groupMap[g]) groupMap[g] = { expense: 0 };
          groupMap[g].expense += Number(e.expense) || 0;
        });
        subDetail = Object.entries(groupMap)
          .sort((a, b) => b[1].expense - a[1].expense)
          .map(([group, vals]) => `<div class="cat-row" style="font-size:11px;padding-left:10px;"><span style="color:var(--brand);">↳ ${sanitize(group)}</span><span class="finance-expense-cell">${formatCurrency(vals.expense)}</span></div>`)
          .join('');
      } else if (ct.category === 'Sueldo') {
        const sueldoEntries = allEntries.filter((e) => e.category === 'Sueldo');
        const empMap = {};
        sueldoEntries.forEach((e) => {
          // Use employeeRef (name) if present, otherwise skip — don't show IDs or placeholders
          const key = e.employeeRef && e.employeeRef.trim() ? e.employeeRef : null;
          if (!key) return;
          if (!empMap[key]) empMap[key] = { expense: 0, count: 0 };
          empMap[key].expense += Number(e.expense) || 0;
          empMap[key].count += 1;
        });
        const totalSueldoPaid = sueldoEntries.reduce((s, e) => s + Number(e.expense || 0), 0);
        subDetail = `<div class="cat-row" style="font-size:11px;border-top:1px solid var(--line);margin-top:4px;padding-top:4px;"><span style="font-weight:700;">Total pagado</span><span class="finance-expense-cell" style="font-weight:700;">${formatCurrency(totalSueldoPaid)}</span></div>` +
          Object.entries(empMap)
            .sort((a, b) => b[1].expense - a[1].expense)
            .map(([emp, vals]) => `<div class="cat-row" style="font-size:11px;padding-left:10px;"><span style="color:var(--brand);">↳ ${sanitize(emp)}</span><span class="finance-expense-cell">${formatCurrency(vals.expense)} <span style="color:var(--muted);">(${vals.count} pago${vals.count !== 1 ? 's' : ''})</span></span></div>`)
            .join('');
      } else if (ct.category === 'Herramientas') {
        const herramientaEntries = allEntries.filter((e) => e.category === 'Herramientas');
        const conFactura = herramientaEntries.filter((e) => e.ivaIncluded);
        const conBoleta  = herramientaEntries.filter((e) => !e.ivaIncluded);
        const conDoc = herramientaEntries.filter((e) => Boolean(getPrimaryAttachment(e, legacyFinanceAttachment)));
        subDetail = `<div class="cat-row" style="font-size:11px;padding-left:10px;"><span style="color:#7c3aed;">↳ Con factura</span><span class="finance-expense-cell">${formatCurrency(conFactura.reduce((s,e) => s+Number(e.expense||0),0))}</span></div>` +
          `<div class="cat-row" style="font-size:11px;padding-left:10px;"><span style="color:#6b7280;">↳ Con boleta</span><span class="finance-expense-cell">${formatCurrency(conBoleta.reduce((s,e) => s+Number(e.expense||0),0))}</span></div>` +
          `<div class="cat-row" style="font-size:11px;padding-left:10px;color:var(--muted);">▤ Con documento adjunto: ${conDoc.length} de ${herramientaEntries.length}</div>`;
      } else if (ct.category === 'Ingreso de Capital') {
        const capEntries = allEntries.filter((e) => e.category === 'Ingreso de Capital');
        subDetail = `<div class="cat-row" style="font-size:11px;padding-left:10px;color:var(--muted);">${capEntries.length} inyecci${capEntries.length !== 1 ? 'ones' : 'ón'} de capital</div>`;
      } else if (ct.category === 'Ahorros (DAP)') {
        const dapEntries = allEntries.filter((e) => e.category === 'Ahorros (DAP)');
        const active = dapEntries.filter((e) => e.savingsEndDate && e.savingsEndDate >= new Date().toISOString().slice(0,10));
        subDetail = `<div class="cat-row" style="font-size:11px;padding-left:10px;color:var(--muted);">${dapEntries.length} depósito${dapEntries.length !== 1 ? 's' : ''} · ${active.length} vigente${active.length !== 1 ? 's' : ''}</div>`;
      }
      return `
      <div class="finance-totals-card">
        <div class="cat-label">${sanitize(ct.category)}</div>
        ${ct.income > 0 ? `<div class="cat-row"><span>Ingresos</span><span class="finance-income-cell">${formatCurrency(ct.income)}</span></div>` : ''}
        ${ct.expense > 0 ? `<div class="cat-row"><span>Egresos</span><span class="finance-expense-cell">${formatCurrency(ct.expense)}</span></div>` : ''}
        ${subDetail}
        <div class="cat-net"><span>Neto</span><span class="${ct.net >= 0 ? 'finance-income-cell' : 'finance-expense-cell'}">${formatCurrency(ct.net)}</span></div>
      </div>
    `;
    }).join('');

    // F29 section (all entries)
    const f29Source = allEntries;
    const f29Summary = getFinanceMonthSummary(f29Source, '');

    // Month options for filter dropdown removed

    return `
      <div class="card">
        <div class="section-title">
          <div>
            <h2>Módulo 9 · Finanzas</h2>
            <p class="subtitle">Registro de movimientos, flujo de caja y cálculo de IVA para F29.</p>
          </div>
        </div>

        <!-- Saldo inicial -->
        ${(() => {
          const locked = !!state.finance.initialBalanceLocked;
          return `<div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;flex-wrap:wrap;padding:10px 14px;background:var(--panel-soft);border:1px solid var(--line);border-radius:8px;">
            <label style="font-size:12px;font-weight:600;color:var(--muted);">Saldo inicial de cuenta</label>
            <input type="text" data-format="clp" id="finance-initial-balance" style="width:160px;${locked ? 'opacity:0.6;' : ''}" value="${formatNumber(state.finance.initialBalance || 0)}" min="0" step="1" ${locked ? 'disabled' : ''} />
            ${locked
              ? `<button class="btn btn-soft" data-action="toggle-finance-balance-lock" title="Desbloquear para editar" style="display:flex;align-items:center;gap:5px;">■ Desbloquear</button>`
              : `<button class="btn btn-soft" data-action="save-finance-initial-balance">Guardar y bloquear</button>`
            }
            <span class="help" style="margin:0;">El saldo inicial más todos los movimientos define el saldo actual.
              ${locked ? '<span style="color:#16a34a;font-weight:600;"> ✓ Bloqueado</span>' : '<span style="color:#d97706;"> (sin bloquear)</span>'}
            </span>
          </div>`;
        })()}

        <!-- Crédito fiscal de IVA inicial (previo a usar la app) -->
        ${(() => {
          const locked = !!state.finance.ivaCreditBalanceLocked;
          return `<div style="display:flex;align-items:center;gap:10px;margin-bottom:16px;flex-wrap:wrap;padding:10px 14px;background:var(--panel-soft);border:1px solid var(--line);border-radius:8px;">
            <label class="label-with-tip" style="font-size:12px;font-weight:600;color:var(--muted);">
              <span>Crédito fiscal IVA inicial (antes de usar la app)</span>
              ${renderInfoTip('AndiApp no está conectada al SII, así que no conoce el crédito fiscal que ya tenías acumulado antes de empezar a registrar movimientos aquí (por ejemplo, IVA de una construcción o compra grande previa). Ingresa aquí ese saldo una sola vez -revísalo en tu Carpeta Tributaria de sii.cl o con tu contador- y la app lo va descontando automáticamente mes a mes contra tu IVA débito, junto con el crédito que sí registres en Finanzas.')}
            </label>
            <input type="text" data-format="clp" id="finance-iva-credit-balance" style="width:160px;${locked ? 'opacity:0.6;' : ''}" value="${formatNumber(state.finance.ivaCreditBalance || 0)}" min="0" step="1" ${locked ? 'disabled' : ''} />
            ${locked
              ? `<button class="btn btn-soft" data-action="toggle-finance-iva-credit-lock" title="Desbloquear para editar" style="display:flex;align-items:center;gap:5px;">■ Desbloquear</button>`
              : `<button class="btn btn-soft" data-action="save-finance-iva-credit-balance">Guardar y bloquear</button>`
            }
            <span class="help" style="margin:0;">Remanente de crédito fiscal disponible hoy: <strong>${formatCurrency(ivaLedger.currentRemanente)}</strong>.
              ${locked ? '<span style="color:#16a34a;font-weight:600;"> ✓ Bloqueado</span>' : '<span style="color:#d97706;"> (sin bloquear)</span>'}
            </span>
          </div>`;
        })()}

        <!-- New Entry Form -->
        <div class="finance-entry-form">
          <div class="form-title">${state.ui.financeEditingEntryId ? 'Editar movimiento' : 'Nuevo movimiento'}</div>
          ${state.ui.financeEditingEntryId ? `<div style="background:#fef9c3;border:1px solid #fde047;border-radius:6px;padding:7px 12px;font-size:12px;color:#854d0e;margin-bottom:8px;">Editando: <strong>${sanitize(draft.title || draft.date)}</strong></div>` : ''}
          <!-- 1. Selects: fecha + categoría -->
          <div class="finance-entry-grid">
            <div>
              <label>Fecha</label>
              <input type="date" id="fin-date" value="${sanitize(draft.date)}" />
            </div>
            <div>
              <label>Categoría</label>
              <select id="fin-category">${catFormOptions}</select>
            </div>
          </div>
          <!-- 2. Zona contextual compacta (OT o grupo/insumo según categoría) -->
          <div id="fin-context-zone">${draftContextZoneHtml}</div>
          <!-- 3. Montos -->
          <div class="fin-amounts-row">
            <div>
              <label>Ingreso ($)</label>
              <input type="text" data-format="clp" id="fin-income" min="0" step="1" value="${formatNumber(Number(draft.income) || 0)}" placeholder="0" ${(draft.category === 'Materiales' || draft.category === 'Gastos Administrativos' || draft.category === 'Salida General' || draft.category === 'Sueldo' || draft.category === 'Herramientas' || draft.category === 'Ahorros (DAP)') ? 'disabled' : ''} />
            </div>
            <div>
              <label>Egreso ($)</label>
              <input type="text" data-format="clp" id="fin-expense" min="0" step="1" value="${formatNumber(Number(draft.expense) || 0)}" placeholder="0" ${(draft.category === 'Ventas' || draft.category === 'Ingreso de Capital') ? 'disabled' : ''} />
            </div>
          </div>
          <!-- 4. Campos de texto -->
          <div class="finance-entry-grid-wide">
            <div>
              <label>Título</label>
              <input type="text" id="fin-title" maxlength="120" value="${sanitize(draft.title)}" placeholder="Nombre o descripción corta del movimiento" />
              <div id="fin-title-actions" style="margin-top:5px;min-height:0;">${draftTitleActionsHtml}</div>
            </div>
            <div>
              <label>Detalle</label>
              <input type="text" id="fin-detail" maxlength="250" value="${sanitize(draft.detail)}" placeholder="Información adicional (opcional)" />
            </div>
          </div>
          ${!['Sueldo', 'Ahorros (DAP)', 'Ingreso de Capital'].includes(draft.category) ? `
          <div class="fin-iva-row">
            <div class="fin-iva-toggle-area">
              <label class="fin-iva-toggle" for="fin-iva-included">
                <input type="checkbox" id="fin-iva-included" ${draft.ivaIncluded ? 'checked' : ''} />
                <span class="fin-iva-slider"></span>
              </label>
              <span class="fin-iva-label">
                ${ draft.category === 'Ventas'
                  ? 'Venta con IVA incluido (boleta o factura)'
                  : ['Materiales','Gastos Administrativos','Salida General'].includes(draft.category)
                  ? 'Compra con <strong>factura</strong> &mdash; genera cr&eacute;dito fiscal IVA'
                  : draft.category === 'Herramientas'
                  ? 'Pagado con <strong>factura</strong> &mdash; cr&eacute;dito fiscal IVA'
                  : 'Monto incluye IVA' }
              </span>
            </div>
            <details class="fin-iva-help">
              <summary>&quest;&nbsp;Cu&aacute;ndo marcarlo</summary>
              <div class="fin-iva-help-body">
                <p><strong>M&aacute;rcalo cuando el monto ya incluye el 19% de IVA</strong>, es decir, es el valor que aparece en la boleta o factura.</p>
                <table class="fin-iva-table">
                  <tr><td>&#x2705;</td><td><strong>Venta con boleta</strong> (t&uacute; vendes)</td><td>S&iacute;, incluye IVA</td></tr>
                  <tr><td>&#x2705;</td><td><strong>Venta con factura</strong> (t&uacute; vendes)</td><td>S&iacute;, incluye IVA</td></tr>
                  <tr><td>&#x2705;</td><td><strong>Compra con factura</strong> de proveedor</td><td>S&iacute; &mdash; ese IVA lo puedes descontar (cr&eacute;dito fiscal)</td></tr>
                  <tr><td>&#x274C;</td><td><strong>Compra con boleta</strong> de consumidor</td><td>No &mdash; la boleta no da cr&eacute;dito fiscal</td></tr>
                  <tr><td>&#x274C;</td><td>Compras personales sin factura</td><td>No &mdash; son gastos sin cr&eacute;dito</td></tr>
                </table>
                <p style="margin-top:6px;"><em>IVA a declarar = IVA de tus ventas &minus; IVA de tus compras con factura.</em></p>
              </div>
            </details>
          </div>` : ''}
          <div class="finance-entry-actions">
            <button class="btn btn-primary" data-action="add-finance-entry">${state.ui.financeEditingEntryId ? 'Guardar cambios' : 'Registrar movimiento'}</button>
            <button class="btn btn-soft" data-action="clear-finance-form">${state.ui.financeEditingEntryId ? 'Cancelar edición' : 'Limpiar'}</button>
          </div>
        </div>

        <!-- Ledger Table -->
        <div class="table-wrap table-compact finance-ledger-wrap">
          <table>
            <thead>
              <tr class="finance-ledger-columns-row">
                <th>Fecha</th>
                <th>Categoría</th>
                <th title="OT asociada / Tipo de gasto">Tipo</th>
                <th style="text-align:center;width:42px;" title="Boleta/Factura">Doc.</th>
                <th>Título / Detalle</th>
                <th>Ingreso</th>
                <th>Egreso</th>
                <th>Saldo banco</th>
                <th>IVA</th>
                <th>Acciones</th>
              </tr>
              ${displayRunningRows.length > 0 ? `
              <tr class="finance-sticky-total-row">
                <th colspan="5"><span class="finance-total-label">Totales globales</span></th>
                <th class="finance-income-cell"><strong>${formatCurrency(displayMonthSummary.totalIncome)}</strong></th>
                <th class="finance-expense-cell"><strong>${formatCurrency(displayMonthSummary.totalExpense)}</strong></th>
                <th class="finance-balance-cell ${currentBalance < 0 ? 'negative' : ''}"><strong>${formatCurrency(currentBalance)}</strong></th>
                <th></th>
                <th></th>
              </tr>` : ''}
            </thead>
            <tbody>
              ${displayRunningRows.length === 0
    ? `<tr><td colspan="10" style="text-align:center;color:var(--muted);padding:24px;">Sin movimientos registrados. Agrega el primero arriba.</td></tr>`
    : ledgerRows}
            </tbody>
            ${displayRunningRows.length > 0 && totalPages > 1 ? `
            <tfoot class="table-total">
              <tr style="font-size:12px;opacity:0.8;">
                <td colspan="5" style="font-size:12px;">Subtotal página ${state.ui.financePage + 1} / ${totalPages}</td>
                <td class="finance-income-cell">${formatCurrency(pageSubtotalIncome)}</td>
                <td class="finance-expense-cell">${formatCurrency(pageSubtotalExpense)}</td>
                <td></td><td colspan="2"></td>
              </tr>
            </tfoot>` : ''}
          </table>
        </div>

        <!-- Indicadores globales -->
        <details class="finance-section-details" open>
          <summary>Indicadores globales <span style="font-weight:400;font-size:11px;margin-left:6px;">mes actual · histórico</span></summary>
          <div class="finance-section-body">
            <div class="finance-kpi-strip" style="margin-top:0;">
              <div class="finance-kpi kpi-neutral">
                <label>Saldo actual (total)</label>
                <strong>${formatCurrency(currentBalance)}</strong>
                <span class="finance-kpi-sub">Histórico acumulado</span>
              </div>
              <div class="finance-kpi ${(monthSummaryCurrentMonth.totalIncome - monthSummaryCurrentMonth.totalExpense) >= 0 ? 'kpi-positive' : 'kpi-negative'}">
                <label>Saldo del mes</label>
                <strong>${formatCurrency(monthSummaryCurrentMonth.totalIncome - monthSummaryCurrentMonth.totalExpense)}</strong>
                <span class="finance-kpi-sub">${formatMonthLabel(currentMonth)}</span>
              </div>
              <div class="finance-kpi ${monthSummaryCurrentMonth.totalIncome > 0 ? 'kpi-positive' : ''}">
                <label>Ingresos (mes actual)</label>
                <strong>${formatCurrency(monthSummaryCurrentMonth.totalIncome)}</strong>
                <span class="finance-kpi-sub">${formatMonthLabel(currentMonth)}</span>
              </div>
              <div class="finance-kpi ${monthSummaryCurrentMonth.totalExpense > 0 ? 'kpi-negative' : ''}">
                <label>Egresos (mes actual)</label>
                <strong>${formatCurrency(monthSummaryCurrentMonth.totalExpense)}</strong>
                <span class="finance-kpi-sub">${formatMonthLabel(currentMonth)}</span>
              </div>
              <div class="finance-kpi kpi-negative">
                <label>IVA a declarar (mes actual)</label>
                <strong>${formatCurrency(monthSummaryCurrentMonth.ivaToPay)}</strong>
                <span class="finance-kpi-sub">${formatMonthLabel(currentMonth)}</span>
              </div>
              <div class="finance-kpi ${margenOpMes >= 0 ? 'kpi-positive' : 'kpi-negative'}">
                <label>Margen operativo</label>
                <strong>${formatCurrency(margenOpMes)}</strong>
                <span class="finance-kpi-sub">Ventas − Mat./Gasto/Herr. &bull; ${formatMonthLabel(currentMonth)}</span>
              </div>
              <div class="finance-kpi">
                <label>Sueldos pagados</label>
                <strong>${formatCurrency(sueldosMes)}</strong>
                <span class="finance-kpi-sub">${formatMonthLabel(currentMonth)}</span>
              </div>
            </div>
            <div class="finance-alert-strip" style="margin-top:10px;">
              <div class="finance-alert">
                <span class="finance-alert-icon">▦</span>
                <span>Sueldo mensual referencia (escenario): <strong>${formatCurrency(monthlySalary)}</strong></span>
              </div>
              ${(() => {
                const curLedgerRow = ivaLedger.byMonth[currentMonth];
                if (curLedgerRow && curLedgerRow.ivaToPay > 0) {
                  return `<div class="finance-alert alert-warn">
                    <span class="finance-alert-icon">▤</span>
                    <span>IVA a pagar este mes (${formatMonthLabel(currentMonth)}, ya descontado tu crédito fiscal): <strong>${formatCurrency(curLedgerRow.ivaToPay)}</strong></span>
                  </div>`;
                }
                if (ivaLedger.currentRemanente > 0) {
                  return `<div class="finance-alert">
                    <span class="finance-alert-icon">▤</span>
                    <span>Tienes remanente de crédito fiscal a tu favor: <strong>${formatCurrency(ivaLedger.currentRemanente)}</strong></span>
                  </div>`;
                }
                return '';
              })()}
              ${margenOpMes < 0 ? `
              <div class="finance-alert alert-warn">
                <span class="finance-alert-icon">⚠</span>
                <span>El margen operativo de este mes es <strong>negativo</strong>. Los egresos operativos superan las ventas.</span>
              </div>` : ''}
            </div>
          </div>
        </details>

        ${monthlySynthesis.length > 0 ? `
        <details class="finance-section-details">
          <summary>Indicadores mensuales sintesis <span style="font-weight:400;font-size:11px;margin-left:6px;">comparativo por mes</span></summary>
          <div class="finance-section-body">
            <div class="finance-month-synth-table">
              <div class="finance-month-synth-row finance-month-synth-head">
                <div>Mes</div>
                <div>Saldo del mes</div>
                <div>Ingresos</div>
                <div>Egresos</div>
                <div>IVA a declarar</div>
                <div>Margen operativo</div>
                <div>Sueldos pagados</div>
              </div>
              ${monthlySynthesis.map((item) => `
              <div class="finance-month-synth-row">
                <div class="finance-month-synth-month"><strong>${sanitize(item.monthLabel)}</strong></div>
                <div class="finance-month-synth-cell ${item.saldoMes >= 0 ? 'is-pos' : 'is-neg'}"><strong>${formatCurrency(item.saldoMes)}</strong><span>${sanitize(item.monthLabel)}</span></div>
                <div class="finance-month-synth-cell is-pos"><strong>${formatCurrency(item.ingresosMes)}</strong><span>${sanitize(item.monthLabel)}</span></div>
                <div class="finance-month-synth-cell is-neg"><strong>${formatCurrency(item.egresosMes)}</strong><span>${sanitize(item.monthLabel)}</span></div>
                <div class="finance-month-synth-cell is-neg"><strong>${formatCurrency(item.ivaMes)}</strong><span>${sanitize(item.monthLabel)}</span></div>
                <div class="finance-month-synth-cell ${item.margenMes >= 0 ? 'is-pos' : 'is-neg'}"><strong>${formatCurrency(item.margenMes)}</strong><span>${sanitize(item.monthLabel)}</span></div>
                <div class="finance-month-synth-cell"><strong>${formatCurrency(item.sueldosMes)}</strong><span>${sanitize(item.monthLabel)}</span></div>
              </div>`).join('')}
            </div>
          </div>
        </details>` : ''}

        <!-- Gráficos -->
        ${allEntries.length >= 2 ? `
        <details class="finance-section-details">
          <summary>Gráficos <span style="font-weight:400;font-size:11px;margin-left:6px;">tendencia y composición</span></summary>
          <div class="finance-section-body">
            <!-- Barra: ancho completo -->
            <div style="margin-bottom:22px;">
              <div class="fin-chart-label">Ingresos vs Egresos por mes</div>
              ${buildFinanceBarChartSVG(allEntries)}
            </div>
            <!-- Dos columnas: ingreso | egreso -->
            ${(() => {
              const chartMonths = getAvailableFinanceMonths(allEntries);
              const miniGrid = (type) => chartMonths.map((m) =>
                `<div>${buildFinanceMiniDonutSVG(allEntries, type, m)}</div>`
              ).join('');
              return `
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:28px;align-items:start;">
              <div>
                <div class="fin-chart-label">Composición de ingresos (histórico)</div>
                ${buildFinanceCategoryDonutSVG(allEntries, 'income')}
                ${chartMonths.length > 0 ? `
                <div class="fin-chart-label" style="margin-top:14px;">Ingresos por mes</div>
                <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:4px;margin-top:4px;">
                  ${miniGrid('income')}
                </div>` : ''}
              </div>
              <div>
                <div class="fin-chart-label">Composición de egresos (histórico)</div>
                ${buildFinanceCategoryDonutSVG(allEntries, 'expense')}
                ${chartMonths.length > 0 ? `
                <div class="fin-chart-label" style="margin-top:14px;">Egresos por mes</div>
                <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:4px;margin-top:4px;">
                  ${miniGrid('expense')}
                </div>` : ''}
              </div>
            </div>`;
            })()}
          </div>
        </details>` : ''}

        <!-- Category Totals -->
        ${categoryTotals.length > 0 ? `
        <details class="finance-section-details">
          <summary>Totales por categoría</summary>
          <div class="finance-section-body">
            <div class="finance-totals-grid">${totalCards}</div>
          </div>
        </details>` : ''}

        <!-- Monthly Totals -->
        ${(() => {
          const availMonths = getAvailableFinanceMonths(allEntries);
          if (!availMonths.length) return '';
          const monthCards = availMonths.map((month, mIdx) => {
            const mEntries = allEntries.filter((e) => String(e.date || '').startsWith(month));
            const mSummary = getFinanceMonthSummary(mEntries, '');
            // Always show all known categories in fixed order
            const catMap = {};
            financeCategories.forEach((cat) => { catMap[cat] = { income: 0, expense: 0 }; });
            mEntries.forEach((e) => {
              const cat = e.category || 'Varios';
              if (!catMap[cat]) catMap[cat] = { income: 0, expense: 0 };
              catMap[cat].income  += Number(e.income)  || 0;
              catMap[cat].expense += Number(e.expense) || 0;
            });
            const catRows = Object.entries(catMap)
              .map(([cat, vals]) => {
                return `<div class="cat-row" style="font-size:11px;">
                  <span style="color:var(--muted);">↳ ${sanitize(cat)}</span>
                  <span style="display:flex;gap:6px;">
                    ${vals.income  > 0 ? `<span class="finance-income-cell"  style="font-size:11px;">+${formatCurrency(vals.income)}</span>`  : `<span style="font-size:11px;color:var(--muted);opacity:0.45;">+${formatCurrency(0)}</span>`}
                    ${vals.expense > 0 ? `<span class="finance-expense-cell" style="font-size:11px;">-${formatCurrency(vals.expense)}</span>` : `<span style="font-size:11px;color:var(--muted);opacity:0.45;">-${formatCurrency(0)}</span>`}
                  </span>
                </div>`;
              }).join('');
            const net = mSummary.totalIncome - mSummary.totalExpense;
            // Variation vs. previous month (availMonths sorted newest-first, so prev = mIdx+1)
            const prevMonth = availMonths[mIdx + 1];
            let variationHtml = '';
            if (prevMonth) {
              const prevEntries = allEntries.filter((e) => String(e.date || '').startsWith(prevMonth));
              const prevNet = prevEntries.reduce((s, e) => s + (Number(e.income) || 0) - (Number(e.expense) || 0), 0);
              const diff = net - prevNet;
              const pct = prevNet !== 0 ? ((diff / Math.abs(prevNet)) * 100).toFixed(1) : null;
              const arrow = diff >= 0 ? '▲' : '▼';
              const varColor = diff >= 0 ? '#16a34a' : '#dc2626';
              const label = pct !== null ? `${arrow} ${pct}% vs. mes anterior` : `${arrow} ${diff >= 0 ? 'mejor' : 'peor'} que mes anterior`;
              variationHtml = `<div style="font-size:10px;color:${varColor};margin-top:4px;text-align:right;">${label}</div>`;
            }
            const isCurrentMonth = month === new Date().toISOString().slice(0, 7);
            return `
              <div class="finance-totals-card" style="${isCurrentMonth ? 'border-color:var(--brand);box-shadow:0 0 0 1px var(--brand);' : ''}">
                <div class="cat-label" style="display:flex;justify-content:space-between;">
                  <span>${sanitize(formatMonthLabel(month))}</span>
                  ${isCurrentMonth ? `<span style="font-size:9px;color:var(--brand);background:var(--brand-soft,#eff6ff);padding:1px 5px;border-radius:4px;">Actual</span>` : ''}
                </div>
                ${catRows}
                <div class="cat-net"><span>Neto</span><span class="${net >= 0 ? 'finance-income-cell' : 'finance-expense-cell'}">${formatCurrency(net)}</span></div>
                ${variationHtml}
                ${(() => {
                  const monthLedgerRow = ivaLedger.byMonth[month];
                  if (!monthLedgerRow) return '';
                  if (monthLedgerRow.ivaToPay > 0) {
                    return `<div class="cat-row" style="font-size:10px;margin-top:4px;"><span style="color:var(--muted);">IVA F29 a pagar</span><span style="color:#dc2626;">${formatCurrency(monthLedgerRow.ivaToPay)}</span></div>`;
                  }
                  if (monthLedgerRow.remanenteFin > 0) {
                    return `<div class="cat-row" style="font-size:10px;margin-top:4px;"><span style="color:var(--muted);">Remanente crédito fiscal</span><span style="color:#16a34a;">${formatCurrency(monthLedgerRow.remanenteFin)}</span></div>`;
                  }
                  return '';
                })()}
              </div>`;
          }).join('');
          return `
          <details class="finance-section-details">
            <summary>Totales por mes <span style="font-weight:400;font-size:11px;margin-left:6px;">${availMonths.length} período${availMonths.length !== 1 ? 's' : ''}</span></summary>
            <div class="finance-section-body">
              <div class="finance-totals-grid" style="grid-template-columns:repeat(auto-fill,minmax(220px,1fr));">${monthCards}</div>
            </div>
          </details>`;
        })()}

        <!-- F29 Helper -->
        ${(() => {
          const ivaSalesTotal  = f29Source.filter((e) => e.ivaIncluded && Number(e.income)  > 0).reduce((s, e) => s + Number(e.income),  0);
          const ivaBuyTotal    = f29Source.filter((e) => e.ivaIncluded && Number(e.expense) > 0).reduce((s, e) => s + Number(e.expense), 0);
          const ivaDebito      = f29Summary.ivaCollected;
          const ivaCredito     = f29Summary.ivaCredit;
          const monthlyRowsDesc = [...ivaLedger.rows].reverse();
          return `
          <details class="finance-section-details">
            <summary>▤ Resumen IVA <span style="font-weight:400;font-size:11px;margin-left:6px;">todos los movimientos, con arrastre de crédito fiscal mes a mes</span></summary>
            <div class="finance-section-body finance-f29-box" style="border-radius:0;border:none;margin-top:0;">
              <p class="help" style="margin:0 0 10px;font-size:11px;line-height:1.5;">
                Este cuadro resume el IVA de tus ventas y compras para ayudarte a completar el F29.
                Marca <strong>"IVA incluido"</strong> en cada movimiento que corresponda para que los números sean correctos.
                El crédito fiscal que no alcanzas a usar en un mes se arrastra automáticamente al siguiente, como exige la ley.
              </p>

              <div class="finance-f29-section-label">Tu IVA Débito — lo que cobraste de más a tus clientes (histórico)</div>
              <div class="finance-f29-row">
                <span>Ventas con IVA incluido (total bruto cobrado)</span>
                <span>${formatCurrency(ivaSalesTotal)}</span>
              </div>
              <div class="finance-f29-row finance-f29-highlight">
                <span>IVA débito (${ivaRatePercent}% de tus ventas con IVA)</span>
                <span style="color:#dc2626;font-weight:700;">${formatCurrency(ivaDebito)}</span>
              </div>

              <div class="finance-f29-section-label" style="margin-top:12px;">Tu IVA Crédito — lo que pagaste en compras con factura (histórico)</div>
              <div class="finance-f29-row">
                <span>Compras con factura y con IVA incluido (total bruto)</span>
                <span>${formatCurrency(ivaBuyTotal)}</span>
              </div>
              <div class="finance-f29-row finance-f29-highlight">
                <span>IVA crédito registrado en Finanzas (${ivaRatePercent}% de esas compras)</span>
                <span style="color:#16a34a;font-weight:700;">${formatCurrency(ivaCredito)}</span>
              </div>
              <div class="finance-f29-row">
                <span>+ Crédito fiscal inicial (previo a la app, ingresado a mano)</span>
                <span style="color:#16a34a;">${formatCurrency(ivaLedger.openingCredit)}</span>
              </div>

              <div class="finance-f29-section-label" style="margin-top:12px;">Resultado real, mes a mes (con arrastre)</div>
              <div class="finance-f29-row" style="font-size:13px;font-weight:700;border-top:2px solid var(--line);padding-top:8px;">
                <span>IVA efectivamente pagado en total (suma de cada mes)</span>
                <span style="color:${ivaLedger.totalToPayHistoric > 0 ? '#dc2626' : '#16a34a'};">${formatCurrency(ivaLedger.totalToPayHistoric)}</span>
              </div>
              <div class="finance-f29-row" style="font-size:13px;font-weight:700;">
                <span>Remanente de crédito fiscal disponible hoy</span>
                <span style="color:#16a34a;">${formatCurrency(ivaLedger.currentRemanente)}</span>
              </div>
              <p class="help" style="margin:6px 0 0;font-size:10.5px;">
                Ojo: esto no es lo mismo que restar directamente "Débito total − Crédito total". Si en algún mes pagaste IVA y en otro acumulaste remanente, sumar todo el historial de una vez puede dar un número distinto al que realmente pagaste período a período. Por eso abajo puedes ver el detalle mes a mes.
              </p>

              ${monthlyRowsDesc.length ? `
              <div class="finance-f29-section-label" style="margin-top:14px;">Detalle mes a mes</div>
              <div class="table-wrap" style="margin-top:6px;">
                <table>
                  <thead>
                    <tr>
                      <th>Mes</th>
                      <th>IVA débito</th>
                      <th>IVA crédito del mes</th>
                      <th>Remanente que traía</th>
                      <th>IVA a pagar</th>
                      <th>Remanente que queda</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${monthlyRowsDesc.map((row) => `
                      <tr>
                        <td>${sanitize(formatMonthLabel(row.monthKey))}</td>
                        <td>${formatCurrency(row.ivaDebito)}</td>
                        <td>${formatCurrency(row.ivaCreditoMes)}</td>
                        <td>${formatCurrency(row.remanenteInicio)}</td>
                        <td style="${row.ivaToPay > 0 ? 'color:#dc2626;font-weight:700;' : ''}">${row.ivaToPay > 0 ? formatCurrency(row.ivaToPay) : '—'}</td>
                        <td style="${row.remanenteFin > 0 ? 'color:#16a34a;font-weight:700;' : ''}">${row.remanenteFin > 0 ? formatCurrency(row.remanenteFin) : '—'}</td>
                      </tr>
                    `).join('')}
                  </tbody>
                </table>
              </div>` : ''}

              <div class="finance-f29-ppm-box">
                <strong>¿Y el PPM?</strong> El PPM (Pago Provisional Mensual) es un porcentaje de tus ventas brutas que el SII define individualmente
                para cada contribuyente y que puede variar. No se puede calcular automáticamente aquí.
                Revísalo en tu <em>Carpeta Tributaria</em> en sii.cl o consúltalo con tu contador.
              </div>
            </div>
          </details>`;
        })()}

        <!-- Imprimir PDF -->
        <div style="margin-top:24px;padding-top:16px;border-top:2px solid var(--line);display:flex;align-items:center;justify-content:flex-end;gap:10px;">
          <span style="font-size:11px;color:var(--muted);">${allEntries.length} movimiento${allEntries.length !== 1 ? 's' : ''} · Tamaño carta</span>
          <button class="btn btn-primary" data-action="print-finance-pdf" ${!allEntries.length ? 'disabled' : ''}>
            ⎙ Imprimir / Guardar PDF
          </button>
        </div>

      </div>
    `;
  }

  function buildAttendanceTimelineChartSVG(records) {
    const source = Array.isArray(records) ? records : [];
    if (!source.length) return '<p class="help">Sin registros para mostrar.</p>';

    // Aggregate by month → day
    const monthMap = {};
    source.forEach((record) => {
      const dk = toLocalDateValue(record.checkInAt || '');
      if (!dk) return;
      const mk = dk.slice(0, 7);
      if (!monthMap[mk]) monthMap[mk] = {};
      if (!monthMap[mk][dk]) monthMap[mk][dk] = { ms: 0, count: 0 };
      monthMap[mk][dk].ms += getAttendanceRecordWorkedMs(record);
      monthMap[mk][dk].count += 1;
    });

    const allMonths = Object.keys(monthMap).sort().reverse(); // newest first
    if (!allMonths.length) return '<p class="help">Sin datos de meses.</p>';

    // Global max daily hours → consistent Y scale across all months
    let globalMaxH = 0;
    Object.values(monthMap).forEach((days) => {
      Object.values(days).forEach(({ ms }) => {
        const h = ms / 3600000;
        if (h > globalMaxH) globalMaxH = h;
      });
    });
    const scaleMaxH = Math.max(Math.ceil(globalMaxH), 1);

    const MONTHS_ES = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
    const WDAYS_ES  = ['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'];

    const W        = 620;
    const padL     = 92;  // month label column
    const padR     = 14;
    const padT     = 18;  // room for scale label at top
    const padB     = 20;  // day-axis row
    const barMaxH  = 26;  // max bar height in px
    const rowH     = 34;  // total row height (bars + spacing)
    const gapH     = 2;   // gap between month rows
    const chartW   = W - padL - padR;
    const slotW    = chartW / 31; // one slot per possible day

    const nMonths  = allMonths.length;
    const H        = padT + nMonths * (rowH + gapH) - gapH + padB;

    let out = '';

    // ── Scale reference (top-right) ──────────────────────────────────
    out += `<text x="${W - padR}" y="11" text-anchor="end" font-size="7.5" fill="#bbbbbb" font-family="JetBrains Mono,monospace">escala: ${scaleMaxH}h/día</text>`;

    // ── Week-boundary vertical grid (day 7, 14, 21, 28) ─────────────
    const gridBottom = padT + nMonths * (rowH + gapH) - gapH;
    for (const d of [7, 14, 21, 28]) {
      const gx = (padL + (d - 0.5) * slotW).toFixed(1);
      out += `<line x1="${gx}" y1="${padT}" x2="${gx}" y2="${gridBottom}" stroke="#dddddd" stroke-width="0.7" stroke-dasharray="2 2"/>`;
    }

    // ── Month rows ───────────────────────────────────────────────────
    allMonths.forEach((mk, mIdx) => {
      const rowY = padT + mIdx * (rowH + gapH);
      const [yr, mo] = mk.split('-');
      const monthLabel = `${MONTHS_ES[parseInt(mo, 10) - 1]} ${yr}`;

      const monthDays  = monthMap[mk];
      const totalMs    = Object.values(monthDays).reduce((s, d) => s + d.ms, 0);
      const daysWorked = Object.keys(monthDays).length;
      const totalLabel = getAttendancePauseLabel(totalMs);

      // Alternating row tint
      if (mIdx % 2 === 0) {
        out += `<rect x="${padL}" y="${rowY}" width="${chartW}" height="${rowH}" fill="rgba(0,0,0,0.025)" rx="0"/>`;
      }

      // Left accent bar (brand color strip)
      out += `<rect x="${padL - 4}" y="${rowY + 3}" width="2" height="${rowH - 6}" fill="#0041cc" rx="1"/>`;

      // Month label (two lines, vertically centered)
      const midY = rowY + rowH / 2;
      out += `<text x="${padL - 8}" y="${(midY - 3.5).toFixed(1)}" text-anchor="end" font-size="9" font-weight="700" fill="#111111" font-family="JetBrains Mono,monospace">${monthLabel}</text>`;
      out += `<text x="${padL - 8}" y="${(midY + 7).toFixed(1)}" text-anchor="end" font-size="7.5" fill="#777777" font-family="JetBrains Mono,monospace">${totalLabel} · ${daysWorked}d</text>`;

      // Day bars
      Object.entries(monthDays).forEach(([dk, { ms, count }]) => {
        const dayNum = parseInt(dk.slice(8, 10), 10); // 1-31
        const h = ms / 3600000;
        const bh = Math.max(2, Math.round((h / scaleMaxH) * barMaxH));
        const bx = (padL + (dayNum - 1) * slotW + slotW * 0.15).toFixed(1);
        const bw = Math.max(2, slotW * 0.70).toFixed(1);
        const by = (rowY + rowH - bh - 3).toFixed(1); // 3px bottom padding in row

        // Intensity-based color: lighter = fewer hours, darker = more hours
        const ratio = h / scaleMaxH;
        const barFill = ratio < 0.30 ? '#93c5fd' : ratio < 0.60 ? '#3b82f6' : '#1d4ed8';

        // Tooltip: day-of-week name + date + hours + entries
        const [, , dd] = dk.split('-');
        const dateObj = new Date(`${dk}T12:00:00`);
        const wd = WDAYS_ES[dateObj.getDay()];
        const hLabel = getAttendancePauseLabel(ms);
        const countLabel = count > 1 ? ` (${count} entradas)` : '';
        const tip = `${wd} ${parseInt(dd, 10)} ${MONTHS_ES[parseInt(mo, 10) - 1]} ${yr} · ${hLabel}${countLabel}`;

        out += `<rect class="fin-hoverable-bar" data-fin-tooltip="${sanitize(tip)}" x="${bx}" y="${by}" width="${bw}" height="${bh}" fill="${barFill}" rx="1"/>`;
      });

      // Divider between months
      if (mIdx < nMonths - 1) {
        const divY = (rowY + rowH + gapH / 2).toFixed(1);
        out += `<line x1="${padL - 4}" y1="${divY}" x2="${padL + chartW}" y2="${divY}" stroke="#e0e0e0" stroke-width="0.5"/>`;
      }
    });

    // ── Day-of-month axis (bottom) ───────────────────────────────────
    const axisY = H - 5;
    for (const d of [1, 5, 10, 15, 20, 25, 31]) {
      const ax = (padL + (d - 1) * slotW + slotW / 2).toFixed(1);
      out += `<text x="${ax}" y="${axisY}" text-anchor="middle" font-size="7.5" fill="#aaaaaa" font-family="JetBrains Mono,monospace">${d}</text>`;
    }
    // Axis title (right-align to not clash with bars)
    out += `<text x="${padL + chartW}" y="${axisY}" text-anchor="end" font-size="7" fill="#cccccc" font-family="JetBrains Mono,monospace">día del mes →</text>`;

    return `<svg class="fin-chart-svg" viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;display:block;" xmlns="http://www.w3.org/2000/svg">${out}</svg>`;
  }

  function renderAttendanceModule() {
    state.attendance = state.attendance || { activeSession: null, records: [] };
    state.attendance.records = Array.isArray(state.attendance.records) ? state.attendance.records : [];

    const people = getAttendancePeople();
    const activeSession = state.attendance.activeSession;
    const activeEmployee = activeSession?.employeeName || 'Andrés';
    const activeComments = activeSession?.comments || '';
    const activePauseLabel = activeSession?.isPaused ? '▶ Reanudar turno' : '⏸ Pausar turno';
    const activePauseClass = activeSession?.isPaused ? 'btn-attendance-resume' : 'btn-attendance-pause';
    const startButtonLabel = '● Marcar entrada';
    const startButtonDisabled = Boolean(activeSession);
    const editingId = state.ui.attendanceEditingId || null;
    const editingRecord = getAttendanceRecordById(editingId);

    const employeeOptions = people
      .filter((name, index, source) => source.indexOf(name) === index)
      .map((name) => `<option value="${sanitize(name)}" ${name === activeEmployee ? 'selected' : ''}>${sanitize(name)}</option>`)
      .join('');

    const editPeopleOptions = people
      .filter((name, index, source) => source.indexOf(name) === index)
      .map((name) => `<option value="${sanitize(name)}" ${name === editingRecord?.employeeName ? 'selected' : ''}>${sanitize(name)}</option>`)
      .join('');

    const records = [...(state.attendance.records || [])]
      .sort((a, b) => new Date(b.checkInAt || 0).getTime() - new Date(a.checkInAt || 0).getTime());

    // Pre-compute total worked per day for the "Total del día" column
    const dayTotals = {};
    records.forEach((record) => {
      const dk = toLocalDateValue(record.checkInAt || '');
      if (dk) dayTotals[dk] = (dayTotals[dk] || 0) + getAttendanceRecordWorkedMs(record);
    });

    const attendanceYearlyStats = getAttendanceYearlyStats(records);
    const attendanceLatestMonthKey = getAttendanceLatestMonthKey(records);
    const attendanceMonthOptions = getAttendanceSelectableMonthKeys(records);
    const attendanceCurrentMonthKey = getAttendanceMonthKeyFromDate(new Date());
    const fallbackMonthKey = attendanceMonthOptions.includes(attendanceCurrentMonthKey)
      ? attendanceCurrentMonthKey
      : (attendanceLatestMonthKey || attendanceMonthOptions[0] || '');
    const attendanceSelectedMonthKey = attendanceMonthOptions.includes(state.ui.attendanceAnalyticsMonthKey)
      ? state.ui.attendanceAnalyticsMonthKey
      : fallbackMonthKey;
    const attendanceMonthEntryStats = getAttendanceMonthlyEntryStats(records, attendanceSelectedMonthKey);
    const attendancePreviousMonthKey = shiftAttendanceMonthKey(attendanceSelectedMonthKey, -1);
    const attendancePreviousMonthEntryStats = attendancePreviousMonthKey
      ? getAttendanceMonthlyEntryStats(records, attendancePreviousMonthKey)
      : [];
    const attendanceWeekOptions = getAttendanceMonthWeekRanges(attendanceSelectedMonthKey);
    const attendanceSelectedWeekKey = attendanceWeekOptions.some((week) => week.key === state.ui.attendanceAnalyticsWeekKey)
      ? state.ui.attendanceAnalyticsWeekKey
      : 'all';
    const attendanceSelectedYearKey = /^\d{4}-\d{2}$/.test(attendanceSelectedMonthKey)
      ? attendanceSelectedMonthKey.slice(0, 4)
      : String(new Date().getFullYear());
    const attendanceMonthlyStats = getAttendanceMonthlyStats(records, attendanceSelectedYearKey);
    const attendanceWeekOptionsHtml = [
      `<option value="all" ${attendanceSelectedWeekKey === 'all' ? 'selected' : ''}>Mes completo</option>`,
      ...attendanceWeekOptions.map((week) => `<option value="${sanitize(week.key)}" ${week.key === attendanceSelectedWeekKey ? 'selected' : ''}>${sanitize(week.label)}</option>`)
    ].join('');
    const attendanceMonthOptionsHtml = attendanceMonthOptions
      .map((monthKey) => {
        const prefix = monthKey === attendanceCurrentMonthKey ? 'Mes actual · ' : '';
        const label = `${prefix}${formatMonthLabel(monthKey)}`;
        return `<option value="${sanitize(monthKey)}" ${monthKey === attendanceSelectedMonthKey ? 'selected' : ''}>${sanitize(label)}</option>`;
      })
      .join('');

    // Build ordered day keys to assign alternating band index per day
    const orderedDayKeys = [];
    records.forEach((record) => {
      const dk = toLocalDateValue(record.checkInAt || '');
      if (dk && !orderedDayKeys.includes(dk)) orderedDayKeys.push(dk);
    });
    const dayBandIndex = {};
    orderedDayKeys.forEach((dk, i) => { dayBandIndex[dk] = i; });

    // Count records per day to know which is the last in each group
    const dayRecordCount = {};
    const dayRecordCursor = {};
    records.forEach((record) => {
      const dk = toLocalDateValue(record.checkInAt || '');
      if (dk) dayRecordCount[dk] = (dayRecordCount[dk] || 0) + 1;
    });

    // Build table rows: one row per record, visually grouped by day
    const tableRows = records.map((record, index) => {
      const dk = toLocalDateValue(record.checkInAt || '');
      const dayTotal = dk ? (dayTotals[dk] || 0) : 0;
      const isEditing = record.id === editingId;
      const prevRecord = index > 0 ? records[index - 1] : null;
      const prevMonthKey = prevRecord ? String(toLocalDateValue(prevRecord.checkInAt || '') || '').slice(0, 7) : '';
      const currentMonthKey = dk ? String(dk).slice(0, 7) : '';
      const isMonthBoundary = Boolean(prevMonthKey && currentMonthKey && prevMonthKey !== currentMonthKey);

      // Track position within day group
      dayRecordCursor[dk] = (dayRecordCursor[dk] || 0) + 1;
      const isFirstInDay = dayRecordCursor[dk] === 1;
      const isLastInDay = dayRecordCursor[dk] === (dayRecordCount[dk] || 1);

      // Alternating band: even index = default bg, odd index = subtle tint
      const bandIdx = dk ? (dayBandIndex[dk] ?? 0) : 0;
      const bandBg = bandIdx % 2 === 0 ? '' : 'background:rgba(0,0,0,0.028);';

      // Top border only on first row of each day to separate groups
      const topBorder = isFirstInDay ? 'border-top:2px solid var(--line);' : '';

      let rowStyle;
      if (isEditing) {
        rowStyle = ' style="background:var(--surface-alt,#f0f9ff);outline:2px solid var(--accent,#2563eb);outline-offset:-2px;"';
      } else {
        const monthDividerStyle = isMonthBoundary ? 'border-top:3px solid rgba(17,24,39,0.34);background:rgba(37,99,235,0.04);' : '';
        const combinedStyle = `${bandBg}${topBorder}${monthDividerStyle}`.trim();
        rowStyle = combinedStyle ? ` style="${combinedStyle}"` : '';
      }

      // "Total del día" shown only on the last row of the day group (avoids repetition)
      const totalDayCell = isLastInDay
        ? `<span style="font-weight:600;">${sanitize(getAttendancePauseLabel(dayTotal))}</span>${(dayRecordCount[dk] || 1) > 1 ? `<br><span class="small muted" style="font-size:10px;">${dayRecordCount[dk]} entradas</span>` : ''}`
        : '<span class="small muted" style="color:transparent;">—</span>';

      const recordRow = `<tr${rowStyle}${isEditing ? '' : ` class="attendance-row-clickable" data-action="view-attendance-record" data-id="${record.id}"`}>
        <td style="${topBorder}${isEditing ? '' : bandBg}">${isFirstInDay ? sanitize(formatAttendanceDate(record.checkInAt)) : '<span class="small muted" style="color:transparent;">—</span>'}</td>
        <td>${sanitize(record.employeeName || '-')}</td>
        <td>${sanitize(formatAttendanceTime(record.checkInAt))}</td>
        <td>${sanitize(formatAttendanceTime(record.checkOutAt))}</td>
        <td><strong>${sanitize(getAttendancePauseLabel(getAttendanceRecordWorkedMs(record)))}</strong></td>
        <td>${totalDayCell}</td>
        <td class="attendance-comments-cell">${sanitize(record.comments || '') || '<span class="small muted">—</span>'}</td>
        <td>
          <div style="display:flex;gap:4px;align-items:center;justify-content:flex-end;">
            <button class="btn btn-soft btn-icon${isEditing ? ' active' : ''}" data-action="edit-attendance-record" data-id="${record.id}" title="${isEditing ? 'Editando este registro' : 'Editar'}" aria-label="Editar registro">${iconSvg('edit')}</button>
            <button class="btn btn-soft btn-icon" data-action="delete-attendance-record" data-id="${record.id}" title="Eliminar" aria-label="Eliminar registro">${iconSvg('trash')}</button>
          </div>
        </td>
      </tr>`;

      if (!isEditing) return recordRow;

      // Inline edit form appended directly below the editing row
      const inlineEdit = `<tr>
        <td colspan="8" style="padding:10px 12px;background:var(--surface-alt,#f0f9ff);border-bottom:2px solid var(--accent,#2563eb);">
          <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px 14px;margin-bottom:10px;">
            <div><label style="font-size:11px;font-weight:500;display:block;margin-bottom:3px;">Fecha</label>
              <input id="attendance-edit-date" type="date" value="${sanitize(toLocalDateValue(editingRecord.checkInAt))}" style="width:100%;box-sizing:border-box;" /></div>
            <div><label style="font-size:11px;font-weight:500;display:block;margin-bottom:3px;">Empleado</label>
              <select id="attendance-edit-employee" style="width:100%;box-sizing:border-box;">${editPeopleOptions}</select></div>
            <div><label style="font-size:11px;font-weight:500;display:block;margin-bottom:3px;">Hora entrada</label>
              <input id="attendance-edit-checkin" type="time" value="${sanitize(toLocalTimeValue(editingRecord.checkInAt))}" style="width:100%;box-sizing:border-box;" /></div>
            <div><label style="font-size:11px;font-weight:500;display:block;margin-bottom:3px;">Hora salida</label>
              <input id="attendance-edit-checkout" type="time" value="${sanitize(toLocalTimeValue(editingRecord.checkOutAt))}" style="width:100%;box-sizing:border-box;" /></div>
            <div style="grid-column:2 / -1;"><label style="font-size:11px;font-weight:500;display:block;margin-bottom:3px;">Comentarios</label>
              <input id="attendance-edit-comments" maxlength="200" value="${sanitize(editingRecord.comments || '')}" style="width:100%;box-sizing:border-box;" /></div>
          </div>
          <div style="display:flex;gap:8px;">
            <button class="btn btn-primary" data-action="save-attendance-edit">Guardar edición</button>
            <button class="btn btn-soft" data-action="cancel-attendance-edit">Cancelar</button>
          </div>
        </td>
      </tr>`;

      return recordRow + inlineEdit;
    }).join('');

    const totalRecords = records.length;
    const totalDays = Object.keys(dayTotals).length;
    const attendanceTableWrapClass = totalRecords > 20 ? 'attendance-records-table-wrap attendance-records-table-scroll' : 'attendance-records-table-wrap';

    return `
      <div class="card">
        <div class="section-title">
          <div>
            <h2>Módulo 8 · Registro de asistencia</h2>
            <p class="subtitle">Marca hora de entrada y salida para registrar tus jornadas de trabajo.</p>
          </div>
          <span class="pill ${activeSession ? 'warn' : 'ok'}">${activeSession ? 'Turno en curso' : 'Sin turno activo'}</span>
        </div>

        <div class="database-form-layout">
          <div class="form-section">
            <div class="form-section-title"><span class="form-step">1</span> Ficha de entrada</div>
            <div class="database-grid database-grid-3 compact-grid">
              <div>
                <label>Registro de asistencia</label>
                <select id="attendance-employee" ${activeSession ? 'disabled' : ''}>${employeeOptions}</select>
              </div>
              <div class="field-wide-2">
                <label>Comentarios</label>
                <input id="attendance-comments" maxlength="200" value="${sanitize(activeComments)}" placeholder="Opcional: observaciones del día" />
              </div>
            </div>

            <div class="attendance-chrono-wrap">
              <div class="attendance-chrono-main">
                <span class="small">Cronómetro activo</span>
                <strong id="attendance-chrono-value">00:00:00</strong>
              </div>
            </div>

            <div class="inline-actions action-pair attendance-actions">
              <button class="btn btn-primary" data-action="check-in-attendance" ${startButtonDisabled ? 'disabled' : ''}>${startButtonLabel}</button>
              <button class="btn btn-soft ${activePauseClass}" data-action="toggle-attendance-pause" ${activeSession ? '' : 'disabled'}>${activePauseLabel}</button>
              <button class="btn btn-primary btn-attendance-stop" data-action="check-out-attendance" ${activeSession ? '' : 'disabled'}>⏹ Marcar salida</button>
            </div>

            ${activeSession ? `<p class="help attendance-live-status">Turno activo de <strong>${sanitize(activeSession.employeeName)}</strong> iniciado a las ${sanitize(formatAttendanceTime(activeSession.checkInAt))}. Estado: <strong>${activeSession.isPaused ? 'en pausa' : 'trabajando'}</strong>${activeSession.pauseCount ? ` · Pausas: ${activeSession.pauseCount}` : ''}.</p>` : ''}
          </div>
        </div>
      </div>

      <div class="card">
        <div class="section-title">
          <h3>Tabla de Registro de Asistencia</h3>
          <span class="pill ok">${totalRecords} entrada(s) · ${totalDays} jornada(s)</span>
        </div>
        <div class="table-wrap table-compact ${attendanceTableWrapClass}">
          <table>
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Empleado</th>
                <th>Entrada</th>
                <th>Salida</th>
                <th>Tiempo</th>
                <th>Total del día</th>
                <th>Comentarios</th>
                <th></th>
              </tr>
            </thead>
            <tbody>${tableRows || '<tr><td colspan="8" class="empty-state">Aún no hay registros de asistencia.</td></tr>'}</tbody>
          </table>
        </div>
      </div>

      ${(attendanceMonthlyStats.length > 0 || attendanceYearlyStats.length > 0) ? `
      <details class="finance-section-details">
        <summary>Análisis y gráficos de asistencia <span style="font-weight:400;font-size:11px;margin-left:6px;">mensual y anual</span></summary>
        <div class="finance-section-body">
          <div style="display:flex;flex-direction:column;gap:18px;align-items:stretch;">

            <section style="border:1px solid var(--line);border-radius:12px;padding:12px;">
              <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:8px;">
                <div class="fin-chart-label" style="margin:0;">Sección mensual</div>
                <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
                  <label for="attendance-analytics-month" class="small" style="margin:0;">Mes:</label>
                  <select id="attendance-analytics-month" style="min-width:220px;">${attendanceMonthOptionsHtml}</select>
                  <label for="attendance-analytics-week" class="small" style="margin:0;">Semana:</label>
                  <select id="attendance-analytics-week" style="min-width:160px;">${attendanceWeekOptionsHtml}</select>
                </div>
              </div>
              <div style="display:flex;flex-direction:column;gap:14px;">
                <div>
                  <div class="fin-chart-label">Horas por día de la semana (lunes a domingo, barras por entrada)</div>
                  ${buildAttendanceWeekdayEntriesBarsSVG(records, attendanceSelectedMonthKey, attendanceSelectedWeekKey)}
                </div>
                <div>
                  <div class="fin-chart-label">Horas por día del mes (barras por entrada)</div>
                  ${buildAttendanceMonthEntriesBarsSVG(attendanceMonthEntryStats, attendanceSelectedMonthKey, attendancePreviousMonthEntryStats, '')}
                </div>
                <div>
                  <div class="fin-chart-label">Horas trabajadas por mes</div>
                  ${buildAttendanceCompactWorkedChartSVG(attendanceMonthlyStats)}
                </div>
              </div>
            </section>

            <section style="border:1px solid var(--line);border-radius:12px;padding:12px;">
              <div class="fin-chart-label" style="margin:0 0 8px 0;">Sección anual</div>
              <div>
                <div class="fin-chart-label">Horas trabajadas por año</div>
                ${buildAttendanceCompactWorkedChartSVG(attendanceYearlyStats)}
              </div>
            </section>

            ${records.length > 0 ? `
            <section style="border:1px solid var(--line);border-radius:12px;padding:12px;">
              <div class="fin-chart-label" style="margin:0 0 6px 0;">Timeline de entradas · todas las jornadas</div>
              <p class="help" style="margin:0 0 8px 0;font-size:11px;">Cada barra muestra el horario real de trabajo. Pasa el cursor para ver el detalle.</p>
              ${buildAttendanceTimelineChartSVG(records)}
            </section>` : ''}

          </div>
        </div>
      </details>` : ''}
    `;
  }

  function renderInventory() {
    return `
      <div class="card">
        <div class="section-title">
          <div>
            <h2>Módulo 6 · Inventario</h2>
            <p class="subtitle">Registro del inventario completo del galpón: equipos, herramientas y activos.</p>
          </div>
        </div>
      </div>

      ${renderDesiredEquipmentSection()}
    `;
  }

  function renderExpensePeriodOptions(current) {
    return Object.entries(expensePeriodConfig).map(([value, meta]) => (
      `<option value="${value}" ${value === current ? 'selected' : ''}>${meta.label}</option>`
    )).join('');
  }

  function renderExpensesModule() {
    state.expenses = state.expenses || { cards: [] };
    state.expenses.cards = Array.isArray(state.expenses.cards) ? state.expenses.cards.map((card) => createExpenseCard(card)) : [];

    if (!state.expenses.cards.length) {
      state.expenses.cards = [
        createExpenseCard({ name: 'Agua', color: '#2563eb', description: 'Registro anual de consumo y pago de agua.', baseYear: String(new Date().getFullYear()), period: 'mensual' }),
        createExpenseCard({ name: 'Luz', color: '#f39b24', description: 'Registro anual de cuentas eléctricas.', baseYear: String(new Date().getFullYear()), period: 'mensual' }),
        createExpenseCard({ name: 'F29', color: '#4c78d7', description: 'Registro de impuestos y pagos de F29.', baseYear: String(new Date().getFullYear()), period: 'mensual' })
      ];
    }

    if (!state.ui.selectedExpenseId || !state.expenses.cards.some((card) => card.id === state.ui.selectedExpenseId)) {
      state.ui.selectedExpenseId = state.expenses.cards[0]?.id || null;
    }

    const selected = (state.expenses.cards || []).find((card) => card.id === state.ui.selectedExpenseId) || state.expenses.cards[0] || null;
    const draft = state.ui.expenseDraft && state.ui.expenseDraft.id === selected?.id
      ? createExpenseCard(state.ui.expenseDraft)
      : (selected ? createExpenseCard(selected) : null);

    state.ui.expenseDraft = draft ? JSON.parse(JSON.stringify(draft)) : null;

    const cards = (state.expenses.cards || []).map((card) => {
      const previewCard = state.ui.expenseDraft && state.ui.expenseDraft.id === card.id
        ? createExpenseCard(state.ui.expenseDraft)
        : card;
      const summary = getExpenseSummary(previewCard);
      return `
        <button type="button" class="expense-card ${summary.complete ? 'expense-card-complete' : ''} ${state.ui.selectedExpenseId === card.id ? 'selected' : ''}" data-action="select-expense-card" data-id="${card.id}" style="--expense-color:${sanitize(previewCard.color || '#2563eb')}">
          <div class="expense-card-head">
            <strong class="expense-card-title">${sanitize(previewCard.name)} · ${sanitize(previewCard.baseYear)}</strong>
            <span class="pill ${summary.complete ? 'ok' : 'info'}">${summary.complete ? 'Objetivo cumplido' : 'En progreso'}</span>
          </div>
          <div class="expense-card-metrics">
            <div><span>Total pagado</span><strong>${formatCurrency(summary.totalPaid)}</strong></div>
            <div><span>Entradas</span><strong>${summary.paidCount} de ${summary.totalCount}</strong></div>
            <div><span>Promedio</span><strong>${formatCurrency(Math.round(summary.average || 0))}</strong></div>
          </div>
          ${previewCard.expenseType ? `<div class="expense-card-type-badge" style="background:${getExpenseTypeColor(previewCard.expenseType)}22;color:${getExpenseTypeColor(previewCard.expenseType)};border:1px solid ${getExpenseTypeColor(previewCard.expenseType)}55;">${sanitize(previewCard.expenseType)}</div>` : ''}
        </button>
      `;
    }).join('');

    const rows = (draft?.entries || []).map((entry, index) => {
      const isPaid = entry.status === 'pagado';
      const expenseAttachment = getPrimaryAttachment(entry, legacyExpenseAttachment);
      const hasPdf = Boolean(expenseAttachment);
      const pdfInputId = `expense-pdf-input-${entry.id}`;
      return `
        <tr>
          <td>${index + 1}</td>
          <td><input type="text" data-format="clp" data-entry-id="${entry.id}" data-expense-entry-field="amount" value="${formatNumber(Number(entry.amount) || 0)}" /></td>
          <td><input type="date" data-entry-id="${entry.id}" data-expense-entry-field="date" value="${sanitize(entry.date || '')}" /></td>
          <td>
            <button type="button" class="expense-status-toggle ${isPaid ? 'paid' : 'unpaid'}" data-action="toggle-expense-entry-status" data-entry-id="${entry.id}" title="Cambiar estado">
              <span class="expense-status-dot">${isPaid ? iconSvg('statusOn') : iconSvg('statusOff')}</span>
              <span>${isPaid ? 'Pagado' : 'No pagado'}</span>
            </button>
          </td>
          <td>
            <div class="expense-file-actions">
              <button
                type="button"
                class="expense-file-icon upload ${hasPdf ? 'is-disabled' : ''}"
                data-action="pick-expense-pdf"
                data-entry-id="${entry.id}"
                ${hasPdf ? 'disabled' : ''}
                title="${hasPdf ? 'Ya existe PDF cargado' : 'Subir PDF'}"
                aria-label="${hasPdf ? 'PDF ya cargado' : 'Subir PDF'}">${iconSvg('upload')}</button>
              <input id="${pdfInputId}" class="expense-file-hidden-input" type="file" accept="application/pdf,.pdf" data-expense-entry-pdf="true" data-entry-id="${entry.id}" ${hasPdf ? 'disabled' : ''} />
            </div>
            ${expenseAttachment ? `<div class="small expense-file-name">${sanitize(expenseAttachment.fileName)} (${Number(expenseAttachment.sizeKb || 0)} KB)</div>` : '<div class="small">Sin PDF</div>'}
          </td>
          <td>
            ${hasPdf
    ? `<button type="button" class="expense-file-icon clear" data-action="clear-expense-pdf" data-entry-id="${entry.id}" title="Quitar PDF" aria-label="Quitar PDF">${iconSvg('close')}</button>`
    : `<span class="expense-file-icon clear is-disabled" aria-disabled="true">${iconSvg('close')}</span>`}
          </td>
          <td>
            ${hasPdf
    ? `<button type="button" class="expense-file-icon download" data-action="download-expense-pdf" data-entry-id="${entry.id}" title="Descargar PDF" aria-label="Descargar PDF">${iconSvg('download')}</button>`
    : `<span class="expense-file-icon download is-disabled" title="Sin PDF" aria-disabled="true">${iconSvg('download')}</span>`}
          </td>
          <td>
            ${hasPdf
    ? `<button type="button" class="expense-file-icon" data-action="view-expense-pdf" data-entry-id="${entry.id}" title="Ver PDF" aria-label="Ver PDF">${iconSvg('eye')}</button>`
            : `<span class="expense-file-icon is-disabled" title="Sin PDF" aria-disabled="true">${iconSvg('eyeClosed')}</span>`}
          </td>
          <td><input maxlength="120" data-entry-id="${entry.id}" data-expense-entry-field="notes" value="${sanitize(entry.notes || '')}" placeholder="Observación breve" /></td>
        </tr>
      `;
    }).join('');

    const draftSummary = getExpenseSummary(draft || { entries: [] });

    return `
      <div class="card">
        <div class="section-title">
          <div>
            <h2>Módulo 7 · Gastos</h2>
            <p class="subtitle">Control anual de gastos clave con respaldo de comprobantes PDF por fila.</p>
          </div>
          <div class="inline-actions save-inline-actions">
            <button class="btn btn-primary btn-add-line-icon" data-action="add-expense-card" title="Nueva card" aria-label="Nueva card">${iconSvg('plus')}</button>
            <span class="pill ok">${(state.expenses.cards || []).length} cards</span>
            ${renderSaveFeedback('expenses')}
          </div>
        </div>

        <div class="expense-grid">
          ${cards}
        </div>
      </div>

      ${draft ? `
        <div class="card">
          <div class="section-title">
            <div>
              <h3>Detalle de Gasto - ${sanitize(draft.name || 'Sin titulo')} ${sanitize(draft.baseYear || '')}</h3>
              <p class="subtitle">Edita datos generales y el detalle de pagos según el período configurado.</p>
            </div>
            <div class="inline-actions">
              <button class="btn btn-soft btn-add-line-icon" data-action="delete-expense-card" data-id="${draft.id}" title="Eliminar card" aria-label="Eliminar card">${iconSvg('trash')}</button>
            </div>
          </div>

          <div class="database-grid database-grid-3 compact-grid">
            <div>
              <label>Nombre Gasto</label>
              <input data-expense-draft="name" value="${sanitize(draft.name || '')}" />
            </div>
            <div>
              <label>Año base</label>
              <input data-expense-draft="baseYear" value="${sanitize(draft.baseYear || '')}" placeholder="2026" />
            </div>
            <div>
              <label>Color</label>
              <div class="expense-color-swatches">
                ${expenseColorOptions.map((color) => `
                  <button
                    type="button"
                    class="expense-swatch ${draft.color === color ? 'selected' : ''}"
                    data-action="select-expense-color"
                    data-color="${color}"
                    style="--swatch-color:${color}"
                    title="Seleccionar color ${color}"
                    aria-label="Seleccionar color ${color}"></button>
                `).join('')}
              </div>
            </div>
            <div class="field-wide-2">
              <label>Descripción de Gasto</label>
              <input data-expense-draft="description" maxlength="220" value="${sanitize(draft.description || '')}" />
            </div>
            <div>
              <label>Período de pago</label>
              <select data-expense-draft="period">${renderExpensePeriodOptions(draft.period || 'mensual')}</select>
            </div>
            <div>
              <label>Tipo de gasto</label>
              <select data-expense-draft="expenseType">
                <option value="" ${!draft.expenseType ? 'selected' : ''}>Sin asignar</option>
                ${expenseTypeOptions.map((t) => `<option value="${sanitize(t.value)}" ${draft.expenseType === t.value ? 'selected' : ''}>${sanitize(t.value)}</option>`).join('')}
              </select>
            </div>
          </div>

          <div class="table-wrap table-compact">
            <table class="expense-detail-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Monto</th>
                  <th>Fecha</th>
                  <th>Estado</th>
                  <th>Subir PDF</th>
                  <th>Quitar</th>
                  <th>Descargar</th>
                  <th>Ver</th>
                  <th>Observaciones</th>
                </tr>
              </thead>
              <tbody>
                ${rows || '<tr><td colspan="9" class="empty-state">Sin filas configuradas.</td></tr>'}
              </tbody>
              <tfoot>
                <tr>
                  <td colspan="2"><strong>Total pagado: ${formatCurrency(draftSummary.totalPaid)}</strong></td>
                  <td><strong>${draftSummary.paidCount} de ${draftSummary.totalCount}</strong></td>
                  <td colspan="6"><strong>Promedio: ${formatCurrency(Math.round(draftSummary.average || 0))}</strong></td>
                </tr>
              </tfoot>
            </table>
          </div>

          <div class="inline-actions action-pair">
            <button class="btn btn-primary" data-action="save-expense-card">Guardar cambios</button>
            <button class="btn btn-soft" data-action="reset-expense-draft">Descartar cambios</button>
          </div>
        </div>
      ` : ''}
    `;
  }

  function renderDesiredEquipmentSection() {
    const editing = (state.inventory.desiredItems || []).find((item) => item.id === state.ui.editingDesiredId) || {};
    const draft = state.ui.desiredDraft || defaultDesiredDraft();
    const pick = (key, fallback = '') => draft[key] ?? editing[key] ?? fallback;
    const form = {
      name: pick('name'),
      sku: pick('sku'),
      category: pick('category'),
      brand: pick('brand'),
      model: pick('model'),
      status: pick('status', 'Operativo'),
      purchaseDate: pick('purchaseDate', pick('entryDate', new Date().toISOString().slice(0, 10))),
      supplier: pick('supplier'),
      cost: Number(pick('cost', 0)) || 0,
      location: pick('location'),
      notes: pick('notes', pick('description', '')),
      imageDataUrl: pick('imageDataUrl'),
      imageName: pick('imageName'),
      imageMimeType: pick('imageMimeType'),
      imageSizeKb: Number(pick('imageSizeKb', 0)) || 0
    };

    const categorySuggestions = collectDesiredCategories();
    const categoryListId = 'desired-category-suggestions';
    const statusOptionsHtml = DESIRED_STATUS_OPTIONS
      .map((opt) => `<option value="${sanitize(opt)}" ${form.status === opt ? 'selected' : ''}>${sanitize(opt)}</option>`)
      .join('');

    const rows = (state.inventory.desiredItems || []).map((item) => {
      const notes = String(item.notes || item.description || '').trim();
      return `
        <tr>
          <td>
            <strong>${sanitize(item.name || '')}</strong>
            ${item.sku ? `<div class="small">SKU: ${sanitize(item.sku)}</div>` : ''}
            ${notes ? `<div class="small">${sanitize(notes)}</div>` : ''}
          </td>
          <td>${sanitize(item.category || '-')}</td>
          <td>
            ${sanitize(item.brand || '-')}
            ${item.model ? `<div class="small">${sanitize(item.model)}</div>` : ''}
          </td>
          <td>${sanitize(item.status || '-')}</td>
          <td>${sanitize(item.purchaseDate || item.entryDate || '-')}</td>
          <td>${sanitize(item.supplier || '-')}</td>
          <td>${Number(item.cost || 0) > 0 ? formatCurrency(Number(item.cost || 0)) : '-'}</td>
          <td>${sanitize(item.location || '-')}</td>
          <td>
            <div class="button-group compact-actions">
              <button class="btn btn-soft btn-icon" data-action="edit-desired-item" data-id="${item.id}" title="Editar" aria-label="Editar">${iconSvg('edit')}</button>
              <button class="btn btn-soft btn-icon" data-action="delete-desired-item" data-id="${item.id}" title="Eliminar" aria-label="Eliminar">${iconSvg('trash')}</button>
            </div>
          </td>
        </tr>
      `;
    }).join('');

    return `
      <div class="card">
        <div class="section-title">
          <div>
            <h3>Ingreso de equipo a Inventario</h3>
          </div>
        </div>

        <datalist id="${categoryListId}">
          ${categorySuggestions.map((cat) => `<option value="${sanitize(cat)}"></option>`).join('')}
        </datalist>

        <div class="database-form-layout">
          <div class="form-section">
            <div class="database-grid database-grid-2 compact-grid">
              <div>
                <label>Nombre de equipamiento</label>
                <input data-desired-draft="name" value="${sanitize(form.name)}" />
              </div>
              <div>
                <label>Código SKU</label>
                <input data-desired-draft="sku" value="${sanitize(form.sku)}" />
              </div>
            </div>

            <div class="database-grid database-grid-4 compact-grid">
              <div>
                <label>Categoría</label>
                <input data-desired-draft="category" list="${categoryListId}" value="${sanitize(form.category)}" placeholder="Herramienta eléctrica, de medición, manual…" />
              </div>
              <div>
                <label>Marca</label>
                <input data-desired-draft="brand" value="${sanitize(form.brand)}" />
              </div>
              <div>
                <label>Modelo</label>
                <input data-desired-draft="model" value="${sanitize(form.model)}" />
              </div>
              <div>
                <label>Estado</label>
                <select data-desired-draft="status">${statusOptionsHtml}</select>
              </div>
            </div>

            <div class="database-grid database-grid-3 compact-grid">
              <div>
                <label>Fecha de compra</label>
                <input type="date" data-desired-draft="purchaseDate" value="${sanitize(form.purchaseDate)}" />
              </div>
              <div>
                <label>Proveedor</label>
                <input data-desired-draft="supplier" value="${sanitize(form.supplier)}" />
              </div>
              <div>
                <label>Coste $</label>
                <input type="text" data-format="clp" min="0" step="1" data-desired-draft="cost" value="${formatNumber(form.cost)}" />
              </div>
            </div>

            <div class="database-grid compact-grid">
              <div class="field-wide-2">
                <label>Ubicación en el galpón</label>
                <input data-desired-draft="location" value="${sanitize(form.location)}" />
              </div>
            </div>

            <div class="database-grid compact-grid">
              <div class="field-wide-2">
                <label>Observaciones</label>
                <textarea data-desired-draft="notes">${sanitize(form.notes)}</textarea>
              </div>
            </div>

            <div class="database-grid compact-grid">
              <div class="field-wide-2">
                <label>Imagen del equipo</label>
                <input id="desired-image" type="file" accept="image/webp,image/jpeg,image/png" />
                ${form.imageDataUrl ? `<div class="small">${sanitize(form.imageName || 'Imagen cargada')} · ${Number(form.imageSizeKb || 0)} KB</div>` : ''}
              </div>
            </div>
          </div>
        </div>

        <div class="inline-actions action-pair">
          <button class="btn btn-primary" data-action="save-desired-item">Guardar</button>
          <button class="btn btn-soft btn-icon" data-action="clear-desired-form" title="Limpiar ficha" aria-label="Limpiar ficha">${iconSvg('broom')}</button>
        </div>
      </div>

      <div class="card">
        <div class="section-title">
          <h3>Inventario Completo</h3>
          <span class="pill ok">${(state.inventory.desiredItems || []).length} registros</span>
        </div>
        <div class="table-wrap table-compact">
          <table>
            <thead>
              <tr>
                <th>Equipamiento</th>
                <th>Categoría</th>
                <th>Marca / Modelo</th>
                <th>Estado</th>
                <th>Fecha de compra</th>
                <th>Proveedor</th>
                <th>Coste $</th>
                <th>Ubicación</th>
                <th></th>
              </tr>
            </thead>
            <tbody>${rows || '<tr><td colspan="9" class="empty-state">Aún no hay equipos registrados en el inventario.</td></tr>'}</tbody>
          </table>
        </div>
      </div>
    `;
  }

  function renderDatabaseSectionTabs() {
    const sections = [
      { key: 'materials', label: 'Base de datos' },
      { key: 'productTypes', label: 'Tipos de producto' },
      { key: 'externalResources', label: 'Proveedores' }
    ];

    return `
      <div class="card">
        <div class="section-title">
          <div>
            <h2>Módulo 3 · Base de datos</h2>
            <p class="subtitle">Administra tu base principal y sus subbases conectadas al presupuestador.</p>
          </div>
        </div>
        <div class="filter-row">
          ${sections.map((section) => `<button class="btn filter-chip ${state.ui.databaseSection === section.key ? 'active' : ''}" data-action="set-database-section" data-section="${section.key}">${section.label}</button>`).join('')}
        </div>
      </div>
    `;
  }

  function renderProductTypesSection() {
    const editing = (state.database.productTypes || []).find((item) => item.id === state.ui.editingProductTypeId) || {};
    const draft = state.ui.productTypeDraft || {};
    const form = {
      name: draft.name ?? editing.name ?? '',
      comments: draft.comments ?? editing.comments ?? ''
    };

    const rows = [...(state.database.productTypes || [])]
      .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'es'))
      .map((item) => `
        <tr>
          <td><strong>${sanitize(item.name)}</strong></td>
          <td>${sanitize(item.createdAt || '-')}</td>
          <td>${sanitize(item.comments || '')}</td>
          <td>
            <div class="button-group compact-actions">
              <button class="btn btn-soft btn-icon" data-action="edit-product-type" data-id="${item.id}" title="Editar" aria-label="Editar">${iconSvg('edit')}</button>
              <button class="btn btn-soft btn-icon" data-action="delete-product-type" data-id="${item.id}" title="Eliminar" aria-label="Eliminar">${iconSvg('trash')}</button>
            </div>
          </td>
        </tr>
      `).join('');

    return `
      ${renderDatabaseSectionTabs()}

      <div class="card">
        <div class="section-title">
          <div>
            <h3>Listado Tipo de productos</h3>
            <p class="subtitle">Tipos de productos que generalmente se fabrican. Esto permitirá organizar a futuro las Ordenes de Trabajo por Tipo.</p>
          </div>
          <span class="pill ok">${(state.database.productTypes || []).length} tipos</span>
        </div>

        <div class="database-form-layout">
          <div class="form-section">
            <div class="form-section-title"><span class="form-step">1</span> Tipo de producto</div>
            <div class="database-grid database-grid-2 compact-grid">
              <div>
                <label>Nombre del tipo de producto</label>
                <input data-product-type-draft="name" value="${sanitize(form.name)}" placeholder="Ejemplo: Letrero acrílico" />
              </div>
              <div>
                <label>Comentarios</label>
                <input data-product-type-draft="comments" value="${sanitize(form.comments)}" placeholder="Opcional: tamaño habitual, línea, cliente objetivo" />
              </div>
            </div>
          </div>
        </div>

        <div class="inline-actions action-pair">
          <button class="btn btn-primary" data-action="save-product-type">${state.ui.editingProductTypeId ? 'Actualizar tipo' : 'Guardar tipo'}</button>
          <button class="btn btn-soft btn-icon" data-action="clear-product-type-form" title="Limpiar ficha" aria-label="Limpiar ficha">${iconSvg('broom')}</button>
        </div>
      </div>

      <div class="card">
        <div class="section-title">
          <h3>Tipos de producto guardados</h3>
        </div>
        <div class="table-wrap table-compact">
          <table>
            <thead>
              <tr>
                <th>Nombre</th>
                <th>Fecha</th>
                <th>Comentarios</th>
                <th></th>
              </tr>
            </thead>
            <tbody>${rows || '<tr><td colspan="4" class="empty-state">Aún no hay tipos de producto guardados.</td></tr>'}</tbody>
          </table>
        </div>
      </div>
    `;
  }

  function renderExternalResourcesSection() {
    const editing = (state.database.externalResources || []).find((item) => item.id === state.ui.editingExternalResourceId) || {};
    const draft = state.ui.externalResourceDraft || {};
    const form = {
      type: draft.type ?? editing.type ?? 'Proveedor',
      name: draft.name ?? editing.name ?? '',
      description: draft.description ?? editing.description ?? '',
      phone: draft.phone ?? editing.phone ?? '',
      instagram: draft.instagram ?? editing.instagram ?? '',
      facebook: draft.facebook ?? editing.facebook ?? '',
      email: draft.email ?? editing.email ?? '',
      website: draft.website ?? editing.website ?? '',
      status: draft.status ?? editing.status ?? 'Activo'
    };

    const rows = [...(state.database.externalResources || [])]
      .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'es'))
      .map((item) => {
        const providerType = normalizeProviderType(item.type);
        const contactLines = [
          item.phone ? `Tel: ${sanitize(item.phone)}` : '',
          item.instagram ? `IG: ${sanitize(item.instagram)}` : '',
          item.facebook ? `FB: ${sanitize(item.facebook)}` : '',
          item.email ? `Mail: ${sanitize(item.email)}` : '',
          item.website ? `Web: ${sanitize(item.website)}` : ''
        ].filter(Boolean).map((line) => `<div class="small">${line}</div>`).join('');

        return `
        <tr class="${item.status === 'Inactivo' ? 'row-inactive' : ''}">
          <td>${sanitize(providerType)}</td>
          <td><strong>${sanitize(item.name)}</strong></td>
          <td>${sanitize(item.description || '')}</td>
          <td>${contactLines || '<div class="small">Sin datos de contacto</div>'}</td>
          <td>${sanitize(item.status || 'Activo')}</td>
          <td>
            <div class="button-group compact-actions">
              <button class="btn btn-soft btn-icon" data-action="toggle-external-resource-status" data-id="${item.id}" title="Cambiar estado" aria-label="Cambiar estado">${item.status === 'Inactivo' ? iconSvg('statusOff') : iconSvg('statusOn')}</button>
              <button class="btn btn-soft btn-icon" data-action="edit-external-resource" data-id="${item.id}" title="Editar" aria-label="Editar">${iconSvg('edit')}</button>
              <button class="btn btn-soft btn-icon" data-action="delete-external-resource" data-id="${item.id}" title="Eliminar" aria-label="Eliminar">${iconSvg('trash')}</button>
            </div>
          </td>
        </tr>
      `;
      }).join('');

    return `
      ${renderDatabaseSectionTabs()}

      <div class="card">
        <div class="section-title">
          <div>
            <h3>Proveedores</h3>
            <p class="subtitle">Registro de proveedores y particulares para usarlos en el Presupuestador.</p>
          </div>
          <span class="pill ok">${(state.database.externalResources || []).length} registros</span>
        </div>

        <div class="database-form-layout">
          <div class="form-section">
            <div class="form-section-title"><span class="form-step">1</span> Registrar proveedor / particular</div>
            <div class="database-grid database-grid-3 compact-grid">
              <div>
                <label>Tipo</label>
                <select data-external-resource-draft="type">
                  <option value="Proveedor" ${form.type === 'Proveedor' ? 'selected' : ''}>Proveedor</option>
                  <option value="Particular" ${form.type === 'Particular' ? 'selected' : ''}>Particular</option>
                </select>
              </div>
              <div>
                <label>Nombre</label>
                <input data-external-resource-draft="name" value="${sanitize(form.name)}" placeholder="Ejemplo: Ayudante CNC" />
              </div>
              <div class="field-wide-2">
                <label>Descripción</label>
                <input data-external-resource-draft="description" value="${sanitize(form.description)}" placeholder="Notas para reconocer cuándo usarlo" />
              </div>
              <div>
                <label>Teléfono</label>
                <input data-external-resource-draft="phone" value="${sanitize(form.phone)}" placeholder="+56 ..." />
              </div>
              <div>
                <label>Instagram</label>
                <input data-external-resource-draft="instagram" value="${sanitize(form.instagram)}" placeholder="@usuario" />
              </div>
              <div>
                <label>Correo</label>
                <input data-external-resource-draft="email" value="${sanitize(form.email)}" placeholder="correo@dominio.cl" />
              </div>
              <div>
                <label>Página web</label>
                <input data-external-resource-draft="website" value="${sanitize(form.website)}" placeholder="https://..." />
              </div>
              <div>
                <label>Estado</label>
                <select data-external-resource-draft="status">
                  <option value="Activo" ${form.status === 'Activo' ? 'selected' : ''}>Activo</option>
                  <option value="Inactivo" ${form.status === 'Inactivo' ? 'selected' : ''}>Inactivo</option>
                </select>
              </div>
            </div>
          </div>
        </div>

        <div class="inline-actions action-pair">
          <button class="btn btn-primary" data-action="save-external-resource">${state.ui.editingExternalResourceId ? 'Actualizar Contacto' : 'Guardar Contacto'}</button>
          <button class="btn btn-soft btn-icon" data-action="clear-external-resource-form" title="Limpiar ficha" aria-label="Limpiar ficha">${iconSvg('broom')}</button>
        </div>
      </div>

      <div class="card">
        <div class="section-title">
          <h3>Proveedores guardados</h3>
        </div>
        <div class="table-wrap table-compact">
          <table>
            <thead>
              <tr>
                <th>Tipo</th>
                <th>Nombre</th>
                <th>Descripción</th>
                <th>Contacto</th>
                <th>Estado</th>
                <th></th>
              </tr>
            </thead>
            <tbody>${rows || '<tr><td colspan="6" class="empty-state">Aún no hay proveedores guardados.</td></tr>'}</tbody>
          </table>
        </div>
      </div>
    `;
  }

  function renderDatabase() {
    if (state.ui.databaseSection === 'productTypes') return renderProductTypesSection();
    if (state.ui.databaseSection === 'externalResources') return renderExternalResourcesSection();

    const sectionTabs = renderDatabaseSectionTabs();
    const editing = state.database.materials.find((item) => item.id === state.ui.editingMaterialId) || {};
    const draft = state.ui.databaseDraft || {};
    const form = {
      group: draft.group ?? editing.group ?? '',
      groupSelection: draft.groupSelection ?? draft.group ?? (editing.group || ''),
      newGroup: draft.newGroup ?? '',
      name: draft.name ?? editing.name ?? '',
      calculationUnit: draft.calculationUnit ?? editing.calculationUnit ?? 'cm2',
      baseCost: draft.baseCost ?? editing.baseCost ?? 0,
      notes: draft.notes ?? editing.notes ?? '',
      provider: draft.provider ?? editing.provider ?? '',
      supplierAddress: draft.supplierAddress ?? editing.supplierAddress ?? '',
      supplierContact: draft.supplierContact ?? editing.supplierContact ?? '',
      status: draft.status ?? editing.status ?? 'Activo',
      widthCm: draft.widthCm ?? editing.widthCm ?? '',
      heightCm: draft.heightCm ?? editing.heightCm ?? '',
      yieldQuantity: draft.yieldQuantity ?? editing.yieldQuantity ?? '',
      yieldUnit: draft.yieldUnit ?? editing.yieldUnit ?? 'm²',
      imageDataUrl: draft.imageDataUrl ?? editing.imageDataUrl ?? '',
      imageName: draft.imageName ?? editing.imageName ?? '',
      imageMimeType: draft.imageMimeType ?? editing.imageMimeType ?? '',
      imageSizeKb: draft.imageSizeKb ?? editing.imageSizeKb ?? 0
    };

    const defaultGroups = ['Placas', 'Servicio', 'Consumible', 'Accesorio', 'Pintura', 'Terminaciones'];
    const availableGroups = [...new Set([...defaultGroups, ...state.database.materials.map((item) => item.group).filter(Boolean)])];
    const activeFilter = (state.ui.databaseFilter === 'Material' ? 'Placas' : state.ui.databaseFilter) || 'Todos';
    const filterOptions = ['Todos', ...availableGroups];
    let visibleItems = activeFilter === 'Todos'
      ? [...state.database.materials]
      : state.database.materials.filter((item) => item.group === activeFilter);

    visibleItems.sort((a, b) => {
      const da = parseCreatedAtTimestamp(a.createdAt);
      const db = parseCreatedAtTimestamp(b.createdAt);
      return (state.ui.databaseSort === 'date-asc' ? da - db : db - da);
    });
    const filterButtons = filterOptions.map((filter) => `
      <button class="btn filter-chip ${activeFilter === filter ? 'active' : ''}" data-action="set-database-filter" data-filter="${filter}">${filter}</button>
    `).join('');

    const sortButtons = `
      <button class="btn filter-chip ${state.ui.databaseSort === 'date-desc' ? 'active' : ''}" data-action="set-database-sort" data-sort="date-desc">Fecha más reciente</button>
      <button class="btn filter-chip ${state.ui.databaseSort === 'date-asc' ? 'active' : ''}" data-action="set-database-sort" data-sort="date-asc">Fecha más antigua</button>
    `;

    const currentGroupSelection = form.groupSelection === '__new__'
      ? '__new__'
      : (availableGroups.includes(form.groupSelection) ? form.groupSelection : '');
    const groupOptions = [`<option value="" disabled ${!currentGroupSelection ? 'selected' : ''}>Selecciona un grupo</option>`]
      .concat(availableGroups.map((group) => `<option value="${group}" ${currentGroupSelection === group ? 'selected' : ''}>${group}</option>`))
      .join('');
    const nameSuggestions = [...new Set(state.database.materials.map((item) => item.name).filter(Boolean))].sort();
    const preview = calculateMaterialPreview(form);

    const rows = visibleItems.map((item) => {
      const contactText = item.supplierAddress || item.supplierContact
        ? `<strong>Dir:</strong> ${sanitize(item.supplierAddress || 'Sin dirección')}<br><strong>Contacto:</strong> ${sanitize(item.supplierContact || 'Sin contacto')}`
        : '<strong>Dir:</strong> Sin dirección<br><strong>Contacto:</strong> Sin contacto';
      return `
      <tr class="${item.status === 'Inactivo' ? 'row-inactive' : ''}">
        <td>
          <div class="status-group-cell">
            <span class="group-cell-label">${sanitize(item.group)}</span>
            <button class="btn-icon btn-status-plain" title="${item.status === 'Inactivo' ? 'Marcar como activo' : 'Marcar como inactivo'}" aria-label="Cambiar estado" data-action="toggle-material-status" data-id="${item.id}">${item.status === 'Inactivo' ? iconSvg('statusOff') : iconSvg('statusOn')}</button>
          </div>
        </td>
        <td>
          <strong class="db-item-name">${sanitize(item.name)}</strong>
          <div class="small">${sanitize(item.provider || 'Sin proveedor')}</div>
        </td>
        <td>${sanitize(item.createdAt || '-')}</td>
        <td>${formatCurrencySmart(item.baseCost)}</td>
        <td>${formatCurrencySmart(item.unitCost)} <div class="small">${sanitize(item.formulaSummary || '')}</div></td>
        <td>${sanitize(item.notes || '')}</td>
        <td>
          <div class="button-group compact-actions">
            ${item.imageDataUrl ? `
              <span class="image-chip" tabindex="0" aria-label="Ver miniatura">
                ▨
                <span class="image-tooltip"><img src="${sanitize(item.imageDataUrl)}" alt="${sanitize(item.name)}" /></span>
              </span>
            ` : ''}
            <span class="contact-chip" tabindex="0" aria-label="Ver datos de contacto">
              ◈
              <span class="contact-tooltip">${contactText}</span>
            </span>
            <button class="btn btn-soft btn-icon" title="Editar registro" aria-label="Editar registro" data-action="edit-material" data-id="${item.id}">${iconSvg('edit')}</button>
            <button class="btn btn-soft btn-icon" title="Duplicar registro" aria-label="Duplicar registro" data-action="duplicate-material" data-id="${item.id}">⧉</button>
            <button class="btn btn-soft btn-icon" title="Eliminar registro" aria-label="Eliminar registro" data-action="delete-material" data-id="${item.id}">${iconSvg('trash')}</button>
          </div>
        </td>
      </tr>
    `;
    }).join('');

    return `
      ${sectionTabs}
      <div class="card">
        <div class="section-title">
          <div>
            <h2>Base de datos</h2>
            <p class="subtitle">Crea, ordena y reutiliza tus insumos, servicios y referencias de compra con el mismo criterio visual del resto de la app.</p>
          </div>
        </div>

        <div class="database-form-layout">
          <div class="form-section">
            <div class="form-section-title"><span class="form-step">1</span> Identificación del ítem</div>
            <div class="database-grid database-grid-3 compact-grid align-end">
              <div class="field-wide-2">
                <label>Nombre del ítem</label>
                <input id="material-name" data-db-draft="name" list="material-name-suggestions" value="${sanitize(form.name)}" placeholder="Ejemplo: Acrílico negro 3 mm" />
                <datalist id="material-name-suggestions">
                  ${nameSuggestions.map((name) => `<option value="${sanitize(name)}"></option>`).join('')}
                </datalist>
              </div>
              <div>
                <label>Grupo</label>
                <select id="material-group-select" data-db-draft="groupSelection">
                  ${groupOptions}
                  <option value="__new__" ${currentGroupSelection === '__new__' ? 'selected' : ''}>Nuevo grupo…</option>
                </select>
              </div>
              ${currentGroupSelection === '__new__' ? `
                <div class="field-wide-2">
                  <label>Nombre del nuevo grupo</label>
                  <input id="material-new-group" data-db-draft="newGroup" value="${sanitize(form.newGroup || form.group || '')}" placeholder="Ejemplo: Quincallería" />
                </div>
              ` : ''}
              <div>
                <label>Proveedor</label>
                <input id="material-provider" data-db-draft="provider" value="${sanitize(form.provider)}" placeholder="Nombre proveedor o tienda" />
              </div>
            </div>
          </div>

          <div class="form-section">
            <div class="form-section-title"><span class="form-step">2</span> Costeo base</div>
            <div class="database-grid database-grid-3 compact-grid costeo-grid align-end">
              <div>
                <label class="label-with-tip">
                  <span>Unidad base de cálculo</span>
                  ${renderInfoTip('Selecciona cómo se costeará este registro en el presupuestador: por superficie, por rendimiento, por minuto o por unidad.')}
                </label>
                <select id="material-calculation-unit" data-db-draft="calculationUnit">
                  ${renderCalculationUnitOptions(form.calculationUnit)}
                </select>
              </div>
              <div>
                <label>Precio $</label>
                <input id="material-base-cost" type="text" data-format="clp" min="0" step="1" data-db-draft="baseCost" value="${formatNumber(form.baseCost || 0)}" placeholder="Precio en CLP" />
              </div>
              <div class="formula-preview formula-preview-compact card-soft">
                <strong>Resultado aplicado</strong>
                <div class="small">${sanitize(preview.description)}</div>
                <div><strong>${formatCurrencySmart(preview.unitCost)}</strong> por ${sanitize(preview.referenceUnit)}</div>
              </div>
            </div>

            ${renderDatabaseCalculationFields(form)}
          </div>

          <div class="database-grid database-grid-2 compact-grid database-grid-split">
            <div class="form-section">
              <div class="form-section-title"><span class="form-step">3</span> Contacto y compra</div>
              <div class="database-grid compact-grid">
                <div>
                  <label>Dirección proveedor</label>
                  <input id="material-supplier-address" data-db-draft="supplierAddress" value="${sanitize(form.supplierAddress)}" placeholder="Dirección o ubicación de compra" />
                </div>
                <div>
                  <label>Contacto</label>
                  <input id="material-supplier-contact" data-db-draft="supplierContact" value="${sanitize(form.supplierContact)}" placeholder="Teléfono, web, correo, Instagram..." />
                </div>
              </div>
            </div>

            <div class="form-section">
              <div class="form-section-title"><span class="form-step">4</span> Imagen opcional</div>
              <label>Miniatura del ítem</label>
              <input id="material-image" type="file" accept="image/webp,image/jpeg,image/png" />
              <div class="small">Usa idealmente WebP. También sirve JPG o PNG liviano. Tamaño sugerido: 300 × 300 px y máximo 150 KB.</div>
              ${form.imageDataUrl ? `
                <div class="material-image-preview">
                  <img src="${sanitize(form.imageDataUrl)}" alt="Vista previa" />
                  <div>
                    <strong>${sanitize(form.imageName || 'Imagen cargada')}</strong>
                    <div class="small">${form.imageSizeKb || 0} KB · ${sanitize(form.imageMimeType || 'imagen')}</div>
                    <button class="btn btn-soft" type="button" data-action="remove-material-image">Quitar imagen</button>
                  </div>
                </div>
              ` : ''}
            </div>
          </div>

          <div class="form-section">
            <div class="form-section-title"><span class="form-step">5</span> Notas internas</div>
            <label>Notas</label>
            <textarea id="material-notes" data-db-draft="notes">${sanitize(form.notes)}</textarea>
          </div>
        </div>

        <div class="inline-actions action-pair">
          <button class="btn btn-primary" data-action="save-material">${state.ui.editingMaterialId ? 'Actualizar insumo' : 'Guardar Insumo'}</button>
          <button class="btn btn-soft btn-icon" data-action="clear-material-form" title="Limpiar ficha" aria-label="Limpiar ficha">${iconSvg('broom')}</button>
          ${state.ui.editingMaterialId ? '<button class="btn btn-soft" data-action="cancel-edit-material">Cancelar edición</button>' : ''}
        </div>
      </div>

      <div class="card">
        <div class="section-title">
          <h3>Base de datos actual</h3>
          <span class="pill ok">${visibleItems.length} visibles / ${state.database.materials.length} registros</span>
        </div>
        <div class="filter-row">${filterButtons}</div>
        <div class="filter-row">${sortButtons}</div>
        <div class="table-wrap table-compact">
          <table class="database-items-table">
            <thead>
              <tr>
                <th>Grupo</th>
                <th>Nombre</th>
                <th>Fecha</th>
                <th>Costo base</th>
                <th>Resultado aplicado</th>
                <th>Notas</th>
                <th></th>
              </tr>
            </thead>
            <tbody>${rows || '<tr><td colspan="7" class="empty-state">Tu base de datos está vacía. Comienza creando tu primer registro.</td></tr>'}</tbody>
          </table>
        </div>

      </div>
    `;
  }

  function renderInternalSummary(calc) {
    const summary = calc.quoteSummary;
    const materialRows = summary.materialLines.map((line) => `
      <tr>
        <td>${sanitize(line.material?.name || 'Sin material')}${String(line.comment || '').trim() ? ` <span class="small">(${sanitize(String(line.comment).trim())})</span>` : ''}</td>
        <td>${line.quantity}</td>
        <td>${sanitize(line.material?.unit || '')}</td>
        <td>${formatCurrency(line.lineTotal)}</td>
      </tr>
    `).join('');

    const laborRows = summary.laborLines.map((line) => `
      <tr>
        <td>${sanitize(line.employee?.name || line.externalResource?.name || line.customEmployeeName || 'Sin asignar')}</td>
        <td>${line.hours}</td>
        <td>${formatCurrency(line.realRate || line.rate || 0)}</td>
        <td>${formatCurrency(line.lineTotal)}</td>
      </tr>
    `).join('');

    return `
      <div class="print-sheet">
        <div class="section-title">
          <div>
            <h2>Resumen interno de presupuesto</h2>
            <p class="subtitle">Documento interno pensado para revisión, guardado e impresión en PDF.</p>
          </div>
          <button class="btn btn-primary" data-action="print-summary">Imprimir o guardar PDF</button>
        </div>

        <div class="grid-2">
          <div><strong>Título de orden:</strong><br />${sanitize(state.quote.orderTitle || '-')}</div>
          <div><strong>Número de orden:</strong><br />${sanitize(state.quote.orderNumber || '-')}</div>
          <div><strong>Cliente:</strong><br />${sanitize(state.quote.customerName)}</div>
          <div><strong>Producto:</strong><br />${sanitize(state.quote.productName)}</div>
          <div><strong>Fecha:</strong><br />${sanitize(state.quote.quoteDate)}</div>
          <div><strong>Estado:</strong><br />${renderOrderStatusPill(state.quote.status || 'Prospecto')}</div>
          <div><strong>Modalidad logística:</strong><br />${sanitize(state.quote.logistics.mode)}</div>
        </div>

        <div class="hr"></div>
        <p><strong>Descripción:</strong><br />${sanitize(state.quote.description)}</p>

        <h3>Materia prima y servicios</h3>
        <div class="table-wrap">
          <table>
            <thead>
              <tr><th>Ítem</th><th>Cantidad</th><th>Unidad</th><th>Total</th></tr>
            </thead>
            <tbody>${materialRows || '<tr><td colspan="4" class="empty-state">Sin ítems</td></tr>'}</tbody>
          </table>
        </div>

        <h3>Mano de obra</h3>
        <div class="table-wrap">
          <table>
            <thead>
              <tr><th>Empleado</th><th>Horas</th><th>Valor hora</th><th>Total</th></tr>
            </thead>
            <tbody>${laborRows || '<tr><td colspan="4" class="empty-state">Sin mano de obra</td></tr>'}</tbody>
          </table>
        </div>

        <h3>Resumen económico</h3>
        <div class="grid-3">
          <div class="kpi-box"><span>Materia prima total</span><strong>${formatCurrency(summary.materialsTotal)}</strong></div>
          <div class="kpi-box"><span>Mano de obra total</span><strong>${formatCurrency(summary.laborTotal)}</strong></div>
          <div class="kpi-box"><span>CIF aplicados</span><strong>${formatCurrency(summary.cifTotal)}</strong></div>
          <div class="kpi-box"><span>Costo de una unidad</span><strong>${formatCurrency(summary.unitCost)}</strong></div>
          <div class="kpi-box"><span>Unidades</span><strong>${summary.pieceQuantity || 1}</strong></div>
          <div class="kpi-box"><span>Subtotal producción (× unidades)</span><strong>${formatCurrency(summary.productionCost)}</strong></div>
          <div class="kpi-box"><span>Logística</span><strong>${formatCurrency(summary.logisticsTotal)}</strong></div>
          <div class="kpi-box"><span>Costo total real</span><strong>${formatCurrency(summary.totalCost)}</strong></div>
          <div class="kpi-box"><span>Precio seleccionado</span><strong>${formatCurrency(summary.effectiveNet)}</strong></div>
          <div class="kpi-box"><span>Margen real</span><strong>${formatPercent(summary.realMargin)}</strong></div>
          <div class="kpi-box"><span>Utilidad CLP</span><strong>${formatCurrency(summary.contribution)}</strong></div>
          <div class="kpi-box"><span>Estado</span><strong>${sanitize(summary.selectedStatus?.text || 'Dentro de las metas definidas')}</strong></div>
        </div>
        <p class="help">${sanitize(summary.averageSaleSignal?.text || '')}</p>
      </div>
    `;
  }

  function renderInfoTip(text) {
    return `<span class="info-tip" tabindex="0" data-tooltip="${sanitize(text)}" title="${sanitize(text)}">${iconSvg('info', 'info-tip-icon')}</span>`;
  }

  function renderPeriodicityOptions(current) {
    return [
      ['mensual', 'Mensual'],
      ['trimestral', 'Trimestral'],
      ['anual', 'Anual'],
      ['unico', 'Único']
    ].map(([value, label]) => `<option value="${value}" ${current === value ? 'selected' : ''}>${label}</option>`).join('');
  }

  // app.js puede cargarse después de DOMContentLoaded (tras el login de sync.js).
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
