// Lógica pura (sin Firebase) para armar y enviar el mensaje de WhatsApp. Se prueba en test.js.

const nf = new Intl.NumberFormat('es-UY', { maximumFractionDigits: 0 });
const money = n => '$ ' + nf.format(Math.round(Number(n) || 0));

/** Revisa los ítems del pedido contra los precios actuales del catálogo. */
function verifyItems(items, catalog /* Map id -> {price} */) {
  let verifiedTotal = 0, mismatch = false;
  const lines = items.map(i => {
    const p = catalog.get(i.id);
    const sent = Number(i.price), now = p ? Number(p.price) : sent;
    if (!p || now !== sent) mismatch = true;
    verifiedTotal += now * Number(i.qty);
    return { name: String(i.name), qty: Number(i.qty), price: now };
  });
  return { lines, verifiedTotal, mismatch };
}

/* Descuento y envío reales (la tienda los calcula igual, acá se vuelven a verificar) */
function priceOrder({ itemsTotal, couponCode, customer = {}, settings = {} }) {
  const k = String(couponCode || '').trim().toUpperCase();
  const cp = k ? (settings.coupons || []).find(c => c && String(c.code).toUpperCase() === k) : null;
  const discount = cp ? Math.min(itemsTotal, cp.type === 'pct' ? Math.round(itemsTotal * Number(cp.value) / 100) : Number(cp.value) || 0) : 0;
  const base = itemsTotal - discount;
  const zone = customer.delivery === 'envio' ? (settings.shippingZones || []).find(z => z && z.name === customer.zone) : null;
  let shipping = zone ? Math.max(0, Number(zone.cost) || 0) : 0;
  const free = Number(settings.freeShippingFrom) || 0;
  if (free > 0 && base >= free) shipping = 0;
  return { discount, shipping, total: base + shipping, coupon: cp ? cp.code : '' };
}

function buildMessage({ code, lines, verifiedTotal, mismatch, customer, storeName, shipping = 0, discount = 0, coupon = '' }) {
  const items = lines.map(l => `• ${l.qty} x ${l.name} — ${money(l.price * l.qty)}`).join('\n');
  const entrega = customer.delivery === 'envio' ? `Envío a: ${customer.address || '(sin dirección)'}${customer.zone ? ' (' + customer.zone + ')' : ''}` : 'Retiro en el local' + (customer.pickup ? ': ' + customer.pickup : '');
  return [
    `🛒 Nuevo pedido ${code}${storeName ? ' · ' + storeName : ''}`,
    '',
    items,
    '',
    discount > 0 ? `Descuento${coupon ? ' (' + coupon + ')' : ''}: -${money(discount)}` : null,
    shipping > 0 ? `Envío: ${money(shipping)}` : null,
    `Total: ${money(verifiedTotal - discount + shipping)}`,
    '',
    `Cliente: ${customer.name}`,
    `Teléfono: ${customer.phone}`,
    customer.payment ? `Pago: ${customer.payment}` : null,
    entrega,
    customer.note ? `Comentarios: ${customer.note}` : null,
    mismatch ? '\n⚠️ Algún precio cambió o el producto ya no existe: revisá el pedido en el panel.' : null
  ].filter(x => x !== null).join('\n').slice(0, 1500);
}

/**
 * Envía el texto por WhatsApp.
 * cfg: { provider: 'callmebot' | 'cloudapi', phone, apiKey, phoneId?, template?, lang? }
 */
async function sendWhatsApp(cfg, text, fetchFn = fetch) {
  const phone = String(cfg.phone).replace(/\D/g, '');
  if (!phone) throw new Error('Falta WA_PHONE');
  if (!cfg.apiKey) throw new Error('Falta el secreto WA_APIKEY');

  if (cfg.provider === 'cloudapi') {
    if (!cfg.phoneId) throw new Error('Falta WA_PHONE_ID');
    const body = cfg.template
      ? { messaging_product: 'whatsapp', to: phone, type: 'template', template: { name: cfg.template, language: { code: cfg.lang || 'es' }, components: [{ type: 'body', parameters: [{ type: 'text', text: text.replace(/\s*\n\s*/g, ' | ').slice(0, 900) }] }] } }
      : { messaging_product: 'whatsapp', to: phone, type: 'text', text: { body: text } };
    const res = await fetchFn(`https://graph.facebook.com/v20.0/${encodeURIComponent(cfg.phoneId)}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${cfg.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!res.ok) throw new Error(`WhatsApp Cloud API ${res.status}: ${(await res.text()).slice(0, 160)}`);
    return;
  }

  // CallMeBot (gratis, envía a tu propio número una vez que lo autorizaste)
  const url = `https://api.callmebot.com/whatsapp.php?phone=${encodeURIComponent('+' + phone)}&text=${encodeURIComponent(text)}&apikey=${encodeURIComponent(cfg.apiKey)}`;
  const res = await fetchFn(url);
  const out = await res.text();
  if (!res.ok || /\bERROR\b/.test(out)) throw new Error(`CallMeBot ${res.status}: ${out.replace(/<[^>]+>/g, ' ').trim().slice(0, 160)}`);
}

/* Descuenta (sign=-1) o devuelve (+1) stock, respetando el stock por variante (vstock). */
function stockPatch(p, items, sign) {
  if (!p || p.stock === null || p.stock === undefined) return null;
  const mine = items.filter(i => i.id === p.id), q = mine.reduce((t, i) => t + Number(i.qty || 0), 0);
  if (!q) return null;
  if (p.vstock && typeof p.vstock === 'object' && Object.keys(p.vstock).length) {
    const vs = { ...p.vstock };
    for (const i of mine) if (i.vk && i.vk in vs) vs[i.vk] = Math.max(0, Number(vs[i.vk] || 0) + sign * Number(i.qty || 0));
    return { vstock: vs, stock: Object.values(vs).reduce((t, n) => t + (Number(n) || 0), 0) };
  }
  return { stock: Math.max(0, Number(p.stock) + sign * q) };
}

/* ───── Mercado Pago ───── */
/* Arma la "preferencia" de Checkout Pro: un solo ítem con el total verificado del pedido. */
function buildPreference({ code, total, storeName, back, notifyUrl, partial }) {
  const b = /^https:\/\/[^\s]+$/.test(String(back || '')) ? String(back).split('#')[0] : '';
  const pref = {
    items: [{ title: `${partial ? 'Seña pedido' : 'Pedido'} ${code}${storeName ? ' · ' + storeName : ''}`.slice(0, 120), quantity: 1, unit_price: Math.round(Number(total) * 100) / 100, currency_id: 'UYU' }],
    external_reference: String(code),
    notification_url: notifyUrl,
    statement_descriptor: String(storeName || 'TIENDA').replace(/[^A-Za-z0-9 ]/g, '').slice(0, 22) || 'TIENDA'
  };
  if (b) { pref.back_urls = { success: b + '#/pedido/' + code, pending: b + '#/pedido/' + code, failure: b + '#/pedido/' + code }; pref.auto_return = 'approved'; }
  return pref;
}
async function mpCreatePreference(token, pref, fetchFn = fetch) {
  if (!token) throw new Error('Falta el secreto MP_ACCESS_TOKEN');
  const res = await fetchFn('https://api.mercadopago.com/checkout/preferences', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(pref) });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j.init_point) throw new Error(`Mercado Pago ${res.status}: ${JSON.stringify(j).slice(0, 160)}`);
  return j.init_point;
}
async function mpGetPayment(token, id, fetchFn = fetch) {
  if (!/^\d{1,20}$/.test(String(id))) throw new Error('id de pago inválido');
  const res = await fetchFn(`https://api.mercadopago.com/v1/payments/${id}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Mercado Pago ${res.status}`);
  return res.json();
}
/* ¿El pago consultado a Mercado Pago corresponde a este pedido? (el monto se acumula; ver applyPayment) */
function paymentCoversOrder(pay, order) {
  return !!pay && pay.status === 'approved' && String(pay.external_reference) === String(order.code) && Number(pay.transaction_amount) > 0;
}
const r2 = n => Math.round(Number(n) * 100) / 100;
/* Cuánto falta cobrar online y cuánto cobrar ahora (seña opcional: % de los ajustes, solo en el primer pago) */
function mpAmountDue(order, total, depositPct) {
  const net = r2((Number(order.paidAmount) || 0) - (Number(order.refunded) || 0)), remaining = r2(Number(total) - net);
  if (remaining <= 0.009) return { remaining: 0, charge: 0 };
  const pct = Number(depositPct) || 0, first = !(Number(order.paidAmount) > 0);
  const charge = first && pct > 0 && pct < 100 ? Math.max(1, r2(Number(total) * pct / 100)) : remaining;
  return { remaining, charge: Math.min(charge, remaining) };
}
/* Incorpora (o actualiza) un pago de Mercado Pago al pedido. Devuelve el cambio a guardar, o null si no hay cambios.
   Idempotente: el mismo aviso llegado dos veces no suma dos veces. Sirve también para reembolsos hechos desde el panel de Mercado Pago. */
function applyPayment(order, pay, total) {
  if (!pay || String(pay.external_reference) !== String(order.code)) return null;
  const refunded = r2(pay.transaction_amount_refunded || 0), amount = r2(pay.transaction_amount || 0);
  const list = Array.isArray(order.payments) ? order.payments.map(p => ({ ...p })) : [];
  let e = list.find(p => String(p.id) === String(pay.id));
  if (!e) { if (pay.status !== 'approved' || amount <= 0) return null; e = { id: String(pay.id), amount, refunded: 0, at: Date.now() }; list.push(e); }
  else if (e.amount === amount && r2(e.refunded) === refunded) return null;
  e.amount = amount; e.refunded = refunded;
  const paidAmount = r2(list.reduce((t, p) => t + (Number(p.amount) || 0), 0)), ref = r2(list.reduce((t, p) => t + (Number(p.refunded) || 0), 0));
  return { payments: list, paidAmount, refunded: ref, paid: r2(paidAmount - ref) + 0.01 >= Number(total), mpPending: false };
}
/* Reembolso por Mercado Pago (monto opcional = parcial) */
async function mpRefundPayment(token, id, amount, key, fetchFn = fetch) {
  if (!/^\d{1,20}$/.test(String(id))) throw new Error('id de pago inválido');
  const res = await fetchFn(`https://api.mercadopago.com/v1/payments/${id}/refunds`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'X-Idempotency-Key': key }, body: JSON.stringify(amount ? { amount: r2(amount) } : {}) });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Mercado Pago ${res.status}: ${(j.message || j.error || '').toString().slice(0, 140)}`);
  return j;
}

module.exports = { mpAmountDue, applyPayment, mpRefundPayment, buildPreference, mpCreatePreference, mpGetPayment, paymentCoversOrder, money, verifyItems, priceOrder, buildMessage, sendWhatsApp, stockPatch };
