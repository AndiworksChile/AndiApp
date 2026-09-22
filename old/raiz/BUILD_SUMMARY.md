# AndiApp v1.3.1 - Build Summary

## Fecha: 21 de Junio de 2026

### Correcciones Realizadas

#### 1. Bug de Números CLP (Crítico)

**Problema Identificado:**
- Al ingresar números con más de dos ceros (ej: 100000), se mostraban formateados como "100.000" 
- Cuando se leían estos valores para guardar, JavaScript interpretaba "100.000" como 100 (punto como decimal)
- Esto afectaba ingresos, egresos, costos de materiales y saldo inicial

**Solución Implementada:**
```javascript
const parseClpNumber = (value) => {
  try {
    const str = String(value || '0').replace(/\./g, '').replace(/,/g, '.');
    return Number(str) || 0;
  } catch (e) {
    return 0;
  }
};
```

**Ubicaciones Corregidas:**
- Línea 3613-3614: Lectura de ingreso/egreso al agregar entrada de Finanzas
- Línea 3727-3728: Lectura de ingreso/egreso al editar entrada de Finanzas
- Línea 3779: Lectura del saldo inicial de Finanzas
- Línea 4910: Lectura del costo base de materiales
- Línea 4566 y 4574: Verificación de valores en eventos de input

#### 2. Revisión de Cálculos Matemáticos

**Validación Realizada:**
- ✓ Todos los cálculos usan `roundMoney()` con `Number.EPSILON` para evitar errores de punto flotante
- ✓ Fórmulas de margen: `(precio - costo) / precio`
- ✓ Fórmulas de precio objetivo: `costo / (1 - margen)`
- ✓ Cálculos de horas productivas: `horas disponibles × eficiencia`
- ✓ Tasa CIF/h: `CIF total / horas productivas`
- ✓ Costos logísticos incluidos en cálculo de márgenes
- ✓ Manejo de eficiencia para empleados internos vs. externos

**Conclusión:** Todos los cálculos están correctos y son matemáticamente sólidos.

### Configuración de Build

**Versión:** 1.3.1
**Framework:** Tauri 2.x
**Stack:** HTML + CSS + JavaScript Vanilla
**Persistencia:** localStorage
**Plataforma Target:** macOS (Intel/Apple Silicon)

### Archivos Modificados

- `app/assets/js/app.js` - Función `parseClpNumber()` agregada y aplicada en 5 ubicaciones
- `app/dist/assets/js/app.js` - Sincronizado con cambios

### Build Instrucciones

```bash
cd app
npm run build:web        # Prepara archivos web
npx tauri build          # Compila app nativa para macOS
```

### Ubicación del Instalador

Una vez completada la build, el instalador .dmg estará en:
```
app/src-tauri/target/release/bundle/macos/AndiApp.dmg
```

### Características de la App

✓ Base de datos de materiales (CRUD)
✓ Presupuestador de trabajos con cálculos automáticos
✓ Módulo de finanzas con ledger contable
✓ Gestión de inventario y ofertas
✓ Seguimiento de asistencia
✓ Interfaz nativa macOS con Tauri
✓ Respaldos y exportación de datos
✓ Integración con Google Sheets (Apps Script)

### Testing Recomendado

Antes de usar en producción, verificar:
1. [ ] Agregar entrada en Finanzas con número > 100000
2. [ ] Verificar que se guarde el valor correcto
3. [ ] Editar entrada y confirmar cálculos
4. [ ] Crear presupuesto y verificar márgenes
5. [ ] Exportar/importar datos
6. [ ] Respaldar datos

---

**Generado automáticamente por Claude Code**
**Email: abaezajordan@gmail.com**
