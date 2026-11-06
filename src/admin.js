/* ───────── Panel de administración ───────── */
var STATUS = { nuevo: 'Nuevo', atendido: 'En preparación', listo: 'Listo / en camino', entregado: 'Entregado', cancelado: 'Cancelado' };
var num = v => { const s = String(v ?? '').trim(); if (s === '') return NaN; const n = Number(s.replace(',', '.')); return Number.isFinite(n) ? n : NaN; };

function adminView() {
  if (!state.authReady) return `<div class="wrap"><p class="muted" style="padding:64px 0;text-align:center">Cargando…</p></div>`;
  if (!state.user) return loginView();
  const nuevos = state.orders.filter(o => o.status === 'nuevo').length;
  const tab = (id, label, badge) => `<button type="button" role="tab" data-act="admTab" data-tab="${id}" aria-selected="${state.admin.tab === id}">${label}${badge ? `<span class="badge">${badge}</span>` : ''}</button>`;
  const rules = state.fsError ? '<div class="wrap"><p class="err" role="alert" style="margin:12px 0">No se pueden leer los productos de Firestore. Casi seguro faltan publicar las reglas (Firebase > Firestore > Reglas). Mientras tanto la tienda muestra productos de ejemplo.</p></div>' : '';
  return `<div id="adminShell"><div class="adm-bar"><div class="wrap"><span class="logo"><span class="logo-mark"></span>${esc(state.settings.storeName)} · Administración</span>
    <nav><a class="btn" href="#/">Ver tienda</a><button type="button" class="btn" data-act="admLogout">Salir</button></nav></div></div>${rules}
    <div class="wrap"><div class="tabs" role="tablist">${tab('summary', 'Resumen')}${tab('products', 'Productos')}${tab('categories', 'Categorías')}${tab('banners', 'Ofertas y banners')}${tab('orders', 'Pedidos', nuevos || '')}${tab('reviews', 'Opiniones', (state.reviewsAll || []).filter(r => r.status !== 'approved').length || '')}${tab('admins', 'Usuarios')}${tab('settings', 'Ajustes')}</div>
    <div id="adminBody" role="tabpanel"></div></div></div>`;
}
function loginView() {
  return `<div class="wrap"><form class="login" id="loginForm" novalidate>
    <h1>Administración</h1><p class="muted" style="margin-bottom:22px">Ingresá para editar productos, precios, ofertas e imágenes.</p>
    <div class="field"><label for="l-u">Usuario</label><input class="in" id="l-u" name="u" autocomplete="username" autocapitalize="none" required></div>
    <div class="field"><label for="l-p">Contraseña</label><input class="in" id="l-p" name="p" type="password" autocomplete="current-password" required></div>
    <p class="err" role="alert" ${state.loginErr ? '' : 'hidden'}>${esc(state.loginErr)}</p>
    <button class="btn btn-primary" type="submit">Ingresar</button>
    ${DB?.mode === 'demo' ? '<p class="note" style="margin-top:14px">Vista previa: usuario <b>user</b> y contraseña <b>123456</b>.</p>' : ''}
    <p style="margin-top:16px;text-align:center"><a href="#/" class="note">Volver a la tienda</a></p></form></div>`;
}
async function doLogin(f) {
  const u = f.u.value, p = f.p.value;
  if (!u.trim() || !p) { state.loginErr = 'Escribí usuario y contraseña.'; return render(); }
  const btn = $('button[type=submit]', f); btn.disabled = true; btn.textContent = 'Ingresando…';
  try { await DB.auth.login(u, p); state.loginErr = ''; }
  catch (e) { state.loginErr = e.message; render(); $('#l-u').value = u; $('#l-p').focus(); }
}

/* Stock automático: la Cloud Function lo descuenta; si no está activa, el panel lo aplica al abrirse. */
var stockBusy = false;
function parseVariantsText(txt) { return String(txt || '').split('\n').map(l => { const [n, o] = l.split(':'); return { name: (n || '').trim(), options: [...new Set(String(o || '').split(',').map(x => x.trim()).filter(Boolean))].slice(0, 20) }; }).filter(g => g.name && g.options.length).slice(0, 3); }
function comboKeys(groups) { return groups.reduce((acc, g) => acc.flatMap(a => g.options.map(o => a.concat(o))), [[]]).map(a => a.join(' / ')).filter(Boolean); }
/* "M / Negro: 3" por línea (o "M / Negro=3" separado por | en CSV) → { 'M / Negro': 3 } */
function parseVS(txt, valid) {
  const out = {};
  String(txt || '').split(/\n|\|/).forEach(l => { const m = /^(.*?)\s*[:=]\s*(\d*)\s*$/.exec(l.trim()); if (!m || !m[1]) return; const k = m[1].replace(/\s*\/\s*/g, ' / '); if (valid && !valid.includes(k)) return; out[k] = m[2] === '' ? 0 : Math.floor(Number(m[2])); });
  return out;
}
async function applyPendingStock() {
  if (stockBusy || !DB || DB.mode !== 'firebase' || !state.user || !state.loaded.products) return;
  const pend = state.orders.filter(o => !o.stockApplied && o.status !== 'cancelado' && Date.now() - (o.createdAt || 0) > 90000);
  if (!pend.length) return;
  stockBusy = true;
  try {
    for (const o of pend) {
      await DB.save('orders', o.id, { stockApplied: true }); // se marca primero para no repetir
      for (const pid of new Set((o.items || []).map(i => i.id))) {
        const pt = stockPatch(state.products.find(x => x.id === pid), o.items || [], -1);
        if (pt) await DB.save('products', pid, { ...pt, updatedAt: Date.now() });
      }
    }
  } catch (e) { console.warn('stock', e); } finally { stockBusy = false; }
}
function renderAdminBody() {
  applyPendingStock(); ensureCats();
  const b = $('#adminBody'); if (!b) return;
  const t = state.admin.tab;
  b.innerHTML = t === 'admins' ? adminsTab() : t === 'reviews' ? reviewsTab() : t === 'summary' ? summaryTab() : t === 'products' ? productsTab() : t === 'categories' ? categoriesTab() : t === 'banners' ? bannersTab() : t === 'orders' ? ordersTab() : settingsTab();
  const nuevos = state.orders.filter(o => o.status === 'nuevo').length;
  const tabBtn = $('[data-tab=orders]'); if (tabBtn) tabBtn.innerHTML = 'Pedidos' + (nuevos ? `<span class="badge">${nuevos}</span>` : '');
  { const pend = (state.reviewsAll || []).filter(r => r.status !== 'approved').length, rb = $('[data-tab=reviews]'); if (rb) rb.innerHTML = 'Opiniones' + (pend ? `<span class="badge">${pend}</span>` : ''); }
  $$('.tabs [data-tab]').forEach(x => x.setAttribute('aria-selected', x.dataset.tab === t));
}

/* ── Productos ── */
function productRows() {
  const q = state.admin.q.toLowerCase(), c = state.admin.cat;
  const l = [...state.products].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
    .filter(p => (!c || p.category === c) && (!q || [p.name, p.brand, p.sub, p.barcode].join(' ').toLowerCase().includes(q)));
  if (!state.loaded.products) return '<div class="empty"><p>Cargando productos…</p></div>';
  if (!l.length) return `<div class="empty"><h3>${state.products.length ? 'Sin resultados' : 'Todavía no hay productos'}</h3><p>${state.products.length ? 'Probá con otra búsqueda.' : 'Agregá el primero, o cargá los productos de ejemplo desde Ajustes.'}</p></div>`;
  return `<div class="rows"><div class="arow head"><span></span><span>Producto</span><span>Precio</span><span>Precio antes</span><span>Stock</span><span>Visible</span><span></span></div>` +
    l.map(p => `<div class="arow prow ${p.active === false ? 'off' : ''}" style="--tint:${catOf(p).tint}">
      <img src="${esc(imgOf(p))}" alt="">
      <div class="nm">${esc(p.name)}<small>${esc(catOf(p).name)}${p.sub ? ' · ' + esc(p.sub) : ''}${p.barcode ? ' · <span class="bcn">' + esc(p.barcode) + '</span>' : ''}</small></div>
      <div class="nums"><label class="cell"><span class="lab">Precio</span><input class="in" type="number" min="0" step="any" inputmode="decimal" aria-label="Precio de ${esc(p.name)}" data-act="admInline" data-field="price" data-id="${esc(p.id)}" value="${esc(p.price)}"></label>
      <label class="cell"><span class="lab">Antes</span><input class="in" type="number" min="0" step="any" inputmode="decimal" aria-label="Precio anterior de ${esc(p.name)}" placeholder="Sin oferta" data-act="admInline" data-field="oldPrice" data-id="${esc(p.id)}" value="${p.oldPrice ? esc(p.oldPrice) : ''}"></label>
      <label class="cell"><span class="lab">Stock</span><input class="in" type="number" min="0" step="1" inputmode="numeric" aria-label="Stock de ${esc(p.name)}" placeholder="Sin límite" data-act="admInline" data-field="stock" data-id="${esc(p.id)}" value="${p.stock === null || p.stock === undefined ? '' : esc(p.stock)}"></label>
      <label class="sw"><input type="checkbox" data-act="admActive" data-id="${esc(p.id)}" ${p.active !== false ? 'checked' : ''} aria-label="Visible en la tienda: ${esc(p.name)}"><i></i></label></div>
      <div class="acts"><button type="button" class="btn btn-line btn-sm" data-act="admEdit" data-id="${esc(p.id)}">Editar</button><button type="button" class="btn btn-danger btn-sm" data-act="admDel" data-id="${esc(p.id)}" aria-label="Eliminar ${esc(p.name)}">Eliminar</button></div></div>`).join('') + '</div>';
}
function productsTab() {
  return `<div class="a-tools"><input class="in" type="search" placeholder="Buscar producto" aria-label="Buscar producto" data-act="admSearch" value="${esc(state.admin.q)}">
    <select class="in" aria-label="Filtrar por sección" data-act="admCatFilter"><option value="">Todas las secciones</option>${Object.entries(CATS).map(([k, c]) => `<option value="${k}" ${state.admin.cat === k ? 'selected' : ''}>${c.name}</option>`).join('')}</select>
    <span class="sp"></span><button type="button" class="btn btn-line" data-act="admScan">Escanear</button><button type="button" class="btn btn-line" data-act="admLabels">Etiquetas</button><button type="button" class="btn btn-line" data-act="admImport">Importar / exportar</button><button type="button" class="btn btn-primary" data-act="admNew">Nuevo producto</button></div>
    <p class="note" style="margin:-4px 0 12px">Editá precio, precio anterior (para mostrar la oferta) y stock directamente en la lista. Los cambios se publican al instante.</p>
    <div id="aList">${productRows()}</div>`;
}

/* ── Formularios ── */
function openForm(title, html) {
  const d = $('#dlgForm');
  d.innerHTML = `<div class="dlg-in"><button type="button" class="dlg-x" data-act="closeDlg" aria-label="Cerrar">×</button><h2>${esc(title)}</h2>${html}</div>`;
  if (!d.open) d.showModal();
}
function imageField(image, art, accent) {
  const isData = String(image || '').startsWith('data:');
  const prev = image || artUri(art || 'laptop', accent);
  return `<div class="imgf"><img class="pv" id="imgPv" src="${esc(prev)}" alt="Vista previa"><div class="col">
    <input type="hidden" name="image" value="${esc(image || '')}">
    <div class="field" style="margin:0"><label for="f-img">Imagen: pegá un enlace o subí una foto</label><input class="in" id="f-img" data-act="admImgUrl" placeholder="https://…" value="${isData ? '' : esc(image || '')}"></div>
    <div class="btns"><label class="btn btn-line btn-sm">Subir foto<input type="file" accept="image/*" class="sr" data-act="admImgFile"></label><button type="button" class="btn btn-line btn-sm" data-act="admImgClear">Quitar imagen</button></div>
    <small class="muted" id="imgNote">${isData ? 'Foto subida.' : (image ? '' : 'Sin imagen: se muestra la ilustración elegida abajo.')}</small></div></div>`;
}
var MAX_IMGS = 5;
function galleryField(images, art, accent) {
  const l = (images || []).filter(Boolean);
  return `<div class="field full gal-f"><label>Fotos del producto (hasta ${MAX_IMGS}; la primera es la principal)</label>
    <input type="hidden" name="images" value="${esc(JSON.stringify(l))}">
    <div id="galList" class="gal-list">${galItems(l, art, accent)}</div>
    <div class="gal-add"><input class="in" id="g-url" placeholder="Pegar enlace de una foto https://…"><button type="button" class="btn btn-line btn-sm" data-act="admGalUrl">Agregar enlace</button>
    <label class="btn btn-line btn-sm">Subir fotos<input type="file" accept="image/*" multiple class="sr" data-act="admGalFile"></label></div>
    <small class="muted" id="galNote"></small></div>`;
}
function galItems(l, art, accent) {
  if (!l.length) return `<div class="gal-it"><img src="${esc(artUri(art || 'laptop', accent))}" alt=""><small>Sin fotos: se usa la ilustración</small></div>`;
  return l.map((u, i) => `<div class="gal-it"><img src="${esc(u)}" alt="Foto ${i + 1}"><div class="gal-b">${i ? `<button type="button" class="btn btn-line btn-sm" data-act="admGalMain" data-i="${i}">Principal</button>` : '<span class="chipst ok">Principal</span>'}<button type="button" class="btn btn-danger btn-sm" data-act="admGalDel" data-i="${i}" aria-label="Quitar foto ${i + 1}">Quitar</button></div></div>`).join('');
}
function galGet(form) { try { return JSON.parse(form.images.value || '[]'); } catch { return []; } }
function galSet(form, l) {
  form.images.value = JSON.stringify(l);
  const cat = catById(form.category?.value);
  $('#galList').innerHTML = galItems(l, form.art.value || cat.art, cat.acc);
  const size = l.join('').length;
  $('#galNote').textContent = size > 850000 ? 'Las fotos pesan demasiado en total: quitá alguna o usá enlaces.' : '';
}
function artSelect(val) {
  return `<div class="field"><label for="f-art">Ilustración si no hay foto</label><select class="in" id="f-art" name="art" data-act="admPreview"><option value="">Según la sección</option>${Object.entries(ART_LABELS).map(([k, l]) => `<option value="${k}" ${val === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>`;
}
function updatePreview(form) {
  if (form.dataset.form === 'product') { galSet(form, galGet(form)); return; }
  const img = form.image.value, cat = CATS[form.category?.value] || null;
  const accent = cat ? cat.acc : (form.color ? (form.color.value || '#2347F5') : '#2347F5');
  const art = form.art.value || (cat ? cat.art : 'laptop');
  $('#imgPv').src = img || artUri(art, accent);
  $('#imgNote').textContent = img ? (img.startsWith('data:') ? 'Foto subida.' : '') : 'Sin imagen: se muestra la ilustración elegida abajo.';
}
/* Si hay Cloudinary configurado, la foto se sube allá y se guarda solo el enlace; si no (o si falla), se guarda dentro de la base como antes */
async function fileToDataUrl(file, maxSide, maxLen = 600000) {
  const s = state.settings;
  if (s.cloudName && s.cloudPreset) {
    try {
      const url = await fileToDataUrlLocal(file, Math.max(maxSide, 1200), 2500000);
      const fd = new FormData(); fd.append('file', url); fd.append('upload_preset', s.cloudPreset);
      const res = await fetch(`https://api.cloudinary.com/v1_1/${encodeURIComponent(s.cloudName)}/image/upload`, { method: 'POST', body: fd });
      const j = await res.json().catch(() => ({}));
      if (res.ok && j.secure_url) return j.secure_url;
      console.warn('Cloudinary', res.status, j); toast('No se pudo subir al servicio de fotos (' + ((j.error && j.error.message) || res.status) + '). Se guarda dentro de la tienda.', { bad: true });
    } catch (e) { console.warn('Cloudinary', e); }
  }
  return fileToDataUrlLocal(file, maxSide, maxLen);
}
async function fileToDataUrlLocal(file, maxSide, maxLen = 600000) {
  const bmp = await createImageBitmap(file);
  let side = maxSide, q = .86;
  for (let i = 0; i < 6; i++) {
    const r = Math.min(1, side / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas'); c.width = Math.round(bmp.width * r); c.height = Math.round(bmp.height * r);
    const x = c.getContext('2d'); x.drawImage(bmp, 0, 0, c.width, c.height);
    let url = c.toDataURL('image/webp', q);
    if (!url.startsWith('data:image/webp')) { x.globalCompositeOperation = 'destination-over'; x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); url = c.toDataURL('image/jpeg', q); }
    if (url.length < maxLen) return url;
    side *= .8; q -= .08;
  }
  throw new Error('La imagen es demasiado pesada. Probá con una más chica.');
}

function openProductForm(id, preset) {
  if (!Object.keys(CATS).length) { state.admin.tab = 'categories'; renderAdminBody(); return toast('Primero creá al menos una categoría (por ejemplo “Televisores”).', { bad: true }); }
  const p = id ? state.products.find(x => x.id === id) : { category: state.admin.cat || Object.keys(CATS)[0], active: true, ...(preset || {}) };
  const subs = [...new Set(state.products.map(x => x.sub).filter(Boolean))];
  openForm(id ? 'Editar producto' : 'Nuevo producto', `<form data-form="product" data-id="${esc(id || '')}" novalidate>
    <div class="form-grid">
      <div class="field full"><label for="f-n">Nombre</label><input class="in" id="f-n" name="name" required value="${esc(p.name)}"></div>
      <div class="field full"><label for="f-bc">Código de barras (opcional)</label><div class="row"><input class="in" id="f-bc" name="barcode" inputmode="text" autocomplete="off" autocapitalize="none" value="${esc(p.barcode || '')}" placeholder="Escaneá o escribí el código" style="flex:1;min-width:0"><button type="button" class="btn btn-line btn-sm" data-act="admBcScan">Escanear</button><button type="button" class="btn btn-line btn-sm" data-act="admBcGen">Generar</button></div><div id="bcPrev" class="bc-prev">${p.barcode ? barcodeSvg(p.barcode, { width: 220, height: 50, fontSize: 11 }) : ''}</div><small>Con lector USB: hacé clic en el campo y escaneá. Si el producto no trae código, tocá <b>Generar</b> para crear uno interno e imprimilo desde <b>Etiquetas</b>.</small></div>
      <div class="field"><label for="f-c">Sección</label><select class="in" id="f-c" name="category" data-act="admPreview">${Object.entries(CATS).map(([k, c]) => `<option value="${k}" ${p.category === k ? 'selected' : ''}>${c.name}</option>`).join('')}</select></div>
      <div class="field"><label for="f-s">Subcategoría</label><input class="in" id="f-s" name="sub" list="subs" placeholder="Ej.: Mouse, Heladeras" value="${esc(p.sub)}"><datalist id="subs">${subs.map(s => `<option value="${esc(s)}">`).join('')}</datalist></div>
      <div class="field"><label for="f-b">Marca</label><input class="in" id="f-b" name="brand" value="${esc(p.brand)}"></div>
      <div class="field"><label for="f-st">Stock</label><input class="in" id="f-st" name="stock" type="number" min="0" step="1" inputmode="numeric" value="${p.stock === null || p.stock === undefined ? '' : esc(p.stock)}"><small>Vacío = sin límite. 0 = sin stock.</small></div>
      <div class="field"><label for="f-p">Precio ($)</label><input class="in" id="f-p" name="price" type="number" min="0" step="any" inputmode="decimal" required value="${p.price ?? ''}"></div>
      <div class="field"><label for="f-o">Precio anterior ($)</label><input class="in" id="f-o" name="oldPrice" type="number" min="0" step="any" inputmode="decimal" value="${p.oldPrice ? esc(p.oldPrice) : ''}"><small>Si es mayor que el precio, se muestra como oferta.</small></div>
      <div class="field full"><label for="f-d">Descripción</label><textarea class="in" id="f-d" name="description" rows="3">${esc(p.description)}</textarea></div>
      <div class="field full"><label for="f-sp">Características</label><textarea class="in" id="f-sp" name="specs" rows="4">${esc(p.specs)}</textarea><small>Una por línea. Ej.: Memoria: 16 GB</small></div>
      <div class="field full"><label for="f-v">Variantes (opcional, una por línea: Grupo: opción, opción)</label><textarea class="in" id="f-v" name="variants" rows="3" placeholder="Talle: S, M, L, XL&#10;Color: Negro, Blanco">${esc(prodVariants(p).map(g => g.name + ': ' + g.options.join(', ')).join('\n'))}</textarea><small>El cliente tiene que elegir una opción de cada grupo antes de agregar al carrito. Si no cargás stock por opción, el stock de arriba es el total del producto.</small></div>
      <div class="field full" id="f-vs-w"><label for="f-vs">Stock por opción (opcional, una por línea: Opción / Opción: cantidad)</label><textarea class="in" id="f-vs" name="vstock" rows="4" placeholder="M / Negro: 3&#10;M / Blanco: 0">${esc(Object.entries(p.vstock || {}).map(([k, n]) => k + ': ' + n).join('\n'))}</textarea><div class="row" style="margin-top:6px"><button type="button" class="btn btn-line btn-sm" data-act="admGenVs">Generar combinaciones</button></div><small>Si lo completás, el stock total se calcula solo (suma de las opciones) y el campo "Stock" de arriba se ignora. Una combinación que no esté en la lista queda sin stock.</small></div>
    </div>
    ${galleryField(p.images && p.images.length ? p.images : (p.image ? [p.image] : []), p.art, catById(p.category).acc)}${artSelect(p.art)}
    <label class="chk"><input type="checkbox" name="active" ${p.active !== false ? 'checked' : ''}> Visible en la tienda</label>
    <label class="chk"><input type="checkbox" name="catalogOnly" ${p.catalogOnly ? 'checked' : ''}> Solo catálogo (no se vende online: el cliente lo consulta por WhatsApp)</label>
    <label class="chk" style="margin-left:26px"><input type="checkbox" name="hidePrice" ${p.hidePrice ? 'checked' : ''}> Ocultar el precio (muestra “Consultar precio”)</label>
    <p class="err" data-err hidden role="alert"></p>
    <div class="dlg-f"><button type="button" class="btn btn-line" data-act="closeDlg">Cancelar</button><button type="submit" class="btn btn-primary">Guardar producto</button></div></form>`);
}

/* ── Categorías ── */
var catsBusy = false;
async function ensureCats() { // la primera vez, guarda las categorías iniciales para que sean editables
  if (catsBusy || !DB || !state.user || !state.loaded.cats || (state.catDocs || []).length) return;
  catsBusy = true;
  try { let i = 0; for (const c of DEFAULT_CATS) { const { id, ...d } = c; await DB.save('categories', id, { ...d, order: ++i }); } }
  catch (e) { console.warn('categorías', e); } finally { catsBusy = false; }
}
var slugify = t => String(t).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || 'cat';
function mixWhite(hex, k) { const n = parseInt(hex.slice(1), 16); return '#' + [n >> 16, (n >> 8) & 255, n & 255].map(c => Math.round(c + (255 - c) * k).toString(16).padStart(2, '0')).join(''); }
function categoriesTab() {
  const l = Object.entries(CATS);
  return `<div class="a-tools"><p class="muted" style="flex:1">Las categorías son las secciones de tu tienda. Creá las que necesites para tu rubro: aparecen en el menú, la portada y el filtro de productos.</p><button type="button" class="btn btn-primary" data-act="admCNew">Nueva categoría</button></div>
  ${!l.length ? '<div class="empty"><h3>Cargando categorías…</h3></div>' : `<div class="rows">${l.map(([k, c]) => {
    const n = state.products.filter(p => p.category === k).length;
    return `<div class="arow crow"><img src="${esc(c.image || artUri(c.art, c.acc))}" alt="" style="background:${esc(c.tint)}">
      <div class="nm">${esc(c.name)}<small>${esc(c.blurb || 'Sin descripción')} · ${n} ${n === 1 ? 'producto' : 'productos'}</small></div><span class="muted">Orden ${esc(c.order ?? 0)}</span>
      <div class="acts"><button type="button" class="btn btn-line btn-sm" data-act="admCEdit" data-id="${esc(k)}">Editar</button><button type="button" class="btn btn-danger btn-sm" data-act="admCDel" data-id="${esc(k)}">Eliminar</button></div></div>`;
  }).join('')}</div>`}`;
}
function openCategoryForm(id) {
  const c = id ? CATS[id] : { name: '', blurb: '', image: '', art: 'box', acc: '#2347F5', order: Object.keys(CATS).length + 1 };
  openForm(id ? 'Editar categoría' : 'Nueva categoría', `<form data-form="category" data-id="${esc(id || '')}" novalidate>
    <div class="field"><label for="c-n">Nombre</label><input class="in" id="c-n" name="name" required value="${esc(c.name)}" placeholder="Ej.: Calzado, Camping, TV"></div>
    <div class="field"><label for="c-b">Frase corta (opcional)</label><input class="in" id="c-b" name="blurb" value="${esc(c.blurb)}"></div>
    <div class="form-grid"><div class="field"><label for="c-o">Orden en el menú</label><input class="in" id="c-o" name="order" type="number" step="1" value="${esc(c.order ?? 1)}"></div>
    <div class="field"><label for="c-c">Color</label><input class="in" id="c-c" name="color" type="color" value="${esc(c.acc || '#2347F5')}" style="padding:4px" data-act="admPreview"></div></div>
    ${imageField(c.image, c.art, c.acc || '#2347F5')}<small class="muted">La foto se muestra en el mosaico de la portada. Sin foto, se usa una ilustración.</small>${artSelect(c.art)}
    <p class="err" data-err hidden role="alert"></p>
    <div class="dlg-f"><button type="button" class="btn btn-line" data-act="closeDlg">Cancelar</button><button type="submit" class="btn btn-primary">Guardar categoría</button></div></form>`);
}

/* ── Banners ── */
function bannersTab() {
  const l = [...state.banners].sort((a, b) => (a.order || 0) - (b.order || 0));
  return `<div class="a-tools"><p class="muted" style="flex:1">Estos banners rotan arriba en la página principal.</p><button type="button" class="btn btn-primary" data-act="admBNew">Nuevo banner</button></div>
  ${!l.length ? '<div class="empty"><h3>No hay banners</h3><p>Creá uno para destacar una oferta en la portada.</p></div>' :
    `<div class="rows">${l.map(b => `<div class="arow brow ${b.active === false ? 'off' : ''}"><div class="sw-prev" style="background:${esc(b.color || '#0E1A2B')};color:${lum(b.color) > .6 ? '#0E1A2B' : '#fff'}">${esc(b.cta || 'Sin botón')}</div>
      <div class="nm">${esc(b.title)}<small>${esc(b.subtitle || '')}</small></div><span class="muted">Orden ${esc(b.order ?? 0)}</span>
      <div class="acts"><button type="button" class="btn btn-line btn-sm" data-act="admBEdit" data-id="${esc(b.id)}">Editar</button><button type="button" class="btn btn-danger btn-sm" data-act="admBDel" data-id="${esc(b.id)}">Eliminar</button></div></div>`).join('')}</div>`}`;
}
function openBannerForm(id) {
  const b = id ? state.banners.find(x => x.id === id) : { color: '#2347F5', active: true, order: state.banners.length + 1, link: 'ofertas', art: 'laptop' };
  openForm(id ? 'Editar banner' : 'Nuevo banner', `<form data-form="banner" data-id="${esc(id || '')}" novalidate>
    <div class="field"><label for="b-t">Título</label><input class="in" id="b-t" name="title" required value="${esc(b.title)}"></div>
    <div class="field"><label for="b-s">Texto de apoyo</label><input class="in" id="b-s" name="subtitle" value="${esc(b.subtitle)}"></div>
    <div class="form-grid">
      <div class="field"><label for="b-c">Texto del botón</label><input class="in" id="b-c" name="cta" value="${esc(b.cta)}"></div>
      <div class="field"><label for="b-l">El botón lleva a</label><select class="in" id="b-l" name="link"><option value="ofertas" ${b.link === 'ofertas' ? 'selected' : ''}>Todas las ofertas</option>${Object.entries(CATS).map(([k, c]) => `<option value="${k}" ${b.link === k ? 'selected' : ''}>${c.name}</option>`).join('')}<option value="" ${!b.link ? 'selected' : ''}>Inicio</option></select></div>
      <div class="field"><label for="b-col">Color de fondo</label><input class="in" id="b-col" name="color" type="color" value="${esc(b.color || '#2347F5')}" style="padding:4px" data-act="admPreview"></div>
      <div class="field"><label for="b-o">Orden</label><input class="in" id="b-o" name="order" type="number" step="1" value="${esc(b.order ?? 1)}"></div>
    </div>
    ${imageField(b.image, b.art, '#FFD21F')}${artSelect(b.art)}
    <label class="chk"><input type="checkbox" name="active" ${b.active !== false ? 'checked' : ''}> Mostrar en la tienda</label>
    <p class="err" data-err hidden role="alert"></p>
    <div class="dlg-f"><button type="button" class="btn btn-line" data-act="closeDlg">Cancelar</button><button type="submit" class="btn btn-primary">Guardar banner</button></div></form>`);
}

/* ── Pedidos ── */
function waChip(o) {
  if (o.whatsapp?.sent) return '<span class="chipst ok">WhatsApp enviado</span>';
  if (o.whatsapp?.error) return '<span class="chipst bad" title="' + esc(o.whatsapp.error) + '">WhatsApp falló</span>';
  return '<span class="chipst mid">WhatsApp pendiente</span>';
}
function reviewsTab() {
  const l = [...(state.reviewsAll || [])].sort((a, b) => (a.status === 'approved') - (b.status === 'approved') || (b.createdAt || 0) - (a.createdAt || 0));
  if (!l.length) return '<div class="empty"><h3>Todavía no hay opiniones</h3><p>Cuando un cliente deje una, aparece acá para que la apruebes antes de mostrarse en la tienda.</p></div>';
  const pn = id => (state.products.find(p => p.id === id) || {}).name || id;
  return `<p class="note" style="margin-bottom:10px">Las opiniones nuevas quedan <b>pendientes</b> y no se ven en la tienda hasta que las aprobés.</p><div class="rows">${l.map(r => `<div class="arow"><div class="nm"><b>${'★'.repeat(r.rating)}${'☆'.repeat(5 - r.rating)}</b> ${esc(r.name)}${r.verified ? ' <span class="vbadge">✓ Compra verificada</span>' : ''}<small>${esc(pn(r.productId))} · ${fmtDate(r.createdAt)}</small></div>
    <div style="flex:2">${esc(r.text) || '<i class="muted">(sin comentario)</i>'}</div><div><span class="chipst ${r.status === 'approved' ? 'ok' : ''}">${r.status === 'approved' ? 'Publicada' : 'Pendiente'}</span></div>
    <div class="acts"><button type="button" class="btn btn-line btn-sm" data-act="admRevToggle" data-id="${esc(r.id)}">${r.status === 'approved' ? 'Ocultar' : 'Aprobar'}</button><button type="button" class="btn btn-line btn-sm" data-act="admRevDel" data-id="${esc(r.id)}">Eliminar</button></div></div>`).join('')}</div>`;
}
function ordersTab() {
  if (!state.orders.length) return '<div class="empty"><h3>Todavía no hay pedidos</h3><p>Cuando un cliente confirme una compra, aparece acá al instante.</p></div>';
  return `<div class="rows">${state.orders.map(o => `<div class="arow orow"><div><b>${esc(o.code || o.id.slice(0, 6))}</b><small class="muted" style="display:block">${fmtDate(o.createdAt)}</small></div>
    <div class="nm">${esc(o.customer?.name)}<small>${esc(o.customer?.phone)}${o.customer?.payment ? ' · ' + esc(o.customer.payment) : ''} · ${o.itemCount || o.items?.length || 0} productos · ${o.customer?.delivery === 'envio' ? 'Envío' : 'Retiro'}</small></div>
    <div><b>${money(o.total)}</b>${o.paid ? ' <span class="chipst ok">Pagado</span>' : ''}<br>${waChip(o)}</div>
    <select class="in" aria-label="Estado del pedido ${esc(o.code)}" data-act="admStatus" data-id="${esc(o.id)}">${Object.entries(STATUS).map(([k, v]) => `<option value="${k}" ${o.status === k ? 'selected' : ''}>${v}</option>`).join('')}</select>
    <div class="acts"><button type="button" class="btn btn-line btn-sm" data-act="admOrder" data-id="${esc(o.id)}">Ver pedido</button></div></div>`).join('')}</div>`;
}
function openOrder(id) {
  const o = state.orders.find(x => x.id === id); if (!o) return;
  const c = o.customer || {};
  const msg = `Hola ${c.name || ''}, te escribimos de ${state.settings.storeName} por tu pedido ${o.code || ''}.`;
  openForm('Pedido ' + (o.code || ''), `<p class="muted">${fmtDate(o.createdAt)} · ${waChip(o)}</p>
    <table class="ord-items"><tbody>${(o.items || []).map(i => `<tr><td>${esc(i.qty)} × ${esc(i.name)}</td><td>${money(i.price * i.qty)}</td></tr>`).join('')}${o.discount ? `<tr><td>Descuento${o.coupon ? ' (' + esc(o.coupon) + ')' : ''}</td><td>− ${money(o.discount)}</td></tr>` : ''}${o.shipping ? `<tr><td>Envío${c.zone ? ' (' + esc(c.zone) + ')' : ''}</td><td>${money(o.shipping)}</td></tr>` : ''}<tr><td><b>Total</b></td><td style="font-size:18px">${money(o.total)}</td></tr></tbody></table>
    ${o.priceMismatch ? `<p class="err">Atención: los precios del pedido no coinciden con los actuales. Total verificado: ${money(o.verifiedTotal)}.</p>` : ''}
    <p><b>${esc(c.name)}</b><br>${esc(c.phone)}<br>${c.payment ? 'Pago: ' + esc(c.payment) + '<br>' : ''}${c.delivery === 'envio' ? 'Envío a: ' + esc(c.address) + (c.zone ? ' (' + esc(c.zone) + ')' : '') : 'Retiro en el local' + (c.pickup ? ': ' + esc(c.pickup) : '')}</p>
    ${c.note ? `<p class="muted" style="margin-top:8px">“${esc(c.note)}”</p>` : ''}
    <div class="panel" style="margin-top:12px"><h3>Mensaje para el cliente</h3><p class="muted">Lo ve en el seguimiento de su pedido (por ejemplo: “Sale mañana, llega entre 14 y 18 h”).</p>
      <textarea class="in" id="o-note" rows="2" maxlength="300">${esc(o.publicNote || '')}</textarea><p><button type="button" class="btn btn-line btn-sm" data-act="admNote" data-id="${esc(o.id)}">Guardar mensaje</button></p></div>
    ${orderPayHtml(o)}
    <div class="dlg-f"><button type="button" class="btn btn-line" data-act="closeDlg">Cerrar</button><a class="btn btn-primary" target="_blank" rel="noopener" href="https://wa.me/${uyPhone(c.phone)}?text=${encodeURIComponent(msg)}">Escribir al cliente</a></div>`);
}

/* ── Ajustes ── */
function settingsTab() {
  const s = state.settings, perks = (s.perks || []).join('\n');
  return `<form class="panel" data-form="settings" novalidate><h3>Datos de la tienda</h3>
    <div class="field"><label for="s-n">Nombre de la tienda</label><input class="in" id="s-n" name="storeName" required value="${esc(s.storeName)}"></div>
    <div class="field"><label for="s-t">Frase corta</label><input class="in" id="s-t" name="tagline" value="${esc(s.tagline)}"></div>
    <div class="field"><label for="s-p">Barra de beneficios (una por línea, máximo 3)</label><textarea class="in" id="s-p" name="perks" rows="3">${esc(perks)}</textarea></div>
    <div class="field"><label for="s-pm">Medios de pago para todos (uno por línea)</label><textarea class="in" id="s-pm" name="payMethods" rows="4">${esc((s.payMethods || []).join('\n'))}</textarea><small>El cliente elige uno al confirmar el pedido. Si lo dejás vacío, no se pregunta.</small></div>
    <div class="field"><label for="s-ppk">Solo si retira en el local</label><textarea class="in" id="s-ppk" name="payPickup" rows="2">${esc((s.payPickup || []).join('\n'))}</textarea><small>Ej.: Tarjeta en el local.</small></div>
    <div class="field"><label for="s-pd">Solo si pide envío a domicilio</label><textarea class="in" id="s-pd" name="payDelivery" rows="2">${esc((s.payDelivery || []).join('\n'))}</textarea><small>Ej.: Tarjeta en domicilio (POS).</small></div>
    <label class="chk" style="margin:6px 0 14px"><input type="checkbox" name="showShipping" ${s.showShipping === false ? '' : 'checked'}> Mostrar costo de envío junto a cada localidad</label>
    <small class="muted" style="display:block;margin:-8px 0 14px">Si lo desactivás, la lista solo muestra la localidad y el costo aparece abajo, en el total.</small>
    <h3 style="margin-top:22px">Marca y redes</h3>
    <div class="form-grid"><div class="field"><label for="s-bc">Color principal</label><input class="in" id="s-bc" name="brandColor" type="color" value="${esc(/^#[0-9a-f]{6}$/i.test(s.brandColor || '') ? s.brandColor : '#2347F5')}" style="padding:4px"></div>
    <div class="field"><label for="s-lg">Logo (enlace o subir imagen)</label><input class="in" id="s-lg" name="logo" placeholder="https://…" value="${s.logo && !s.logo.startsWith('data:') ? esc(s.logo) : ''}" data-keep="${s.logo && s.logo.startsWith('data:') ? esc(s.logo) : ''}"><label class="btn btn-line btn-sm" style="margin-top:6px">Subir logo<input type="file" accept="image/*" class="sr" data-act="admLogoFile"></label>${s.logo ? '<img src="' + esc(s.logo) + '" alt="Logo actual" style="height:40px;margin-top:8px">' : ''}<small>Vacío = se muestra el nombre del negocio.</small></div></div>
    <div class="field"><label for="s-ig">Instagram (enlace)</label><input class="in" id="s-ig" name="instagram" placeholder="https://instagram.com/…" value="${esc(s.instagram)}"></div>
    <div class="field"><label for="s-fb">Facebook (enlace)</label><input class="in" id="s-fb" name="facebook" placeholder="https://facebook.com/…" value="${esc(s.facebook)}"></div>
    <div class="field"><label for="s-br">Sucursales (una por línea: Nombre | Dirección | enlace de foto | enlace del mapa)</label><textarea class="in" id="s-br" name="branches" rows="3">${esc((s.branches || []).map(b => [b.name, b.address || '', b.image || '', b.link || ''].join(' | ')).join('\n'))}</textarea><small>Opcional. Se muestran en la portada.</small></div>
    <h3 style="margin-top:22px">Contacto y local</h3>
    <div class="field"><label for="s-cw">WhatsApp de contacto (botón y página Contacto)</label><input class="in" id="s-cw" name="contactWhatsapp" inputmode="tel" placeholder="598…" value="${esc(s.contactWhatsapp)}"><small>Es el que ven los clientes. No es el número que recibe los pedidos.</small></div>
    <div class="field"><label for="s-ce">Correo de contacto (opcional)</label><input class="in" id="s-ce" name="contactEmail" type="email" value="${esc(s.contactEmail)}"></div>
    <div class="field"><label for="s-ad">Dirección del local</label><input class="in" id="s-ad" name="address" value="${esc(s.address)}"></div>
    <div class="field"><label for="s-h">Horarios (uno por línea)</label><textarea class="in" id="s-h" name="hours" rows="3">${esc((s.hours || []).join('\n'))}</textarea></div>
    <div class="field"><label for="s-f">Texto extra en el pie de página (opcional)</label><textarea class="in" id="s-f" name="footerInfo" rows="2">${esc(s.footerInfo)}</textarea></div>
    <h3 style="margin-top:22px">Envíos y límites</h3>
    <div class="field"><label for="s-z">Localidades y costo de envío (una por línea: Localidad | costo)</label><textarea class="in" id="s-z" name="zones" rows="8">${esc((s.shippingZones || []).map(z => z.name + ' | ' + (Number(z.cost) || 0)).join('\n'))}</textarea><small>Costo 0 = sin costo. Los costos por distancia son estimados: ajustalos a tu realidad. Las localidades que no figuren se coordinan por WhatsApp.</small></div>
    <label class="chk" style="margin:6px 0 14px"><input type="checkbox" name="askPickup" ${s.askPickup ? 'checked' : ''}> Pedir día y hora de retiro cuando el cliente retira en el local</label>
    <div class="field"><label for="s-ti">Datos para transferencias (se muestran al cliente que elige “Transferencia”)</label><textarea class="in" id="s-ti" name="transferInfo" rows="3" placeholder="Banco, cuenta, titular, alias…">${esc(s.transferInfo)}</textarea></div>
    <div class="field full"><label for="s-rv">Opiniones de clientes</label><select class="in" id="s-rv" name="reviewsMode"><option value="on" ${s.reviewsMode !== 'off' ? 'selected' : ''}>Activadas (las aprobás vos antes de publicarse)</option><option value="verified" ${s.reviewsMode === 'verified' ? 'selected' : ''}>Solo compradores (con código de pedido entregado)</option><option value="off" ${s.reviewsMode === 'off' ? 'selected' : ''}>Desactivadas</option></select></div>
    <div class="field full"><label for="s-mp">Mercado Pago ${mpStatus(s)}</label><select class="in" id="s-mp" name="mpMode"><option value="off" ${s.mpMode !== 'link' && s.mpMode !== 'api' ? 'selected' : ''}>No usar</option><option value="link" ${s.mpMode === 'link' ? 'selected' : ''}>Link de pago fijo (sin servidor, el cliente manda comprobante)</option><option value="api" ${s.mpMode === 'api' ? 'selected' : ''}>Checkout automático (requiere Cloud Function)</option></select></div>
    <div class="field"><label for="s-mpl">Link de pago de Mercado Pago (https://…)</label><input class="in" id="s-mpl" name="mpLink" value="${esc(s.mpLink || '')}" placeholder="https://mpago.la/…"></div>
    <div class="field"><label for="s-mpd">Seña: % que se cobra online en el primer pago (0 = se cobra todo)</label><input class="in" id="s-mpd" name="mpDeposit" type="number" min="0" max="99" value="${esc(s.mpDeposit || 0)}"><small>El resto lo podés cobrar al entregar o el cliente lo paga desde su seguimiento.</small></div>
    <div class="field"><label for="s-mpr">URL de la función mpRefund (opcional)</label><input class="in" id="s-mpr" name="mpRefundUrl" value="${esc(s.mpRefundUrl || '')}" placeholder="Si lo dejás vacío se deduce de la URL de createMpPayment"></div>
    <div class="field"><label for="s-mpu">URL de la función createMpPayment (https://…)</label><input class="in" id="s-mpu" name="mpUrl" value="${esc(s.mpUrl || '')}" placeholder="https://us-central1-…cloudfunctions.net/createMpPayment"></div>
    <div class="field"><label for="s-fs">Envío gratis desde (monto, 0 = no usar)</label><input class="in" id="s-fs" name="freeShippingFrom" type="number" min="0" step="1" value="${esc(s.freeShippingFrom || 0)}"><small>Si el pedido (con descuentos) llega a ese monto, el envío es gratis en las localidades con costo.</small></div>
    <div class="field"><label for="s-cp">Cupones de descuento (uno por línea: CÓDIGO | 10% o CÓDIGO | 200)</label><textarea class="in" id="s-cp" name="coupons" rows="3" placeholder="BIENVENIDO | 10%">${esc((s.coupons || []).map(c => c.code + ' | ' + (c.type === 'pct' ? c.value + '%' : c.value)).join('\n'))}</textarea><small>"10%" descuenta un porcentaje; un número solo descuenta ese monto fijo. Los códigos no se pueden ocultar del todo (quedan en los datos públicos de la tienda): usalos para promociones, no para secretos.</small></div>
    <div class="form-grid"><div class="field"><label for="s-mu">Máximo de unidades por pedido</label><input class="in" id="s-mu" name="maxUnits" type="number" min="1" step="1" value="${esc(s.maxUnits ?? 30)}"></div>
    <div class="field"><label for="s-mpp">Máximo de unidades del mismo producto</label><input class="in" id="s-mpp" name="maxPerProduct" type="number" min="1" step="1" value="${esc(s.maxPerProduct ?? 10)}"></div></div>
    <h3 style="margin-top:22px">Modo catálogo</h3>
    <label class="chk" style="margin-bottom:14px"><input type="checkbox" name="catalogAll" ${s.catalogAll ? 'checked' : ''}> Toda la tienda en modo catálogo (sin carrito: todo se consulta por WhatsApp)</label>
    <h3 style="margin-top:22px">Almacén de fotos (opcional)</h3>
    <p class="note" style="margin-bottom:10px">Si cargás muchas fotos, conviene un servicio externo gratuito: en <b>cloudinary.com</b> creá una cuenta, andá a Settings &gt; Upload y creá un <i>upload preset</i> en modo <b>Unsigned</b>. Pegá acá tu <i>Cloud name</i> y el nombre del preset. Las fotos nuevas se suben allá y en la tienda se guarda solo el enlace.</p>
    <div class="form-grid"><div class="field"><label for="s-cn">Cloud name</label><input class="in" id="s-cn" name="cloudName" value="${esc(s.cloudName)}"></div>
    <div class="field"><label for="s-cu">Upload preset (unsigned)</label><input class="in" id="s-cu" name="cloudPreset" value="${esc(s.cloudPreset)}"></div></div>
    <h3 style="margin-top:22px">Aviso de pedidos por email</h3>
    <p class="note" style="margin-bottom:10px">Gratis con <b>emailjs.com</b>: creá una cuenta, conectá tu correo (Email Services), creá una plantilla (Email Templates) con asunto <code>{{subject}}</code> y cuerpo <code>{{message}}</code>, y destinatario tu correo. Copiá acá los tres datos. Con eso cada pedido te llega por email.</p>
    <div class="field"><label for="s-es">Service ID</label><input class="in" id="s-es" name="emailServiceId" value="${esc(s.emailServiceId)}" placeholder="service_xxxxxxx"></div>
    <div class="field"><label for="s-et">Template ID</label><input class="in" id="s-et" name="emailTemplateId" value="${esc(s.emailTemplateId)}" placeholder="template_xxxxxxx"></div>
    <div class="field"><label for="s-ek">Public Key</label><input class="in" id="s-ek" name="emailPublicKey" value="${esc(s.emailPublicKey)}"></div>
    <div style="margin-bottom:14px"><button type="button" class="btn btn-line btn-sm" data-act="admEmailTest">Enviar correo de prueba</button> <small class="muted" id="emailTestMsg"></small></div>
    <h3 style="margin-top:22px">Textos de páginas</h3>
    <div class="field"><label for="s-ps">Servicios</label><textarea class="in" id="s-ps" name="pageServices" rows="6">${esc(s.pageServices)}</textarea><small>Línea en blanco = nuevo párrafo. Una línea que empiece con ## es un subtítulo; con - es un punto de lista.</small></div>
    <div class="field"><label for="s-pt">Condiciones de compra</label><textarea class="in" id="s-pt" name="pageTerms" rows="6">${esc(s.pageTerms)}</textarea></div>
    <div class="field"><label for="s-pp">Política de privacidad</label><textarea class="in" id="s-pp" name="pagePrivacy" rows="6">${esc(s.pagePrivacy)}</textarea><small>Son textos de ejemplo: revisalos y adaptalos a tu negocio.</small></div>
    <details style="margin-bottom:14px"><summary style="cursor:pointer;font-weight:600">Respaldo: abrir WhatsApp del cliente al comprar</summary>
      <p class="note" style="margin:8px 0">Solo si no usás el envío automático (Cloud Function). Abre WhatsApp con el mensaje armado y el cliente lo envía él mismo, por lo que <b>verá el número</b>.</p>
      <label class="chk"><input type="checkbox" name="linkFallback" ${s.linkFallback ? 'checked' : ''}> Activar respaldo</label>
      <div class="field"><label for="s-w">Número de WhatsApp (con código de país)</label><input class="in" id="s-w" name="waNumber" inputmode="tel" placeholder="598…" value="${esc(s.waNumber)}"></div></details>
    <p class="err" data-err hidden role="alert"></p>
    <button class="btn btn-primary" type="submit">Guardar ajustes</button></form>
  <form class="panel" data-form="password" novalidate><h3>Cambiar contraseña</h3>
    <p class="note" style="margin-bottom:12px">Cambiala apenas puedas: la contraseña inicial es fácil de adivinar.</p>
    <div class="field"><label for="pw1">Nueva contraseña</label><input class="in" id="pw1" name="p1" type="password" autocomplete="new-password" minlength="6"></div>
    <div class="field"><label for="pw2">Repetir contraseña</label><input class="in" id="pw2" name="p2" type="password" autocomplete="new-password"></div>
    <p class="err" data-err hidden role="alert"></p>
    <button class="btn btn-ink" type="submit">Cambiar contraseña</button></form>
  ${SAMPLE_ON ? `<div class="panel"><h3>Datos de ejemplo</h3><p class="note" style="margin-bottom:12px">Carga ${SEED_PRODUCTS.length} productos y ${SEED_BANNERS.length} banners de muestra con marcas ficticias. No borra lo que ya cargaste.</p>
    <button type="button" class="btn btn-line" data-act="admSeed">Cargar productos de ejemplo</button></div>` : ''}
  <p class="note">Conexión: ${DB.mode === 'firebase' ? 'Firebase (datos en tiempo real)' : 'modo demo (datos guardados solo en este navegador)'}.</p>`;
}

/* ── Acciones ── */
function formErr(form, msg) { const e = $('[data-err]', form); e.textContent = msg; e.hidden = false; e.scrollIntoView({ block: 'nearest' }); }
async function guarded(fn, form) {
  const btn = form && $('button[type=submit]', form); if (btn) btn.disabled = true;
  try { await Promise.race([fn(), new Promise((_, rej) => setTimeout(() => rej(new Error('No se pudo guardar: sin respuesta del servidor. Revisá tu conexión y las reglas de Firestore.')), 15000))]); }
  catch (e) { console.error(e); const m = /permission|insufficient/i.test(e.message || e.code || '') ? 'Tu sesión no tiene permiso para guardar. Volvé a ingresar.' : (e.message || 'No se pudo guardar.'); form ? formErr(form, m) : toast(m, { bad: true }); }
  finally { if (btn) btn.disabled = false; }
}

function adminClick(a, t) {
  const id = t.dataset.id;
  if (a === 'admTab') { state.admin.tab = t.dataset.tab; renderAdminBody(); }
  else if (a === 'admGenVs') { const f = t.closest('form'), keys = comboKeys(parseVariantsText($('#f-v', f).value)); if (!keys.length) return toast('Primero escribí las variantes (ej. Talle: S, M, L).', { bad: true }); const cur = parseVS($('#f-vs', f).value); $('#f-vs', f).value = keys.map(k => k + ': ' + (cur[k] ?? 0)).join('\n'); }
  else if (a === 'admNew') openProductForm();
  else if (a === 'admNote') guarded(async () => {
    const o = state.orders.find(x => x.id === id), note = ($('#o-note').value || '').trim().slice(0, 300);
    await DB.save('orders', id, { publicNote: note });
    if (o && o.code) await DB.save('orderStatus', o.code, { note, updatedAt: Date.now() });
    toast('Mensaje guardado: el cliente lo ve en su seguimiento');
  });
  else if (a === 'admPayManual') guarded(async () => {
    const o = state.orders.find(x => x.id === id); if (!o) return;
    const total = Number(o.verifiedTotal || o.total) || 0, paid = Number(o.paidAmount) || (o.paid ? total : 0), net = Math.max(0, paid - (Number(o.refunded) || 0)), due = Math.max(0, total - net);
    const amt = Math.min(due, Number($('#o-pay').value) || due); if (!(amt > 0)) return;
    const paidAmount = Math.round((paid + amt) * 100) / 100, ok = Math.round((paidAmount - (Number(o.refunded) || 0)) * 100) / 100 + 0.01 >= total;
    await DB.save('orders', id, { paidAmount, paid: ok });
    if (o.code) await DB.save('orderStatus', o.code, { paidAmount, paid: ok, updatedAt: Date.now() });
    toast(ok ? 'Pedido saldado' : 'Cobro parcial registrado'); $('#dlgForm') && $('#dlgForm').close();
  });
  else if (a === 'admRefund') {
    const o = state.orders.find(x => x.id === id), pid = t.dataset.pid, amt = Number(($('#rf-' + pid) || {}).value) || 0;
    askConfirm(amt ? `¿Reembolsar ${money(amt)} al cliente por Mercado Pago?` : '¿Reembolsar el pago completo por Mercado Pago?', 'Reembolsar').then(ok => { if (!ok) return; guarded(async () => {
      const token = await DB.idToken(); if (!token) throw new Error('Necesitás estar conectado con Firebase para reembolsar.');
      const r = await fetch(await refundUrl(), { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify({ code: o.code, paymentId: pid, amount: amt || undefined }) });
      const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || 'No se pudo reembolsar.');
      toast('Reembolso realizado'); $('#dlgForm') && $('#dlgForm').close();
    }); });
  }
  else if (a === 'admScan') openAdminScanner();
  else if (a === 'admLabels') openLabelsDialog();
  else if (a === 'admBcScan') openScanner({ title: 'Escanear código del producto', onCode: c => { const f = $('#f-bc'); if (!f) return { msg: 'Cerrá y volvé a abrir el formulario.', ok: false }; f.value = c; f.dispatchEvent(new Event('input', { bubbles: true })); return { msg: 'Código cargado: ' + c }; } });
  else if (a === 'admBcGen') { const f = $('#f-bc'); if (f && (!f.value.trim() || confirm('Ya hay un código escrito. ¿Reemplazarlo por uno nuevo?'))) { f.value = genInternalCode(barcodeTaken()); f.dispatchEvent(new Event('input', { bubbles: true })); } }
  else if (a === 'admLblAll') { $$('#lblList input[type=checkbox]').forEach(x => { x.checked = t.dataset.v === '1'; }); }
  else if (a === 'admLblGen') genMissingCodes();
  else if (a === 'admLblPrint') {
    const items = $$('#lblList .lrow').map(r => ({ p: state.products.find(x => x.id === r.dataset.id), on: $('input[type=checkbox]', r).checked, n: Math.max(1, Math.min(99, Math.floor(Number($('input[type=number]', r).value) || 1))) })).filter(x => x.on && x.p && x.p.barcode).map(x => ({ p: x.p, n: x.n }));
    if (!items.length) return toast('Elegí al menos un producto con código.', { bad: true });
    printLabels(items, $('#lblSize').value);
  }
  else if (a === 'admImport') openImportDialog();
  else if (a === 'admRevToggle') { const r = state.reviewsAll.find(x => x.id === id); if (r) guarded(async () => { await DB.save('reviews', id, { status: r.status === 'approved' ? 'pending' : 'approved' }); toast(r.status === 'approved' ? 'Opinión oculta' : 'Opinión publicada'); }); }
  else if (a === 'admRevDel') { if (!confirm('¿Eliminar esta opinión?')) return; guarded(async () => { await DB.remove('reviews', id); toast('Opinión eliminada'); }); }
  else if (a === 'admDelAdmin') { if (!confirm('¿Quitarle el acceso al panel a ' + t.dataset.name + '? Su cuenta deja de poder editar la tienda.')) return; guarded(async () => { await DB.remove('admins', id); toast('Acceso quitado'); }); }
  else if (a === 'admTpl') downloadFile('plantilla-productos.csv', productsCsv([
    { name: 'Remera básica', category: 'Ropa', sub: 'Remeras', brand: 'Marca', price: 890, oldPrice: 1190, stock: 12, description: 'Algodón peinado', specs: 'Corte regular\nLavable a máquina', variants: [{ name: 'Talle', options: ['S', 'M', 'L'] }, { name: 'Color', options: ['Negro', 'Blanco'] }], images: ['https://ejemplo.com/foto1.jpg'], active: true },
    { name: 'Producto sin variantes', category: 'Ropa', price: 1500, stock: 5, active: true }]));
  else if (a === 'admExportP') downloadFile('productos-' + new Date().toISOString().slice(0, 10) + '.csv', productsCsv(state.products));
  else if (a === 'admExportO') downloadFile('pedidos-' + new Date().toISOString().slice(0, 10) + '.csv', ordersCsv(state.orders));
  else if (a === 'admImpGo') runImport();
  else if (a === 'admEdit') openProductForm(id);
  else if (a === 'admDel') { const p = state.products.find(x => x.id === id); askConfirm(`¿Eliminar “${p?.name}”? No se puede deshacer.`).then(ok => ok && guarded(async () => { await DB.remove('products', id); toast('Producto eliminado'); })); }
  else if (a === 'admCNew') openCategoryForm();
  else if (a === 'admCEdit') openCategoryForm(id);
  else if (a === 'admCDel') {
    const n = state.products.filter(p => p.category === id).length;
    if (Object.keys(CATS).length <= 1) return toast('Tiene que quedar al menos una categoría. Creá la nueva antes de borrar esta.', { bad: true });
    if (n) {
      const otras = Object.entries(CATS).filter(([k]) => k !== id);
      return openForm('Eliminar categoría', `<form data-form="catmove" data-id="${esc(id)}" novalidate>
        <p>“${esc(CATS[id]?.name)}” tiene <b>${n} producto${n === 1 ? '' : 's'}</b>. Elegí a qué categoría pasarlos antes de eliminarla.</p>
        <div class="field"><label for="m-c">Mover a</label><select class="in" id="m-c" name="target">${otras.map(([k, c]) => `<option value="${esc(k)}">${esc(c.name)}</option>`).join('')}</select></div>
        <p class="err" data-err hidden role="alert"></p>
        <div class="dlg-f"><button type="button" class="btn btn-line" data-act="closeDlg">Cancelar</button><button type="submit" class="btn btn-danger">Mover y eliminar</button></div></form>`);
    }
    askConfirm(`¿Eliminar la categoría “${CATS[id]?.name}”?`).then(ok => ok && guarded(async () => { await DB.remove('categories', id); toast('Categoría eliminada'); }));
  }
  else if (a === 'admBNew') openBannerForm();
  else if (a === 'admBEdit') openBannerForm(id);
  else if (a === 'admBDel') { const b = state.banners.find(x => x.id === id); askConfirm(`¿Eliminar el banner “${b?.title}”?`).then(ok => ok && guarded(async () => { await DB.remove('banners', id); toast('Banner eliminado'); })); }
  else if (a === 'admOrder') openOrder(id);
  else if (a === 'admLogout') DB.auth.logout().then(() => { state.loginErr = ''; render(); });
  else if (a === 'admGalUrl') { const f = t.closest('form'), u = $('#g-url').value.trim(), l = galGet(f); if (!/^https?:\/\//i.test(u)) return formErr(f, 'Pegá un enlace que empiece con https://'); if (l.length >= MAX_IMGS) return formErr(f, `Máximo ${MAX_IMGS} fotos.`); l.push(u); $('#g-url').value = ''; galSet(f, l); }
  else if (a === 'admGalDel') { const f = t.closest('form'), l = galGet(f); l.splice(+t.dataset.i, 1); galSet(f, l); }
  else if (a === 'admGalMain') { const f = t.closest('form'), l = galGet(f), [x] = l.splice(+t.dataset.i, 1); l.unshift(x); galSet(f, l); }
  else if (a === 'admImgClear') { const f = t.closest('form'); f.image.value = ''; $('#f-img').value = ''; updatePreview(f); }
  else if (a === 'admEmailTest') {
    const f = t.closest('form'), msg = $('#emailTestMsg'); msg.textContent = 'Enviando…';
    const keep = state.settings;
    state.settings = { ...keep, emailServiceId: f.emailServiceId.value.trim(), emailTemplateId: f.emailTemplateId.value.trim(), emailPublicKey: f.emailPublicKey.value.trim() };
    notifyEmail({ customer: { name: 'Cliente de prueba', phone: '099000000', delivery: 'retiro' }, items: [{ name: 'Producto de prueba', price: 100, qty: 1 }], total: 100 }, 'P-PRUEBA', true)
      .then(() => { msg.textContent = 'Listo: revisá tu correo (y spam). Recordá tocar “Guardar ajustes”.'; })
      .catch(e => { msg.textContent = e.message || 'No se pudo enviar.'; })
      .finally(() => { state.settings = keep; });
  }
  else if (a === 'admSeed') askConfirm('Se cargarán los productos y banners de ejemplo. ¿Continuar?', 'Cargar').then(ok => ok && guarded(async () => {
    for (const p of seedProducts()) await DB.save('products', p.id, p);
    for (const b of SEED_BANNERS) await DB.save('banners', b.id, b);
    toast('Productos de ejemplo cargados');
  }));
}

function adminChange(a, t) {
  const id = t.dataset.id;
  if (a === 'admImpFile') { const f = t.files[0]; t.value = ''; if (f) f.text().then(importPreview).catch(() => toast('No se pudo leer el archivo.', { bad: true })); return; }
  if (a === 'admCatFilter') { state.admin.cat = t.value; $('#aList').innerHTML = productRows(); }
  else if (a === 'admInline') {
    const field = t.dataset.field, raw = t.value.trim();
    let v = raw === '' ? (field === 'price' ? NaN : (field === 'stock' ? null : 0)) : num(raw);
    if ((typeof v === 'number' && (Number.isNaN(v) || v < 0))) { toast('Escribí un número válido.', { bad: true }); return renderAdminBody(); }
    if (field === 'stock' && v !== null) v = Math.floor(v);
    guarded(async () => { await DB.save('products', id, { [field]: v, updatedAt: Date.now() }); toast('Guardado'); });
  }
  else if (a === 'admActive') guarded(async () => { await DB.save('products', id, { active: t.checked, updatedAt: Date.now() }); });
  else if (a === 'admStatus') guarded(async () => {
    const o = state.orders.find(x => x.id === id);
    const now = Date.now(), history = [...(Array.isArray(o.history) && o.history.length ? o.history : [{ s: 'nuevo', t: o.createdAt || now }]), { s: t.value, t: now }];
    await DB.save('orders', id, { status: t.value, history });
    await adjustStockForStatus(o, t.value); // cancelar devuelve el stock; reactivar lo vuelve a descontar
    if (o && o.code) await DB.save('orderStatus', o.code, { status: t.value, updatedAt: now, history }); // lo que ve el cliente al seguir su pedido
    toast('Estado actualizado');
  });
  else if (a === 'admPreview') updatePreview(t.closest('form'));
  else if (a === 'admLogoFile') {
    const f = t.files[0], form = t.closest('form'); if (!f) return;
    fileToDataUrl(f, 400, 80000).then(url => { form.logo.value = ''; form.logo.dataset.keep = url; toast('Logo cargado: guardá los ajustes'); }).catch(e => formErr(form, e.message || 'No se pudo leer la imagen.'));
  }
  else if (a === 'admGalFile') {
    const form = t.closest('form'), files = [...t.files]; t.value = '';
    (async () => { const l = galGet(form); for (const f of files) { if (l.length >= MAX_IMGS) { formErr(form, `Máximo ${MAX_IMGS} fotos.`); break; } try { l.push(await fileToDataUrl(f, 700, 150000)); } catch (e) { formErr(form, e.message || 'No se pudo leer la imagen.'); } } galSet(form, l); })();
  }
  else if (a === 'admImgFile') {
    const f = t.files[0]; if (!f) return;
    const form = t.closest('form'), isBanner = form.dataset.form === 'banner';
    fileToDataUrl(f, isBanner ? 1100 : 800, form.dataset.form === 'category' ? 250000 : 600000).then(url => { form.image.value = url; $('#f-img').value = ''; updatePreview(form); })
      .catch(e => formErr(form, e.message || 'No se pudo leer la imagen.'));
  }
}
document.addEventListener('input', e => {
  const t = e.target, a = t.dataset?.act;
  if (a === 'admSearch') { state.admin.q = t.value; $('#aList').innerHTML = productRows(); }
  else if (a === 'admImgUrl') { const f = t.closest('form'); f.image.value = t.value.trim(); updatePreview(f); }
  else if (a === 'admPreview' && t.type === 'color') updatePreview(t.closest('form'));
});

async function adminSubmit(form) {
  const kind = form.dataset.form, id = form.dataset.id || null, f = new FormData(form);
  const s = k => String(f.get(k) ?? '').trim();
  $('[data-err]', form).hidden = true;

  if (kind === 'product') {
    const price = num(f.get('price')), old = String(f.get('oldPrice')).trim() === '' ? 0 : num(f.get('oldPrice'));
    const stockRaw = s('stock'), stock = stockRaw === '' ? null : Math.floor(num(stockRaw));
    if (!s('name')) return formErr(form, 'Escribí el nombre del producto.');
    if (Number.isNaN(price) || price < 0) return formErr(form, 'Escribí un precio válido.');
    if (Number.isNaN(old) || old < 0) return formErr(form, 'El precio anterior no es válido.');
    if (stock !== null && (Number.isNaN(stock) || stock < 0)) return formErr(form, 'El stock no es válido.');
    let images = []; try { images = JSON.parse(f.get('images') || '[]').filter(x => typeof x === 'string' && x).slice(0, MAX_IMGS); } catch { /* vacío */ }
    if (images.join('').length > 850000) return formErr(form, 'Las fotos pesan demasiado en total (límite de Firestore ~1 MB). Quitá alguna o usá enlaces.');
    const bcode = normCode(s('barcode'));
    if (bcode) {
      const bp = eanProblem(bcode); if (bp) return formErr(form, bp);
      const dup = findByBarcode(bcode); if (dup && dup.id !== (form.dataset.id || '')) return formErr(form, `Ese código ya lo usa “${dup.name}”.`);
    }
    const data = { barcode: bcode, name: s('name'), category: s('category'), sub: s('sub'), brand: s('brand'), price, oldPrice: old, stock, description: s('description'), specs: String(f.get('specs') || '').trim(), variants: String(f.get('variants') || '').split('\n').map(l => { const [n, o] = l.split(':'); return { name: (n || '').trim(), options: [...new Set(String(o || '').split(',').map(x => x.trim()).filter(Boolean))].slice(0, 20) }; }).filter(g => g.name && g.options.length).slice(0, 3), images, image: images[0] || '', art: s('art'), active: f.get('active') === 'on', catalogOnly: f.get('catalogOnly') === 'on', hidePrice: f.get('catalogOnly') === 'on' && f.get('hidePrice') === 'on', updatedAt: Date.now() };
    const vsTxt = String(f.get('vstock') || '').trim();
    if (vsTxt && data.variants.length) {
      const vs = parseVS(vsTxt, comboKeys(data.variants));
      if (Object.keys(vs).length) { data.vstock = vs; data.stock = Object.values(vs).reduce((t, n) => t + n, 0); } else return formErr(form, 'No reconocí ninguna combinación en "Stock por opción". Usá el botón "Generar combinaciones".');
    } else data.vstock = null;
    if (!id) data.createdAt = Date.now();
    return guarded(async () => { await DB.save('products', id, data); $('#dlgForm').close(); toast('Producto guardado'); }, form);
  }
  if (kind === 'newadmin') {
    const u = s('username'), p = String(f.get('password') || '');
    if (!u) return formErr(form, 'Escribí un usuario o correo.');
    if (p.length < 6) return formErr(form, 'La contraseña necesita al menos 6 caracteres.');
    return guarded(async () => { const r = await DB.createAdmin(u, p); form.reset(); toast(r.existed ? 'Ese usuario ya existía: ahora es administrador' : 'Administrador creado'); }, form);
  }
  if (kind === 'catmove') {
    const target = s('target'); if (!CATS[target]) return formErr(form, 'Elegí una categoría de destino.');
    return guarded(async () => {
      for (const p of state.products.filter(x => x.category === id)) await DB.save('products', p.id, { category: target, updatedAt: Date.now() });
      await DB.remove('categories', id);
      $('#dlgForm').close(); toast('Productos movidos y categoría eliminada');
    }, form);
  }
  if (kind === 'category') {
    if (!s('name')) return formErr(form, 'Escribí el nombre de la categoría.');
    const acc = /^#[0-9a-f]{6}$/i.test(s('color')) ? s('color') : '#2347F5';
    const order = Number.isNaN(num(f.get('order'))) ? 1 : num(f.get('order'));
    const data = { name: s('name'), blurb: s('blurb'), image: s('image'), art: s('art') || 'box', acc, tint: mixWhite(acc, .88), order };
    let cid = id;
    if (!cid) { cid = slugify(s('name')); const base = cid; let k = 2; while (CATS[cid]) cid = base + '-' + k++; }
    return guarded(async () => { await DB.save('categories', cid, data); $('#dlgForm').close(); toast('Categoría guardada'); }, form);
  }
  if (kind === 'banner') {
    if (!s('title')) return formErr(form, 'Escribí el título del banner.');
    const data = { title: s('title'), subtitle: s('subtitle'), cta: s('cta'), link: s('link'), color: s('color') || '#2347F5', order: Number.isNaN(num(f.get('order'))) ? 1 : num(f.get('order')), image: s('image'), art: s('art') || 'laptop', active: f.get('active') === 'on', updatedAt: Date.now() };
    return guarded(async () => { await DB.save('banners', id, data); $('#dlgForm').close(); toast('Banner guardado'); }, form);
  }
  if (kind === 'settings') {
    if (!s('storeName')) return formErr(form, 'Escribí el nombre de la tienda.');
    const linkFallback = f.get('linkFallback') === 'on';
    if (linkFallback && digits(s('waNumber')).length < 8) return formErr(form, 'Para activar el respaldo, escribí un número de WhatsApp válido.');
    const data = { storeName: s('storeName'), tagline: s('tagline'), perks: String(f.get('perks') || '').split('\n').map(x => x.trim()).filter(Boolean).slice(0, 3), footerInfo: String(f.get('footerInfo') || '').trim(), payMethods: String(f.get('payMethods') || '').split('\n').map(x => x.trim()).filter(Boolean).slice(0, 8), payPickup: String(f.get('payPickup') || '').split('\n').map(x => x.trim()).filter(Boolean).slice(0, 4), payDelivery: String(f.get('payDelivery') || '').split('\n').map(x => x.trim()).filter(Boolean).slice(0, 4), showShipping: f.get('showShipping') === 'on', linkFallback, waNumber: digits(s('waNumber')),
      brandColor: /^#[0-9a-f]{6}$/i.test(s('brandColor')) ? s('brandColor') : '#2347F5', logo: s('logo') || form.logo.dataset.keep || '', instagram: s('instagram'), facebook: s('facebook'),
      branches: String(f.get('branches') || '').split('\n').map(l => { const [n, a, im, lk] = l.split('|').map(x => (x || '').trim()); return { name: n, address: a, image: im, link: lk }; }).filter(b => b.name).slice(0, 6),
      contactWhatsapp: digits(s('contactWhatsapp')), contactEmail: s('contactEmail'), address: s('address'), hours: String(f.get('hours') || '').split('\n').map(x => x.trim()).filter(Boolean).slice(0, 7),
      shippingZones: String(f.get('zones') || '').split('\n').map(l => { const [n, c] = l.split('|'); return { name: (n || '').trim(), cost: Math.max(0, Math.round(num(c) || 0)) }; }).filter(z => z.name).slice(0, 60),
      cloudName: s('cloudName'), cloudPreset: s('cloudPreset'), catalogAll: f.get('catalogAll') === 'on', askPickup: f.get('askPickup') === 'on', transferInfo: String(f.get('transferInfo') || '').trim(), reviewsMode: ['off', 'verified'].includes(s('reviewsMode')) ? s('reviewsMode') : 'on', mpDeposit: Math.max(0, Math.min(99, Math.floor(Number(s('mpDeposit')) || 0))), mpRefundUrl: s('mpRefundUrl'), mpMode: ['link', 'api'].includes(s('mpMode')) ? s('mpMode') : 'off', mpLink: s('mpLink'), mpUrl: s('mpUrl'), emailServiceId: s('emailServiceId'), emailTemplateId: s('emailTemplateId'), emailPublicKey: s('emailPublicKey'),
      freeShippingFrom: Math.max(0, Math.round(num(f.get('freeShippingFrom')) || 0)),
      coupons: String(f.get('coupons') || '').split('\n').map(l => { const [c, v] = l.split('|').map(x => (x || '').trim()); const pct = /%$/.test(v || ''); const n = num((v || '').replace('%', '')); return { code: (c || '').toUpperCase().replace(/\s+/g, ''), type: pct ? 'pct' : 'fix', value: pct ? Math.min(100, n) : n }; }).filter(c => c.code && c.value > 0).slice(0, 20),
      maxUnits: Math.max(1, Math.floor(num(f.get('maxUnits')) || 30)), maxPerProduct: Math.max(1, Math.floor(num(f.get('maxPerProduct')) || 10)),
      pageServices: String(f.get('pageServices') || '').trim(), pageTerms: String(f.get('pageTerms') || '').trim(), pagePrivacy: String(f.get('pagePrivacy') || '').trim() };
    return guarded(async () => { await DB.save('settings', 'store', data); toast('Ajustes guardados'); }, form);
  }
  if (kind === 'password') {
    const p1 = String(f.get('p1') || ''), p2 = String(f.get('p2') || '');
    if (p1.length < 6) return formErr(form, 'La contraseña debe tener al menos 6 caracteres.');
    if (p1 !== p2) return formErr(form, 'Las contraseñas no coinciden.');
    return guarded(async () => { await DB.auth.changePassword(p1); form.reset(); toast('Contraseña actualizada'); }, form);
  }
}


/* ───────── Carga masiva, exportar y respaldo (CSV: se abre y se edita con Excel / Google Sheets) ───────── */
const CSV_COLS = ['nombre', 'categoria', 'subcategoria', 'marca', 'precio', 'precio_anterior', 'stock', 'descripcion', 'caracteristicas', 'variantes', 'fotos', 'visible', 'solo_catalogo', 'ocultar_precio', 'stock_variantes', 'codigo_barras'];
function csvParse(text) {
  text = String(text).replace(/^\uFEFF/, '');
  const first = text.split(/\r?\n/)[0] || '', d = (first.match(/;/g) || []).length >= (first.match(/,/g) || []).length ? ';' : ',';
  const rows = []; let row = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
    else if (ch === '"' && cur === '') q = true; // las comillas solo abren un campo si están al principio
    else if (ch === d) { row.push(cur); cur = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cur); cur = ''; if (row.some(x => x.trim() !== '')) rows.push(row); row = []; }
    else cur += ch;
  }
  row.push(cur); if (row.some(x => x.trim() !== '')) rows.push(row);
  return rows;
}
const csvCell = v => { const t = String(v ?? ''); return /[;"\n\r]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t; };
function productsCsv(list) {
  const rows = list.map(p => [p.name, CATS[p.category]?.name || p.category || '', p.sub || '', p.brand || '', p.price ?? '', p.oldPrice || '', p.stock ?? '', p.description || '', String(p.specs || '').split('\n').map(x => x.trim()).filter(Boolean).join(' | '),
    prodVariants(p).map(g => g.name + ': ' + g.options.join(', ')).join(' | '), (p.images && p.images.length ? p.images : p.image ? [p.image] : []).filter(u => !String(u).startsWith('data:')).join(' | '), p.active === false ? 'no' : 'si', p.catalogOnly ? 'si' : '', p.hidePrice ? 'si' : '', Object.entries(p.vstock || {}).map(([k, n]) => k + '=' + n).join(' | '), p.barcode || '']);
  return [CSV_COLS, ...rows].map(r => r.map(csvCell).join(';')).join('\r\n');
}
function ordersCsv(list) {
  const head = ['codigo', 'fecha', 'estado', 'cliente', 'telefono', 'entrega', 'localidad', 'direccion', 'pago', 'productos', 'descuento', 'envio', 'total', 'comentarios'];
  const rows = list.map(o => { const c = o.customer || {}; return [o.code || o.id, fmtDate(o.createdAt), o.status, c.name, c.phone, c.delivery, c.zone || '', c.address || '', c.payment || '', (o.items || []).map(i => i.qty + ' x ' + i.name).join(' | '), o.discount || 0, o.shipping || 0, o.total, c.note || '']; });
  return [head, ...rows].map(r => r.map(csvCell).join(';')).join('\r\n');
}
function downloadFile(name, text) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['\uFEFF' + text], { type: 'text/csv;charset=utf-8' }));
  a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
function openImportDialog() {
  openForm('Importar / exportar productos', `<div class="imp">
    <p><b>Cargar muchos productos de una vez.</b> Descargá la plantilla, completala en Excel o Google Sheets (una fila por producto) y guardala como <b>CSV</b>. Después subila acá. Las secciones que no existan se crean solas, y si el nombre coincide con un producto ya cargado, se actualiza.</p>
    <div class="dlg-f" style="justify-content:flex-start;flex-wrap:wrap"><button type="button" class="btn btn-line" data-act="admTpl">Descargar plantilla</button>
    <label class="btn btn-primary">Subir planilla CSV<input type="file" accept=".csv,text/csv,text/plain" class="sr" data-act="admImpFile"></label></div>
    <hr style="margin:18px 0;border:0;border-top:1px solid var(--line)"><p><b>Respaldo.</b> Descargá tus datos cuando quieras.</p>
    <div class="dlg-f" style="justify-content:flex-start;flex-wrap:wrap"><button type="button" class="btn btn-line" data-act="admExportP">Exportar productos</button><button type="button" class="btn btn-line" data-act="admExportO">Exportar pedidos</button></div>
    <small class="muted">Columnas: ${CSV_COLS.join(', ')}. En <i>variantes</i> usá <code>Talle: S, M, L | Color: Negro, Blanco</code>; en <i>fotos</i> y <i>caracteristicas</i>, separá con <code> | </code>. Las fotos subidas desde el panel no se exportan (solo los enlaces).</small></div>`);
}
const normH = t => String(t || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
const ALIAS = { nombre: 'nombre', producto: 'nombre', name: 'nombre', categoria: 'categoria', seccion: 'categoria', subcategoria: 'subcategoria', marca: 'marca', precio: 'precio', precio_anterior: 'precio_anterior', precio_antes: 'precio_anterior', stock: 'stock', descripcion: 'descripcion', caracteristicas: 'caracteristicas', variantes: 'variantes', fotos: 'fotos', imagenes: 'fotos', visible: 'visible', solo_catalogo: 'solo_catalogo', ocultar_precio: 'ocultar_precio', stock_variantes: 'stock_variantes', codigo_barras: 'codigo_barras', codigo: 'codigo_barras', ean: 'codigo_barras', barcode: 'codigo_barras' };
function parseMoney(v) {
  let t = String(v ?? '').replace(/[^0-9.,-]/g, ''); if (t === '') return NaN;
  if (t.includes(',') && t.includes('.')) t = t.replace(/\./g, '').replace(',', '.');
  else if (t.includes(',')) t = t.replace(',', '.');
  else if (/^\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, '');
  const n = Number(t); return Number.isFinite(n) ? n : NaN;
}
const yes = v => /^(si|sí|s|1|true|x|yes)$/i.test(String(v || '').trim());
var importPlan = null;
function importPreview(text) {
  const rows = csvParse(text);
  if (rows.length < 2) return toast('La planilla está vacía o no tiene encabezados.', { bad: true });
  const heads = rows[0].map(h => ALIAS[normH(h)] || ''), col = k => heads.indexOf(k);
  if (col('nombre') < 0 || col('precio') < 0) return toast('Faltan las columnas "nombre" y "precio". Usá la plantilla.', { bad: true });
  const get = (r, k) => (col(k) < 0 ? '' : String(r[col(k)] ?? '').trim());
  const items = [], issues = [], newCats = new Map(), seen = new Set();
  const catKey = name => Object.entries(CATS).find(([k, c]) => normH(c.name) === normH(name) || k === normH(name).replace(/_/g, '-'))?.[0];
  rows.slice(1, 501).forEach((r, i) => {
    const line = i + 2, name = get(r, 'nombre'), price = parseMoney(get(r, 'precio'));
    if (!name) return issues.push(`Fila ${line}: falta el nombre.`);
    if (!(price >= 0)) return issues.push(`Fila ${line} (${name}): precio no válido.`);
    if (seen.has(normH(name))) return issues.push(`Fila ${line} (${name}): nombre repetido en la planilla, se omite.`);
    seen.add(normH(name));
    const cname = get(r, 'categoria'); let ck = cname ? catKey(cname) : Object.keys(CATS)[0];
    if (cname && !ck) { ck = 'new:' + normH(cname); newCats.set(ck, cname); }
    if (!ck) { issues.push(`Fila ${line} (${name}): falta la categoría y no hay ninguna creada.`); return; }
    const old = parseMoney(get(r, 'precio_anterior')), stockRaw = get(r, 'stock'), stock = stockRaw === '' ? null : Math.max(0, Math.floor(parseMoney(stockRaw)));
    const bcv = normCode(get(r, 'codigo_barras')), exist = (bcv && findByBarcode(bcv)) || state.products.find(p => normH(p.name) === normH(name));
    items.push({ exist, data: {
      name, barcode: bcv, category: ck, sub: get(r, 'subcategoria'), brand: get(r, 'marca'), price, oldPrice: old > price ? old : null, stock: Number.isNaN(stock) ? null : stock,
      description: get(r, 'descripcion'), specs: get(r, 'caracteristicas').split('|').map(x => x.trim()).filter(Boolean).join('\n'),
      variants: get(r, 'variantes').split('|').map(g => { const [n, o] = g.split(':'); return { name: (n || '').trim(), options: [...new Set(String(o || '').split(',').map(x => x.trim()).filter(Boolean))].slice(0, 20) }; }).filter(g => g.name && g.options.length).slice(0, 3),
      images: get(r, 'fotos').split('|').map(x => x.trim()).filter(u => /^https?:\/\//i.test(u)).slice(0, MAX_IMGS),
      active: col('visible') < 0 ? true : get(r, 'visible') === '' ? true : yes(get(r, 'visible')), catalogOnly: yes(get(r, 'solo_catalogo')), hidePrice: yes(get(r, 'solo_catalogo')) && yes(get(r, 'ocultar_precio'))
    }, _vs: get(r, 'stock_variantes') });
  });
  importPlan = { items, newCats };
  const nNew = items.filter(x => !x.exist).length, nUpd = items.length - nNew;
  openForm('Revisá antes de importar', `<div class="imp"><p><b>${items.length}</b> producto${items.length === 1 ? '' : 's'} listo${items.length === 1 ? '' : 's'}: <b>${nNew}</b> nuevo${nNew === 1 ? '' : 's'} y <b>${nUpd}</b> para actualizar.${newCats.size ? ` Se crearán ${newCats.size} sección${newCats.size === 1 ? '' : 'es'} nueva${newCats.size === 1 ? '' : 's'}: ${[...newCats.values()].map(esc).join(', ')}.` : ''}</p>
    ${issues.length ? `<p class="err" role="alert"><b>${issues.length} fila${issues.length === 1 ? '' : 's'} con problemas (no se importan):</b><br>${issues.slice(0, 12).map(esc).join('<br>')}${issues.length > 12 ? '<br>…' : ''}</p>` : ''}
    <p class="err" data-err hidden role="alert" id="impErr"></p>
    <div class="dlg-f"><button type="button" class="btn btn-line" data-act="closeDlg">Cancelar</button><button type="button" class="btn btn-primary" data-act="admImpGo" ${items.length ? '' : 'disabled'} id="impGo">Importar ${items.length}</button></div></div>`);
}
async function runImport() {
  if (!importPlan) return;
  const { items, newCats } = importPlan, btn = $('#impGo'); btn.disabled = true;
  const err = m => { const e = $('#impErr'); e.textContent = m; e.hidden = false; btn.disabled = false; };
  try {
    const catMap = {}; let order = Object.keys(CATS).length;
    for (const [k, name] of newCats) {
      let cid = slugify(name), base = cid, n = 2; while (CATS[cid] || Object.values(catMap).includes(cid)) cid = base + '-' + n++;
      const acc = '#2347F5'; await DB.save('categories', cid, { name, blurb: '', image: '', art: 'box', acc, tint: mixWhite(acc, .88), order: ++order });
      catMap[k] = cid;
    }
    let done = 0;
    for (const { exist, data, _vs } of items) {
      const vs = _vs ? parseVS(_vs, comboKeys(data.variants)) : {};
      if (Object.keys(vs).length) { data.vstock = vs; data.stock = Object.values(vs).reduce((t, n) => t + n, 0); } else data.vstock = null;
      const d = { ...data, category: catMap[data.category] || data.category, image: data.images[0] || '', art: exist?.art || '', updatedAt: Date.now() };
      if (exist) { if (!d.images.length) { d.images = exist.images || []; d.image = exist.image || ''; } await DB.save('products', exist.id, d); }
      else { d.createdAt = Date.now(); await DB.save('products', null, d); }
      btn.textContent = `Importando… ${++done}/${items.length}`;
    }
    importPlan = null; $('#dlgForm').close(); toast(`${items.length} producto${items.length === 1 ? '' : 's'} importado${items.length === 1 ? '' : 's'}`);
  } catch (e) { console.error(e); err(/permission|insufficient/i.test(e.message || '') ? 'Tu sesión no tiene permiso para guardar. Volvé a ingresar.' : (e.message || 'No se pudo importar.')); }
}


/* Cancelar un pedido devuelve el stock (una sola vez); si se reactiva, se vuelve a descontar */
async function adjustStockForStatus(o, next) {
  if (!o || !o.stockApplied) return;
  const prev = o.status;
  const move = async sign => {
    for (const pid of new Set((o.items || []).map(i => i.id))) {
      const pt = stockPatch(state.products.find(x => x.id === pid), o.items || [], sign);
      if (pt) await DB.save('products', pid, { ...pt, updatedAt: Date.now() });
    }
  };
  if (next === 'cancelado' && prev !== 'cancelado' && !o.stockRestored) { await move(+1); await DB.save('orders', o.id, { stockRestored: true }); toast('Pedido cancelado: el stock se devolvió'); }
  else if (prev === 'cancelado' && next !== 'cancelado' && o.stockRestored) { await move(-1); await DB.save('orders', o.id, { stockRestored: false }); }
}

/* ── Resumen ── */
/* ── Panel de ventas ── */
var RANGES = [['7', '7 días'], ['30', '30 días'], ['90', '90 días'], ['365', '12 meses'], ['all', 'Todo'], ['custom', 'Fechas']];
const isoDay = t => { const d = new Date(t), p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };
function salesRange() {
  const ad = state.admin, r = ad.range || '30', day = 864e5, end0 = new Date().setHours(23, 59, 59, 999);
  let from, to = end0;
  if (r === 'all') { const m = Math.min(...state.orders.map(o => o.createdAt || Infinity)); from = Number.isFinite(m) ? new Date(m).setHours(0, 0, 0, 0) : end0 - 30 * day; }
  else if (r === 'custom') { from = ad.from ? new Date(ad.from + 'T00:00:00').getTime() : end0 - 30 * day; to = ad.to ? new Date(ad.to + 'T23:59:59').getTime() : end0; }
  else from = new Date(end0 - (+r - 1) * day).setHours(0, 0, 0, 0);
  if (to < from) [from, to] = [to, from];
  return { from, to };
}
function summaryTab() {
  const { from, to } = salesRange(), day = 864e5, span = Math.max(1, Math.round((to - from) / day)), prevFrom = from - (to - from) - 1, prevTo = from - 1;
  const live = state.orders.filter(o => o.status !== 'cancelado');
  const inR = (o, a, b) => (o.createdAt || 0) >= a && (o.createdAt || 0) <= b;
  const cur = live.filter(o => inR(o, from, to)), prev = live.filter(o => inR(o, prevFrom, prevTo));
  const sum = (l, f) => l.reduce((t, o) => t + f(o), 0), tot = o => Number(o.total) || 0;
  const units = l => sum(l, o => sum(o.items || [], i => Number(i.qty) || 0));
  const money0 = n => money(Math.round(n));
  const sales = sum(cur, tot), n = cur.length, avg = n ? sales / n : 0, pSales = sum(prev, tot);
  const collected = sum(cur, o => Math.max(0, (Number(o.paidAmount) || (o.paid ? tot(o) : 0)) - (Number(o.refunded) || 0))), refunded = sum(cur, o => Number(o.refunded) || 0);
  const delta = (a, b) => b > 0 ? `<em class="${a >= b ? 'up' : 'down'}">${a >= b ? '▲' : '▼'} ${Math.abs(Math.round((a - b) / b * 100))}%</em>` : '';
  // buckets: días, semanas o meses según el largo del rango
  const mode = span <= 45 ? 'd' : span <= 200 ? 'w' : 'm', keyOf = t => { const d = new Date(t); if (mode === 'd') return isoDay(t); if (mode === 'm') return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); const x = new Date(d); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return isoDay(x.getTime()); };
  const buckets = new Map(); for (let t = from; t <= to; t += day) buckets.set(keyOf(t), { v: 0, n: 0 });
  cur.forEach(o => { const b = buckets.get(keyOf(o.createdAt)); if (b) { b.v += tot(o); b.n++; } });
  const bl = [...buckets.entries()], max = Math.max(1, ...bl.map(([, b]) => b.v));
  const label = k => mode === 'm' ? ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'][+k.slice(5) - 1] + ' ' + k.slice(2, 4) : k.slice(8) + '/' + k.slice(5, 7);
  const W = 720, H = 220, pl = 56, pb = 26, pt = 10, bw = (W - pl) / bl.length, ch = H - pb - pt;
  const nice = (() => { const p = Math.pow(10, Math.floor(Math.log10(max))), m = max / p; return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p; })();
  const ticks = [0, .25, .5, .75, 1].map(f => nice * f), every = Math.ceil(bl.length / 10);
  const chart = n ? `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Ventas por ${mode === 'd' ? 'día' : mode === 'w' ? 'semana' : 'mes'}">${ticks.map(v => { const y = pt + ch - v / nice * ch; return `<line x1="${pl}" x2="${W}" y1="${y}" y2="${y}" stroke="#e5e7eb"/><text x="${pl - 6}" y="${y + 4}" text-anchor="end" font-size="10" fill="#6b7280">${Math.round(v).toLocaleString('es-UY')}</text>`; }).join('')}
    ${bl.map(([k, b], i) => { const h = b.v / nice * ch, x = pl + i * bw; return `<g><rect x="${x + bw * .15}" y="${pt + ch - h}" width="${Math.max(1, bw * .7)}" height="${Math.max(h, b.v ? 1 : 0)}" rx="3" fill="#2347f5" opacity="${b.v ? 1 : .15}"><title>${label(k)}${mode === 'w' ? ' (semana)' : ''}: ${money0(b.v)} · ${b.n} pedido${b.n === 1 ? '' : 's'}</title></rect>${i % every === 0 ? `<text x="${x + bw / 2}" y="${H - 8}" text-anchor="middle" font-size="10" fill="#6b7280">${label(k)}</text>` : ''}</g>`; }).join('')}</svg>` : '<p class="muted" style="padding:30px 0;text-align:center">No hay ventas en estas fechas.</p>';
  // rankings
  const prodOf = id => state.products.find(p => p.id === id);
  const byP = {}, byC = {}, byPay = {}, byDel = { retiro: { n: 0, v: 0 }, envio: { n: 0, v: 0 } }, byDow = Array.from({ length: 7 }, () => ({ n: 0, v: 0 }));
  cur.forEach(o => {
    (o.items || []).forEach(i => { const v = (Number(i.price) || 0) * (Number(i.qty) || 0), x = byP[i.id] = byP[i.id] || { name: String(i.name).replace(/ \(.*\)$/, ''), q: 0, v: 0 }; x.q += Number(i.qty) || 0; x.v += v; const p = prodOf(i.id), cn = p ? catOf(p).name : 'Otros', y = byC[cn] = byC[cn] || { q: 0, v: 0 }; y.q += Number(i.qty) || 0; y.v += v; });
    const pm = o.customer?.payment || 'Sin indicar', z = byPay[pm] = byPay[pm] || { n: 0, v: 0 }; z.n++; z.v += tot(o);
    const dl = byDel[o.customer?.delivery === 'envio' ? 'envio' : 'retiro']; dl.n++; dl.v += tot(o);
    const w = byDow[(new Date(o.createdAt).getDay() + 6) % 7]; w.n++; w.v += tot(o);
  });
  const bars = (rows, fmt) => { const m = Math.max(1, ...rows.map(r => r.v)); return rows.length ? `<ul class="hb">${rows.map(r => `<li><span class="hb-l" title="${esc(r.l)}">${esc(r.l)}</span><i><u style="width:${Math.max(2, Math.round(r.v / m * 100))}%"></u></i><b>${fmt(r)}</b></li>`).join('')}</ul>` : '<p class="muted">Sin datos.</p>'; };
  const rows = o => Object.entries(o).map(([l, x]) => ({ l, ...x })).sort((a, b) => b.v - a.v);
  const topP = Object.values(byP).map(x => ({ l: x.name, ...x })).sort((a, b) => b.v - a.v).slice(0, 8);
  const dows = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'].map((l, i) => ({ l, ...byDow[i] }));
  const low = state.products.filter(p => p.active !== false && Number.isFinite(Number(p.stock)) && p.stock !== null && Number(p.stock) <= 5).sort((a, b) => a.stock - b.stock).slice(0, 10);
  const nuevos = state.orders.filter(o => o.status === 'nuevo').length, ad = state.admin;
  const statusN = Object.keys(STATUS).map(k => ({ l: STATUS[k], v: state.orders.filter(o => o.status === k && inR(o, from, to)).length }));
  return `<div class="range" role="group" aria-label="Período">${RANGES.map(([k, l]) => `<button type="button" class="chip ${(ad.range || '30') === k ? 'on' : ''}" data-act="admRange" data-r="${k}">${l}</button>`).join('')}
      ${(ad.range === 'custom') ? `<label>Desde <input class="in" type="date" id="sr-from" value="${esc(ad.from || isoDay(from))}"></label><label>Hasta <input class="in" type="date" id="sr-to" value="${esc(ad.to || isoDay(to))}"></label>` : `<small class="muted">${isoDay(from).split('-').reverse().join('/')} – ${isoDay(to).split('-').reverse().join('/')}</small>`}</div>
    <div class="stats">
      <div class="stat"><small>Ventas</small><b>${money0(sales)}</b><span>${delta(sales, pSales)} vs. período anterior</span></div>
      <div class="stat"><small>Pedidos</small><b>${n}</b><span>${delta(n, prev.length)} ${n && span ? (n / span).toFixed(1) + ' por día' : ''}</span></div>
      <div class="stat"><small>Ticket promedio</small><b>${money0(avg)}</b><span>${units(cur)} unidades vendidas</span></div>
      <div class="stat"><small>Cobrado</small><b>${money0(collected)}</b><span>${sales > collected ? 'Por cobrar ' + money0(sales - collected) : 'Todo cobrado'}${refunded ? ' · Reembolsado ' + money0(refunded) : ''}</span></div>
      <div class="stat ${nuevos ? 'hot' : ''}"><small>Pedidos nuevos</small><b>${nuevos}</b><span><button type="button" class="lnk" data-act="admTab" data-tab="orders">Ver pedidos</button></span></div></div>
    <div class="panel" style="max-width:none"><h3>Ventas por ${mode === 'd' ? 'día' : mode === 'w' ? 'semana' : 'mes'}</h3>${chart}</div>
    <div class="stat-cols"><div class="panel"><h3>Productos que más venden</h3>${bars(topP, r => money0(r.v) + ' · ' + r.q + ' u.')}</div>
      <div class="panel"><h3>Por categoría</h3>${bars(rows(byC), r => money0(r.v))}</div></div>
    <div class="stat-cols"><div class="panel"><h3>Medios de pago</h3>${bars(rows(byPay), r => money0(r.v) + ' · ' + r.n)}</div>
      <div class="panel"><h3>Retiro vs. envío</h3>${bars([{ l: 'Retiro en el local', ...byDel.retiro }, { l: 'Envío', ...byDel.envio }], r => money0(r.v) + ' · ' + r.n)}<h3 style="margin-top:14px">Estado de los pedidos</h3>${bars(statusN, r => r.v)}</div></div>
    <div class="stat-cols"><div class="panel"><h3>Días de la semana</h3>${bars(dows, r => money0(r.v) + ' · ' + r.n)}</div>
      <div class="panel"><h3>Stock bajo o agotado</h3>${low.length ? `<ul class="plain">${low.map(p => `<li><button type="button" class="lnk" data-act="admEdit" data-id="${esc(p.id)}">${esc(p.name)}</button> <b class="${Number(p.stock) <= 0 ? 'bad' : 'lowst'}">${Number(p.stock) <= 0 ? 'agotado' : 'quedan ' + p.stock}</b></li>`).join('')}</ul>` : '<p class="muted">Todo con stock.</p>'}</div></div>
    <p class="note">No incluye pedidos cancelados. “Ventas” son pedidos recibidos en la tienda; “Cobrado” son pagos registrados (Mercado Pago o cobros manuales).</p>`;
}
document.addEventListener('click', e => { const t = e.target.closest('[data-act="admRange"]'); if (!t) return; state.admin.range = t.dataset.r; renderAdminBody(); });
document.addEventListener('change', e => { const t = e.target; if (t && (t.id === 'sr-from' || t.id === 'sr-to')) { state.admin[t.id === 'sr-from' ? 'from' : 'to'] = t.value; renderAdminBody(); } });

/* ── Usuarios (administradores) ── */
function adminsTab() {
  const me = (state.user && state.user.email || '').toLowerCase(), disp = e => String(e).replace('@tienda-admin.local', '');
  const list = [...state.admins].sort((a, b) => String(a.email).localeCompare(b.email));
  return `<div class="panel"><h3>Quién puede entrar al panel</h3>
    <ul class="plain">${me ? `<li><span>${esc(disp(me))} <small class="muted">(vos)</small></span></li>` : ''}${list.filter(a => String(a.email).toLowerCase() !== me).map(a => `<li><span>${esc(disp(a.email))}</span><button type="button" class="btn btn-danger btn-sm" data-act="admDelAdmin" data-id="${esc(a.id)}" data-name="${esc(disp(a.email))}">Quitar</button></li>`).join('')}</ul>
    <p class="note">El administrador principal está definido en las reglas de Firestore y no se puede quitar desde acá.</p></div>
  <form class="panel" data-form="newadmin" novalidate><h3>Agregar administrador</h3>
    <div class="form-grid"><div class="field"><label for="n-u">Usuario o correo</label><input class="in" id="n-u" name="username" autocomplete="off" placeholder="ej.: maria"></div>
    <div class="field"><label for="n-p">Contraseña (mínimo 6)</label><input class="in" id="n-p" name="password" type="password" autocomplete="new-password"></div></div>
    <p class="err" data-err hidden role="alert"></p><button type="submit" class="btn btn-primary">Crear administrador</button>
    <p class="note" style="margin-top:10px">Crea la cuenta y le da permiso para editar productos, precios y pedidos. Requiere que el registro esté activado en Firebase (Authentication > Configuración > Acciones del usuario) y las reglas nuevas publicadas.</p></form>`;
}

/* ── Códigos de barras en el panel ── */
document.addEventListener('input', e => {
  if (e.target && e.target.id === 'f-bc') { const pv = $('#bcPrev'), c = normCode(e.target.value); if (pv) pv.innerHTML = c ? (barcodeSvg(c, { width: 220, height: 50, fontSize: 11 }) || '<small class="err">Este código tiene caracteres que no se pueden imprimir.</small>') : ''; }
});
document.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target && e.target.id === 'f-bc') e.preventDefault(); }); // el lector USB termina con Enter: no enviar el formulario

/* Lectura desde el panel: abre el producto o propone crearlo */
function adminScan(code) {
  const p = findByBarcode(code);
  if (p) { scanBeep(true); const d = $('#dlgForm'); if (d && d.open) d.close(); openProductForm(p.id); return { msg: p.name, ok: true }; }
  scanBeep(false);
  askConfirm(`El código ${code} no está cargado. ¿Crear un producto nuevo con ese código?`, 'Crear producto').then(ok => { if (ok) { state.admin.tab = 'products'; openProductForm(null, { barcode: code }); } });
  return { msg: `Código ${code} sin producto`, ok: false };
}
function openAdminScanner() {
  openScanner({
    title: 'Escanear productos', keep: true,
    modes: [{ id: 'find', label: 'Buscar / editar' }, { id: 'add', label: 'Sumar stock (llegó mercadería)' }, { id: 'sub', label: 'Restar stock (venta en mostrador)' }],
    hint: 'Elegí qué hacer y escaneá. Funciona con la cámara o con un lector USB.',
    onCode: async (code, mode, qty) => {
      if (mode === 'find') {
        const p = findByBarcode(code);
        if (!p) { closeScanner(); return adminScan(code); }
        closeScanner(); openProductForm(p.id); return { msg: p.name };
      }
      const p = findByBarcode(code);
      if (!p) return { msg: `El código ${code} no está cargado. Usá “Buscar / editar” para crear el producto.`, ok: false };
      if (hasVS(p)) return { msg: `${p.name}: tiene stock por variante, ajustalo desde Editar.`, ok: false };
      if (p.stock === null || p.stock === undefined || p.stock === '') return { msg: `${p.name}: no tiene control de stock (sin límite).`, ok: false };
      const cur = Number(p.stock) || 0, n = Math.max(0, cur + (mode === 'add' ? qty : -qty));
      if (mode === 'sub' && cur <= 0) return { msg: `${p.name}: ya está sin stock.`, ok: false };
      await DB.save('products', p.id, { stock: n, updatedAt: Date.now() }); p.stock = n;
      return { msg: `${p.name}: ${mode === 'add' ? '+' : '−'}${qty} → stock ${n}` };
    }
  });
}
/* Etiquetas */
function openLabelsDialog() {
  const l = [...state.products].sort((a, b) => String(a.name).localeCompare(b.name));
  if (!l.length) return toast('Primero cargá productos.', { bad: true });
  const miss = l.filter(p => !p.barcode).length;
  openForm('Imprimir etiquetas', `<p class="note" style="margin-bottom:10px">Marcá los productos y cuántas etiquetas de cada uno. Los que no tienen código no se pueden imprimir.</p>
    ${miss ? `<p class="note"><b>${miss}</b> producto${miss === 1 ? '' : 's'} sin código. <button type="button" class="btn btn-line btn-sm" data-act="admLblGen">Generar códigos internos</button></p>` : ''}
    <div class="row" style="margin:8px 0"><label>Tamaño <select class="in" id="lblSize"><option value="small">Rollo 50 × 30 mm</option><option value="big">Rollo 70 × 40 mm</option><option value="a4">Hoja A4 (4 columnas)</option></select></label>
      <span class="sp"></span><button type="button" class="btn btn-line btn-sm" data-act="admLblAll" data-v="1">Marcar todos</button><button type="button" class="btn btn-line btn-sm" data-act="admLblAll" data-v="0">Desmarcar</button></div>
    <div id="lblList" class="lbl-list">${lblRows(l)}</div>
    <div class="dlg-f"><button type="button" class="btn btn-line" data-act="closeDlg">Cerrar</button><button type="button" class="btn btn-primary" data-act="admLblPrint">Imprimir</button></div>`);
}
function lblRows(l) {
  return l.map(p => `<div class="lrow" data-id="${esc(p.id)}"><label class="lck"><input type="checkbox" ${p.barcode ? 'checked' : 'disabled'}> <span>${esc(p.name)}</span></label><small class="muted">${p.barcode ? esc(p.barcode) : 'sin código'}</small><input class="in" type="number" min="1" max="99" value="1" aria-label="Cantidad de etiquetas de ${esc(p.name)}"></div>`).join('');
}
async function genMissingCodes() {
  const taken = barcodeTaken(), miss = state.products.filter(p => !p.barcode);
  if (!miss.length) return;
  const ok = await askConfirm(`Se crearán códigos internos para ${miss.length} producto${miss.length === 1 ? '' : 's'}. ¿Continuar?`, 'Generar');
  if (!ok) return;
  guarded(async () => {
    for (const p of miss) { const c = genInternalCode(taken); if (!c) continue; taken.add(c); await DB.save('products', p.id, { barcode: c, updatedAt: Date.now() }); p.barcode = c; }
    toast('Códigos generados'); openLabelsDialog();
  });
}

/* Estado de configuración de Mercado Pago (se ve en rojo si falta algo) */
function mpStatus(s) {
  const https = v => /^https:\/\//i.test(String(v || ''));
  let ok = false, msg = 'No configurado / no disponible: elegí un modo';
  if (s.mpMode === 'link') { ok = https(s.mpLink); msg = ok ? 'Configurado (link fijo)' : 'No configurado / no disponible: falta el link https://'; }
  else if (s.mpMode === 'api') { ok = https(s.mpUrl); msg = ok ? 'Configurado (checkout automático)' : 'No configurado / no disponible: falta la URL de la función'; }
  return `<span class="mp-st ${ok ? 'ok' : 'bad'}">${ok ? '●' : '●'} ${msg}</span>`;
}

/* ── Pagos del pedido: registrar pagos manuales y reembolsar (Mercado Pago) ── */
function orderPayHtml(o) {
  const total = Number(o.verifiedTotal || o.total) || 0, paid = Number(o.paidAmount) || (o.paid ? total : 0), ref = Number(o.refunded) || 0, net = Math.max(0, paid - ref), due = Math.max(0, total - net);
  const pays = Array.isArray(o.payments) ? o.payments : [], api = state.settings.mpMode === 'api' && /^https:\/\//.test(state.settings.mpUrl || '');
  return `<div class="panel" style="margin-top:12px"><h3>Pagos</h3>
    <p>Total ${money(total)} · Pagado ${money(paid)}${ref ? ` · Reembolsado ${money(ref)}` : ''} · <b class="${due > 0 ? 'bad' : 'okc'}">${due > 0 ? 'Saldo ' + money(due) : 'Saldado'}</b></p>
    ${pays.length ? `<ul class="plain">${pays.map(p => { const left = Math.round((p.amount - (p.refunded || 0)) * 100) / 100; return `<li><span>Mercado Pago #${esc(p.id)} · ${money(p.amount)}${p.refunded ? ` <small class="muted">(reembolsado ${money(p.refunded)})</small>` : ''}</span>${api && left > 0 ? `<span class="row"><input class="in" type="number" min="1" max="${left}" step="0.01" placeholder="${left}" id="rf-${esc(p.id)}" style="width:100px;height:32px" aria-label="Monto a reembolsar (vacío = ${left})"><button type="button" class="btn btn-danger btn-sm" data-act="admRefund" data-id="${esc(o.id)}" data-pid="${esc(p.id)}">Reembolsar</button></span>` : ''}</li>`; }).join('')}</ul>` : '<p class="muted">Sin pagos de Mercado Pago registrados.</p>'}
    ${due > 0 ? `<div class="row" style="margin-top:8px"><input class="in" type="number" min="1" step="0.01" id="o-pay" placeholder="${due}" style="width:130px;height:36px" aria-label="Monto cobrado en mano o transferencia"><button type="button" class="btn btn-line btn-sm" data-act="admPayManual" data-id="${esc(o.id)}">Registrar cobro manual (efectivo / transferencia)</button></div>` : ''}
    ${state.settings.mpMode === 'api' && !api ? '<p class="note">Para reembolsar desde acá, completá la URL de la función en Ajustes → Mercado Pago.</p>' : ''}</div>`;
}
async function refundUrl() {
  const s = state.settings; return s.mpRefundUrl || String(s.mpUrl || '').replace(/createMpPayment/i, 'mpRefund');
}
