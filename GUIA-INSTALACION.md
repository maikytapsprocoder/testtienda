# Guía de instalación paso a paso

Tiempo estimado: 45–60 min la primera vez. **Costo: $0** (GitHub Pages + Firebase plan gratuito Spark). No necesitás el plan Blaze.

## 0. Qué necesitás
- Cuenta de **GitHub** y cuenta de **Google** (para Firebase).
- **Node.js** instalado (https://nodejs.org, versión LTS). Solo para generar el archivo final.
- Opcional: cuentas de **EmailJS** (avisos por email), **Cloudinary** (fotos), **Mercado Pago**, Google Analytics / Meta Pixel.

## 1. Probar sin instalar nada
Abrí `docs/index.html` en el navegador: funciona en **modo demo** (datos de ejemplo solo en tu navegador). Panel: pie de página → "Acceso administradores" → `user` / `123456`.

## 2. Personalizar el negocio
1. Copiá `docs/negocio.config.EN-BLANCO.js` sobre `docs/negocio.config.js` (si es un negocio nuevo).
2. Completá: nombre, color, logo, WhatsApp (`598…` sin + ni espacios), dirección, horarios, redes.
3. Ejecutá en la carpeta del proyecto: `node scripts/build.js` (regenera `docs/index.html`). **Repetí este paso cada vez que cambies archivos de `src/` o el config.**

## 3. Crear el proyecto en Firebase
1. https://console.firebase.google.com → *Agregar proyecto* (podés desactivar Analytics).
2. *Agregar app* → ícono web `</>` → copiá el bloque `firebaseConfig` y pegalo en `docs/firebase-config.js`.
3. **Firestore**: Build → Firestore Database → *Crear base de datos* (modo producción, región cercana, p. ej. `southamerica-east1`).
4. **Authentication**: Comenzar → Método de acceso → activá *Correo electrónico/contraseña*. En *Configuración → Acciones del usuario* **desactivá "Habilitar creación (registro)"**.
5. Authentication → Users → *Agregar usuario*: correo `user@tienda-admin.local`, contraseña `123456` (la vas a cambiar enseguida).
6. **Reglas**: Firestore → pestaña *Reglas* → pegá el contenido de `firestore.rules` → *Publicar*. (Hay que repetirlo cuando se actualice ese archivo.)

## 4. Publicar la web (GitHub Pages)
1. Creá un repositorio y subí **todo** el contenido del proyecto.
2. Settings → Pages → Source: *Deploy from a branch* → rama `main`, carpeta `/docs`.
3. Esperá 1–2 min: queda en `https://TU_USUARIO.github.io/NOMBRE_REPO/`.
4. Firebase → Authentication → Configuración → **Dominios autorizados** → agregá `TU_USUARIO.github.io`.

## 5. Primer ingreso (obligatorio)
1. Abrí la tienda → pie de página → *Acceso administradores* → `user` / `123456`.
2. **Ajustes → cambiá la contraseña** ya mismo.
3. Creá las **categorías** y cargá productos (o *Cargar productos de ejemplo*). Con lector USB podés escanear códigos de barras.
4. Ajustes: envíos y zonas, medios de pago, textos de Términos/Privacidad (completá los `[placeholders]` y que los revise un profesional), `siteUrl` (la dirección pública de la tienda).
5. **Descargá un respaldo** (Ajustes → Respaldo) y guardalo en tu Drive.

## 6. Servicios opcionales
- **Avisos por email (gratis)**: crear cuenta en emailjs.com, un servicio de correo y una plantilla; pegar *Service ID*, *Template ID* y *Public Key* en Ajustes. Para avisar al cliente por cambio de estado, una segunda plantilla → `emailStatusTemplateId`.
- **Fotos con Cloudinary (recomendado)**: cuenta gratis → Settings → Upload → crear *upload preset* **unsigned** → cargar *cloud name* y *preset* en Ajustes. Las fotos quedan fuera de la base y se sirven livianas.
- **Fotos ya subidas pesadas**: Ajustes → *Optimizar fotos guardadas*.
- **Mercado Pago**: modo *link fijo* (sin servidor) o con Cloud Functions (requiere Blaze). Ver README.
- **Google Analytics / Meta Pixel**: pegar el ID en Ajustes.
- **SEO**: Ajustes → descargar respaldo y luego `node scripts/make-seo.js respaldo.json https://tu-sitio/` → subir los archivos generados en `docs/`. Enviá `sitemap.xml` a Google Search Console.

## 7. Entregar a un cliente
Repetí 2–5 con un proyecto Firebase **nuevo por cliente** (datos separados), cambiale la clave, entregale: URL, usuario del panel y el respaldo inicial. Explicale que debe bajar un respaldo cada tanto.

## 8. Problemas comunes
| Síntoma | Solución |
|---|---|
| Sigue en modo demo | `firebase-config.js` aún tiene `TU_...`; pegá la config real y subí de nuevo |
| No puedo entrar al panel | ¿Creaste el usuario `user@tienda-admin.local`? ¿Dominio autorizado agregado? Tras 5 fallos hay un bloqueo temporal |
| "Missing or insufficient permissions" | Publicá `firestore.rules` actualizado |
| Cambios que no se ven | Corré `node scripts/build.js`, subí y refrescá con Ctrl+F5 |
| Foto no se sube | Revisá cloud name / preset *unsigned*; si falla se guarda en la base (más pesada) |
| Pedido sin stock descontado | Sin Blaze el stock se aplica al abrir el panel; entrá al admin |
