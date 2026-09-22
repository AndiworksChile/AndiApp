# Base IA del proyecto AndiApp

## Estado release actual
- Fecha: 2026-05-04
- Version objetivo: 1.2.1 no-estable
- Politica de actualizacion: sin updater automatico (build nueva + reinstalacion limpia)
- Compatibilidad objetivo: web + desktop (Tauri 2.x)

## 1. Identidad del proyecto
AndiApp es una plataforma interna de AndiWorks para modelar escenarios financieros/operativos, calcular costos reales, construir presupuestos y ordenar la ejecucion de trabajos (OT) en un solo sistema.

Su foco es operativo: decisiones rapidas, trazables y realistas para no subcotizar ni perder control del negocio.

## 2. Problema que resuelve
En operaciones pequenas/medianas, los costos se dispersan entre planillas, notas y memoria operativa. Eso produce:
- precios mal definidos,
- margenes no controlados,
- baja trazabilidad de pedidos y gastos,
- dificultad para aprender del historial.

AndiApp centraliza esa informacion y estandariza formulas para sostener decisiones comerciales mas robustas.

## 3. Objetivo general
Convertir conocimiento operativo en un sistema repetible: desde escenario base hasta precio final y seguimiento de la OT, incluyendo gastos e inventario deseado.

## 4. Modulos funcionales
1. Escenario
- Configura periodo, eficiencia, IVA, costos fijos y sueldos.
- Deriva tasas base como valor hora real y CIF por hora.

2. Presupuestador
- Construye ficha tecnica por OT: insumos, mano de obra, CIF, logistica.
- Calcula costo total, precios de referencia, margen real y utilidad.

3. Base de datos
- Administra insumos internos, tipos de producto y ayuda externa.

4. Clientes
- Gestiona base de contactos y relacion comercial.

5. Panel OT
- Consolida ordenes guardadas y estado operativo/comercial.

6. Inventario
- Seguimiento de equipamiento deseado y ofertas asociadas.

7. Gastos
- Control periodico de gastos por card, con soporte de PDF por fila.

Backup center
- Import/export por base y descarga total en ZIP.

## 5. Arquitectura tecnica
Stack:
- HTML + CSS + JavaScript vanilla.
- Persistencia local con localStorage.
- App empaquetable con Tauri.

Archivos clave:
- index.html: estructura general de UI y modales globales.
- assets/js/data.js: defaults oficiales (ERMDefaults).
- assets/js/storage.js: carga/normalizacion/migracion y guardado (ERMStorage).
- assets/js/calculations.js: formulas y calculos de negocio.
- assets/js/app.js: render, eventos, flujo UI y acciones del usuario.
- assets/css/styles.css: sistema visual y layout.

## 6. Principios de diseno/implementacion
- Realismo de costos por sobre optimismo comercial.
- Cambios incrementales, pequenos y verificables.
- Consistencia visual/funcional entre modulos.
- Evitar complejidad innecesaria.
- Mantener trazabilidad de cambios importantes.

## 7. Estado y persistencia
El estado global se guarda en localStorage y combina:
- defaults de ERMDefaults,
- datos historicos del usuario,
- normalizaciones/migraciones para compatibilidad.

Ramas principales del estado:
- scenario
- quote
- database
- inventory
- expenses
- contacts
- orders
- ui

## 8. Convenciones operativas
- No romper flujos existentes sin motivo fuerte.
- No mezclar cambios visuales masivos con cambios logicos profundos en la misma iteracion.
- Validar errores post-cambio en archivos editados.
- Preferir funciones reutilizables y puntos de extension claros.

## 9. Como debe trabajar una IA nueva en este proyecto
Antes de proponer cambios:
1. Leer index.html, app.js, storage.js, data.js, calculations.js, styles.css.
2. Entender el modulo afectado y su impacto cruzado.
3. Priorizar soluciones minimas con mayor valor.
4. Mantener compatibilidad con el estado persistido actual.

## 10. Regla critica de continuidad documental
Esta base debe actualizarse cada vez que haya cambios relevantes.

Minimo a registrar por cambio:
- Fecha
- Modulo/archivo
- Cambio aplicado
- Motivo
- Impacto esperado
- Riesgo y mitigacion
- Pendientes

Si esta base no se mantiene al dia, se pierde contexto y sube el riesgo de regresiones al migrar trabajo entre sesiones o entre IAs.

## 11. Registro historico recomendado
Usar este bloque para mantener continuidad:

### Entrada de cambio (plantilla)
- Fecha:
- Modulo/archivo:
- Cambio aplicado:
- Motivo de negocio/uso:
- Riesgo:
- Mitigacion:
- Pendientes relacionados:

---

## 12. Vision de mediano plazo
Consolidar AndiApp como sistema interno confiable para:
- fijar precios con criterio,
- ejecutar OT con trazabilidad,
- aprender del historial operativo,
- escalar decisiones sin perder control financiero.
