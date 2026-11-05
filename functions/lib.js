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

module.exports = { money, verifyItems, priceOrder, buildMessage, sendWhatsApp };
