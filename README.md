# AndiApp

App web interna de AndiWorks (HTML/CSS/JS vanilla, sin build). Datos en `localStorage` o, con Firebase configurado, sincronizados en Firestore.

## Uso local
    npm install
    npm run dev:web     # http://localhost:1420

## Sincronización (Firebase Spark)
1. Consola Firebase → Authentication → habilita "Correo/contraseña" y crea tu usuario.
2. Firestore Database → crea la base y pega `firestore.rules` en la pestaña Reglas.
3. Configuración del proyecto → Tus apps → app web → copia `firebaseConfig` a `assets/js/firebase-config.js`.
4. Authentication → Configuración → Dominios autorizados: agrega `TU_USUARIO.github.io` (y `localhost`).

## Publicar en GitHub Pages
Repositorio → Settings → Pages → Deploy from branch → `main` / carpeta raíz (esta carpeta debe ser la raíz del repo).
