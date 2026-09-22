# Playbook de actualizaciones AndiApp

## Estado release actual
- Fecha: 2026-05-04
- Version activa de trabajo: 1.2.1 no-estable
- Estrategia: release manual sin updater automatico

## Objetivo
Publicar nuevas versiones de AndiApp con seguridad operativa, sin perdida de datos, y con trazabilidad completa del cambio.

## Regla de trabajo recomendada
- Una sesion nueva por paquete de cambios importante.
- Cambios pequenos, validables y con alcance claro.
- Actualizar BASE_IA_PROYECTO_ANDIAPP.md al cierre de cada release.

## Checklist de desarrollo
1. Definir alcance y riesgos.
2. Implementar cambios por bloques pequenos.
3. Verificar errores/lint en archivos tocados.
4. Validar flujos clave de toda la app:
- Escenario
- Presupuestador
- Base de datos
- Clientes
- Panel OT
- Inventario
- Gastos
- Backup center

## Checklist de respaldos y datos
1. Probar exportacion individual de bases.
2. Probar exportacion ZIP total.
3. Confirmar que viajan correctamente:
- imagenes en imageDataUrl
- PDF en pdfDataUrl
- metadatos de archivo (nombre, tipo, peso)
4. Probar reimportacion del ZIP y validar integridad.

## Versionado
1. Subir version en src-tauri/tauri.conf.json antes del build.
1. Alinear tambien package.json, src-tauri/Cargo.toml, index.html y etiqueta visible en footer.
2. Registrar cambios de la version en notas de release.
3. Evitar builds funcionalmente distintos con el mismo numero de version.

## Comandos de build
### Apple Silicon (DMG)
```bash
npm run tauri:build -- --target aarch64-apple-darwin
```

### Apple Intel (DMG)
```bash
npm run tauri:build -- --target x86_64-apple-darwin
```

### Windows (MSVC)
```bash
npm run tauri:build -- --target x86_64-pc-windows-msvc
```

## Verificacion post-build
1. Confirmar artefactos generados (ruta, fecha, tamano).
2. Instalar en limpio o reemplazar app previa cerrada.
3. Abrir la app instalada (no una copia antigua del build folder).
4. Confirmar version y cambios esperados.

## Prevencion de "se instala pero abre version vieja"
1. Cerrar AndiApp.
2. Eliminar copia previa en /Applications/AndiApp.app si aplica.
3. Copiar nueva app desde el DMG.
4. Abrir desde Applications.
5. Si persiste confusion, revisar accesos de Spotlight/Launchpad.

## Cierre de release
1. Registrar en BASE_IA_PROYECTO_ANDIAPP.md:
- fecha
- alcance
- archivos tocados
- riesgos/pedientes
2. Guardar evidencia de build ejecutado.
3. Dejar definido el siguiente paquete de trabajo.

## Plantilla rapida de release
- Version:
- Fecha:
- Alcance:
- Archivos tocados:
- Pruebas realizadas:
- Resultado build Silicon:
- Resultado build Intel:
- Resultado build Windows:
- Riesgos pendientes:
- Proximo paso:
