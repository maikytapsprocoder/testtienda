/* ───────── Extras de gestión: respaldo, avisos al cliente, impresión, etiquetas, catálogo para redes ───────── */

var ORDER_TAGS = ['Esperando pago', 'Avisar al cliente', 'Preparar', 'Urgente', 'Con problema'];
var plainDay = t => { try { return new Date(t).toLocaleString('es-UY', { dateStyle: 'short', timeStyle: 'short' }); } catch { return ''; } };

/* ── Mensajes al cliente según el estado ── */
function statusMessage(o) {
  const c = o.customer || {}, st = state.settings, code = o.code || '', hi = `Hola ${c.name || ''}, te escribimos de ${st.storeName}.`;
  const by = {
    nuevo: `${hi} Recibimos tu pedido ${code}. Enseguida lo confirmamos.`,
    atendido: `${hi} Tu pedido ${code} ya está en preparación.`,
    listo: c.delivery === 'envio' ? `${hi} Tu pedido ${code} salió en camino.${o.trackNo ? ' Guía N° ' + o.trackNo + (o.carrier ? ' (' + o.carrier + ')' : '') + '.' : ''}` : `${hi} Tu pedido ${code} está listo para retirar.`,
    entregado: `${hi} Tu pedido ${code} figura como entregado. ¡Gracias por tu compra!`,
    cancelado: `${hi} Tu pedido ${code} fue cancelado. Escribinos si tenés dudas.`
  };
  return by[o.status] || `${hi} Te escribimos por tu pedido ${code}.`;
}
/* Email de cambio de estado (EmailJS, opcional): solo si el cliente dejó su correo */
async function notifyCustomerStatus(o, status) {
  const s = state.settings, to = o && o.customer && o.customer.email;
  if (!to || !s.emailServiceId || !s.emailStatusTemplateId || !s.emailPublicKey) return;
  const label = (typeof STATUS_LBL !== 'undefined' && STATUS_LBL[status]) || status;
  const link = (s.siteUrl || location.href.split('#')[0]) + '#/pedido/' + (o.code || '');
  try {
    const res = await fetch('https://api.emailjs.com/api/v1.0/email/send', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ service_id: s.emailServiceId, template_id: s.emailStatusTemplateId, user_id: s.emailPublicKey, template_params: { to_email: to, to_name: o.customer.name, order_code: o.code, status: label, message: statusMessage({ ...o, status }) + ' Seguí tu pedido: ' + link, store_name: s.storeName } }) });
    if (!res.ok) console.warn('EmailJS estado', res.status);
  } catch (e) { console.warn('EmailJS estado', e); }
}

/* ── Pedido: gestión interna (etiquetas, nota, envío) ── */
function orderMetaHtml(o) {
  const tags = o.tags || [];
  return `<div class="panel" style="margin-top:12px"><h3>Gestión interna <small class="muted">(el cliente no ve las etiquetas ni la nota)</small></h3>
    <div class="chips" role="group" aria-label="Etiquetas">${ORDER_TAGS.map(t => `<button type="button" class="chip ${tags.includes(t) ? 'on' : ''}" data-act="admTag" data-t="${esc(t)}" aria-pressed="${tags.includes(t)}">${esc(t)}</button>`).join('')}</div>
    <div class="field" style="margin-top:10px"><label for="o-int">Nota interna</label><textarea class="in" id="o-int" rows="2" maxlength="500">${esc(o.internalNote || '')}</textarea></div>
    <div class="row"><div class="field" style="flex:1"><label for="o-car">Empresa de envío (opcional)</label><input class="in" id="o-car" maxlength="40" placeholder="DAC, Correo Uruguayo…" value="${esc(o.carrier || '')}"></div>
      <div class="field" style="flex:1"><label for="o-trk">N° de guía / seguimiento</label><input class="in" id="o-trk" maxlength="40" value="${esc(o.trackNo || '')}"></div></div>
    <p><button type="button" class="btn btn-line btn-sm" data-act="admMeta" data-id="${esc(o.id)}">Guardar</button> <small class="muted">La empresa y la guía se muestran al cliente en el seguimiento.</small></p></div>`;
}
/* ── Pedidos: filtros ── */
function ordersFiltered() {
  const f = state.admin.of || {}, q = String(f.q || '').toLowerCase().trim();
  return state.orders.filter(o => ((state.admin.ov === 'can') === (o.status === 'cancelado')) && (!f.st || o.status === f.st) && (!f.tag || (o.tags || []).includes(f.tag)) && (!f.pay || (f.pay === 'paid' ? o.paid : !o.paid)) &&
    (!q || [o.code, o.customer?.name, o.customer?.phone].join(' ').toLowerCase().includes(q)));
}
function orderFilterBar(f, n) {
  return `<div class="ofilters"><input class="in" type="search" id="of-q" placeholder="Buscar por código, nombre o teléfono" value="${esc(f.q || '')}" aria-label="Buscar pedidos">
    <select class="in" id="of-st" aria-label="Estado"><option value="">Todos los estados</option>${Object.entries(STATUS).filter(([k]) => state.admin.ov === 'can' ? false : k !== 'cancelado').map(([k, v]) => `<option value="${k}" ${f.st === k ? 'selected' : ''}>${v}</option>`).join('')}</select>
    <select class="in" id="of-tag" aria-label="Etiqueta"><option value="">Todas las etiquetas</option>${ORDER_TAGS.map(t => `<option ${f.tag === t ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select>
    <select class="in" id="of-pay" aria-label="Pago"><option value="">Pagados y no pagados</option><option value="paid" ${f.pay === 'paid' ? 'selected' : ''}>Pagados</option><option value="unpaid" ${f.pay === 'unpaid' ? 'selected' : ''}>Sin pagar</option></select>
    <small class="muted">${n} pedido${n === 1 ? '' : 's'}</small></div>`;
}
document.addEventListener('input', e => { if (e.target.id === 'of-q') { (state.admin.of = state.admin.of || {}).q = e.target.value; clearTimeout(window.__ofT); window.__ofT = setTimeout(() => { const pos = e.target.selectionStart; renderAdminBody(); const i = $('#of-q'); if (i) { i.focus(); try { i.setSelectionRange(pos, pos); } catch { /* nada */ } } }, 250); } });
document.addEventListener('change', e => { const m = { 'of-st': 'st', 'of-tag': 'tag', 'of-pay': 'pay' }[e.target.id]; if (m) { (state.admin.of = state.admin.of || {})[m] = e.target.value; renderAdminBody(); } });

/* ── Imprimir hoja de preparación ── */
function printOrder(o) {
  const c = o.customer || {}, items = (o.items || []);
  const html = `<!doctype html><meta charset="utf-8"><title>Pedido ${esc(o.code)}</title><style>@page{margin:12mm}body{font:13px/1.45 system-ui,sans-serif;color:#000}h1{font-size:20px;margin:0}table{width:100%;border-collapse:collapse;margin:12px 0}td,th{padding:6px 4px;border-bottom:1px solid #999;text-align:left}td:last-child,th:last-child{text-align:right}.b{border:1px solid #000;padding:8px;margin:8px 0}.chk{width:18px;height:18px;border:1.5px solid #000;display:inline-block;vertical-align:middle;margin-right:6px}.tot td{font-weight:700;border:0}</style>
    <h1>${esc(state.settings.storeName)} · Pedido ${esc(o.code)}</h1><p>${esc(plainDay(o.createdAt))} · ${c.delivery === 'envio' ? 'ENVÍO' : 'RETIRO EN EL LOCAL'}${o.paid ? ' · PAGADO' : ''}</p>
    <div class="b"><b>${esc(c.name)}</b> · ${esc(c.phone)}${c.email ? ' · ' + esc(c.email) : ''}<br>${c.delivery === 'envio' ? esc(c.address || '') + (c.zone ? ' (' + esc(c.zone) + ')' : '') : (c.pickup ? 'Retira: ' + esc(c.pickup) : '')}${c.note ? '<br><i>“' + esc(c.note) + '”</i>' : ''}${o.publicNote ? '<br>Mensaje al cliente: ' + esc(o.publicNote) : ''}</div>
    <table><thead><tr><th>Producto</th><th>Cant.</th><th>Importe</th></tr></thead><tbody>${items.map(i => `<tr><td><span class="chk"></span>${esc(i.name)}</td><td>${esc(i.qty)}</td><td>${money(i.price * i.qty)}</td></tr>`).join('')}
    ${o.discount ? `<tr class="tot"><td colspan="2">Descuento</td><td>− ${money(o.discount)}</td></tr>` : ''}${o.shipping ? `<tr class="tot"><td colspan="2">Envío</td><td>${money(o.shipping)}</td></tr>` : ''}<tr class="tot"><td colspan="2">Total</td><td>${money(o.total)}</td></tr></tbody></table>
    <p>Forma de pago: ${esc(c.payment || '-')}${o.internalNote ? '<br>Nota interna: ' + esc(o.internalNote) : ''}</p>`;
  const f = document.createElement('iframe'); f.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0'; document.body.appendChild(f);
  f.srcdoc = html; f.onload = () => { try { f.contentWindow.focus(); f.contentWindow.print(); } catch { toast('No se pudo abrir la impresión.', { bad: true }); } setTimeout(() => f.remove(), 60000); };
}

/* ── Respaldo y restauración ── */
function optPanel() {
  const big = state.products.reduce((n, p) => n + ((Array.isArray(p.images) ? p.images : [p.image]).filter(u => typeof u === 'string' && u.startsWith('data:') && u.length > 150000).length), 0);
  return `<div class="panel"><h3>Fotos</h3><p class="muted">Las fotos nuevas ya se reducen solas al subirlas. Si cargaste fotos pesadas antes, acá las recomprimís (máx. 900 px, WebP). ${big ? `<b>${big}</b> foto(s) pesada(s) detectada(s).` : 'No hay fotos pesadas.'}</p>
    <button type="button" class="btn btn-line btn-sm" data-act="admOptImg" ${big ? '' : 'disabled'}>Optimizar fotos guardadas</button>
    <p class="muted" style="margin-top:8px">Consejo: con Cloudinary (Ajustes → fotos) además se sirven en tamaño chico y formato moderno automáticamente.</p></div>`;
}
async function optimizeStored() {
  let n = 0, saved = 0;
  for (const p of state.products) {
    const list = Array.isArray(p.images) ? p.images.slice() : (p.image ? [p.image] : []); let ch = false;
    for (let i = 0; i < list.length; i++) { const u = list[i]; if (typeof u === 'string' && u.startsWith('data:') && u.length > 150000) {
      try { const blob = await (await fetch(u)).blob(), nu = await fileToDataUrlLocal(blob, 900, 120000); if (nu.length < u.length) { saved += u.length - nu.length; list[i] = nu; ch = true; n++; } } catch (e) { console.warn(e); } } }
    if (ch) await DB.save('products', p.id, { images: list, image: list[0] || '', updatedAt: Date.now() });
  }
  toast(`${n} foto(s) optimizadas, ahorro ≈ ${Math.round(saved * .75 / 1024)} KB`);
}
function backupPanel() {
  return `<div class="panel"><h3>Respaldo de datos</h3>
    <p class="muted">Descargá una copia de productos, categorías, banners, ajustes, pedidos y opiniones. Guardala en un lugar seguro (por ejemplo, tu Drive) cada tanto, y antes de hacer cambios grandes.</p>
    <div class="row"><button type="button" class="btn btn-primary btn-sm" data-act="admBackup">Descargar respaldo</button>
      <label class="btn btn-line btn-sm">Restaurar desde un respaldo<input type="file" accept="application/json,.json" class="sr" data-act="admRestore"></label></div>
    <p class="note" style="margin-top:10px">Restaurar <b>vuelve a escribir</b> los datos del archivo (no borra lo que no esté en él).</p></div>
    <div class="panel"><h3>Catálogo para Facebook e Instagram</h3>
      <p class="muted">Archivo CSV para cargar tus productos en Meta (Commerce Manager) y vender en Instagram y Facebook. Los productos necesitan imagen con link <b>https://</b> (usá Cloudinary o pegá links de imagen).</p>
      <p><button type="button" class="btn btn-line btn-sm" data-act="admFbFeed">Descargar catálogo para Meta</button></p></div>
    <div class="panel"><h3>Seguridad de la cuenta</h3>
      <p class="muted">Cambiá la contraseña en “Usuarios”. Si la perdés, entrá a la consola de Firebase → Authentication → buscá tu usuario → menú ⋮ → <b>Restablecer contraseña</b> (o creá otro administrador desde “Usuarios” con otra cuenta que aún tenga acceso). Tras 5 intentos fallidos el ingreso se bloquea unos minutos.</p></div>`;
}
function settingsTab() { return settingsTabBase() + optPanel() + backupPanel(); }
function backupData() {
  const strip = l => l.map(x => { const { id, ...r } = x; return { id, ...r }; });
  return { app: 'tienda-template', version: 1, exportedAt: new Date().toISOString(), data: { products: strip(state.products), categories: strip(state.catDocs || []), banners: strip(state.banners), settings: { id: 'store', ...state.settings }, orders: strip(state.orders), reviews: strip(state.reviewsAll || []) } };
}
async function restoreBackup(file) {
  let j; try { j = JSON.parse(await file.text()); } catch { return toast('El archivo no es un respaldo válido.', { bad: true }); }
  if (!j || j.app !== 'tienda-template' || !j.data) return toast('El archivo no es un respaldo de esta tienda.', { bad: true });
  const d = j.data, n = (d.products || []).length;
  const ok = await askConfirm(`Se restaurarán ${n} productos, ${(d.categories || []).length} categorías, ${(d.banners || []).length} banners, los ajustes y ${(d.orders || []).length} pedidos del respaldo del ${String(j.exportedAt || '').slice(0, 10)}. ¿Continuar?`, 'Restaurar');
  if (!ok) return;
  guarded(async () => {
    const put = async (col, l) => { for (const x of l || []) { const { id, ...r } = x; if (id) await DB.save(col, String(id), JSON.parse(JSON.stringify(r))); } };
    await put('categories', d.categories); await put('products', d.products); await put('banners', d.banners); await put('orders', d.orders);
    if (d.settings) { const { id, ...r } = d.settings; await DB.save('settings', 'store', JSON.parse(JSON.stringify(r))); }
    toast('Respaldo restaurado');
  });
}
/* ── Catálogo para Meta ── */
function metaFeed() {
  const base = (state.settings.siteUrl || location.href.split('#')[0]).replace(/#.*$/, ''), cols = ['id', 'title', 'description', 'availability', 'condition', 'price', 'link', 'image_link', 'brand'];
  const rows = state.products.filter(p => p.active !== false && !priceHidden(p)).map(p => {
    const img = (Array.isArray(p.images) && p.images[0]) || p.image || '', st = stockOf(p);
    return [p.id, p.name, String(p.desc || p.description || p.name).replace(/\s+/g, ' ').slice(0, 5000), st > 0 || p.stock == null ? 'in stock' : 'out of stock', 'new', `${Number(p.price) || 0} UYU`, base + 'p/' + encodeURIComponent(p.id) + '/', /^https:\/\//.test(img) ? img : '', p.brand || state.settings.storeName];
  });
  const q = v => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
  return [cols.join(','), ...rows.map(r => r.map(q).join(','))].join('\r\n');
}
function isoNow() { return new Date().toISOString().slice(0, 10); }

document.addEventListener('click', e => {
  const t = e.target.closest('[data-act]'); if (!t) return; const a = t.dataset.act, id = t.dataset.id;
  if (a === 'admTag') { const on = t.getAttribute('aria-pressed') !== 'true'; t.setAttribute('aria-pressed', on); t.classList.toggle('on', on); }
  else if (a === 'admMeta') guarded(async () => {
    const o = state.orders.find(x => x.id === id); if (!o) return;
    const tags = $$('.chips [data-act=admTag]').filter(b => b.getAttribute('aria-pressed') === 'true').map(b => b.dataset.t), internalNote = $('#o-int').value.trim().slice(0, 500), carrier = $('#o-car').value.trim().slice(0, 40), trackNo = $('#o-trk').value.trim().slice(0, 40);
    await DB.save('orders', id, { tags, internalNote, carrier, trackNo });
    if (o.code) await DB.save('orderStatus', o.code, { carrier, trackNo, updatedAt: Date.now() });
    toast('Guardado');
  });
  else if (a === 'admPrint') { const o = state.orders.find(x => x.id === id); o && printOrder(o); }
  else if (a === 'admBackup') { downloadFile(`respaldo-${isoNow()}.json`, JSON.stringify(backupData(), null, 1)); toast('Respaldo descargado'); }
  else if (a === 'admFbFeed') { downloadFile(`catalogo-meta-${isoNow()}.csv`, metaFeed()); toast('Catálogo descargado'); }
});
document.addEventListener('change', e => { const t = e.target; if (t && t.dataset && t.dataset.act === 'admRestore') { const f = t.files[0]; t.value = ''; f && restoreBackup(f); } });

/* ───────── SEO: datos estructurados del producto ───────── */
function seoProduct(p) {
  try {
    const s = state.settings, r = ratingOf(p.id), st = stockOf(p), img = (productImages(p)[0]) || '';
    const base = (s.siteUrl || location.href.split('#')[0]).replace(/#.*$/, '');
    const ld = { '@context': 'https://schema.org', '@type': 'Product', name: p.name, description: p.description || p.name, sku: p.id, ...(p.brand ? { brand: { '@type': 'Brand', name: p.brand } } : {}), ...(/^https?:/.test(img) ? { image: [img] } : {}),
      ...(!priceHidden(p) && !isCatalog(p) ? { offers: { '@type': 'Offer', priceCurrency: 'UYU', price: String(Number(p.price) || 0), availability: st > 0 ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock', url: s.siteUrl ? base.replace(/\/?$/, '/') + 'p/' + encodeURIComponent(p.id) + '/' : location.href } } : {}),
      ...(r.n ? { aggregateRating: { '@type': 'AggregateRating', ratingValue: r.avg.toFixed(1), reviewCount: r.n } } : {}) };
    let el = document.getElementById('ldp'); if (!el) { el = document.createElement('script'); el.type = 'application/ld+json'; el.id = 'ldp'; document.head.appendChild(el); }
    el.textContent = JSON.stringify(ld).replace(/</g, '\\u003c');
    let m = document.querySelector('meta[name=description]'); if (m) { m.dataset.orig = m.dataset.orig || m.content; m.content = String(p.description || p.name).slice(0, 155); }
  } catch (e) { console.warn('seo', e); }
}
function seoReset() { const el = document.getElementById('ldp'); if (el) el.remove(); const m = document.querySelector('meta[name=description]'); if (m && m.dataset.orig) m.content = m.dataset.orig; }

/* ───────── Analytics y Meta Pixel (solo si cargaste los IDs en Ajustes) ───────── */
var trk = { ga: '', fb: '' };
function initTracking() {
  const s = state.settings || {}; if (navigator.doNotTrack === '1') return;
  if (/^G-[A-Z0-9]{4,}$/i.test(s.gaId || '') && trk.ga !== s.gaId) {
    trk.ga = s.gaId; const sc = document.createElement('script'); sc.async = true; sc.src = 'https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(s.gaId); document.head.appendChild(sc);
    window.dataLayer = window.dataLayer || []; window.gtag = function () { window.dataLayer.push(arguments); }; gtag('js', new Date()); gtag('config', s.gaId);
  }
  if (/^\d{6,20}$/.test(s.fbPixelId || '') && trk.fb !== s.fbPixelId) {
    trk.fb = s.fbPixelId;
    !function (f, b, e, v, n, t, s2) { if (f.fbq) return; n = f.fbq = function () { n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments); }; if (!f._fbq) f._fbq = n; n.push = n; n.loaded = !0; n.version = '2.0'; n.queue = []; t = b.createElement(e); t.async = !0; t.src = v; s2 = b.getElementsByTagName(e)[0]; s2.parentNode.insertBefore(t, s2); }(window, document, 'script', 'https://connect.facebook.net/en_US/fbevents.js');
    fbq('init', s.fbPixelId); fbq('track', 'PageView');
  }
}
var trkN = 0, trkTimer = setInterval(() => { initTracking(); if (trk.ga || trk.fb || ++trkN > 40) clearInterval(trkTimer); }, 500);
function trackEvt(name, d, n) {
  try {
    const it = x => ({ item_id: x.id, item_name: x.name, price: Number(x.price) || 0, quantity: Number(x.qty || n) || 1 });
    if (window.gtag && trk.ga) {
      if (name === 'purchase') gtag('event', 'purchase', { transaction_id: d.code, value: d.total, currency: 'UYU', items: d.items.map(i => ({ item_id: i.id, item_name: i.name, price: i.price, quantity: i.qty })) });
      else gtag('event', name, { currency: 'UYU', value: Number(d.price) || 0, items: [it(d)] });
    }
    if (window.fbq && trk.fb) {
      if (name === 'purchase') fbq('track', 'Purchase', { value: d.total, currency: 'UYU', content_ids: d.items.map(i => i.id), content_type: 'product' });
      else fbq('track', name === 'add_to_cart' ? 'AddToCart' : 'ViewContent', { value: Number(d.price) || 0, currency: 'UYU', content_ids: [d.id], content_type: 'product' });
    }
  } catch { /* la tienda nunca debe fallar por las estadísticas */ }
}

/* ───────── Carrito pendiente ───────── */
function cartNudge() {
  let n = 0; try { n = cartLines().reduce((t, l) => t + l.qty, 0); } catch { n = 0; }
  return n ? `<div class="wrap"><div class="cart-nudge" role="status"><span>🛒 Tenés <b>${n}</b> producto${n === 1 ? '' : 's'} esperándote en el carrito.</span><button type="button" class="btn btn-primary btn-sm" data-act="nudgeOpen">Terminar mi compra</button></div></div>` : '';
}

/* ───────── Lista de espera de stock ───────── */
function waitForm(p) {
  const done = (lsGet('nodo_wait') || {})[p.id];
  return done ? '<p class="note">Listo: te avisamos cuando vuelva a haber stock.</p>' : `<div class="waitf" data-pid="${esc(p.id)}"><label for="wl-c">Avisame cuando vuelva</label><div class="row"><input class="in" id="wl-c" maxlength="80" inputmode="text" autocomplete="tel" placeholder="Tu WhatsApp o correo"><button type="button" class="btn btn-line btn-sm" data-act="wlJoin">Avisarme</button></div><p class="err" id="wl-e" hidden role="alert"></p></div>`;
}
function waitPanel() {
  const l = state.waitAll || []; if (!l.length) return '';
  const by = {}; l.forEach(w => (by[w.productId] = by[w.productId] || []).push(w));
  return `<div class="panel" style="max-width:none"><h3>Lista de espera <small class="muted">(clientes que quieren que vuelva un producto)</small></h3>${Object.entries(by).map(([pid, ws]) => {
    const p = state.products.find(x => x.id === pid), back = p && stockOf(p) > 0;
    return `<div class="wl-g"><b>${esc(p ? p.name : pid)}</b> ${back ? '<span class="chipst ok">Ya hay stock</span>' : '<span class="chipst bad">Sin stock</span>'}<ul class="plain">${ws.map(w => { const num = /^[\d\s+()-]{6,}$/.test(w.contact); const href = num ? `https://wa.me/${uyPhone(w.contact)}?text=${encodeURIComponent(`Hola, volvió a haber stock de ${p ? p.name : 'el producto'} en ${state.settings.storeName}.`)}` : `mailto:${encodeURIComponent(w.contact)}`;
      return `<li><span>${esc(w.contact)}</span><span class="row"><a class="btn btn-line btn-sm" target="_blank" rel="noopener" href="${esc(href)}">Avisar</a><button type="button" class="btn btn-line btn-sm" data-act="wlDel" data-id="${esc(w.id)}">Quitar</button></span></li>`; }).join('')}</ul></div>`; }).join('')}</div>`;
}

/* ───────── Caja: venta en mostrador (escanear y cobrar) ───────── */
var pos = { items: {}, pay: '', msg: '' };
function posTotal() { return Object.values(pos.items).reduce((t, x) => t + x.p.price * x.q, 0); }
function posAdd(p, n = 1) {
  if (hasVS(p) || (p.variants && p.variants.length)) return { msg: `${p.name}: tiene variantes, vendelo por la tienda o editá el stock a mano.`, ok: false };
  const st = stockOf(p), cur = (pos.items[p.id] || { q: 0 }).q;
  if (p.stock != null && p.stock !== '' && cur + n > st) return { msg: `${p.name}: solo quedan ${st}.`, ok: false };
  pos.items[p.id] = { p, q: cur + n }; return { msg: `${p.name} × ${cur + n}` };
}
function posHtml() {
  const l = Object.values(pos.items), pays = [...new Set([...(state.settings.payMethods || []), ...(state.settings.payPickup || [])].map(x => String(x).trim()).filter(x => x && !/mercado/i.test(x)))];
  if (!pos.pay || !pays.includes(pos.pay)) pos.pay = pays[0] || 'Efectivo';
  return `<p class="muted">Escaneá con el lector USB (o escribí el código / nombre y Enter). Cada venta queda registrada como pedido entregado y pagado, y descuenta el stock.</p>
    <div class="row"><input class="in" id="pos-in" autocomplete="off" placeholder="Código de barras o nombre del producto" style="flex:1"><button type="button" class="btn btn-line btn-sm" data-act="posCam">Cámara</button></div>
    <p class="${pos.msgBad ? 'err' : 'muted'}" id="pos-msg" role="status" style="min-height:1.3em">${esc(pos.msg)}</p>
    <div id="pos-sug"></div>
    ${l.length ? `<table class="ord-items"><tbody>${l.map(x => `<tr><td>${esc(x.p.name)}</td><td><span class="row"><button type="button" class="btn btn-line btn-sm" data-act="posQty" data-id="${esc(x.p.id)}" data-d="-1" aria-label="Menos">−</button><b>${x.q}</b><button type="button" class="btn btn-line btn-sm" data-act="posQty" data-id="${esc(x.p.id)}" data-d="1" aria-label="Más">+</button></span></td><td>${money(x.p.price * x.q)}</td></tr>`).join('')}</tbody></table>` : '<p class="muted">Todavía no agregaste productos.</p>'}
    <div class="row" style="justify-content:space-between;margin:10px 0"><label>Pago <select class="in" id="pos-pay">${pays.map(m => `<option ${pos.pay === m ? 'selected' : ''}>${esc(m)}</option>`).join('')}</select></label><b style="font-size:1.4rem">${money(posTotal())}</b></div>
    <div class="dlg-f"><button type="button" class="btn btn-line" data-act="closeDlg">Cerrar</button><button type="button" class="btn btn-primary" data-act="posPay" ${l.length ? '' : 'disabled'}>Cobrar ${l.length ? money(posTotal()) : ''}</button></div>`;
}
function openPOS() { pos = { items: {}, pay: '', msg: '' }; openForm('Caja · venta en mostrador', posHtml()); setTimeout(() => $('#pos-in') && $('#pos-in').focus(), 80); }
function posRefresh(msg, bad) { pos.msg = msg || ''; pos.msgBad = !!bad; const d = $('#dlgForm'); if (!d || !d.open) return; const v = ($('#pos-in') || {}).value || ''; openForm('Caja · venta en mostrador', posHtml()); const i = $('#pos-in'); if (i) { i.value = v; i.focus(); } }
function posEnter(txt) {
  const q = String(txt || '').trim(); if (!q) return;
  const bc = findByBarcode(q), pick = bc ? [bc] : searchProducts(q, state.products.filter(p => p.active !== false)).slice(0, 5);
  if (!pick.length) { scanBeep(false); return posRefresh('No encontramos ese producto.', true); }
  if (pick.length === 1) { const r = posAdd(pick[0]); scanBeep(r.ok !== false); const i = $('#pos-in'); if (i) i.value = ''; return posRefresh(r.msg, r.ok === false); }
  posRefresh(''); $('#pos-sug').innerHTML = pick.map(p => `<button type="button" class="btn btn-line btn-sm" data-act="posPick" data-id="${esc(p.id)}">${esc(p.name)} · ${money(p.price)}</button>`).join(' ');
}
async function posCharge() {
  const l = Object.values(pos.items); if (!l.length) return;
  const items = l.map(x => ({ id: x.p.id, name: x.p.name, price: x.p.price, qty: x.q })), total = posTotal();
  const order = { customer: { name: 'Venta en mostrador', phone: '00000000', delivery: 'retiro', payment: pos.pay, email: '' }, items, itemCount: items.reduce((t, i) => t + i.qty, 0), shipping: 0, total };
  guarded(async () => {
    const code = await DB.createOrder(order);
    let o = null; for (let i = 0; i < 20 && !o; i++) { o = state.orders.find(x => x.code === code); if (!o) await sleep(300); }
    if (o) {
      const now = Date.now();
      await DB.save('orders', o.id, { status: 'entregado', paid: true, paidAmount: total, source: 'mostrador', stockApplied: true, history: [{ s: 'nuevo', t: now }, { s: 'entregado', t: now }] });
      await DB.save('orderStatus', code, { status: 'entregado', paid: true, paidAmount: total, updatedAt: now });
      if (!o.stockApplied) for (const pid of new Set(items.map(i => i.id))) { const pt = stockPatch(state.products.find(x => x.id === pid), items, -1), pr = state.products.find(x => x.id === pid), q = items.filter(i => i.id === pid).reduce((t, i) => t + i.qty, 0); await DB.save('products', pid, { ...(pt || {}), sold: (Number(pr.sold) || 0) + q, updatedAt: now }); }
    }
    toast(`Venta registrada: ${money(total)}`); pos.items = {}; posRefresh('Venta registrada. Podés cargar la siguiente.');
  });
}

document.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.id === 'pos-in') { e.preventDefault(); const v = e.target.value; posEnter(v); } });
document.addEventListener('change', e => { if (e.target.id === 'pos-pay') pos.pay = e.target.value; });
document.addEventListener('click', e => {
  const t = e.target.closest('[data-act]'); if (!t) return; const a = t.dataset.act, id = t.dataset.id;
  if (a === 'nudgeOpen') { const b = document.getElementById('cartBtn'); b && b.click(); }
  else if (a === 'wlJoin') {
    const box = t.closest('.waitf'), pid = box.dataset.pid, c = $('#wl-c').value.trim(), er = $('#wl-e');
    if (!/^[\d\s+()-]{6,20}$/.test(c) && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(c)) { er.textContent = 'Escribí un WhatsApp o un correo válido.'; er.hidden = false; return; }
    t.disabled = true;
    DB.createWait({ productId: pid, contact: c.slice(0, 80) }).then(() => { const w = lsGet('nodo_wait') || {}; w[pid] = 1; lsSet('nodo_wait', w); box.outerHTML = '<p class="note">Listo: te avisamos cuando vuelva a haber stock.</p>'; })
      .catch(() => { t.disabled = false; er.textContent = 'No pudimos anotarte. Probá de nuevo más tarde.'; er.hidden = false; });
  }
  else if (a === 'wlDel') guarded(async () => { await DB.remove('waitlist', id); toast('Quitado de la lista'); });
  else if (a === 'admPos') openPOS();
  else if (a === 'admView') { state.admin.ov = t.dataset.v; state.admin.of = {}; renderAdminBody(); }
  else if (a === 'admRestore1') guarded(async () => {
    const o = state.orders.find(x => x.id === id); if (!o) return; const now = Date.now(), history = [...(Array.isArray(o.history) ? o.history : []), { s: 'nuevo', t: now }];
    await DB.save('orders', id, { status: 'nuevo', history }); await adjustStockForStatus(o, 'nuevo'); if (o.code) await DB.save('orderStatus', o.code, { status: 'nuevo', updatedAt: now, history }); toast('Pedido restaurado');
  });
  else if (a === 'admDelOrder') askConfirm('¿Eliminar este pedido definitivamente? No se puede deshacer.').then(ok => ok && guarded(async () => { const o = state.orders.find(x => x.id === id); await DB.remove('orders', id); if (o && o.code) { try { await DB.remove('orderStatus', o.code); } catch (e) { console.warn(e); } } toast('Pedido eliminado'); }));
  else if (a === 'admEmptyTrash') askConfirm('¿Eliminar definitivamente todos los pedidos cancelados? No se puede deshacer.', 'Vaciar').then(ok => ok && guarded(async () => { for (const o of state.orders.filter(x => x.status === 'cancelado')) { await DB.remove('orders', o.id); if (o.code) { try { await DB.remove('orderStatus', o.code); } catch (e) { console.warn(e); } } } toast('Papelera vaciada'); }));
  else if (a === 'admOptImg') guarded(optimizeStored);
  else if (a === 'posQty') { const x = pos.items[id]; if (x) { const q = x.q + Number(t.dataset.d); if (q <= 0) delete pos.items[id]; else { const r = posAdd(x.p, Number(t.dataset.d)); if (r.ok === false) return posRefresh(r.msg, true); } } posRefresh(); }
  else if (a === 'posPick') { const p = state.products.find(x => x.id === id); if (p) { const r = posAdd(p); $('#pos-in').value = ''; posRefresh(r.msg, r.ok === false); } }
  else if (a === 'posPay') posCharge();
  else if (a === 'posCam') openScanner({ title: 'Escanear para la caja', keep: true, onCode: c => { const p = findByBarcode(c); if (!p) return { msg: `Código ${c} sin producto`, ok: false }; const r = posAdd(p); posRefresh(r.msg, r.ok === false); return r; } });
});
