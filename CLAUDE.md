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
3. `assets/js/calculations.js` → `window.ERMCalc` (pure math; despite the name suggestion elsewhere, the actual global is `ERMCalc`, not `ERMCalculations`)
4. `assets/js/app.js` (~12.3k lines: all tab renderers, event handlers, UI state) — a closed IIFE, it exposes nothing on `window`. Rendered into a single `#main-panel` that is re-rendered on every state change; `render()` also saves state on every call.

Third-party libs (jspdf, jszip) are under `assets/js/vendor/`. `assets/js/sync.js` also creates the fixed session panel (`#session-panel` in `index.html`, hidden until login) showing "Sesión de: Andrés Baeza", "Cerrar Sesión" and "Guardar Bases" (the latter dispatches `data-action="save-all-bases-now"`, handled in app.js's global click listener since it's delegated on `document`, not scoped to `#main-panel`). Per-section green "save check" buttons were removed in favor of this single global save action — don't reintroduce per-tab save buttons; if a tab needs explicit save confirmation, use `triggerSaveFeedback(slotKey, baseKey)` and `renderSaveFeedback(slotKey)` (already used by Gastos' autosave).

State is one object in `localStorage` key `erm-proyecta-state-v1`, with branches: `scenario`, `quote`, `database`, `contacts`, `orders`, `inventory`, `expenses`, `attendance`, `finance`, `ui` (ephemeral flags/drafts/theme).

### Adding or changing state
New field → default in `ERMDefaults` (data.js) **and** normalization/migration in `ERMStorage.load()` (storage.js). Confirm an old JSON export still imports without data loss (the Backup tab exports bases individually or as ZIP, embedding images as `imageDataUrl` and PDFs as `pdfDataUrl`).

### Math rules (re-validate before changing; all math belongs in calculations.js)
- margen real = (precio − costo) / precio
- precio objetivo = costo total / (1 − margen objetivo)
- tasa CIF/h = CIF del período / horas productivas; horas productivas = horas disponibles × eficiencia
- Logistics is added to total cost *before* computing the suggested price.

### Tabs
Escenario, Presupuestador, Base de datos, Clientes, Panel OT, Inventario, Gastos, Asistencia, Finanzas, Backup (Respaldo), Ayuda técnica. There is no "Apps" tab in the current codebase. Desktop navigation is a fixed sidebar in `index.html` grouped by family (Producción, Dinero, Taller, Ajustes) plus a "+ Nuevo" menu (`#new-menu`); on mobile (≤780px) it becomes a top bar plus a bottom tab bar, and `mobile-home` lists the same families. Any element with `data-view` acts as a navigation button (`renderTabs()` toggles `.active`), so never put `data-view` on containers.

Visual line (2.1): AndiWorks brand — ink `#15181D`, white, workshop grey `#EEF0EE`, laser orange `#F26A1B` only as accent ("+ Nuevo", keyboard focus); Barlow Condensed for headings, Barlow for text, IBM Plex Mono for figures; 4px radius on controls, 6px on cards. Tokens live at the top of `styles.css`. Each desktop section starts with `renderPageHead(family, title, subtitle, actions)` (and `renderPageTabs` for sub-views); create/edit forms open as a closable ficha (`state.ui.databaseFormOpen`, `contactFormOpen`) above the list. OT payment state (paid / por cobrar) comes only from `getOrderPaymentStatus(order)` — don't recompute it elsewhere.

Stage 3 features (2.1.2):
- Desktop starts in `home` ("¿Qué tengo que hacer hoy?", `getTodayItems()`); mobile starts in `mobile-home`, which embeds the same today panel.
- Undo: a capture-phase click/change listener snapshots the data branches; `logActivity()` pushes that snapshot onto an in-memory stack (last 15, lost on reload); `undoLastAction()` restores it. Pass `{ undoable: false }` for log lines that don't change data.
- Expense due dates: `card.dueDay` (0 = none) + `card.firstDueMonth`; `getExpenseEntryDueDate()` / `getExpenseDueList()`.
- Annual sales goal: `ERMCalc.annualSalesGoal(scenario)` (manual `scenario.annualSalesGoal` > 0 overrides); progress from Finanzas Ventas net of IVA, excluding prototypes.
- Attendance per OT: `activeSession.orderIds` / `orderTimeMs` / `orderAllocSince` split worked time equally across the marked OT (`allocateSessionOrderTime`); closed records keep `orderTimeMs`. Machine timers live in `attendance.machineTimers` / `machineRecords`. `[data-live-since]` elements tick via `syncLiveTimers()`.
- Enlaces (`links` view): stored in `scenario.links` (so it syncs and is backed up with Escenario); only http(s) URLs; `pinned` ones render in `#sidebar-links`.
- Gastos timeline (`renderExpenseTimeline`) and "Pagar" (`pay-expense-entry`: marks the cuota paid and opens a prefilled Finanzas egreso). Finanzas insights: `getFinanceInsights()`.
- Insumos, Clientes and Inventario equipment use `.db-split` (list + sticky ficha side by side from 1280px).
- Inventario: equipment has `maintenanceEveryDays` / `lastMaintenanceDate` (`getEquipmentMaintenance`); `inventory.wishItems` is the "Quiero comprar" list with offers; "Lo compré" moves it to equipment and opens a Herramientas egreso.
- Escenario is split into tabs (`state.ui.scenarioTab`); the tabs live outside the lock `<fieldset>`.
- Presupuestador: numbered steps (`#quote-step-1`…`7`, sticky `.quote-steps` nav, `scroll-quote-step`) with cost colors; inputs keep their original `data-model` / `data-collection` attributes. Margin comparisons use a 1e-6 tolerance (price rounding leaves 0.3499999… at the minimum).
- Presupuestador materials: search box `#quote-mat-search` (`searchQuoteMaterials`, accent-insensitive; Enter adds the first match), "Frecuentes" from saved OT, and for cm² materials an optional detail row (`pieceWidthCm` × `pieceHeightCm` × `pieceCount` → `quantity`, quick waste chips, plate usage). On mobile the material/labor tables render as cards via `td[data-label]`.
- Form controls share one height (`--field-h`, 40px) and labels have a fixed height so fields in a row align; labels inside form grids are single-line with ellipsis.
- OT ficha has a "Tiempo" tab (`getOrderTimeDetail`): human hours, machine hours, total, per shift and per machine.
- The login screen (sync.js) uses `assets/logo/logoapp.svg` with a CSS laser-cut animation; model-viewer is no longer loaded.

Before editing, read the relevant render function in app.js and the state slice it touches. Visual changes go in `assets/css/styles.css`.
