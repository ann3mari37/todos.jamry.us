// Post-process the web export for Cloudflare Pages.
// Pages skips any `node_modules` directory on upload, so Expo's bundled assets under
// dist/assets/node_modules (fonts, icons) would 404 and fall through to index.html.
import { cpSync, existsSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const dist = 'dist';
const from = join(dist, 'assets', 'node_modules');
const to = join(dist, 'assets', 'vendor');

if (existsSync(from)) {
  renameSync(from, to);
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(js|html|json|css|map)$/.test(name)) {
        const src = readFileSync(p, 'utf8');
        const out = src.replaceAll('/assets/node_modules/', '/assets/vendor/');
        if (out !== src) writeFileSync(p, out);
      }
    }
  };
  walk(dist);
}

if (existsSync('public/_redirects')) cpSync('public/_redirects', join(dist, '_redirects'));
