/* Genera páginas estáticas por producto (para Google y vistas previas de WhatsApp/Facebook), sitemap.xml y robots.txt.
   Uso:  node scripts/make-seo.js respaldo-2026-01-01.json https://tuusuario.github.io/tienda/
   (el respaldo se descarga desde el panel → Ajustes → Descargar respaldo). Volvé a correrlo cuando cambie el catálogo. */
const fs = require('fs'), path = require('path');
const [file, siteArg] = process.argv.slice(2);
if (!file) { console.error('Uso: node scripts/make-seo.js respaldo.json https://tu-sitio/'); process.exit(1); }
const bk = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')), d = bk.data || {};
const site = String(siteArg || (d.settings && d.settings.siteUrl) || '').replace(/\/?$/, '/');
if (!/^https?:\/\//.test(site)) { console.error('Falta la dirección web (https://…/)'); process.exit(1); }
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const store = (d.settings && d.settings.storeName) || 'Tienda', out = path.join(__dirname, '..', 'docs');
const prods = (d.products || []).filter(p => p.active !== false && p.id);
const rev = {}; (d.reviews || []).filter(r => r.status === 'approved').forEach(r => { (rev[r.productId] = rev[r.productId] || []).push(+r.rating || 0); });
const urls = [site];
for (const p of prods) {
  const dir = path.join(out, 'p', String(p.id).replace(/[^\w.-]/g, '_')); fs.mkdirSync(dir, { recursive: true });
  const img = (Array.isArray(p.images) && p.images[0]) || p.image || '', ok = /^https:\/\//.test(img), url = site + 'p/' + encodeURIComponent(p.id) + '/';
  const stock = p.stock == null || p.stock === '' ? 1 : Number(p.stock), desc = String(p.description || p.name).slice(0, 300), r = rev[p.id] || [];
  const ld = { '@context': 'https://schema.org', '@type': 'Product', name: p.name, description: desc, sku: p.id, ...(p.brand ? { brand: { '@type': 'Brand', name: p.brand } } : {}), ...(ok ? { image: [img] } : {}),
    ...(!p.hidePrice && !p.catalogOnly ? { offers: { '@type': 'Offer', priceCurrency: 'UYU', price: String(Number(p.price) || 0), availability: stock > 0 ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock', url } } : {}),
    ...(r.length ? { aggregateRating: { '@type': 'AggregateRating', ratingValue: (r.reduce((a, b) => a + b, 0) / r.length).toFixed(1), reviewCount: r.length } } : {}) };
  fs.writeFileSync(path.join(dir, 'index.html'), `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(p.name)} · ${esc(store)}</title><meta name="description" content="${esc(desc.slice(0, 155))}"><link rel="canonical" href="${esc(url)}">
<meta property="og:type" content="product"><meta property="og:title" content="${esc(p.name)}"><meta property="og:description" content="${esc(desc.slice(0, 155))}"><meta property="og:url" content="${esc(url)}">${ok ? `<meta property="og:image" content="${esc(img)}">` : ''}
<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, '\\u003c')}</script>
<script>location.replace(${JSON.stringify(site)} + '#/p/' + encodeURIComponent(${JSON.stringify(p.id)}));</script></head>
<body><h1>${esc(p.name)}</h1><p>${esc(desc)}</p>${!p.hidePrice && !p.catalogOnly ? `<p>Precio: $ ${esc(p.price)}</p>` : ''}<p><a href="${esc(site)}#/p/${encodeURIComponent(p.id)}">Ver en la tienda ${esc(store)}</a></p></body></html>`);
  urls.push(url);
}
fs.writeFileSync(path.join(out, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map(u => `  <url><loc>${esc(u)}</loc></url>`).join('\n')}\n</urlset>\n`);
fs.writeFileSync(path.join(out, 'robots.txt'), `User-agent: *\nAllow: /\nSitemap: ${site}sitemap.xml\n`);
console.log(`OK: ${prods.length} páginas de producto + sitemap.xml + robots.txt en docs/ (${site})`);
