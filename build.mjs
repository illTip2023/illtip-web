// Build: node build.mjs [--watch] [--prod]
// Bundles src/main.tsx with esbuild into dist/ (app.js, app.css, index.html, static files from public/).
// --base=/app/ serves the app under a sub-path (preview); default '/'.
// --prod makes the LIVE backend the default (only after Bosun approves); otherwise the default is the DEV backend.
// Mixpanel analytics are compiled in only for --prod with --base=/ (the live www.illtip.com build).
// Locally, packages resolve from node_modules or NODE_PATH (e.g. /opt/npm-tools/node_modules).
import { build, context } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';

const watch = process.argv.includes('--watch');
const prod = process.argv.includes('--prod');
const baseArg = (process.argv.find((a) => a.startsWith('--base=')) || '--base=/').slice(7);
const base = baseArg.endsWith('/') ? baseArg : baseArg + '/';
const out = 'dist';
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
for (const f of fs.readdirSync('public')) fs.copyFileSync(path.join('public', f), path.join(out, f));
const stamp = Date.now().toString(36);
fs.writeFileSync(path.join(out, 'index.html'), fs.readFileSync('index.html', 'utf8').replaceAll('__BUILD__', stamp).replaceAll('__BASE__', base).replace(prod ? /\s*<meta name="robots" content="noindex" \/>/ : /$^/, ''));

const opts = {
  entryPoints: { app: 'src/main.tsx' },
  bundle: true,
  outdir: out,
  format: 'iife',
  target: ['es2020'],
  jsx: 'automatic',
  minify: !watch,
  sourcemap: watch ? 'inline' : false,
  loader: { '.png': 'file', '.svg': 'file', '.jpg': 'file' },
  define: {
    'process.env.NODE_ENV': watch ? '"development"' : '"production"',
    'globalThis.__ILLTIP_DEFAULT_ENV__': prod ? '"PROD"' : '"DEV"',
    // Mixpanel (src/lib/analytics.ts) only in the live build: --prod served at the site root.
    // Preview builds under a sub-path (--base=/web/) and dev builds never load it.
    'globalThis.__ILLTIP_ANALYTICS__': prod && base === '/' ? 'true' : 'false',
  },
  nodePaths: (process.env.NODE_PATH || '').split(':').filter(Boolean),
  logLevel: 'info',
};

if (watch) {
  const ctx = await context(opts);
  await ctx.watch();
  const { port } = await ctx.serve({ servedir: out, port: 5173 });
  console.log(`dev server http://localhost:${port}`);
} else {
  await build(opts);
  console.log(`built ${out}/ (${prod ? 'PROD' : 'DEV'} default backend, analytics ${prod && base === '/' ? 'ON' : 'off'})`);
}
