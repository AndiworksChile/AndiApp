# Estructura compartida del proyecto ERM Proyecta

Este documento define el mapa común del proyecto para que cada edición futura sea precisa, trazable y ordenada.

## 1. Objetivo central

ERM Proyecta debe permitir:

1. proyectar un escenario económico por período
2. convertir ese escenario en tasas útiles por hora
3. cotizar una orden de trabajo con costos directos e indirectos
4. incorporar logística real
5. emitir un resumen interno imprimible

---

## 2. Módulos funcionales

### Módulo A. Escenario
Responsable de definir el marco económico del período.

**Entradas:**
- período en meses
- CIFs por periodicidad
- empleados
- horas disponibles
- eficiencia productiva
- margen mínimo e ideal

**Salidas:**
- total CIF del período
- total sueldos del período
- horas productivas
- tasa CIF por hora
- valor hora base
- punto de equilibrio mensual
- venta mínima e ideal requeridas
- capital de trabajo sugerido
- venta necesaria para una utilidad objetivo en CLP

### Módulo B. Base de datos interna
Responsable del catálogo reutilizable y de las reglas de costeo por tipo de entrada.

**Contiene:**
- grupo de la entrada
- nombre del material o servicio
- unidad base de cálculo
- costo en CLP
- notas internas
- fórmulas de costeo por cm², rendimiento, minuto o unidad

### Módulo C. Presupuestador
Responsable de construir la orden de trabajo.

**Subsecciones:**
- ficha del producto y cliente
- tabla de materia prima y servicios
- tabla de mano de obra
- aplicación de CIFs
- margen y precio final

### Módulo D. Logística y despacho
Responsable de agregar costos y datos operativos de entrega.

**Modalidades:**
- retiro en taller
- entrega en metro
- entrega a domicilio
- envío por Starken

### Módulo E. Resumen en vivo
Responsable de mostrar resultados mientras se edita el presupuesto.

**Debe mostrar siempre:**
- materia prima total
- mano de obra total
- CIF total
- logística total
- costo total
- precio sugerido mínimo e ideal
- margen real

### Módulo F. Resumen interno / PDF
Responsable del documento final interno.

**Debe servir para:**
- guardar
- imprimir
- revisar internamente
- eventualmente archivar historial

---

## 3. Reglas matemáticas obligatorias

### 3.1 Margen real
Se usa esta fórmula:

Margen real = (Precio - Costo total) / Precio

### 3.2 Precio objetivo
Se obtiene con:

Precio = Costo total / (1 - Margen objetivo)

### 3.3 Tasa CIF por hora
Se obtiene con:

Tasa CIF/h = CIF total del período / Horas productivas del período

### 3.4 Horas productivas
No usar horas teóricas puras. Usar:

Horas productivas = Horas disponibles × Eficiencia

---

## 4. Estructura técnica actual

- index.html → entrada principal
- assets/css/styles.css → estilos
- assets/js/data.js → estado inicial y datos demo
- assets/js/storage.js → persistencia local
- assets/js/calculations.js → motor matemático
- assets/js/app.js → interfaz y eventos

---

## 5. Forma correcta de trabajar juntos en futuras ediciones

Para evitar errores, cada cambio debería indicar siempre:

1. **qué módulo se tocará**
2. **qué objetivo funcional tiene el cambio**
3. **qué fórmula o regla afecta**
4. **qué archivo o archivos participan**
5. **cómo se verificará el resultado**

Ejemplo de pedido ideal:

- editar Módulo C Presupuestador
- agregar cálculo de merma en materiales de madera
- impacta costo directo de materia prima
- archivos: app.js y calculations.js
- verificar con un caso de prueba manual

---

## 6. Orden recomendado de desarrollo

### Etapa 1. Base estable
- escenario
- tasas
- presupuesto básico
- resumen en vivo

### Etapa 2. Datos reales
- cargar tu base real de materiales
- cargar empleados reales
- mejorar categorías y unidades

### Etapa 3. Operación diaria
- historial de cotizaciones
- duplicar presupuesto
- exportar PDF más formal

### Etapa 4. Escalamiento
- clientes
- órdenes guardadas
- reportes por período
- integración con GitHub Pages o backend futuro


### OBSERVACIONES PARA DESPUÉS CORREGIR
- dirección y comuna puede funcionar con google maps automáticamente?

- agregar buscado de clientes

- que el reordenamiento de cards no sea sin mostrar las otras, sino que ponga primero la del criterio seleccionado

- que las cards sean puedan reordenar arrastrandolas con el mouse (como aplicación de app en Iphone)

---

## 7. Etapas de implementación acordadas (abril 2026)

### Etapa 1. Quick Wins UI + Orden OT
- Ajuste de columnas anchas en tablas (Base de datos y Clientes)
- Renombre botón: "Importar Base de datos"
- Validación manual de persistencia y refresco

### Etapa 2. Ficha técnica + Precio definido clásico
- Renombrar "Fecha" a "Fecha de ingreso"
- Agregar "Fecha de entrega estimada"
- Reacomodo visual de ficha técnica
- Tooltip para campo Estado
- Precio definido único: ingreso final con IVA incluido
- Cálculo inferior por impuesto inverso (neto + IVA)
- Validación con casos reales

### Etapa 3. Subbases en Módulo 3
- Subbase: Tipos de producto (CRUD)
- Conexión al Presupuestador en campo Producto (select)
- Subbase: Ayuda externa / servicios / apoyo (CRUD)
- Conexión al Presupuestador en Mano de obra (select)
- Subbotones internos visibles solo en Módulo 3
- Compatibilidad con datos existentes

### Etapa 4. Robustez de datos y rendimiento
- Corregir uso de extraCost en logística
- Mejorar estrategia de almacenamiento de imágenes
- Versionado de esquema para import/export
- Checklist de regresión funcional completa

### Etapa 5 (propuesta previa al checklist final). Inventario de herramientas
- Submódulo para herramientas, accesorios y equipamiento
- Registro de estado: disponible, en mantención, fuera de servicio
- Registro de compras realizadas y compras deseadas
- Campos base sugeridos: fecha, costo, proveedor, vida útil, observaciones
- Integración futura al escenario (deterioro/mantención y reposición)



Botón para guardar la edición sin cambios.

