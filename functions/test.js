// Prueba local de la lógica de mensajes y envío (con fetch simulado). Uso: node test.js
const assert = require('assert');
const { verifyItems, priceOrder, buildMessage, sendWhatsApp } = require('./lib');

const catalog = new Map([['a', { price: 890 }], ['b', { price: 2490 }]]);

// Precios correctos
let v = verifyItems([{ id: 'a', name: 'Mouse', price: 890, qty: 2 }, { id: 'b', name: 'Teclado', price: 2490, qty: 1 }], catalog);
assert.strictEqual(v.mismatch, false);
assert.strictEqual(v.verifiedTotal, 4270);

// Precio manipulado o producto inexistente → se detecta y se usa el precio real
v = verifyItems([{ id: 'a', name: 'Mouse', price: 1, qty: 2 }], catalog);
assert.strictEqual(v.mismatch, true);
assert.strictEqual(v.verifiedTotal, 1780);
assert.strictEqual(verifyItems([{ id: 'zzz', name: 'X', price: 5, qty: 1 }], catalog).mismatch, true);

const msg = buildMessage({ code: 'P-1', ...v, customer: { name: 'Ana', phone: '099123456', delivery: 'envio', address: 'Calle 1', zone: 'Dolores', payment: 'Efectivo', note: 'Tocar timbre' }, storeName: 'Nodo', shipping: 100 });
assert.ok(msg.includes('Nuevo pedido P-1') && msg.includes('Envío a: Calle 1 (Dolores)') && msg.includes('Envío: $ 100') && msg.includes('Total: $ 1.880') && msg.includes('Pago: Efectivo') && msg.includes('⚠️'));

// Cupones y envío gratis
const cfg = { shippingZones: [{ name: 'Mercedes', cost: 0 }, { name: 'Dolores', cost: 100 }], coupons: [{ code: 'HOLA', type: 'pct', value: 10 }, { code: 'FIJO', type: 'fix', value: 5000 }], freeShippingFrom: 3000 };
let pr = priceOrder({ itemsTotal: 1000, couponCode: 'hola', customer: { delivery: 'envio', zone: 'Dolores' }, settings: cfg });
assert.deepStrictEqual([pr.discount, pr.shipping, pr.total], [100, 100, 1000]);
pr = priceOrder({ itemsTotal: 3500, couponCode: '', customer: { delivery: 'envio', zone: 'Dolores' }, settings: cfg });
assert.strictEqual(pr.shipping, 0);
pr = priceOrder({ itemsTotal: 1000, couponCode: 'FIJO', customer: { delivery: 'retiro' }, settings: cfg });
assert.deepStrictEqual([pr.discount, pr.total], [1000, 0]);
assert.strictEqual(priceOrder({ itemsTotal: 1000, couponCode: 'NOEXISTE', customer: {}, settings: cfg }).discount, 0);

{
  const L = require('./lib');
  const pr = L.buildPreference({ code: 'AB-12', total: 1500.456, storeName: 'Nodo Tecno!', back: 'https://x.github.io/t/', notifyUrl: 'https://f/mpWebhook' });
  assert.strictEqual(pr.items[0].unit_price, 1500.46); assert.strictEqual(pr.external_reference, 'AB-12');
  assert.strictEqual(pr.statement_descriptor, 'Nodo Tecno'); assert.ok(pr.back_urls.success.endsWith('#/pedido/AB-12'));
  assert.strictEqual(L.buildPreference({ code: 'A', total: 1, back: 'javascript:alert(1)', notifyUrl: 'u' }).back_urls, undefined);
  assert.ok(L.paymentCoversOrder({ status: 'approved', external_reference: 'AB-12', transaction_amount: 1500 }, { code: 'AB-12', verifiedTotal: 1500 }));
  assert.ok(!L.paymentCoversOrder({ status: 'pending', external_reference: 'AB-12', transaction_amount: 1500 }, { code: 'AB-12', verifiedTotal: 1500 }));
}
{
  const L = require('./lib');
  assert.deepStrictEqual(L.mpAmountDue({}, 1000, 30), { remaining: 1000, charge: 300 });
  assert.deepStrictEqual(L.mpAmountDue({ paidAmount: 300 }, 1000, 30), { remaining: 700, charge: 700 });
  assert.deepStrictEqual(L.mpAmountDue({}, 1000, 0), { remaining: 1000, charge: 1000 });
  assert.deepStrictEqual(L.mpAmountDue({ paidAmount: 1000, refunded: 0 }, 1000, 30), { remaining: 0, charge: 0 });
  assert.strictEqual(L.mpAmountDue({ paidAmount: 1000, refunded: 400 }, 1000, 0).charge, 400);
  const o = { code: 'P-1' };
  const p1 = L.applyPayment(o, { id: 11, status: 'approved', external_reference: 'P-1', transaction_amount: 300 }, 1000);
  assert.strictEqual(p1.paidAmount, 300); assert.strictEqual(p1.paid, false);
  assert.strictEqual(L.applyPayment({ ...o, ...p1 }, { id: 11, status: 'approved', external_reference: 'P-1', transaction_amount: 300 }, 1000), null); // aviso repetido
  const p2 = L.applyPayment({ ...o, ...p1 }, { id: 12, status: 'approved', external_reference: 'P-1', transaction_amount: 700 }, 1000);
  assert.strictEqual(p2.paidAmount, 1000); assert.strictEqual(p2.paid, true); assert.strictEqual(p2.payments.length, 2);
  const p3 = L.applyPayment({ ...o, ...p2 }, { id: 12, status: 'partially_refunded', external_reference: 'P-1', transaction_amount: 700, transaction_amount_refunded: 200 }, 1000);
  assert.strictEqual(p3.refunded, 200); assert.strictEqual(p3.paid, false);
  assert.strictEqual(L.applyPayment(o, { id: 5, status: 'pending', external_reference: 'P-1', transaction_amount: 10 }, 1000), null);
  assert.strictEqual(L.applyPayment(o, { id: 5, status: 'approved', external_reference: 'OTRO', transaction_amount: 10 }, 1000), null);
}
(async () => {
  const L3 = require('./lib');
  let rq; await L3.mpRefundPayment('T', '99', 50.456, 'k', async (u, op) => { rq = { u, op }; return { ok: true, json: async () => ({}) }; });
  assert.ok(rq.u.endsWith('/v1/payments/99/refunds')); assert.strictEqual(JSON.parse(rq.op.body).amount, 50.46); assert.strictEqual(rq.op.headers['X-Idempotency-Key'], 'k');
  await L3.mpRefundPayment('T', '99', 0, 'k', async (u, op) => { rq = { op }; return { ok: true, json: async () => ({}) }; }); assert.strictEqual(rq.op.body, '{}');
  await assert.rejects(L3.mpRefundPayment('T', '99', 1, 'k', async () => ({ ok: false, status: 400, json: async () => ({ message: 'x' }) })), /400/);
  const L2 = require('./lib');
  assert.strictEqual(await L2.mpCreatePreference('T', {}, async () => ({ ok: true, status: 201, json: async () => ({ init_point: 'https://www.mercadopago.com.uy/x' }) })), 'https://www.mercadopago.com.uy/x');
  await assert.rejects(L2.mpCreatePreference('T', {}, async () => ({ ok: false, status: 401, json: async () => ({}) })), /Mercado Pago 401/);
  await assert.rejects(L2.mpGetPayment('T', '../x', async () => ({})), /inválido/);
  // CallMeBot
  let seen;
  await sendWhatsApp({ provider: 'callmebot', phone: '59898297449', apiKey: 'K' }, 'hola\nmundo', async url => { seen = url; return { ok: true, status: 200, text: async () => 'Message queued' }; });
  assert.ok(seen.startsWith('https://api.callmebot.com/whatsapp.php?phone=%2B59898297449&text=hola%0Amundo&apikey=K'));
  await assert.rejects(sendWhatsApp({ provider: 'callmebot', phone: '59898297449', apiKey: 'K' }, 'x', async () => ({ ok: true, status: 200, text: async () => 'ERROR: apikey invalid' })), /CallMeBot/);

  // Cloud API (texto y plantilla)
  let call;
  const fake = async (url, opt) => { call = { url, opt }; return { ok: true, status: 200, text: async () => '{}' }; };
  await sendWhatsApp({ provider: 'cloudapi', phone: '+598 98 297 449', apiKey: 'T', phoneId: '123' }, 'a\nb', fake);
  assert.strictEqual(JSON.parse(call.opt.body).to, '59898297449');
  assert.strictEqual(JSON.parse(call.opt.body).type, 'text');
  await sendWhatsApp({ provider: 'cloudapi', phone: '59898297449', apiKey: 'T', phoneId: '123', template: 'pedido_nuevo' }, 'a\nb', fake);
  assert.strictEqual(JSON.parse(call.opt.body).template.components[0].parameters[0].text, 'a | b');

  // Errores de configuración
  await assert.rejects(sendWhatsApp({ provider: 'callmebot', phone: '', apiKey: 'K' }, 'x', fake), /WA_PHONE/);
  await assert.rejects(sendWhatsApp({ provider: 'callmebot', phone: '598', apiKey: '' }, 'x', fake), /WA_APIKEY/);
  console.log('OK: todas las pruebas pasaron');
})().catch(e => { console.error('FALLÓ', e); process.exit(1); });
{
  const { stockPatch } = require('./lib');
  const p = { id: 'a', stock: 5, vstock: { 'M / Negro': 3, 'L / Negro': 2 } };
  const d = stockPatch(p, [{ id: 'a', qty: 2, vk: 'M / Negro' }], -1);
  if (d.vstock['M / Negro'] !== 1 || d.stock !== 3) throw new Error('stockPatch vstock');
  const r = stockPatch({ id: 'b', stock: 4 }, [{ id: 'b', qty: 9 }], -1);
  if (r.stock !== 0) throw new Error('stockPatch plano');
  console.log('OK stockPatch');
}
