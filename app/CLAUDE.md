# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

AndiApp / ERM Proyecta: internal management app for AndiWorks (scenario planning, job costing/OT, materials DB, clients, inventory, expenses, attendance, finance). Vanilla HTML/CSS/JS, no framework, no backend, no bundler. Persistence is `localStorage`, or Firestore when `assets/js/firebase-config.js` is filled in (`assets/js/sync.js`: email/password login, per-branch sync, attachments split into chunks; `ui` stays local; rules in `firestore.rules`). sync.js loads app.js after login. Browser-only web app (the Tauri desktop build was removed). UI text and docs are in Spanish. The app lives in `app/` (this directory); the parent folder holds release/guide docs and the unrelated `google sheets/` Apps Script files.

## Commands

Run from `app/`:

```bash
npm run dev:web       # serve . at http://localhost:1420
npm run build:web     # rm -rf dist, copy index.html + assets into dist/ (gitignored, for hosting)
```

No tests and no linter (`npm test` fails intentionally). Verify by loading localhost:1420 and exercising the affected tab.

## Architecture

`index.html` is the sole entry point. It loads plain `<script>` globals in this order (order matters):

1. `assets/js/data.js` → `window.ERMDefaults` (initial state shape + demo data)
2. `assets/js/storage.js` → `window.ERMStorage` (load/save/reset, schema migrations)
3. `assets/js/calculations.js` → `window.ERMCalculations` (pure math)
4. `assets/js/app.js` → `window.ERMApp` (~12.5k lines: all tab renderers, event handlers, UI state). Rendered into a single `#main-panel` that is re-rendered on state changes.

Third-party libs (jspdf, jszip) are under `assets/js/vendor/`.

State is one object in `localStorage` key `erm-proyecta-state-v1`, with branches: `scenario`, `quote`, `database`, `contacts`, `orders`, `inventory`, `expenses`, `attendance`, `finance`, `ui` (ephemeral flags/drafts/theme).

### Adding or changing state
New field → default in `ERMDefaults` (data.js) **and** normalization/migration in `ERMStorage.load()` (storage.js). Confirm an old JSON export still imports without data loss (the Backup tab exports bases individually or as ZIP, embedding images as `imageDataUrl` and PDFs as `pdfDataUrl`).

### Math rules (re-validate before changing; all math belongs in calculations.js)
- margen real = (precio − costo) / precio
- precio objetivo = costo total / (1 − margen objetivo)
- tasa CIF/h = CIF del período / horas productivas; horas productivas = horas disponibles × eficiencia
- Logistics is added to total cost *before* computing the suggested price.

### Tabs
Escenario, Presupuestador, Base de datos, Clientes, Panel OT, Inventario, Gastos, Asistencia, Finanzas, Apps, Backup.

Before editing, read the relevant render function in app.js and the state slice it touches. Visual changes go in `assets/css/styles.css`.
