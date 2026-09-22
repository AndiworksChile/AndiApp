# Guia Build Final Windows 10 (AndiApp 1.1.0 estable)

La mejor forma de obtener el build final de Windows 10 es construir directamente en una maquina Windows con MSVC.

## Recomendacion principal

1. Usar Windows 10/11 para el build de Windows.
2. Dejar macOS solo para el build macOS.
3. Si quieres automatizar, usar GitHub Actions con `windows-latest`.

## Pasos en Windows (local)

1. Instalar Rust con `rustup`.
2. Instalar Node.js LTS.
3. Instalar Visual Studio Build Tools 2022 con:
   - C++ build tools (MSVC)
   - Windows SDK
4. Abrir el proyecto en VS Code.
5. En terminal (PowerShell o CMD), dentro del proyecto:

```bash
npm install
rustup target add x86_64-pc-windows-msvc
npm run tauri:build -- --target x86_64-pc-windows-msvc
```

## Ubicacion esperada del artefacto

- `src-tauri/target/x86_64-pc-windows-msvc/release/bundle/`

Normalmente veras `.msi` y/o `.exe` segun configuracion de Tauri/bundler.

## Nombre final recomendado

- `AndiApp_1.1.0_estable_Windows10_x64.msi`
- o `AndiApp_1.1.0_estable_Windows10_x64.exe`

## Checklist rapido de validacion

1. Abrir app y entrar a Central de respaldo.
2. Probar exportar ZIP y una base individual con Guardar como.
3. Probar visor PDF interno y descarga PDF.
4. Probar guardar OT y eliminar OT.
5. Confirmar version visible: 1.1.0 estable.

## Nota tecnica

Si intentas compilar Windows desde macOS, suelen faltar toolchains (`llvm-rc` o `mingw dlltool`) y el build puede fallar. Por eso se recomienda compilar en Windows con MSVC instalado.
