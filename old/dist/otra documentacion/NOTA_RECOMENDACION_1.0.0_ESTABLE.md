# Nota de Recomendacion - AndiApp 1.0.0 Estable

Fecha: 24-04-2026

## Recomendacion de instalacion

Para esta primera version oficial estable de AndiApp, se recomienda el siguiente flujo:

1. Exportar respaldos desde la Central de respaldos.
2. Cerrar completamente AndiApp.
3. Desinstalar o reemplazar la version anterior.
4. Instalar la build estable desde el instalador oficial:
   - src-tauri/target/release/bundle/dmg/AndiApp_1.0.0_aarch64.dmg
5. Abrir AndiApp e importar respaldos si corresponde.

## Politica de actualizacion vigente

- No se usa actualizacion automatica desde la app.
- Ante cambios grandes, se publica una nueva build estable.
- La migracion se realiza por desinstalacion/instalacion, resguardando datos con export/import de bases.

## Artefactos oficiales vigentes

- Aplicacion macOS:
  - src-tauri/target/release/bundle/macos/AndiApp.app
- Instalador macOS (Apple Silicon):
  - src-tauri/target/release/bundle/dmg/AndiApp_1.0.0_aarch64.dmg

## Observacion

Se eliminaron artefactos antiguos para evitar confusiones de instalacion con versiones previas.
