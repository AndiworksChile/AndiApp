# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this project is

**AndiApp** (ERM Proyecta) is an internal management platform for AndiWorks — a small production/fabrication business. It centralizes scenario planning, job costing (OT), materials database, clients, inventory, expenses, and finances in a single-file vanilla JS app. No frameworks, no backend.

## Commands

All commands run from `app/`:

```bash
npm run dev:web       # serve at http://localhost:1420 for browser dev
npm run tauri:dev     # run as desktop app (requires Rust + Tauri CLI)
npm run build:web     # copy files to dist/ (no JS bundling)
npm run tauri:build   # build distributable .dmg / .exe
```

There are no automated tests (`npm test` exits with error intentionally).

To verify changes: open the browser at localhost:1420 and exercise the affected module manually.

## Architecture

**Stack**: HTML + CSS + JavaScript vanilla. Persistence via `localStorage`. Packaged as desktop app with Tauri 2.x.

All JS files are globals loaded in order via `<script>` tags — there is no module bundler. The load order matters:

1. `assets/js/data.js` → defines `window.ERMDefaults` (initial state shape + demo data)
2. `assets/js/storage.js` → defines `window.ERMStorage` (load/save/reset + schema migrations)
3. `assets/js/calculations.js` → defines `window.ERMCalculations` (all math, no side effects)
4. `assets/js/app.js` → defines `window.ERMApp` (render functions, event handlers, UI state) — ~10 000 lines

`index.html` is the only entry point. It defines the tab navigation and a single `<section id="main-panel">` that is re-rendered by `app.js` on every state change.

### State model

The global state lives in `localStorage` under key `erm-proyecta-state-v1`. Top-level branches:

| Branch | Contents |
|---|---|
| `scenario` | Period config, fixed costs, employees, efficiency, IVA rate, margins |
| `quote` | Active work order being budgeted (materials, labor, logistics) |
| `database` | Materials catalog, product types, external resources |
| `contacts` | Client records |
| `orders` | Saved work orders (OT) |
| `inventory` | Desired equipment items and offers |
| `expenses` | Expense cards (periodic bills like water, power, F29) |
| `attendance` | Clock-in/out records |
| `finance` | Financial ledger entries and initial balance |
| `ui` | UI-only ephemeral flags (active filters, draft edits, theme) |

`ERMStorage.load()` merges saved state with `ERMDefaults` and runs inline migrations. Any schema change must be handled there.

### Key math rules (never change without re-validating)

- `margen real = (precio - costo) / precio`
- `precio objetivo = costo total / (1 - margen objetivo)`
- `tasa CIF/h = CIF total del período / horas productivas`
- `horas productivas = horas disponibles × eficiencia`
- Logistics cost is added to total cost **before** computing the suggested price, so the real margin is preserved.

### Functional modules (tabs in UI)

1. **Escenario** — economic period config, derives hourly rates and break-even
2. **Presupuestador** — builds an OT: materials, labor (by hour or direct), CIF, logistics, price/margin
3. **Base de datos** — CRUD for materials, product types, external resources
4. **Clientes** — contact management
5. **Panel OT** — saved orders list and status tracking
6. **Inventario** — equipment wishlist with offers
7. **Gastos** — periodic expense cards (monthly/quarterly/annual bills)
8. **Asistencia** — attendance time tracking
9. **Finanzas** — ledger with income/expense entries, IVA tracking
10. **Apps** — mini-apps section
11. **Backup (⤓)** — import/export all bases individually or as ZIP

### Google Sheets integration

`google sheets/` contains standalone Google Apps Script files deployed separately — they are not part of the Tauri/web app build. `importarCartola.gs` parses bank statements; `recordatoriostesta.gs` handles reminders.

### dist/ and build

`npm run build:web` runs `shx` to copy `index.html`, `product-builder.html`, `assets/`, `database/`, `ots/`, and `otra documentacion/` into `dist/`. Tauri points `frontendDist` at `dist/`. The `dist/` folder is committed and should stay in sync.

## How to approach changes

Before editing, read the module affected in `app.js` and understand its render function and the state slice it touches. Changes to math go in `calculations.js`. New state fields need a default in `data.js` and a migration in `storage.js`. Visual changes go in `styles.css`.

When adding a new state field: add the default in `ERMDefaults`, add normalization in `ERMStorage.load()`, and verify that importing an old JSON export still works without data loss.
