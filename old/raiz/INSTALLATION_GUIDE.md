# AndiApp v1.3.1 - Guía de Instalación para macOS

## 📍 Ubicación del Instalador

**Archivo:** `AndiApp_1.3.1_aarch64.dmg`

**Ruta Completa:**
```
/Users/andresbaeza/Desktop/AndiWorks 2026/Programacion/ERM/app/src-tauri/target/release/bundle/dmg/AndiApp_1.3.1_aarch64.dmg
```

**Tamaño:** 3.4 MB  
**Fecha de Compilación:** 21 de Junio de 2026  
**Arquitectura:** Apple Silicon (aarch64/M1+) y Intel

---

## 📦 Pasos de Instalación

### 1. Descargar el Instalador
El archivo `AndiApp_1.3.1_aarch64.dmg` ya está compilado y listo en la ruta indicada arriba.

### 2. Abrir el Instalador
```bash
# Opción A: Desde Finder
# - Localiza el archivo AndiApp_1.3.1_aarch64.dmg
# - Haz doble clic para montarlo

# Opción B: Desde Terminal
open "/Users/andresbaeza/Desktop/AndiWorks 2026/Programacion/ERM/app/src-tauri/target/release/bundle/dmg/AndiApp_1.3.1_aarch64.dmg"
```

### 3. Instalar la Aplicación
Una vez que el DMG se abra:
- Verás una ventana con el ícono de AndiApp
- Arrastra el ícono a la carpeta **Aplicaciones** (Applications)
- Espera a que se complete la copia (unos segundos)

### 4. Ejecutar la Aplicación
```bash
# Opción A: Desde Finder
# - Abre la carpeta Aplicaciones
# - Busca "AndiApp"
# - Haz doble clic para iniciar

# Opción B: Desde Terminal
open /Applications/AndiApp.app

# Opción C: Usando spotlight
# - Presiona Cmd + Espacio
# - Escribe "AndiApp"
# - Presiona Enter
```

---

## 🔐 Notas de Seguridad en macOS

Si macOS muestra un aviso de seguridad ("El desarrollador no puede ser verificado"):

### Solución 1: Permitir Temporalmente (Recomendado)
```bash
# Ejecuta esto una sola vez
xattr -d com.apple.quarantine /Applications/AndiApp.app
open /Applications/AndiApp.app
```

### Solución 2: System Preferences
1. Abre **System Preferences** → **Security & Privacy**
2. Busca "AndiApp" en el listado
3. Haz clic en **"Open Anyway"**

---

## ✅ Verificación Post-Instalación

Al abrir AndiApp por primera vez:

1. **Interfaz de Usuario**
   - [ ] Se abre una ventana de 800x600 píxeles
   - [ ] La interfaz se ve clara y sin errores

2. **Funcionalidad Básica**
   - [ ] Puedes navegar entre pestañas (Escenario, Presupuestador, etc.)
   - [ ] Los datos de demostración se cargan correctamente

3. **Prueba de Número (Crítico - Validar Fix)**
   - [ ] Ve a la pestaña **Finanzas**
   - [ ] Ingresa una entrada con valor **100000**
   - [ ] Confirma que se guarde como **100.000** en la tabla
   - [ ] Edita la entrada y verifica que el valor sea **100000** (no 100)

4. **Cálculos**
   - [ ] Ve a **Presupuestador**
   - [ ] Crea un presupuesto con materiales y labor
   - [ ] Verifica que los márgenes se calculen correctamente

---

## 💾 Datos y Respaldos

### Primero Inicio
- La app usa **localStorage** para guardar datos localmente en macOS
- Los datos se almacenan de forma segura en tu computadora

### Respaldar Datos
Desde la app:
1. Ve a **Backup (⤓)**
2. Haz clic en **"Exportar todas las bases"**
3. Se descargará un archivo `.zip` con todos tus datos

### Restaurar Datos
1. Ve a **Backup (⤓)**
2. Haz clic en **"Importar ZIP"**
3. Selecciona el archivo `.zip` que guardaste previamente

---

## 🔧 Troubleshooting

### Problema: "AndiApp está dañado y no se puede abrir"
```bash
sudo xattr -rd com.apple.quarantine /Applications/AndiApp.app
```

### Problema: App no inicia
```bash
# Verifica que los permisos sean correctos
chmod +x /Applications/AndiApp.app/Contents/MacOS/app

# Intenta iniciar desde terminal para ver errores
/Applications/AndiApp.app/Contents/MacOS/app
```

### Problema: Datos no se guardan
1. Cierra la app completamente
2. Abre de nuevo
3. Los datos se cargan desde localStorage
4. Si persiste el problema, exporta datos, desinstala y reinstala

### Problema: Performance lenta
- Asegúrate de tener suficiente espacio libre en disco (mínimo 500 MB)
- Si hay muchos registros, considera exportar datos históricos

---

## 📞 Soporte

**Email:** abaezajordan@gmail.com

**Problemas Conocidos:**
- Ninguno conocido en esta versión (1.3.1)

**Cambios en esta Versión:**
- ✅ Corrección crítica: Lectura correcta de números CLP (100000 → "100.000" → 100000)
- ✅ Validación de todos los cálculos matemáticos
- ✅ Build nativa para macOS (Apple Silicon y Intel compatible)

---

## 📋 Especificaciones Técnicas

**Requisitos de Sistema:**
- macOS 10.15 (Catalina) o superior
- 100 MB de espacio libre en disco
- RAM: 512 MB mínimo (1 GB recomendado)

**Tecnología:**
- Framework: Tauri 2.x
- Frontend: HTML + CSS + JavaScript Vanilla
- Backend: Rust (compilado de forma nativa)
- Base de Datos: localStorage (datos locales)

**Características Principales:**
- ✓ Base de datos de materiales
- ✓ Presupuestador inteligente
- ✓ Módulo de finanzas con contabilidad
- ✓ Gestión de inventario
- ✓ Seguimiento de asistencia
- ✓ Cálculos avanzados de márgenes
- ✓ Importación/Exportación de datos
- ✓ Google Sheets Integration (via Apps Script)

---

**Generado automáticamente - 21 de Junio de 2026**
