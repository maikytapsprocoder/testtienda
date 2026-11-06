/* ───────── Códigos de barras: generar, imprimir, escanear (cámara y lector USB) ─────────
   Sin dependencias para generar (EAN-13, EAN-8, UPC-A y Code 128). Para escanear con cámara usa el
   lector nativo del navegador (BarcodeDetector) y, si no existe, la librería ZXing (se descarga sola). */

/* ── Codificación ── */
var EAN_L = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011'];
var EAN_G = ['0100111', '0110011', '0011011', '0100001', '0011101', '0111001', '0000101', '0010001', '0001001', '0010111'];
var EAN_R = ['1110010', '1100110', '1101100', '1000010', '1011100', '1001110', '1010000', '1000100', '1001000', '1110100'];
var EAN_PAR = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL'];
var C128 = ['212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213', '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132', '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211', '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313', '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331', '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111', '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214', '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111', '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141', '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141', '114131', '311141', '411131', '211412', '211214', '211232', '2331112'];

var normCode = s => String(s == null ? '' : s).replace(/[\s\u0000-\u001f]/g, '').slice(0, 48);
/* Dígito verificador GS1 de los primeros n-1 dígitos */
function eanCheckDigit(body) {
  let sum = 0;
  for (let i = 0; i < body.length; i++) sum += Number(body[body.length - 1 - i]) * (i % 2 === 0 ? 3 : 1);
  return (10 - (sum % 10)) % 10;
}
/* '' si el código es válido (o no es un EAN), o el mensaje de error si parece EAN/UPC pero el verificador no coincide */
function eanProblem(code) {
  if (!/^\d+$/.test(code) || ![8, 12, 13].includes(code.length)) return '';
  return eanCheckDigit(code.slice(0, -1)) === Number(code.slice(-1)) ? '' : `El dígito verificador no coincide (debería terminar en ${eanCheckDigit(code.slice(0, -1))}). Revisá que lo hayas escrito bien.`;
}
/* Código interno único (prefijo 20–29 de GS1, reservado para uso interno de cada tienda) */
function genInternalCode(taken) {
  for (let i = 0; i < 200; i++) {
    const body = '20' + String(Math.floor(Math.random() * 1e10)).padStart(10, '0'), c = body + eanCheckDigit(body);
    if (!taken || !taken.has(c)) return c;
  }
  return '';
}
/* Devuelve { type, bits } con 1 = barra y 0 = espacio */
function encodeBarcode(code) {
  code = normCode(code);
  if (!code) return null;
  if (/^\d{12}$/.test(code) && !eanProblem(code)) return encodeBarcode('0' + code); // UPC-A se imprime como EAN-13 con 0 adelante
  if (/^\d{13}$/.test(code) && !eanProblem(code)) {
    const par = EAN_PAR[+code[0]];
    let b = '101';
    for (let i = 1; i <= 6; i++) b += (par[i - 1] === 'L' ? EAN_L : EAN_G)[+code[i]];
    b += '01010';
    for (let i = 7; i <= 12; i++) b += EAN_R[+code[i]];
    return { type: 'EAN-13', bits: b + '101', text: code };
  }
  if (/^\d{8}$/.test(code) && !eanProblem(code)) {
    let b = '101';
    for (let i = 0; i < 4; i++) b += EAN_L[+code[i]];
    b += '01010';
    for (let i = 4; i < 8; i++) b += EAN_R[+code[i]];
    return { type: 'EAN-8', bits: b + '101', text: code };
  }
  // Code 128 (juego B: texto ASCII imprimible)
  if (!/^[\x20-\x7e]+$/.test(code)) return null;
  const vals = [104]; let sum = 104;
  for (let i = 0; i < code.length; i++) { const v = code.charCodeAt(i) - 32; vals.push(v); sum += v * (i + 1); }
  vals.push(sum % 103, 106);
  let b = '';
  for (const v of vals) { const w = C128[v]; for (let i = 0; i < w.length; i++) b += (i % 2 === 0 ? '1' : '0').repeat(+w[i]); }
  return { type: 'Code128', bits: b, text: code };
}
/* SVG del código (con zona blanca y texto debajo) */
function barcodeSvg(code, o = {}) {
  const e = encodeBarcode(code); if (!e) return '';
  const mw = o.module || 2, quiet = 10, h = o.height || 60, fs = o.fontSize || 12, W = (e.bits.length + quiet * 2) * mw, H = h + (o.noText ? 8 : fs + 10);
  let rects = '', i = 0;
  while (i < e.bits.length) {
    if (e.bits[i] === '1') { let j = i; while (e.bits[j] === '1') j++; rects += `<rect x="${(i + quiet) * mw}" y="4" width="${(j - i) * mw}" height="${h}"/>`; i = j; } else i++;
  }
  const label = o.noText ? '' : `<text x="${W / 2}" y="${h + fs + 5}" text-anchor="middle" font-family="monospace" font-size="${fs}" fill="#000">${String(e.text).replace(/[<>&"]/g, '')}</text>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${o.width || W}" role="img" aria-label="Código de barras ${String(e.text).replace(/[<>&"]/g, '')}"><rect width="${W}" height="${H}" fill="#fff"/><g fill="#000">${rects}</g>${label}</svg>`;
}

/* ── Buscar productos por código (UPC-A y EAN-13 son el mismo código con/sin cero adelante) ── */
var canonCode = c => normCode(c).replace(/^0+(?=\d{7})/, '');
function findByBarcode(code, list) {
  const c = canonCode(code); if (!c) return null;
  return (list || state.products).find(p => p.barcode && canonCode(p.barcode) === c) || null;
}
function barcodeTaken() { return new Set(state.products.map(p => canonCode(p.barcode)).filter(Boolean)); }

/* ── Avisos al leer ── */
function scanBeep(ok = true) {
  try {
    const A = window.AudioContext || window.webkitAudioContext; if (!A) return;
    scanBeep.ctx = scanBeep.ctx || new A();
    const o = scanBeep.ctx.createOscillator(), g = scanBeep.ctx.createGain();
    o.frequency.value = ok ? 1100 : 300; g.gain.value = .08; o.connect(g); g.connect(scanBeep.ctx.destination);
    o.start(); o.stop(scanBeep.ctx.currentTime + (ok ? .09 : .25));
  } catch { /* sin audio */ }
  try { navigator.vibrate && navigator.vibrate(ok ? 40 : [60, 40, 60]); } catch { /* nada */ }
}

/* ── Cámara ── */
var zxingP = null;
function loadZXing() {
  if (window.ZXing) return Promise.resolve(window.ZXing);
  return zxingP || (zxingP = new Promise((res, rej) => {
    const s = document.createElement('script'); s.src = 'https://unpkg.com/@zxing/library@0.21.3/umd/index.min.js';
    s.onload = () => window.ZXing ? res(window.ZXing) : rej(new Error('zxing')); s.onerror = () => { zxingP = null; rej(new Error('zxing')); };
    document.head.appendChild(s);
  }));
}
var BC_FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'itf'];
/* Arranca la cámara en <video>. Devuelve una función stop(). onCode(texto) se llama por cada lectura. */
async function startCamera(video, onCode) {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error('nocam');
  const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
  video.srcObject = stream; video.setAttribute('playsinline', ''); video.muted = true;
  await video.play().catch(() => {});
  let stopped = false, timer = 0, reader = null;
  const stop = () => { stopped = true; clearInterval(timer); try { reader && reader.reset(); } catch { /* nada */ } stream.getTracks().forEach(t => t.stop()); video.srcObject = null; };
  if ('BarcodeDetector' in window) {
    let fm = BC_FORMATS; try { const sup = await BarcodeDetector.getSupportedFormats(); fm = BC_FORMATS.filter(f => sup.includes(f)); } catch { /* usa todos */ }
    if (fm.length) {
      const det = new BarcodeDetector({ formats: fm }); let busy = false;
      timer = setInterval(async () => {
        if (busy || stopped || video.readyState < 2) return; busy = true;
        try { const r = await det.detect(video); if (r && r[0] && r[0].rawValue) onCode(r[0].rawValue); } catch { /* frame inválido */ }
        busy = false;
      }, 180);
      return stop;
    }
  }
  try {
    const Z = await loadZXing();
    reader = new Z.BrowserMultiFormatReader(new Map([[Z.DecodeHintType.POSSIBLE_FORMATS, [Z.BarcodeFormat.EAN_13, Z.BarcodeFormat.EAN_8, Z.BarcodeFormat.UPC_A, Z.BarcodeFormat.UPC_E, Z.BarcodeFormat.CODE_128, Z.BarcodeFormat.CODE_39, Z.BarcodeFormat.ITF]], [Z.DecodeHintType.TRY_HARDER, true]]));
    reader.decodeFromStream(stream, video, (r) => { if (r && !stopped) onCode(r.getText()); });
  } catch (e) { stop(); throw new Error('nolib'); }
  return stop;
}

/* ── Ventana de escaneo ──
   opts: { title, hint, modes:[{id,label}], onCode(code, mode, qty) -> string|{msg,ok}|Promise, keep:true para seguir leyendo } */
var scanState = null;
function openScanner(opts) {
  closeScanner();
  let d = $('#dlgScan'); if (!d) { d = document.createElement('dialog'); d.id = 'dlgScan'; document.body.appendChild(d); d.addEventListener('close', closeScanner); }
  const modes = opts.modes || [];
  d.innerHTML = `<div class="dlg-in scan"><button type="button" class="dlg-x" data-act="bcClose" aria-label="Cerrar">×</button><h2>${esc(opts.title || 'Escanear código')}</h2>
    ${modes.length ? `<div class="scan-modes" role="radiogroup" aria-label="Qué hacer al escanear">${modes.map((m, i) => `<label><input type="radio" name="scm" value="${m.id}" ${i === 0 ? 'checked' : ''}><span>${esc(m.label)}</span></label>`).join('')}<label class="scan-qty">Cantidad <input class="in" id="scQty" type="number" min="1" max="999" value="1"></label></div>` : ''}
    <div class="scan-v" id="scV" hidden><video id="scVideo" playsinline muted></video><i class="scan-line"></i></div>
    <p class="muted" id="scMsg" role="status">${esc(opts.hint || 'Apuntá la cámara al código de barras, o usá tu lector USB.')}</p>
    <div class="row scan-in"><input class="in" id="scIn" inputmode="text" autocomplete="off" autocapitalize="none" placeholder="Escaneá con el lector o escribí el código y Enter" aria-label="Código de barras"><button type="button" class="btn btn-primary" data-act="bcManual">Buscar</button></div>
    <div class="row" style="margin-top:8px"><button type="button" class="btn btn-line btn-sm" data-act="bcCam" id="scCamBtn">Usar la cámara</button><label class="btn btn-line btn-sm">Foto del código<input type="file" accept="image/*" class="sr" data-act="bcPhoto"></label></div>
    <ul class="scan-log" id="scLog" aria-live="polite"></ul></div>`;
  scanState = { opts, stop: null, last: '', lastAt: 0, queue: Promise.resolve(), d };
  d.showModal();
  setTimeout(() => { const i = $('#scIn'); i && i.focus(); }, 50);
  if (!opts.noAuto && navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.isSecureContext) bcCamera();
  else if (!window.isSecureContext) bcMsg('La cámara solo funciona con la tienda publicada (https). Podés usar el lector USB o escribir el código.', true);
  return d;
}
function closeScanner() {
  if (!scanState) return;
  const s = scanState; scanState = null; try { s.stop && s.stop(); } catch { /* nada */ }
  if (s.d && s.d.open) s.d.close();
}
function bcMsg(m, bad) { const e = $('#scMsg'); if (e) { e.textContent = m; e.classList.toggle('err', !!bad); } }
async function bcCamera() {
  const s = scanState; if (!s) return;
  const v = $('#scVideo'), box = $('#scV'), btn = $('#scCamBtn');
  btn && (btn.disabled = true);
  try {
    s.stop = await startCamera(v, c => bcHandle(c, true)); box.hidden = false; btn && (btn.hidden = true);
  } catch (e) {
    btn && (btn.disabled = false);
    bcMsg(e.message === 'nolib' ? 'No se pudo cargar el lector de cámara (¿sin internet?). Usá el lector USB, una foto o escribí el código.' : 'No pudimos abrir la cámara. Revisá el permiso del navegador, o usá el lector USB / escribí el código.', true);
  }
}
/* Procesa un código leído (de cámara, lector o texto) */
function bcHandle(raw, fromCam) {
  const s = scanState; if (!s) return; const code = normCode(raw); if (!code) return;
  const now = Date.now();
  if (fromCam && code === s.last && now - s.lastAt < 2500) return; // la cámara lee el mismo código muchas veces
  s.last = code; s.lastAt = now;
  const mode = (($('input[name=scm]:checked') || {}).value) || '', qty = Math.max(1, Math.min(999, Math.floor(Number(($('#scQty') || {}).value) || 1)));
  s.queue = s.queue.then(async () => {
    if (scanState !== s) return;
    let r; try { r = await s.opts.onCode(code, mode, qty); } catch (e) { console.error(e); r = { msg: 'Error: ' + (e.message || 'no se pudo procesar'), ok: false }; }
    if (typeof r === 'string') r = { msg: r, ok: true };
    r = r || { msg: code, ok: true };
    scanBeep(r.ok !== false); bcMsg(r.msg, r.ok === false);
    const log = $('#scLog'); if (log) { const li = document.createElement('li'); li.className = r.ok === false ? 'bad' : ''; li.textContent = `${r.ok === false ? '✕' : '✓'} ${r.msg}`; log.prepend(li); while (log.children.length > 30) log.lastChild.remove(); }
    if (!s.opts.keep && r.ok !== false && scanState === s) closeScanner();
  });
}
async function bcPhoto(file) {
  try {
    const bmp = await createImageBitmap(file);
    if ('BarcodeDetector' in window) {
      const det = new BarcodeDetector(); const r = await det.detect(bmp);
      if (r && r[0]) return bcHandle(r[0].rawValue);
    } else {
      const Z = await loadZXing(), cv = document.createElement('canvas'); cv.width = bmp.width; cv.height = bmp.height; cv.getContext('2d').drawImage(bmp, 0, 0);
      const rd = new Z.BrowserMultiFormatReader(); const r = await rd.decodeFromImageUrl(cv.toDataURL('image/png')); if (r) return bcHandle(r.getText());
    }
    bcMsg('No se encontró ningún código en la foto. Probá con una más cerca y nítida.', true);
  } catch (e) { console.error(e); bcMsg('No se pudo leer la foto. Probá con otra más nítida.', true); }
}

/* ── Lector USB / Bluetooth (emula un teclado: escribe el código muy rápido y termina con Enter) ── */
(function wedge() {
  let buf = '', last = 0, fast = 0;
  document.addEventListener('keydown', e => {
    const t = e.target, tag = t && t.tagName, typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (t && t.isContentEditable);
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const now = Date.now(), gap = now - last; last = now;
    if (e.key === 'Enter') {
      const code = buf; buf = ''; const fastEnough = fast >= code.length - 1;
      if (code.length >= 6 && fastEnough && !typing && !scanState) { e.preventDefault(); onWedgeScan(code); }
      fast = 0; return;
    }
    if (e.key.length !== 1) return;
    if (gap > 60) { buf = ''; fast = 0; } else fast++;
    buf += e.key;
    if (buf.length > 64) buf = '';
  }, true);
})();
function onWedgeScan(code) {
  if (state.route && state.route.name === 'admin' && state.user) return adminScan(code);
  storeScan(code);
}
/* Tienda: abre el producto con ese código */
function storeScan(code) {
  const p = findByBarcode(code, activeProducts());
  if (p) { scanBeep(true); if ($('#dlgScan') && $('#dlgScan').open) closeScanner(); openProduct(p.id); return { msg: p.name, ok: true }; }
  scanBeep(false); toast('No encontramos un producto con ese código.', { bad: true }); return { msg: 'No encontramos un producto con el código ' + code, ok: false };
}
function openStoreScanner() { openScanner({ title: 'Escanear producto', hint: 'Apuntá la cámara al código de barras del producto.', onCode: c => storeScan(c) }); }

/* ── Etiquetas para imprimir ── */
function labelsHtml(items, size) {
  const one = size === 'a4' ? { w: '47mm', h: '27mm', bw: 40 } : size === 'big' ? { w: '70mm', h: '40mm', bw: 56 } : { w: '50mm', h: '30mm', bw: 44 };
  const cells = items.map(({ p, n }) => Array.from({ length: n }, () => `<div class="l"><b>${esc(String(p.name).slice(0, 48))}</b>${p.price && !p.hidePrice ? `<i>${esc(money(p.price))}</i>` : ''}${barcodeSvg(p.barcode, { module: 2, height: 52, fontSize: 13, width: '100%' })}</div>`).join('')).join('');
  const page = size === 'a4' ? '@page{size:A4;margin:8mm}.wrap{display:grid;grid-template-columns:repeat(4,47mm);gap:2mm;justify-content:center}' : `@page{size:${one.w} ${one.h};margin:0}.wrap{display:block}.l{page-break-after:always}`;
  return `<!doctype html><meta charset="utf-8"><title>Etiquetas</title><style>${page}
    body{margin:0;font-family:system-ui,sans-serif}.l{box-sizing:border-box;width:${one.w};height:${one.h};padding:1.5mm 2mm;overflow:hidden;display:flex;flex-direction:column;justify-content:center;align-items:center;text-align:center;${size === 'a4' ? 'outline:.2mm dotted #bbb;' : ''}}
    .l b{font-size:8pt;line-height:1.1;max-height:2.3em;overflow:hidden}.l i{font-style:normal;font-size:9pt;font-weight:700}.l svg{width:92%;height:auto;max-height:${size === 'a4' ? '16mm' : '58%'}}</style><div class="wrap">${cells}</div>`;
}
function printLabels(items, size) {
  const f = document.createElement('iframe'); f.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0'; document.body.appendChild(f);
  f.srcdoc = labelsHtml(items, size);
  f.onload = () => { try { f.contentWindow.focus(); f.contentWindow.print(); } catch (e) { toast('No se pudo abrir la impresión.', { bad: true }); } setTimeout(() => f.remove(), 60000); };
}

/* ── Eventos propios (data-act="bc…") ── */
document.addEventListener('click', e => {
  const t = e.target.closest('[data-act^="bc"]'); if (!t) return;
  const a = t.dataset.act;
  if (a === 'bcClose') closeScanner();
  else if (a === 'bcCam') bcCamera();
  else if (a === 'bcManual') { const i = $('#scIn'); if (i && i.value.trim()) { bcHandle(i.value); i.value = ''; i.focus(); } }
  else if (a === 'bcStoreScan') openStoreScanner();
});
document.addEventListener('change', e => { const t = e.target; if (t && t.dataset && t.dataset.act === 'bcPhoto') { const f = t.files[0]; t.value = ''; f && bcPhoto(f); } });
document.addEventListener('keydown', e => {
  if (e.key === 'Enter' && e.target && e.target.id === 'scIn') { e.preventDefault(); const i = e.target; if (i.value.trim()) { bcHandle(i.value); i.value = ''; } }
});

/* Botón de escaneo en la barra de búsqueda (solo si el navegador tiene cámara) */
if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) { const b = document.getElementById('scanBtn'); if (b) b.hidden = false; }
