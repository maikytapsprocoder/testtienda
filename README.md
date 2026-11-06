# Nodo Tecno · tienda de tecnología con Firebase

Tienda web con secciones de **Periféricos, Teléfonos, Electrodomésticos y PCs/componentes**, carrito con totales automáticos, pedidos guardados en Firebase, **aviso por WhatsApp sin que el cliente vea el número** y panel de administración para editar productos, precios, ofertas e imágenes.

Todo el sitio es un solo archivo (`docs/index.html`) más `docs/firebase-config.js`. Sin build obligatorio.

## Probarla ya (modo demo)

Abrí `docs/index.html` en el navegador. Mientras `firebase-config.js` tenga los valores `TU_...`, la tienda corre en **modo demo**: datos de ejemplo guardados solo en tu navegador. Para entrar al panel: pie de página > "Acceso administradores" (usuario `user`, contraseña `123456`).

## Publicarla en GitHub Pages

1. Subí todo el contenido de esta carpeta a tu repositorio.
2. En GitHub: Settings > Pages > Source: *Deploy from a branch*, rama `main`, carpeta `/docs`.
3. La tienda queda en `https://TU_USUARIO.github.io/NOMBRE_DEL_REPO/`.
4. En Firebase > Authentication > Configuración > Dominios autorizados, agregá `TU_USUARIO.github.io`.

Las reglas y la función de WhatsApp igual se despliegan con la CLI de Firebase (pasos 5 y 7 de abajo).

## Publicarla con Firebase

Necesitás Node.js y `npm i -g firebase-tools`.

1. **Proyecto**: en https://console.firebase.google.com creá un proyecto. Agregá una **app web** (`</>`) y copiá la configuración en `docs/firebase-config.js`.
2. **Firestore**: Build > Firestore Database > Crear base de datos. Elegí la región y anotala (se usa en el paso 7).
3. **Usuario administrador** (hacelo *antes* de publicar el sitio):
   - Build > Authentication > Comenzar > Método de acceso > activá **Correo electrónico/contraseña**.
   - Pestaña Users > Agregar usuario: correo `user@tienda-admin.local`, contraseña `123456`.
   - Authentication > Configuración > Acciones del usuario: **desactivá "Habilitar creación (registro)"**, para que nadie más pueda crear cuentas.
   - En el panel se escribe solo `user`; la tienda le agrega `@tienda-admin.local`.
4. **Iniciá sesión en la CLI y vinculá el proyecto** (en esta carpeta): `firebase login` y `firebase use --add`.
5. **Reglas y sitio**: `firebase deploy --only firestore:rules,hosting`.
6. **Primer ingreso**: abrí tu sitio, "Acceso administradores", entrá, andá a **Ajustes** y **cambiá la contraseña**. Después cargá tus productos (o usá "Cargar productos de ejemplo" para ver cómo queda).
7. **WhatsApp automático** (ver más abajo): `firebase deploy --only functions`.

> **Contraseña `123456`**: es la que pediste, pero es muy fácil de adivinar y el usuario `user` también. Cambiala desde Ajustes apenas entres. Quien entre como admin puede cambiar precios y ver los datos de los clientes.

## Cómo se manda el WhatsApp (sin que el cliente lo vea)

Un enlace `wa.me` siempre abre WhatsApp en el celular del cliente, con el número a la vista. Para que **no vea nada**, el envío se hace desde el servidor:

1. El cliente toca **Confirmar pedido** y la tienda guarda el pedido en Firestore. El cliente solo ve "¡Recibimos tu pedido!".
2. La Cloud Function `notifyNewOrder` (`functions/index.js`) se dispara sola, **recalcula el total con los precios reales** del catálogo y manda el mensaje a **+598 98 297 449**. Ese número vive solo en el servidor.
3. En el panel > Pedidos ves cada pedido con su estado de WhatsApp (enviado, pendiente o falló), y un botón para escribirle al cliente.

Las funciones salientes a internet requieren el **plan Blaze** de Firebase (pago por uso; con pocos pedidos el costo es mínimo o cero, pero pide tarjeta).

### Opción A: CallMeBot (gratis, la más simple)
Sirve para recibir mensajes en **tu propio número**. Seguí las instrucciones actuales de https://www.callmebot.com para autorizar tu número y obtener una `apikey`. Luego:

```
firebase functions:secrets:set WA_APIKEY      # pegá la apikey
cp functions/.env.example functions/.env      # revisá WA_PHONE=59898297449
firebase deploy --only functions
```

### Opción B: WhatsApp Cloud API (oficial de Meta)
Más robusta, con más trámite (cuenta de Meta Business). En `functions/.env` poné `WA_PROVIDER=cloudapi` y `WA_PHONE_ID=<id del número>`, y guardá el token con `firebase functions:secrets:set WA_APIKEY`. Meta solo permite texto libre dentro de las 24 h posteriores a que el destinatario te escribió; fuera de esa ventana hace falta una plantilla aprobada (`WA_TEMPLATE`, con un único parámetro de cuerpo).

### Región
En `functions/index.js`, `REGION` debe coincidir con la región de tu Firestore (por defecto `us-central1`).

### Respaldo sin servidor
Si no querés usar Functions todavía: Panel > Ajustes > "Respaldo". Al comprar, se abre el WhatsApp del cliente con el mensaje armado y el cliente lo envía. **En ese modo el cliente sí ve el número.** Está desactivado por defecto.

## Qué hace el panel de administración (`#/admin`)

- **Productos**: editar precio, precio anterior (con valor mayor al precio se muestra como oferta con etiqueta de descuento) y stock directamente en la lista; mostrar/ocultar; crear, editar y eliminar con descripción, características e imagen.
- **Imágenes**: pegar un enlace o subir una foto (se achica y se guarda en Firestore, sin Firebase Storage). Sin foto se usa una ilustración.
- **Ofertas y banners**: los banners de la portada (título, texto, botón, destino, color, imagen, orden).
- **Pedidos**: en tiempo real, con aviso de pedido nuevo, estados y detalle.
- **Ajustes**: nombre, frase, beneficios, medios de pago que aceptás, pie de página, cambio de contraseña, carga de datos de ejemplo.

Los cambios llegan a los clientes en segundos: la tienda escucha Firestore en tiempo real.

## Seguridad

`firestore.rules` permite a cualquiera **leer** catálogo, banners y ajustes, y **crear** pedidos (con validación de forma y tamaño). Solo los administradores listados en `isAdmin()` pueden escribir o ver pedidos. Para sumar otro administrador: creá el usuario en Authentication y agregá su correo a esa lista; luego `firebase deploy --only firestore:rules`.

## Estructura

```
docs/index.html        sitio completo (generado)
docs/firebase-config.js  tu configuración de Firebase
src/                     fuentes del sitio; `node scripts/build.js` regenera docs/index.html
functions/               Cloud Function de WhatsApp (index.js, lib.js) y su prueba (node test.js)
firestore.rules          reglas de seguridad
firebase.json            hosting + reglas + functions
```

Los productos de ejemplo tienen marcas y precios ficticios: reemplazalos por los tuyos.

## Novedades de esta versión

- **Envíos por localidad**: Mercedes sin costo; el resto de $ 50 a $ 500 según distancia (valores estimados, editables en Ajustes > Envíos). Localidades no listadas: se coordina por WhatsApp.
- **Stock automático**: se descuenta al confirmar el pedido (Cloud Function; si no está activa, el panel lo aplica al abrirse).
- **Seguimiento**: `#/pedido/CÓDIGO`. Requiere publicar `firestore.rules` (colección `orderStatus`).
- **Límites**: unidades por pedido y por producto (Ajustes), más protección anti-robot y anti-duplicados.
- **Enlace por producto** (`#/p/ID`), varias fotos por producto, buscador tolerante a errores, flechas en banners.
- **Redes**: `docs/og.png` es la imagen al compartir. Para que funcione, poné en `index.template.html` la URL absoluta de tu sitio en `og:image`. Con hosting estático la vista previa es la misma para todo el sitio (no por producto).
- Páginas: Contacto/mapa/horarios, Servicios, Condiciones, Privacidad (textos de ejemplo, editables en Ajustes).

## Template para varios negocios (etapa 1)

- **`docs/negocio.config.js`** es lo único que se cambia por cliente: nombre, logo, color de marca, redes, WhatsApp, dirección, horarios, categorías iniciales y sucursales. Trae ejemplos de rubros (ropa, caza y pesca).
- **Categorías editables** desde el panel (pestaña Categorías): crear, renombrar, ordenar, cambiar foto y color. No se puede borrar una que tenga productos. Requiere publicar `firestore.rules` (colección `categories`).
- **Color de marca, logo y sucursales** también se editan en Ajustes.
- Rediseño: barra superior con buscador, menú Tienda, mosaico de categorías con foto, carrusel de ofertas, sucursales, paginación y carrito flotante.
- Para armar la tienda de un cliente nuevo: copiá el proyecto, editá `negocio.config.js` y `firebase-config.js`, `node scripts/build.js`, y publicá reglas.

## Categorías 100% variables y arranque en blanco

- Las categorías se crean, renombran y borran desde el panel. Al borrar una con productos, el panel pregunta a cuál moverlos.
- **Cliente nuevo:** copiá `docs/negocio.config.EN-BLANCO.js` encima de `docs/negocio.config.js` (arranca sin productos, banners ni categorías de ejemplo, `sampleData:false`), completá nombre, color, WhatsApp, y poné su `firebase-config.js`.
- La tienda de ejemplo sigue disponible con `sampleData: true`.

## Funciones de venta (todas configurables en Ajustes)

- **Cupones**: `CÓDIGO | 10%` o `CÓDIGO | 200`. Se verifican de nuevo en el servidor (Cloud Function). Son públicos en los datos de la tienda: sirven para promociones.
- **Envío gratis desde un monto** y aviso al cliente de cuánto le falta.
- **Medios de pago por tipo de entrega** (retiro o domicilio) y casilla para mostrar u ocultar el costo junto a cada localidad.
- **Recordar datos del cliente** en su dispositivo, y aviso de "quedan N" en el carrito.

## Entregar la tienda a un cliente (guía rápida)

1. Copiá el proyecto. Copiá `docs/negocio.config.EN-BLANCO.js` sobre `docs/negocio.config.js` y completalo (nombre, color, logo, WhatsApp, dirección, horarios).
2. Creá un proyecto de Firebase para el cliente y pegá su config en `docs/firebase-config.js`. Activá Firestore y Authentication (correo/contraseña), creá el usuario `user@tienda-admin.local`.
3. Publicá `firestore.rules`. Si querés el aviso por WhatsApp automático y stock automático, desplegá `functions/` (plan Blaze).
4. `node scripts/build.js`, subí `docs/` a GitHub Pages o Firebase Hosting y agregá el dominio en Authentication.
5. Entrá a `#/admin`, cambiá la contraseña, creá categorías y productos, ajustá envíos, pagos y textos de páginas (Servicios, Condiciones, Privacidad).

## Variantes (talle, color, etc.)

En el panel, al crear o editar un producto, el campo **Variantes** acepta una línea por grupo (`Talle: S, M, L` / `Color: Negro, Blanco`, hasta 3 grupos). El cliente elige una opción de cada grupo antes de agregar al carrito; cada combinación es una línea del carrito y del pedido. El stock es el total del producto y se reparte entre sus variantes.

## Aviso de pedidos por email (sin servidor)

Ajustes > "Aviso de pedidos por email". Cuenta gratuita en emailjs.com: conectá tu correo (Email Services), creá una plantilla con asunto `{{subject}}` y cuerpo `{{message}}` (destinatario: tu correo) y pegá Service ID, Template ID y Public Key. El botón "Enviar correo de prueba" confirma que funciona. Estos tres datos son públicos por diseño de EmailJS; restringí el servicio a tu dominio desde su panel. Si no querés usar el WhatsApp automático (Cloud Function), esto alcanza.

## Solo catálogo

- Por producto: casillas "Solo catálogo" y "Ocultar el precio" al crear/editar.
- Toda la tienda: Ajustes > "Modo catálogo". Sin carrito; cada producto se consulta por WhatsApp (o en el local si no hay número cargado).

## Carga masiva y respaldo

Productos > "Importar / exportar": descargá la plantilla CSV, completala en Excel o Google Sheets (una fila por producto) y subila. Las secciones nuevas se crean solas; si el nombre coincide con un producto existente, se actualiza (sin duplicar). Antes de guardar se muestra un resumen con las filas que tienen problemas. Admite hasta 500 filas por vez, separador `;` o `,` y precios como `1.250,50`. También exporta productos (mismo formato, sirve de respaldo y se puede volver a importar) y pedidos.

## Más funciones (panel y tienda)

- **Resumen**: pestaña con ventas, pedidos, productos más pedidos y stock bajo.
- **Favoritos y relacionados**: los clientes guardan productos con el corazón (`#/favoritos`) y ven productos relacionados en cada ficha.
- **Retiro en el local**: Ajustes → "Pedir día y hora de retiro". **Datos de transferencia** (alias/CBU): se muestran al elegir transferencia.
- **Usuarios (varios administradores)**: pestaña Usuarios. Requiere habilitar Email/Contraseña en Firebase Auth y republicar `firestore.rules`.
- **Imágenes con Cloudinary** (alternativa gratis a Firebase Storage): Ajustes → completar `cloudName` y `cloudPreset` (preset "unsigned").
- **Versión demo**: `node scripts/make-demo.js` genera `demo/` con cartel de vista previa, para mostrar a clientes.

## Stock por variante
En el formulario del producto, después de cargar las variantes, usá **"Generar combinaciones"** y poné la cantidad de cada una (ej. `M / Negro: 3`). El stock total se calcula solo, las combinaciones agotadas se tachan en la ficha y el pedido descuenta (y al cancelar devuelve) stock de la combinación elegida. También se puede importar con la columna `stock_variantes` del CSV.

## Pago online con Mercado Pago
Hay dos modos (Ajustes → Mercado Pago):
1. **Link de pago fijo** (sin servidor): pegás tu link `mpago.la/…`; el cliente paga y te manda el comprobante.
2. **Checkout automático** (requiere plan Blaze de Firebase): el cliente paga el total exacto de su pedido y el pedido queda marcado **Pagado** solo.
   - Sacá tu *Access Token* de producción en mercadopago.com.uy → Tu negocio → Configuración → Credenciales.
   - `cd functions && npm install && firebase functions:secrets:set MP_ACCESS_TOKEN` y después `firebase deploy --only functions`.
   - Copiá la URL de la función `createMpPayment` que muestra el deploy y pegala en Ajustes ("URL de la función").
   - El aviso de pago llega a `mpWebhook` (se configura solo en cada pago). El servidor consulta el pago a Mercado Pago y verifica monto y pedido antes de marcarlo pagado.
   - Probalo primero con las credenciales de prueba de Mercado Pago.

## Opiniones de clientes
Los clientes dejan puntaje (1–5) y comentario en la ficha del producto, en un apartado desplegable con resumen de estrellas, distribución y páginas de 4 opiniones. Las opiniones quedan **pendientes** y solo se publican cuando las aprobás en el panel → Opiniones (también podés ocultarlas o eliminarlas). Se pueden desactivar en Ajustes. Hay que **republicar `firestore.rules`** (colección `reviews`). Sin verificación de compra: la moderación es la protección contra spam.

## Códigos de barras
- **Cargar el código**: en el producto, campo "Código de barras" (escribilo, escanealo con la cámara o con un lector USB). Si el producto no trae código, **Generar** crea uno interno único. El sistema avisa si el dígito verificador de un EAN/UPC está mal o si el código ya lo usa otro producto.
- **Panel → Productos → Escanear**: tres modos. *Buscar / editar* (abre el producto o propone crearlo si el código es nuevo), *Sumar stock* (llegó mercadería) y *Restar stock* (venta en mostrador), con cantidad. Sigue leyendo uno tras otro y deja un registro. Con un lector USB también funciona sin abrir nada: escaneás en cualquier pantalla del panel y se abre el producto.
- **Etiquetas**: Panel → Productos → Etiquetas. Elegí productos y cantidad, tamaño (rollo 50×30, rollo 70×40 o hoja A4) e imprimí. "Generar códigos internos" completa los que no tienen. Los códigos son EAN-13/EAN-8/UPC-A (si el código es válido) o Code 128 (cualquier otro).
- **Tienda**: el cliente puede escribir el código en el buscador o tocar el ícono de escaneo (cámara) para abrir un producto. Un lector USB también abre el producto.
- **Importar/exportar**: columna `codigo_barras`; al importar, los productos se emparejan primero por código y después por nombre.
- La cámara solo funciona con la tienda publicada en **https** (GitHub Pages sirve). Usa el lector nativo del navegador y, si no existe (Firefox, Safari antiguo), descarga la librería ZXing automáticamente. Los lectores USB/Bluetooth que emulan teclado funcionan sin configurar nada.

## Panel de ventas
Panel → Resumen: elegí el período (7/30/90 días, 12 meses, todo o fechas a medida). Muestra ventas, pedidos, ticket promedio, cobrado/por cobrar y comparación con el período anterior; gráfico de ventas por día/semana/mes; productos y categorías que más venden; medios de pago; retiro vs. envío; estados; días de la semana y stock bajo.

## Seguimiento de pedido (cliente)
`#/pedido/CÓDIGO`: pasos con fecha (Recibido → En preparación → Listo/En camino → Entregado), historial, mensaje de la tienda, productos y totales, estado del pago (pagado, reembolsado, saldo) y botón para pagar el saldo con Mercado Pago. No muestra nombre, teléfono ni dirección. En el panel, al abrir un pedido podés escribir un **mensaje para el cliente** y registrar **cobros manuales** (efectivo/transferencia, parciales o totales).

## Opiniones solo de compradores
Ajustes → Opiniones → "Solo compradores": el cliente debe poner el código de un pedido que ya marcaste **Entregado** y que contenga ese producto (lo verifican las reglas de Firestore, no solo la página). Una opinión por pedido y producto, con insignia "Compra verificada". En modo abierto, el código es opcional y da la insignia. **Republicá `firestore.rules`.**

## Mercado Pago: seña, pagos parciales y reembolsos
- **Seña**: Ajustes → "Seña %" (ej. 30). El primer pago online cobra ese porcentaje; el cliente paga el saldo desde su seguimiento (o vos lo cobrás al entregar y lo registrás en el pedido).
- Los pagos se acumulan por pedido (varios pagos, avisos repetidos no duplican). El pedido queda "Pagado" cuando lo cobrado menos lo reembolsado cubre el total.
- **Reembolsos**: en el pedido, junto a cada pago de Mercado Pago, monto (vacío = completo) y "Reembolsar". Usa la función `mpRefund`, que verifica que quien la llama sea administrador. Los reembolsos hechos desde el sitio de Mercado Pago también se sincronizan.
- Deploy: `firebase deploy --only functions` (funciones nuevas: `mpRefund`; si usás otros administradores, definí `ADMIN_EMAILS` con sus emails separados por coma). La URL de `mpRefund` se deduce de la de `createMpPayment`, o pegala en Ajustes.
