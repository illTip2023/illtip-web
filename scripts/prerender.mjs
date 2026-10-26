// Pre-renders the public pages of the LIVE package (./live) so search engines see real text, a unique
// <title> and meta description without running JavaScript, and writes sitemap.xml + robots.txt.
// The live backend is never called: every request to the API is blocked while rendering.
// Usage (after build): node scripts/prerender.mjs live
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const ROOT = path.resolve(process.argv[2] || 'live');
const SITE = 'https://www.illtip.com';
const pages = JSON.parse(fs.readFileSync(new URL('../src/seo-pages.json', import.meta.url), 'utf8'));
const shell = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const esc = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

const server = http
  .createServer((req, res) => {
    const u = decodeURIComponent(req.url.split('?')[0]);
    let f = path.join(ROOT, u);
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(ROOT, 'index.html');
    const type = f.endsWith('.js') ? 'text/javascript' : f.endsWith('.css') ? 'text/css' : f.endsWith('.html') ? 'text/html' : 'application/octet-stream';
    res.writeHead(200, { 'content-type': type });
    res.end(f.endsWith('index.html') ? shell : fs.readFileSync(f));
  })
  .listen(0);
const base = `http://localhost:${server.address().port}`;

function page(html, p, body) {
  let out = html
    .replace(/<title>[^<]*<\/title>/, `<title>${esc(p.title)}</title>`)
    .replace(/<meta name="description" content="[^"]*" \/>/, `<meta name="description" content="${esc(p.description)}" />\n    <link rel="canonical" href="${SITE}${p.path === '/' ? '/' : p.path}" />`);
  if (body != null) out = out.replace('<div id="root"></div>', `<div id="root">${body}</div>`);
  return out;
}

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
await ctx.route(/illtipadmins\.com/, (r) => r.abort());
for (const p of pages) {
  let body = null;
  if (p.path !== '/' && p.path !== '/information') {
    const tab = await ctx.newPage();
    await tab.goto(base + p.path, { waitUntil: 'networkidle' });
    await tab.waitForTimeout(500);
    const at = new URL(tab.url()).pathname;
    if (at !== p.path) throw new Error(`${p.path} redirected to ${at}; not pre-rendering it`);
    body = await tab.evaluate(() => document.getElementById('root').innerHTML);
    await tab.close();
  }
  const html = page(shell, p, body);
  const file = p.path === '/' ? path.join(ROOT, 'index.html') : path.join(ROOT, p.path, 'index.html');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, html);
  console.log('prerendered', p.path, body ? `${body.length} chars` : '(head only)');
}
await browser.close();
server.close();

const today = new Date().toISOString().slice(0, 10);
fs.writeFileSync(
  path.join(ROOT, 'sitemap.xml'),
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    pages.map((p) => `  <url><loc>${SITE}${p.path}</loc><lastmod>${today}</lastmod></url>`).join('\n') +
    `\n</urlset>\n`
);
fs.writeFileSync(path.join(ROOT, 'robots.txt'), `User-agent: *\nAllow: /\n\nSitemap: ${SITE}/sitemap.xml\nSitemap: https://jobs.illtip.com/sitemap.xml\n`);
console.log('wrote sitemap.xml and robots.txt');
