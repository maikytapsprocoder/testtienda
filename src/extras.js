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
  const f = state.admin.of || {}, q = String(f.q || '').toLowerCase().trim(), trash = state.admin.ov === 'can';
  const from = f.from ? new Date(f.from + 'T00:00:00').getTime() : 0, to = f.to ? new Date(f.to + 'T23:59:59').getTime() : Infinity;
  const l = state.orders.filter(o => (trash === (o.status === 'cancelado')) && (!f.st || o.status === f.st) && (!f.tag || (o.tags || []).includes(f.tag)) && (!f.pay || (f.pay === 'paid' ? o.paid : !o.paid)) &&
    (o.createdAt || 0) >= from && (o.createdAt || 0) <= to &&
    (!q || [o.code, o.customer?.name, o.customer?.phone, o.customer?.email, o.customer?.address, ...(o.items || []).map(i => i.name)].join(' ').toLowerCase().includes(q)));
  const k = f.sort || 'new';
  return l.sort((a, b) => k === 'old' ? (a.createdAt || 0) - (b.createdAt || 0) : k === 'big' ? (Number(b.total) || 0) - (Number(a.total) || 0) : (b.createdAt || 0) - (a.createdAt || 0));
}
function orderFilterBar(f, n) {
  return `<div class="ofilters"><input class="in" type="search" id="of-q" placeholder="Buscar: código, cliente, teléfono, producto…" value="${esc(f.q || '')}" aria-label="Buscar pedidos" style="flex:2;min-width:240px">
    <select class="in" id="of-tag" aria-label="Etiqueta"><option value="">Todas las etiquetas</option>${ORDER_TAGS.map(t => `<option ${f.tag === t ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select>
    <select class="in" id="of-pay" aria-label="Pago"><option value="">Pagados y no pagados</option><option value="paid" ${f.pay === 'paid' ? 'selected' : ''}>Pagados</option><option value="unpaid" ${f.pay === 'unpaid' ? 'selected' : ''}>Sin pagar</option></select>
    <label class="of-d">Desde <input class="in" type="date" id="of-from" value="${esc(f.from || '')}"></label><label class="of-d">Hasta <input class="in" type="date" id="of-to" value="${esc(f.to || '')}"></label>
    <select class="in" id="of-sort" aria-label="Orden"><option value="new">Más nuevos primero</option><option value="old" ${f.sort === 'old' ? 'selected' : ''}>Más antiguos primero</option><option value="big" ${f.sort === 'big' ? 'selected' : ''}>Mayor monto primero</option></select>
    ${(f.q || f.tag || f.pay || f.from || f.to || f.st) ? '<button type="button" class="btn btn-line btn-sm" data-act="ofClear">Limpiar filtros</button>' : ''}</div>`;
}
document.addEventListener('input', e => { if (e.target.id === 'of-q') { (state.admin.of = state.admin.of || {}).q = e.target.value; clearTimeout(window.__ofT); window.__ofT = setTimeout(() => { const pos = e.target.selectionStart; renderAdminBody(); const i = $('#of-q'); if (i) { i.focus(); try { i.setSelectionRange(pos, pos); } catch { /* nada */ } } }, 250); } });
document.addEventListener('change', e => { const m = { 'of-st': 'st', 'of-tag': 'tag', 'of-pay': 'pay', 'of-from': 'from', 'of-to': 'to', 'of-sort': 'sort' }[e.target.id]; if (m) { (state.admin.of = state.admin.of || {})[m] = e.target.value; renderAdminBody(); } });

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

/* ───────── Pedidos: vista grande para PC + editor completo ───────── */
var oe = null;
const oeNum = v => Math.max(0, Math.round((Number(String(v == null ? '' : v).replace(',', '.')) || 0) * 100) / 100);
const orderSub = o => (o.items || []).reduce((t, i) => t + (Number(i.price) || 0) * (Number(i.qty) || 0), 0);
const orderDue = o => { const total = Number(o.total) || 0, paid = Number(o.paidAmount) || (o.paid ? total : 0); return Math.max(0, total - Math.max(0, paid - (Number(o.refunded) || 0))); };

async function setOrderStatus(o, next) {
  if (!o || o.status === next) return;
  const now = Date.now(), history = [...(Array.isArray(o.history) && o.history.length ? o.history : [{ s: 'nuevo', t: o.createdAt || now }]), { s: next, t: now }];
  await DB.save('orders', o.id, { status: next, history });
  await adjustStockForStatus(o, next);
  if (o.code) await DB.save('orderStatus', o.code, { status: next, updatedAt: now, history });
  notifyCustomerStatus(o, next);
  toast(next === 'cancelado' ? 'Pedido cancelado: pasó a la papelera' : 'Estado actualizado');
}

function ordersTab() {
  const of = state.admin.of || {}, trash = state.admin.ov === 'can', nCan = state.orders.filter(o => o.status === 'cancelado').length;
  const top = `<div class="ovtabs" role="tablist"><button type="button" class="btn ${trash ? 'btn-line' : 'btn-primary'}" data-act="admView" data-v="act">Pedidos</button><button type="button" class="btn ${trash ? 'btn-primary' : 'btn-line'}" data-act="admView" data-v="can">Cancelados / papelera${nCan ? ' (' + nCan + ')' : ''}</button>${trash && nCan ? '<button type="button" class="btn btn-danger btn-sm" data-act="admEmptyTrash">Vaciar papelera</button>' : ''}
    <span class="sp"></span><button type="button" class="btn btn-line" data-act="ofCsv">Exportar a Excel (CSV)</button><button type="button" class="btn btn-primary" data-act="admNewOrder">+ Nuevo pedido</button></div>`;
  if (!state.orders.length) return `${top}<div class="empty"><h3>Todavía no hay pedidos</h3><p>Cuando un cliente confirme una compra aparece acá al instante. También podés cargar uno a mano (venta por WhatsApp, teléfono, etc.).</p></div>`;
  const live = state.orders.filter(o => o.status !== 'cancelado');
  const chips = trash ? '' : `<div class="ostats" role="group" aria-label="Filtrar por estado">${Object.entries(STATUS).filter(([k]) => k !== 'cancelado').map(([k, v]) => `<button type="button" class="ostat st-${k}" data-act="ofSt" data-v="${k}" aria-pressed="${of.st === k}"><b>${live.filter(o => o.status === k).length}</b><span>${v}</span></button>`).join('')}</div>`;
  const list = ordersFiltered(), sel = state.admin.sel || {}, nSel = list.filter(o => sel[o.id]).length, sum = list.reduce((t, o) => t + (Number(o.total) || 0), 0);
  const note = trash ? '<p class="note" style="margin-bottom:10px">Acá van los pedidos cancelados (el stock ya se devolvió y no cuentan en las ventas). Podés <b>restaurarlos</b> o <b>eliminarlos definitivamente</b>.</p>' : '';
  const bulk = list.length ? `<div class="obulk"><label><input type="checkbox" data-act="ofAll" ${nSel && nSel === list.length ? 'checked' : ''}> Seleccionar todos</label>${nSel ? `<b>${nSel} seleccionado${nSel === 1 ? '' : 's'}</b><select class="in" id="of-bulk" aria-label="Nuevo estado">${Object.entries(STATUS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select><button type="button" class="btn btn-primary btn-sm" data-act="ofBulk">Cambiar estado</button>` : ''}<span class="sp"></span><span class="muted">${list.length} pedido${list.length === 1 ? '' : 's'} · ${money(sum)}</span></div>` : '';
  return `${top}${note}${chips}${orderFilterBar(of, list.length)}${bulk}<div class="ocards">${list.map(o => ocardHtml(o, trash)).join('') || '<div class="empty"><h3>Sin resultados</h3><p>No hay pedidos con esos filtros.</p></div>'}</div>`;
}
function ocardHtml(o, trash) {
  const c = o.customer || {}, items = o.items || [], sub = orderSub(o), due = orderDue(o), sel = (state.admin.sel || {})[o.id];
  const dest = c.delivery === 'envio' ? `Envío a ${esc(c.address || '—')}${c.zone ? ' (' + esc(c.zone) + ')' : ''}` : `Retiro en el local${c.pickup ? ': ' + esc(c.pickup) : ''}`;
  const lines = [['Productos', sub], o.shipping ? ['Envío', o.shipping] : null, o.discount ? ['Descuento', -o.discount] : null, o.tip ? ['Propina', o.tip] : null, o.extra ? [esc(o.extraLabel || 'Otros costos'), o.extra] : null].filter(Boolean);
  return `<article class="ocard st-${esc(o.status)}${sel ? ' sel' : ''}">
    <div class="oc-h"><label class="oc-sel" title="Seleccionar"><input type="checkbox" data-act="ofSel" data-id="${esc(o.id)}" ${sel ? 'checked' : ''} aria-label="Seleccionar pedido ${esc(o.code)}"></label>
      <b class="oc-code">${esc(o.code || o.id.slice(0, 6))}</b><span class="muted">${fmtDate(o.createdAt)}</span>${o.source === 'mostrador' ? '<span class="tagc">Caja</span>' : o.source === 'manual' ? '<span class="tagc">Manual</span>' : ''}${(o.tags || []).map(t => `<span class="tagc">${esc(t)}</span>`).join('')}
      <span class="sp"></span>${trash ? '<span class="chipst bad">Cancelado</span>' : `<select class="in oc-st" aria-label="Estado del pedido ${esc(o.code)}" data-act="admStatus" data-id="${esc(o.id)}">${Object.entries(STATUS).map(([k, v]) => `<option value="${k}" ${o.status === k ? 'selected' : ''}>${v}</option>`).join('')}</select>`}
      <b class="oc-total">${money(o.total)}</b></div>
    <div class="oc-b">
      <div class="oc-c"><b>${esc(c.name)}</b><a href="https://wa.me/${uyPhone(c.phone)}" target="_blank" rel="noopener">${esc(c.phone)}</a>${c.email ? `<span>${esc(c.email)}</span>` : ''}<span>${dest}</span>${c.payment ? `<span>Pago: ${esc(c.payment)}</span>` : ''}${c.note ? `<q>${esc(c.note)}</q>` : ''}${o.internalNote ? `<small class="oc-int">Nota interna: ${esc(o.internalNote)}</small>` : ''}</div>
      <ul class="oc-i">${items.slice(0, 5).map(i => `<li><span><b>${esc(i.qty)}×</b> ${esc(i.name)}</span><span>${money(i.price * i.qty)}</span></li>`).join('')}${items.length > 5 ? `<li class="muted">+ ${items.length - 5} más…</li>` : ''}</ul>
      <div class="oc-t">${lines.map(([l, v]) => `<div><span>${l}</span><span>${v < 0 ? '− ' : ''}${money(Math.abs(v))}</span></div>`).join('')}<div class="tt"><span>Total</span><span>${money(o.total)}</span></div>
        <div class="oc-pay">${o.paid && !due ? '<span class="chipst ok">Pagado</span>' : due < (Number(o.total) || 0) ? `<span class="chipst mid">Pago parcial · saldo ${money(due)}</span>` : '<span class="chipst bad">Sin pagar</span>'}${o.carrier || o.trackNo ? `<span class="chipst">${esc(o.carrier || 'Envío')} ${esc(o.trackNo || '')}</span>` : ''}</div></div>
    </div>
    <div class="oc-a"><button type="button" class="btn btn-primary btn-sm" data-act="admOrder" data-id="${esc(o.id)}">Ver y editar</button>
      <a class="btn btn-line btn-sm" target="_blank" rel="noopener" href="https://wa.me/${uyPhone(c.phone)}?text=${encodeURIComponent(statusMessage(o))}">WhatsApp</a>
      <button type="button" class="btn btn-line btn-sm" data-act="admPrint" data-id="${esc(o.id)}">Imprimir</button>
      ${!trash && due > 0 ? `<button type="button" class="btn btn-line btn-sm" data-act="ofPaid" data-id="${esc(o.id)}">Marcar pagado</button>` : ''}
      <button type="button" class="btn btn-line btn-sm" data-act="ofDup" data-id="${esc(o.id)}">Duplicar</button><span class="sp"></span>
      ${trash ? `<button type="button" class="btn btn-line btn-sm" data-act="admRestore1" data-id="${esc(o.id)}">Restaurar</button><button type="button" class="btn btn-danger btn-sm" data-act="admDelOrder" data-id="${esc(o.id)}">Eliminar</button>` : `<button type="button" class="btn btn-danger btn-sm" data-act="ofCancel" data-id="${esc(o.id)}">Cancelar pedido</button>`}</div></article>`;
}

/* CSV para Excel */
function ordersExport(list) {
  const q = v => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`, d = t => t ? new Date(t).toLocaleString('es-UY') : '';
  const head = ['Código', 'Fecha', 'Estado', 'Cliente', 'Teléfono', 'Correo', 'Entrega', 'Dirección / zona', 'Pago', 'Productos', 'Subtotal', 'Envío', 'Descuento', 'Propina', 'Otros costos', 'Total', 'Cobrado', 'Saldo', 'Etiquetas', 'Nota del cliente', 'Nota interna'];
  return [head.map(q).join(','), ...list.map(o => { const c = o.customer || {}; return [o.code, d(o.createdAt), STATUS[o.status] || o.status, c.name, c.phone, c.email, c.delivery === 'envio' ? 'Envío' : 'Retiro', [c.address, c.zone].filter(Boolean).join(' · '), c.payment, (o.items || []).map(i => `${i.qty}× ${i.name}`).join(' | '), orderSub(o), o.shipping || 0, o.discount || 0, o.tip || 0, o.extra || 0, o.total, o.paid ? (Number(o.paidAmount) || o.total) : (Number(o.paidAmount) || 0), orderDue(o), (o.tags || []).join(' | '), c.note, o.internalNote].map(q).join(','); })].join('\r\n');
}

/* Editor del pedido */
function openOrder(id, preset) {
  const base = id ? state.orders.find(x => x.id === id) : null; if (id && !base) return;
  const o = base || { customer: { delivery: 'retiro' }, items: [], status: 'nuevo', ...(preset || {}) }, c = o.customer || {};
  oe = { id: id || '', o, items: (o.items || []).map(i => ({ ...i })) };
  const tags = o.tags || [], zs = (Array.isArray(state.settings.shippingZones) ? state.settings.shippingZones : []).filter(z => z && z.name), pays = [...new Set([...(state.settings.payMethods || []), ...(state.settings.payPickup || [])].map(x => String(x).trim()).filter(Boolean))];
  const f = (lbl, idd, val, extra = '') => `<div class="field"><label for="${idd}">${lbl}</label><input class="in" id="${idd}" value="${esc(val == null ? '' : val)}" ${extra}></div>`;
  const nf = (lbl, idd, val, hint = '') => `<div class="field"><label for="${idd}">${lbl}</label><input class="in oe-n" type="number" inputmode="decimal" min="0" step="any" id="${idd}" value="${esc(val || 0)}">${hint ? `<small>${hint}</small>` : ''}</div>`;
  openForm(id ? 'Pedido ' + (o.code || '') : 'Nuevo pedido manual', `
    <div class="oe">
      <div class="oe-l">
        <div class="panel"><h3>Cliente y entrega</h3>
          <div class="form-grid">${f('Nombre', 'oe-name', c.name, 'maxlength="80"')}${f('Teléfono', 'oe-phone', c.phone, 'maxlength="30" inputmode="tel"')}${f('Correo', 'oe-mail', c.email, 'maxlength="80" type="email"')}
            <div class="field"><label for="oe-del">Entrega</label><select class="in" id="oe-del"><option value="retiro" ${c.delivery !== 'envio' ? 'selected' : ''}>Retiro en el local</option><option value="envio" ${c.delivery === 'envio' ? 'selected' : ''}>Envío</option></select></div>
            ${f('Dirección', 'oe-addr', c.address, 'maxlength="200"')}${f('Zona / localidad', 'oe-zone', c.zone, 'maxlength="80" list="oe-zones"')}<datalist id="oe-zones">${zs.map(z => `<option value="${esc(z.name)}">`).join('')}</datalist>
            ${f('Retira (día y hora)', 'oe-pick', c.pickup, 'maxlength="80"')}${f('Forma de pago', 'oe-pay', c.payment, 'maxlength="60" list="oe-pays"')}<datalist id="oe-pays">${pays.map(p => `<option value="${esc(p)}">`).join('')}</datalist></div>
          <div class="field"><label for="oe-cnote">Comentario del cliente</label><textarea class="in" id="oe-cnote" rows="2" maxlength="500">${esc(c.note || '')}</textarea></div></div>
        <div class="panel"><h3>Productos</h3>
          <table class="oe-items"><thead><tr><th>Producto</th><th>Cant.</th><th>Precio</th><th>Importe</th><th></th></tr></thead><tbody id="oe-rows"></tbody></table>
          <div class="row" style="margin-top:10px"><input class="in" id="oe-add" list="oe-prods" placeholder="Agregar producto: escribí el nombre, o el código de barras" style="flex:1"><datalist id="oe-prods">${state.products.filter(p => !(hasVS(p) || (p.variants && p.variants.length))).map(p => `<option value="${esc(p.name)}">`).join('')}</datalist><button type="button" class="btn btn-line btn-sm" data-act="oeAdd">Agregar</button></div>
          <small class="muted">Si el nombre no existe, se agrega como línea libre (por ejemplo “Instalación”) y le ponés el precio.</small></div>
      </div>
      <div class="oe-r">
        <div class="panel oe-tot"><h3>Importes <small class="muted">(editables)</small></h3>
          <div class="oe-sub"><span>Subtotal productos</span><b id="oe-sub"></b></div>
          ${nf('Envío', 'oe-ship', o.shipping)}${nf('Descuento', 'oe-disc', o.discount)}${nf('Propina', 'oe-tip', o.tip)}
          <div class="row"><div style="flex:1">${nf('Otros costos / recargo', 'oe-extra', o.extra)}</div><div style="flex:1">${f('Concepto', 'oe-extral', o.extraLabel, 'maxlength="40" placeholder="Ej.: Instalación"')}</div></div>
          <div class="oe-grand"><span>Total</span><b id="oe-total"></b></div></div>
        <div class="panel"><h3>Estado y comentarios</h3>
          <div class="field"><label for="oe-st">Estado</label><select class="in" id="oe-st">${Object.entries(STATUS).map(([k, v]) => `<option value="${k}" ${o.status === k ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
          <div class="field"><label for="oe-pub">Mensaje para el cliente <small class="muted">(lo ve en el seguimiento)</small></label><textarea class="in" id="oe-pub" rows="2" maxlength="300">${esc(o.publicNote || '')}</textarea></div>
          <div class="field"><label for="oe-int">Nota interna <small class="muted">(solo vos)</small></label><textarea class="in" id="oe-int" rows="2" maxlength="500">${esc(o.internalNote || '')}</textarea></div>
          <div class="chips" role="group" aria-label="Etiquetas">${ORDER_TAGS.map(t => `<button type="button" class="chip ${tags.includes(t) ? 'on' : ''}" data-act="admTag" data-t="${esc(t)}" aria-pressed="${tags.includes(t)}">${esc(t)}</button>`).join('')}</div>
          <div class="row" style="margin-top:10px"><div style="flex:1">${f('Empresa de envío', 'oe-car', o.carrier, 'maxlength="40" placeholder="DAC, Correo Uruguayo…"')}</div><div style="flex:1">${f('N° de guía', 'oe-trk', o.trackNo, 'maxlength="40"')}</div></div></div>
        ${id ? orderPayHtml(o) : ''}
        ${id && Array.isArray(o.edits) && o.edits.length ? `<div class="panel"><h3>Historial de cambios</h3><ul class="plain oe-log">${o.edits.slice(-6).reverse().map(x => `<li><small class="muted">${fmtDate(x.t)}</small> ${esc(x.txt)}</li>`).join('')}</ul></div>` : ''}
      </div>
    </div>
    <p class="err" id="oe-err" hidden role="alert"></p>
    <div class="dlg-f">${id ? `<button type="button" class="btn btn-line" data-act="admPrint" data-id="${esc(id)}">Imprimir</button>` : ''}<button type="button" class="btn btn-line" data-act="closeDlg">Cerrar</button><button type="button" class="btn btn-primary" data-act="oeSave">${id ? 'Guardar cambios' : 'Crear pedido'}</button></div>`);
  $('#dlgForm').classList.add('wide'); oeRows(); oeCalc();
}
function oeRows() {
  const b = $('#oe-rows'); if (!b) return;
  b.innerHTML = oe.items.length ? oe.items.map((i, k) => `<tr><td><input class="in oe-nm" data-i="${k}" value="${esc(i.name)}" maxlength="80" aria-label="Producto"></td><td><input class="in oe-q" type="number" min="1" step="1" data-i="${k}" value="${esc(i.qty)}" aria-label="Cantidad"></td><td><input class="in oe-p" type="number" min="0" step="any" data-i="${k}" value="${esc(i.price)}" aria-label="Precio"></td><td class="oe-im">${money(oeNum(i.price) * (Math.floor(Number(i.qty)) || 0))}</td><td><button type="button" class="btn btn-line btn-sm" data-act="oeDel" data-i="${k}" aria-label="Quitar">×</button></td></tr>`).join('') : '<tr><td colspan="5" class="muted">Sin productos. Agregá al menos uno.</td></tr>';
}
function oeVals() { const g = id => ($('#' + id) || {}).value || ''; return { ship: oeNum(g('oe-ship')), disc: oeNum(g('oe-disc')), tip: oeNum(g('oe-tip')), extra: oeNum(g('oe-extra')) }; }
function oeCalc() {
  const sub = oe.items.reduce((t, i) => t + oeNum(i.price) * (Math.floor(Number(i.qty)) || 0), 0), v = oeVals(), total = Math.max(0, Math.round((sub - v.disc + v.ship + v.tip + v.extra) * 100) / 100);
  $('#oe-sub').textContent = money(sub); $('#oe-total').textContent = money(total); oe.sub = sub; oe.total = total;
  $$('#oe-rows tr').forEach((tr, k) => { const im = tr.querySelector('.oe-im'), i = oe.items[k]; if (im && i) im.textContent = money(oeNum(i.price) * (Math.floor(Number(i.qty)) || 0)); });
}
document.addEventListener('input', e => {
  if (!oe || !e.target.closest || !e.target.closest('.oe')) return; const t = e.target, k = +t.dataset.i;
  if (t.classList.contains('oe-q')) oe.items[k].qty = Math.max(1, Math.floor(Number(t.value)) || 1);
  else if (t.classList.contains('oe-p')) oe.items[k].price = oeNum(t.value);
  else if (t.classList.contains('oe-nm')) oe.items[k].name = t.value;
  oeCalc();
});
function oeAddLine() {
  const i = $('#oe-add'), v = (i.value || '').trim(); if (!v) return;
  const low = v.toLowerCase(), p = findByBarcode(v) || state.products.find(x => x.name.toLowerCase() === low) || state.products.find(x => x.id === v);
  if (p && (hasVS(p) || (p.variants && p.variants.length))) return toast('Ese producto tiene variantes: cargalo desde la tienda o editá la línea a mano como línea libre.', { bad: true });
  const ex = p && oe.items.find(x => x.id === p.id);
  if (ex) ex.qty = (Number(ex.qty) || 0) + 1; else oe.items.push(p ? { id: p.id, name: p.name, price: Number(p.price) || 0, qty: 1 } : { id: 'libre', name: v.slice(0, 80), price: 0, qty: 1 });
  i.value = ''; oeRows(); oeCalc();
}
document.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.id === 'oe-add') { e.preventDefault(); oeAddLine(); } });
document.addEventListener('change', e => { if (e.target.id === 'oe-add' && e.target.value && state.products.some(x => x.name === e.target.value)) oeAddLine(); });
document.addEventListener('input', e => { if (oe && e.target.classList && e.target.classList.contains('oe-n')) oeCalc(); });

async function oeSave() {
  const er = $('#oe-err'), bad = m => { er.textContent = m; er.hidden = false; er.scrollIntoView({ block: 'nearest' }); };
  const g = id => ($('#' + id).value || '').trim(), name = g('oe-name').slice(0, 80), phone = g('oe-phone').slice(0, 30);
  if (!name) return bad('Escribí el nombre del cliente.');
  if (phone.replace(/\D/g, '').length < 7) return bad('El teléfono necesita al menos 7 dígitos.');
  const items = oe.items.map(i => ({ ...i, name: String(i.name || '').trim().slice(0, 80), qty: Math.max(1, Math.floor(Number(i.qty)) || 1), price: oeNum(i.price) })).filter(i => i.name);
  if (!items.length) return bad('Agregá al menos un producto.');
  er.hidden = true; oeCalc();
  const v = oeVals(), delivery = $('#oe-del').value === 'envio' ? 'envio' : 'retiro', total = oe.total, itemCount = items.reduce((t, i) => t + i.qty, 0);
  const cust = { name, phone, delivery }; [['email', 'oe-mail', 80], ['address', 'oe-addr', 200], ['zone', 'oe-zone', 80], ['pickup', 'oe-pick', 80], ['payment', 'oe-pay', 60], ['note', 'oe-cnote', 500]].forEach(([k, idd, n]) => { const val = g(idd).slice(0, n); if (val) cust[k] = val; });
  const tags = $$('.oe .chips [data-act=admTag]').filter(b => b.getAttribute('aria-pressed') === 'true').map(b => b.dataset.t);
  const extra = { tip: v.tip, extra: v.extra, extraLabel: g('oe-extral').slice(0, 40), publicNote: g('oe-pub').slice(0, 300), internalNote: g('oe-int').slice(0, 500), tags, carrier: g('oe-car').slice(0, 40), trackNo: g('oe-trk').slice(0, 40) };
  const next = $('#oe-st').value, now = Date.now();
  if (!oe.id) {
    return guarded(async () => {
      const code = await DB.createOrder({ customer: cust, items: items.map(({ id, name, price, qty, vk }) => ({ id, name, price, qty, ...(vk ? { vk } : {}) })), itemCount, shipping: v.ship, total, ...(v.disc > 0 ? { discount: v.disc } : {}) });
      let n = null; for (let k = 0; k < 20 && !n; k++) { n = state.orders.find(x => x.code === code); if (!n) await sleep(300); }
      if (n) { await DB.save('orders', n.id, { ...extra, source: 'manual' }); await DB.save('orderStatus', code, { note: extra.publicNote, carrier: extra.carrier, trackNo: extra.trackNo, updatedAt: now }); if (next !== 'nuevo') await setOrderStatus({ ...n, ...extra }, next); }
      $('#dlgForm').close(); toast('Pedido creado: ' + code);
    });
  }
  const o = oe.o, log = [], ch = (lbl, a, b) => { if ((Number(a) || 0) !== (Number(b) || 0)) log.push(`${lbl} ${money(a || 0)} → ${money(b || 0)}`); };
  ch('Envío', o.shipping, v.ship); ch('Descuento', o.discount, v.disc); ch('Propina', o.tip, v.tip); ch('Otros costos', o.extra, v.extra);
  const oc = o.customer || {}; [['name', 'Nombre'], ['phone', 'Teléfono'], ['address', 'Dirección'], ['payment', 'Pago']].forEach(([k, l]) => { if ((oc[k] || '') !== (cust[k] || '')) log.push(`${l} modificado`); });
  const sig = l => JSON.stringify((l || []).map(i => [i.id, i.name, Number(i.qty), Number(i.price), i.vk || '']));
  const itemsChanged = sig(o.items) !== sig(items); if (itemsChanged) log.push(`Productos modificados (${money(orderSub(o))} → ${money(oe.sub)})`);
  if ((Number(o.total) || 0) !== total) log.push(`Total ${money(o.total)} → ${money(total)}`);
  if ((o.internalNote || '') !== extra.internalNote || (o.publicNote || '') !== extra.publicNote) log.push('Notas modificadas');
  const edits = [...(Array.isArray(o.edits) ? o.edits : []), ...(log.length ? [{ t: now, txt: log.join(' · ') }] : [])].slice(-30);
  return guarded(async () => {
    const cleanItems = items.map(({ id, name, price, qty, vk }) => ({ id, name, price, qty, ...(vk ? { vk } : {}) }));
    if (itemsChanged && o.stockApplied && !o.stockRestored && o.status !== 'cancelado') {
      for (const pid of new Set([...(o.items || []), ...cleanItems].map(i => i.id))) {
        const p = state.products.find(x => x.id === pid); if (!p) continue;
        const back = stockPatch(p, o.items || [], +1), p1 = back ? { ...p, ...back } : p, take = stockPatch(p1, cleanItems, -1), fin = take || back;
        if (fin) await DB.save('products', pid, { ...fin, updatedAt: now });
      }
    }
    await DB.save('orders', o.id, { customer: { ...oc, ...cust, ...Object.fromEntries(['email', 'address', 'zone', 'pickup', 'payment', 'note'].filter(k => !cust[k] && k in oc).map(k => [k, ''])) }, items: cleanItems, itemCount, shipping: v.ship, discount: v.disc, total, ...extra, edits, editedAt: now, priceMismatch: false, verifiedTotal: null });
    if (o.code) await DB.save('orderStatus', o.code, { items: cleanItems.slice(0, 50).map(i => ({ n: String(i.name).slice(0, 80), q: i.qty, p: i.price })), pids: [...new Set(cleanItems.map(i => String(i.id)))].slice(0, 50), total, shipping: v.ship, discount: v.disc, delivery, zone: cust.zone || '', payment: cust.payment || '', note: extra.publicNote, carrier: extra.carrier, trackNo: extra.trackNo, updatedAt: now });
    if (next !== o.status) await setOrderStatus({ ...o, items: cleanItems }, next);
    $('#dlgForm').close(); toast('Pedido actualizado');
  });
}

document.addEventListener('click', e => {
  const t = e.target.closest('[data-act]'); if (!t) return; const a = t.dataset.act, id = t.dataset.id, ad = state.admin;
  if (a === 'oeAdd') oeAddLine();
  else if (a === 'oeDel') { oe.items.splice(+t.dataset.i, 1); oeRows(); oeCalc(); }
  else if (a === 'oeSave') oeSave();
  else if (a === 'admNewOrder') openOrder(null);
  else if (a === 'ofSt') { (ad.of = ad.of || {}).st = ad.of.st === t.dataset.v ? '' : t.dataset.v; renderAdminBody(); }
  else if (a === 'ofClear') { ad.of = {}; renderAdminBody(); }
  else if (a === 'ofCsv') { const l = ordersFiltered(); if (!l.length) return toast('No hay pedidos para exportar.', { bad: true }); downloadFile(`pedidos-${isoNow()}.csv`, ordersExport(l)); toast(`${l.length} pedido(s) exportados`); }
  else if (a === 'ofCancel') { const o = state.orders.find(x => x.id === id); o && askConfirm(`¿Cancelar el pedido ${o.code}? Se devuelve el stock y pasa a la papelera (podés restaurarlo).`, 'Cancelar pedido').then(ok => ok && guarded(() => setOrderStatus(o, 'cancelado'))); }
  else if (a === 'ofPaid') guarded(async () => { const o = state.orders.find(x => x.id === id); if (!o) return; const paidAmount = Math.round((Number(o.total) + (Number(o.refunded) || 0)) * 100) / 100; await DB.save('orders', id, { paid: true, paidAmount }); if (o.code) await DB.save('orderStatus', o.code, { paid: true, paidAmount, updatedAt: Date.now() }); toast('Pedido marcado como pagado'); });
  else if (a === 'ofDup') { const o = state.orders.find(x => x.id === id); if (o) openOrder(null, { customer: { ...o.customer }, items: (o.items || []).map(i => ({ ...i })), shipping: o.shipping, discount: o.discount, tip: o.tip, extra: o.extra, extraLabel: o.extraLabel }); }
  else if (a === 'ofSel') { ad.sel = ad.sel || {}; if (t.checked) ad.sel[id] = 1; else delete ad.sel[id]; renderAdminBody(); }
  else if (a === 'ofAll') { ad.sel = {}; if (t.checked) ordersFiltered().forEach(o => { ad.sel[o.id] = 1; }); renderAdminBody(); }
  else if (a === 'ofBulk') { const next = $('#of-bulk').value, l = ordersFiltered().filter(o => (ad.sel || {})[o.id] && o.status !== next); if (!l.length) return toast('Nada para cambiar.'); askConfirm(`¿Pasar ${l.length} pedido(s) a “${STATUS[next]}”?${next !== 'cancelado' ? ' Se avisa a los clientes que dejaron correo.' : ''}`, 'Cambiar').then(ok => ok && guarded(async () => { for (const o of l) await setOrderStatus(o, next); ad.sel = {}; })); }
});

/* ───────── Clientes (se arma solo con los pedidos) ───────── */
function customersList() {
  const m = new Map();
  state.orders.filter(o => o.status !== 'cancelado').forEach(o => {
    const c = o.customer || {}, k = String(c.phone || '').replace(/\D/g, '').slice(-8) || String(c.name || '').toLowerCase(); if (!k) return;
    const r = m.get(k) || { name: c.name || '', phone: c.phone || '', email: '', n: 0, total: 0, last: 0, first: Infinity, addr: '' };
    r.n++; r.total += Number(o.total) || 0; if ((o.createdAt || 0) >= r.last) { r.last = o.createdAt || 0; r.name = c.name || r.name; r.phone = c.phone || r.phone; r.addr = c.address || r.addr; } r.first = Math.min(r.first, o.createdAt || Infinity); if (c.email) r.email = c.email; m.set(k, r);
  });
  return [...m.values()];
}
function customersTab() {
  const q = String(state.admin.cq || '').toLowerCase().trim(), all = customersList(), k = state.admin.csort || 'total';
  const list = all.filter(r => !q || [r.name, r.phone, r.email].join(' ').toLowerCase().includes(q)).sort((a, b) => k === 'last' ? b.last - a.last : k === 'n' ? b.n - a.n : b.total - a.total);
  const rep = all.filter(r => r.n > 1).length;
  return `<div class="stats"><div class="stat"><small>Clientes</small><b>${all.length}</b><span>con al menos un pedido</span></div><div class="stat"><small>Recurrentes</small><b>${rep}</b><span>${all.length ? Math.round(rep * 100 / all.length) : 0}% volvió a comprar</span></div></div>
  <div class="ofilters"><input class="in" type="search" id="c-q" placeholder="Buscar cliente por nombre, teléfono o correo" value="${esc(state.admin.cq || '')}" aria-label="Buscar clientes" style="flex:2">
    <select class="in" id="c-sort" aria-label="Orden"><option value="total">Más compraron ($)</option><option value="n" ${k === 'n' ? 'selected' : ''}>Más pedidos</option><option value="last" ${k === 'last' ? 'selected' : ''}>Compra más reciente</option></select>
    <button type="button" class="btn btn-line" data-act="cuCsv">Exportar CSV</button></div>
  ${list.length ? `<div class="rows">${list.map(r => `<div class="arow cu-row"><div class="nm">${esc(r.name)}<small>${esc(r.phone)}${r.email ? ' · ' + esc(r.email) : ''}${r.addr ? ' · ' + esc(r.addr) : ''}</small></div><div><b>${r.n}</b> pedido${r.n === 1 ? '' : 's'}${r.n > 1 ? ' <span class="chipst ok">Recurrente</span>' : ''}</div><div><b>${money(r.total)}</b><small class="muted" style="display:block">Última: ${fmtDate(r.last)}</small></div><div class="acts"><button type="button" class="btn btn-line btn-sm" data-act="cuOrders" data-q="${esc(r.phone)}">Ver pedidos</button><a class="btn btn-line btn-sm" target="_blank" rel="noopener" href="https://wa.me/${uyPhone(r.phone)}">WhatsApp</a></div></div>`).join('')}</div>` : '<div class="empty"><h3>Sin clientes todavía</h3><p>Se arma solo con los pedidos que van entrando.</p></div>'}`;
}
document.addEventListener('input', e => { if (e.target.id === 'c-q') { state.admin.cq = e.target.value; clearTimeout(window.__cqT); window.__cqT = setTimeout(() => { const pos = e.target.selectionStart; renderAdminBody(); const i = $('#c-q'); if (i) { i.focus(); try { i.setSelectionRange(pos, pos); } catch { /* nada */ } } }, 250); } });
document.addEventListener('change', e => { if (e.target.id === 'c-sort') { state.admin.csort = e.target.value; renderAdminBody(); } });
document.addEventListener('click', e => {
  const t = e.target.closest('[data-act]'); if (!t) return;
  if (t.dataset.act === 'cuOrders') { state.admin.tab = 'orders'; state.admin.ov = 'act'; state.admin.of = { q: t.dataset.q }; document.querySelectorAll('[data-act=admTab]').forEach(b => b.setAttribute('aria-selected', b.dataset.tab === 'orders')); renderAdminBody(); }
  else if (t.dataset.act === 'cuCsv') { const q = v => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`; downloadFile(`clientes-${isoNow()}.csv`, [['Nombre', 'Teléfono', 'Correo', 'Dirección', 'Pedidos', 'Total', 'Última compra'].map(q).join(','), ...customersList().sort((a, b) => b.total - a.total).map(r => [r.name, r.phone, r.email, r.addr, r.n, r.total, r.last ? new Date(r.last).toLocaleDateString('es-UY') : ''].map(q).join(','))].join('\r\n')); toast('Clientes exportados'); }
});
