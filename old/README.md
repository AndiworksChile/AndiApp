# ERM Proyecta

Base inicial para una aplicación interna de escenarios y presupuestos de producción.

## Qué resuelve este MVP

1. Proyecta un escenario por período.
2. Convierte CIF y sueldos en tasas por hora útiles.
3. Presupuesta una orden de trabajo con materiales, mano de obra y logística.
4. Calcula margen real con la fórmula correcta:

   margen = (precio - costo) / precio

5. Entrega un resumen interno listo para imprimir en PDF.

## Decisiones matemáticas importantes

### 1) Horas productivas reales
No se divide por las horas teóricas totales, sino por las horas productivas:

Horas productivas = horas disponibles x eficiencia

Esto evita subestimar la tasa CIF por hora y el costo real de la mano de obra.

### 2) Tasa CIF por hora

Tasa CIF/h = CIF del período / horas productivas del período

### 3) Precio objetivo desde margen real

Precio = costo total / (1 - margen objetivo)

Ejemplo: si el costo total es 100.000 y el margen deseado es 35%, el precio neto correcto es 153.846.

### 4) Logística
La logística se suma al costo total antes de calcular el precio sugerido. Así el margen real no se rompe cuando hay despacho.

## Estructura

- index.html: punto de entrada
- assets/css/styles.css: estilos
- assets/js/data.js: datos demo y estructura inicial del estado
- assets/js/storage.js: persistencia en el navegador
- assets/js/calculations.js: reglas matemáticas y cálculo central
- assets/js/app.js: renderizado e interacción

## Cómo usar

Abre index.html directamente en tu navegador.

## Próximas mejoras recomendadas

- historial de cotizaciones
- exportación PDF con formato más corporativo
- importación desde CSV reales
- ficha de clientes
- biblioteca de plantillas de productos
- centro de costos por máquina o proceso


Finanzas
En un principio, tenia todo el flujo de caja en un única cuenta; movimientos personales y movimientos de la empresa.
Ahora tengo la posibilidad de poder manera todo en una cuenta, pero es super importante, crucial e indispensable que se cálculen bien los números. Po ejemplo, algunos escenarios:
1.- Todos los meses hago el F29, la declaración de impuestos mensuales. Y para eso, tengo que pasarle al Estado los impuestos recolectados en mis ventas (así es, ¿verdad?). Entonces, tiene que estar calculado el número que corresponde al valor del iva. 

2.- Otros escenario es cuando me pagan el abono de la OT. Esto quizas podría estar considerado en el Presupuestador (y, en consecuencia, también el Panel ot) que considere ese 50% que transfieren en las finanas.

3.- En general, las columnas que solía utilizar eran estás, pero completamete abierto a tus comentarios y sugerencias para poder hacer más eficiente e inteligente esta tabla. 

4.- Tengo la posibilidad de descargar las cartolas en determinados formatos (tipo excel, de columnas, txt, etc.) que más adelante, sería ideal tener una herramienta que permita ingresar todo eso de manera inteligente, rápida, que permita seleccionar cuáles entran, cuáles no, etc. ¿me explico? 

Ojalá, que tambien me diga cuando es el sueldo que me tengo que transferir, según total de OT terminadas, asi mismo con el IVA que haya que pagar con cada mes. Sería buenisimo ir teniendo totales para ir sabiendo como voy.
columanas que ocupaba:
# : número de entrada
Fecha: día de ingreso de entrada
Categoría: Ordenaba las entradas por categorias (materiales, sueldo, iva, etc...)
SKU: Que era para diferenciar cada uno, pero aquí sería OT según entiendo, ya que ese me permite diferenciar
Título: Nombre de la entrada, general
Detalle: Detalle de la entrada
Ingreso: si es que hay ingreso
Egreso: si es que hay egreso
Total Banco: sería mi saldo total, igual a lo que tengo en el banco
Luego, en excel, tenia distintas columnas con nombre según las Categorías, que me permitia ver cuando gastaba en un tipo de Categoría y, eventualmente, tomar decisiones. Pero en honor al espacio, y que este todo ordenado, estos totales podrían estar en una sección de totales, inteligente ubicada.

Quedo completamente abierto a comentarios, mejoras, criticas, recomendaciones, sugerencias e ideas innovadoras.


Trofeo Madera Stli
Dimensiones:

Descripción
Fabricado en Roble, este trofeo conmemorativo para el equipo de STLi es un regalo moderno, cálido y personalizado. Con una dedicatoria para cada uno grabado en láser, y terminado en laca acrílica para su durabilidad y conservación. 

Trofeo Mader Stli Conmemorativo

Este es un diseño especial para nuestro cliente STLi, que nos pidió adicionalmente para una ceremonia de conmemoración en agradecimiento para su equipo. Conservando un diseño moderno, simple, con el símbolo representativo del cancer de mamas. Me siento orgulloso de formar parte con este diseño.

Stand QR Grace is God

Elegante, moderno y personalizado. Grabado de ALTA calidad independiente del tamaño. En este caso el logo se redibujo manualmente para logar ese detalle en un grabado pequeño, para un Stand Acrílico compacto y fácil de transportar. Además, está fabricado en acrílico... Dura para toda la vida.

. Materiales -> subcategoria de BDD -> seleccionar un material

. Gastos Generales -> Gatos según BDD -> seleccionar gasto

. Servicios externos -> 

. Ventas -> seleccionar OT -> seleccionar OT
Ingreso Aislado





Documentos de identificación y representación.
*1.- Fotocopia Cédula de Identidad del representante legal.(obligatorio)*
*2.- Escritura de la constitución de la sociedad, original y fotocopia simple. (obligatorio)*
3.- Poder Notarial que autoriza la representación en original, con no más de 1 año de antiguedad (si quien realiza el trámite no es el titular o representante legal). *(opcional)*
4.- Personas Jurídicas sin fines de lucro, adjuntar Certificado de vigencia de persona jurídica sin fines de lucro, Certificado de directorio de persona jurídica sin fines de lucro, ambos emitidos por Registro Civil y Declaración Jurada Simple Municipal. *(opcional)*
5.- Cédula de Identidad por ambos lados de quién realizará el trámite. *(opcional)*
6.- Copia E-Rut de la sociedad. *(opcional)*

Documentación de la Propiedad y Ubicación
*1.- Contrato de arriendo o documento de autorización del dueño de la propiedad, (indicando destino comercial o tributario) en original y fotocopia simple. (obligatorio)*
*2.- Certificado de Avalúo Fiscal, que indique el destino de la propiedad. (obligatorio)*
3.- Permiso de edificación, plano de planta aprobado y recepción final, consideren transformaciones y/o construcciones que existen actualmente. El no contar con esta información, le permite optar a la patente provisoria, situación que será revisada por la Dirección de Obras. *(opcional)*
4.- Contrato de Subarriendo y/o bien Autorización de Uso del espacio *(opcional)*
5.- Leyes especiales ART. 26 Letra D. *(opcional)*
6.- Contrato de arriendo de Oficina Virtual, si corresponde, en original y fotocopia simple. *(opcional)*

Documentos y declaraciones municipales
1.- Certificado de distribución de capital para apertura de sucursal emitido por la municipalidad donde se encuentre la Casa Matriz (cuando la casa matriz se encuentre en otra comuna). *(opcional)*
2.- Certificado de no deuda Municipal extendido por la Municipalidad de donde proviene (Es obligatorio si el traslado es desde otra comuna). *(opcional)*
3.- Patente al día de la comuna que procede (Es obligatorio si el traslado es desde otra comuna). *(opcional)*

Documentos del Servicio de Impuestos Internos (SII)
*1.- Formulario de declaración de inicio de actividades realizada en el Servicio de Impuestos Internos. (obligatorio)*
2.- Balance tributario 8 columnas, desde la fecha de inicio de actividades o desde el cambio de domicilio desde otra comuna. (Si inició actividades durante el presente año, no requiere adjuntar balance(s)). *(opcional)*
3.- Formulario declaración de impuesto a la renta (F22) desde la fecha de inicio de actividades o desde el cambio de domicilio desde otra comuna. (Si inició actividades durante el presente año, no requiere adjuntar declaración (es) de impuesto a la renta) *(opcional)*
4.- Cambio de domicilio o Certificado Histórico de Domicilio ante el Servicio de Impuestos Internos. (en caso de cambio de domicilio dentro de la misma comuna de Santiago o desde otra comuna). *(opcional)*
5.- Copia de certificado de apertura de sucursal extendido por el Servicio de Impuestos Internos.

Antecedentes Otros Organismos Públicos
1.- Resolución Sanitaria Favorable emitida por la Autoridad Sanitaria, cuando la actividad considere la manipulación o expendio de alimentos (solo en caso de actividad productiva). *opcional*
2.- Certificado de Calificación de Actividad Inofensiva otorgado por la Autoridad Sanitaria o Comprobante de ingreso. *opcional*
3.- Comprobante de ingreso de solicitud de Informe Sanitario o Resolución Sanitaria. *opcional*
4.- En casos de Cambio de Razón Social, adjuntar Resolución de Cambio de Razón Social y Resolución Sanitaria Primitiva (Original o Timbrada por el Ministro de fe de Seremi de Salud). *opcional*
5.- Certificado del Registro Civil de inhabilidad para trabajar con menores de edad (para giros relacionados con guarderías, after-school y trabajo con niños en general). *opcional*