// Genera demo/ : una copia de la tienda que funciona sin Firebase (datos en el navegador del visitante),
// con datos de ejemplo y una cinta que explica cómo entrar al panel. Se publica en GitHub Pages aparte.
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..'), out = path.join(root, 'demo');
fs.rmSync(out, { recursive: true, force: true }); fs.mkdirSync(out);
fs.copyFileSync(path.join(root, 'docs/index.html'), path.join(out, 'index.html'));
if (fs.existsSync(path.join(root, 'docs/og.png'))) fs.copyFileSync(path.join(root, 'docs/og.png'), path.join(out, 'og.png'));
fs.writeFileSync(path.join(out, 'firebase-config.js'), 'window.FIREBASE_CONFIG = {};\n');
let cfg = fs.readFileSync(path.join(root, 'docs/negocio.config.js'), 'utf8');
cfg = cfg.replace(/sampleData:\s*(true|false)/, 'sampleData: true').replace('window.NEGOCIO = {', 'window.NEGOCIO = {\n  demo: true,');
fs.writeFileSync(path.join(out, 'negocio.config.js'), cfg);
console.log('demo/ listo: subila a un repositorio aparte con GitHub Pages.');
