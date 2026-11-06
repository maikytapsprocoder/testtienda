// Cuando entra un pedido a Firestore, esta función lo verifica y manda el WhatsApp
// desde el servidor: el cliente nunca ve a qué número se envía ni cuándo.
const { onDocumentCreated } = require('firebase-functions/v2/firestore');
const { onRequest } = require('firebase-functions/v2/https');
const { defineSecret, defineString } = require('firebase-functions/params');
const { logger } = require('firebase-functions/v2');
const admin = require('firebase-admin');
const { verifyItems, priceOrder, buildMessage, sendWhatsApp, stockPatch, buildPreference, mpCreatePreference, mpGetPayment, paymentCoversOrder, mpAmountDue, applyPayment, mpRefundPayment } = require('./lib');

admin.initializeApp();

// IMPORTANTE: debe coincidir con la región de tu base Firestore
// (ej.: 'us-central1' para nam5, 'southamerica-east1' si la creaste en São Paulo).
const REGION = 'us-central1';

const WA_PROVIDER = defineString('WA_PROVIDER', { default: 'callmebot' }); // 'callmebot' | 'cloudapi'
const WA_PHONE = defineString('WA_PHONE', { default: '59898297449' });      // destino, con código de país y sin +
const WA_PHONE_ID = defineString('WA_PHONE_ID', { default: '' });           // solo cloudapi
const WA_TEMPLATE = defineString('WA_TEMPLATE', { default: '' });           // solo cloudapi, opcional
const WA_APIKEY = defineSecret('WA_APIKEY');                                // clave de CallMeBot o token de Cloud API

exports.notifyNewOrder = onDocumentCreated(
  { document: 'orders/{orderId}', region: REGION, secrets: [WA_APIKEY], maxInstances: 5 },
  async event => {
    const snap = event.data;
    if (!snap) return;
    const order = snap.data();
    const db = admin.firestore();

    try {
      // 1) Verificar precios contra el catálogo actual (las reglas no pueden hacerlo)
      const ids = [...new Set((order.items || []).map(i => i.id).filter(id => typeof id === 'string' && id && !id.includes('/')))];
      const docs = ids.length ? await db.getAll(...ids.map(id => db.collection('products').doc(id))) : [];
      const catalog = new Map(docs.filter(d => d.exists).map(d => [d.id, d.data()]));
      const v = verifyItems(order.items || [], catalog);

      // Envío: se recalcula con las zonas actuales de los ajustes
      const st0 = await db.collection('settings').doc('store').get();
      const c = order.customer || {};
      const pr = priceOrder({ itemsTotal: v.verifiedTotal, couponCode: order.coupon, customer: c, settings: st0.exists ? st0.data() : {} });
      const shipping = pr.shipping;
      v.shipping = shipping; v.discount = pr.discount; v.coupon = pr.coupon;

      // Stock: se descuenta una sola vez por pedido (transacción)
      try {
        await db.runTransaction(async tx => {
          const o = await tx.get(snap.ref);
          if (!o.exists || o.data().stockApplied) return;
          const refs = ids.map(id => db.collection('products').doc(id));
          const ps = refs.length ? await tx.getAll(...refs) : [];
          for (const d of ps) {
            if (!d.exists) continue;
            const pt = stockPatch({ id: d.id, ...d.data() }, order.items || [], -1);
            if (pt) tx.update(d.ref, pt);
          }
          tx.update(snap.ref, { stockApplied: true });
        });
      } catch (e) { logger.warn('No se pudo descontar el stock', { order: order.code, error: String(e && e.message) }); }

      // 2) Nombre de la tienda (opcional)
      const storeName = st0.exists ? st0.data().storeName : '';

      // 3) Armar y enviar el WhatsApp
      const text = buildMessage({ code: order.code, ...v, customer: order.customer || {}, storeName });
      await sendWhatsApp({
        provider: WA_PROVIDER.value(), phone: WA_PHONE.value(), apiKey: WA_APIKEY.value(),
        phoneId: WA_PHONE_ID.value(), template: WA_TEMPLATE.value()
      }, text);

      await snap.ref.update({
        verifiedTotal: pr.total, priceMismatch: v.mismatch,
        whatsapp: { sent: true, provider: WA_PROVIDER.value(), at: admin.firestore.FieldValue.serverTimestamp() }
      });
      logger.info('Pedido notificado', { order: order.code });
    } catch (e) {
      // No lanzamos el error: así no se reintenta en bucle. Queda marcado en el panel de pedidos.
      logger.error('No se pudo enviar el WhatsApp', { order: order.code, error: String(e && e.message) });
      await snap.ref.update({ whatsapp: { sent: false, error: String((e && e.message) || e).slice(0, 200) } }).catch(() => {});
    }
  }
);

/* ───── Mercado Pago (opcional): secreto MP_ACCESS_TOKEN = Access Token de producción de tu cuenta ───── */
const MP_TOKEN = defineSecret('MP_ACCESS_TOKEN');

async function orderByCode(db, code) {
  if (!/^[A-Za-z0-9-]{4,24}$/.test(String(code || ''))) return null;
  const q = await db.collection('orders').where('code', '==', String(code)).limit(1).get();
  return q.empty ? null : q.docs[0];
}

// El cliente pide el link de pago de su pedido recién creado (se verifica el total en el servidor).
exports.createMpPayment = onRequest({ region: REGION, secrets: [MP_TOKEN], cors: true, maxInstances: 5 }, async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });
  try {
    const db = admin.firestore();
    const doc = await orderByCode(db, (req.body || {}).code);
    if (!doc) return res.status(404).json({ error: 'Pedido no encontrado' });
    const o = doc.data();
    if (o.status === 'cancelado') return res.status(409).json({ error: 'Pedido cancelado' });
    // Esperar a que notifyNewOrder haya verificado el total (hasta ~6 s); si no llegó, se recalcula acá
    let total = o.verifiedTotal;
    if (!total) {
      const ids = [...new Set((o.items || []).map(i => i.id).filter(id => typeof id === 'string' && id && !id.includes('/')))];
      const docs = ids.length ? await db.getAll(...ids.map(id => db.collection('products').doc(id))) : [];
      const v = verifyItems(o.items || [], new Map(docs.filter(d => d.exists).map(d => [d.id, d.data()])));
      const st = await db.collection('settings').doc('store').get();
      total = priceOrder({ itemsTotal: v.verifiedTotal, couponCode: o.coupon, customer: o.customer || {}, settings: st.exists ? st.data() : {} }).total;
    }
    const st = await db.collection('settings').doc('store').get();
    const due = mpAmountDue(o, total, st.exists ? st.data().mpDeposit : 0);
    if (due.charge <= 0) return res.status(409).json({ error: 'Este pedido ya está pagado' });
    const pref = buildPreference({ code: o.code, total: due.charge, partial: due.charge < total, storeName: st.exists ? st.data().storeName : '', back: (req.body || {}).back, notifyUrl: `https://${REGION}-${process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT}.cloudfunctions.net/mpWebhook` });
    const url = await mpCreatePreference(MP_TOKEN.value(), pref);
    await doc.ref.update({ mpPending: true, verifiedTotal: total });
    res.json({ url });
  } catch (e) {
    logger.error('createMpPayment', { error: String(e && e.message) });
    res.status(500).json({ error: 'No se pudo iniciar el pago' });
  }
});

// Mercado Pago avisa acá cuando cambia un pago. No se confía en el aviso: se consulta el pago a la API.
exports.mpWebhook = onRequest({ region: REGION, secrets: [MP_TOKEN], maxInstances: 5 }, async (req, res) => {
  try {
    const id = (req.query['data.id'] || (req.body && req.body.data && req.body.data.id) || req.query.id || '');
    const type = req.query.type || req.query.topic || (req.body && req.body.type) || '';
    if (!id || !/payment/.test(String(type))) return res.status(200).send('ignorado');
    const pay = await mpGetPayment(MP_TOKEN.value(), id);
    const db = admin.firestore();
    const doc = await orderByCode(db, pay.external_reference);
    if (!doc) return res.status(200).send('sin pedido');
    const o = doc.data();
    const st = await db.collection('settings').doc('store').get();
    const patch = applyPayment(o, pay, o.verifiedTotal || o.total);
    if (patch) {
      await doc.ref.update(patch);
      await db.collection('orderStatus').doc(o.code).set({ paid: patch.paid, paidAmount: patch.paidAmount, refunded: patch.refunded, updatedAt: Date.now() }, { merge: true });
      logger.info('Pago registrado', { order: o.code, paid: patch.paid });
    }
    res.status(200).send('ok');
  } catch (e) {
    logger.error('mpWebhook', { error: String(e && e.message) });
    res.status(500).send('error'); // MP reintenta
  }
});

// Reembolso total o parcial desde el panel (solo administradores: se verifica el token de sesión de Firebase).
const ADMIN_EMAILS = defineString('ADMIN_EMAILS', { default: 'user@tienda-admin.local' }); // separados por coma
exports.mpRefund = onRequest({ region: REGION, secrets: [MP_TOKEN], cors: true, maxInstances: 3 }, async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });
  try {
    const tok = String(req.get('authorization') || '').replace(/^Bearer /i, '');
    const dec = tok ? await admin.auth().verifyIdToken(tok).catch(() => null) : null;
    const email = dec && String(dec.email || '').toLowerCase();
    const db = admin.firestore();
    const isAdm = !!email && (ADMIN_EMAILS.value().toLowerCase().split(',').map(x => x.trim()).includes(email) || (await db.collection('admins').doc(email).get()).exists);
    if (!isAdm) return res.status(403).json({ error: 'No autorizado' });
    const { code, paymentId, amount } = req.body || {};
    const doc = await orderByCode(db, code);
    if (!doc) return res.status(404).json({ error: 'Pedido no encontrado' });
    const o = doc.data(), e = (o.payments || []).find(p => String(p.id) === String(paymentId));
    if (!e) return res.status(404).json({ error: 'Pago no encontrado en el pedido' });
    const left = Math.round((Number(e.amount) - Number(e.refunded || 0)) * 100) / 100, amt = amount ? Number(amount) : 0;
    if (left <= 0) return res.status(409).json({ error: 'Ese pago ya fue reembolsado' });
    if (amt && (!(amt > 0) || amt > left + 0.001)) return res.status(400).json({ error: `El monto máximo a reembolsar es ${left}` });
    await mpRefundPayment(MP_TOKEN.value(), paymentId, amt || 0, `${o.code}-${paymentId}-${Date.now()}`);
    const pay = await mpGetPayment(MP_TOKEN.value(), paymentId);
    const patch = applyPayment(o, pay, o.verifiedTotal || o.total);
    if (patch) {
      await doc.ref.update(patch);
      await db.collection('orderStatus').doc(o.code).set({ paid: patch.paid, paidAmount: patch.paidAmount, refunded: patch.refunded, updatedAt: Date.now() }, { merge: true });
    }
    res.json({ ok: true, refunded: patch ? patch.refunded : undefined });
  } catch (e) {
    logger.error('mpRefund', { error: String(e && e.message) });
    res.status(500).json({ error: String((e && e.message) || 'No se pudo reembolsar').slice(0, 200) });
  }
});
