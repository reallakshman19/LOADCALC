// Find upstream test/check files whose whole import graph stays inside this app.
// Usage: node scripts/qualify-upstream-tests.mjs <upstreamRoot> > qualified.json
// A candidate qualifies when every src/ file it reaches already exists in this
// app's src/. Non-src helpers it reaches (tests/, scripts/, fixtures) are listed
// so they can be copied alongside it.
import fs from 'node:fs';
import path from 'node:path';

const upstream = path.resolve(process.argv[2] || '_source');
const app = process.cwd();
const SPEC_RE = [
  /\bimport\s+(?:[\w*{}\s,$]+?\s+from\s+)?['"]([^'"]+)['"]/g,
  /\bexport\s+(?:\*(?:\s+as\s+\w+)?|\{[^}]*\})\s+from\s+['"]([^'"]+)['"]/g,
  /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  /new\s+URL\(\s*['"]([^'"]+)['"]\s*,\s*import\.meta\.url\s*\)/g,
];
const exists = (p) => fs.existsSync(p) && fs.statSync(p).isFile();

function resolve(fromRel, spec) {
  const base = path.posix.normalize(path.posix.join(path.posix.dirname(fromRel), spec.split('?')[0]));
  for (const cand of [base, `${base}.js`, `${base}.mjs`, `${base}/index.js`]) {
    if (exists(path.join(upstream, cand))) return cand;
  }
  return null;
}

function closure(entry) {
  const seen = new Set();
  const missing = [];
  const bare = new Set();
  const stack = [entry];
  while (stack.length) {
    const rel = stack.pop();
    if (seen.has(rel)) continue;
    seen.add(rel);
    if (!/\.(m?js)$/.test(rel)) continue;
    const text = fs.readFileSync(path.join(upstream, rel), 'utf8');
    for (const re of SPEC_RE) {
      for (const m of text.matchAll(re)) {
        const spec = m[1];
        if (spec.startsWith('.')) {
          const target = resolve(rel, spec);
          if (target) stack.push(target); else missing.push(`${rel} -> ${spec}`);
        } else if (!spec.startsWith('node:') && !spec.startsWith('http')) {
          bare.add(spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0]);
        }
      }
    }
  }
  return { seen, missing, bare };
}

const candidates = [];
for (const dir of ['tests', 'test']) {
  for (const f of fs.readdirSync(path.join(upstream, dir))) {
    if (/\.test\.m?js$/.test(f)) candidates.push(`${dir}/${f}`);
  }
}
for (const f of fs.readdirSync(path.join(upstream, 'scripts'))) {
  if (/(check|guard|test)[^/]*\.mjs$/.test(f)) candidates.push(`scripts/${f}`);
}

const allowedBare = new Set(['three', 'xlsx', 'papaparse']);
const qualified = [];
const rejected = { outsideApp: 0, missing: 0, bare: 0, noSrc: 0 };
for (const entry of candidates) {
  const { seen, missing, bare } = closure(entry);
  const src = [...seen].filter((f) => f.startsWith('src/'));
  if (missing.length) { rejected.missing += 1; continue; }
  if ([...bare].some((b) => !allowedBare.has(b))) { rejected.bare += 1; continue; }
  if (!src.length) { rejected.noSrc += 1; continue; }
  if (src.some((f) => !exists(path.join(app, f)))) { rejected.outsideApp += 1; continue; }
  qualified.push({ entry, helpers: [...seen].filter((f) => !f.startsWith('src/') && f !== entry).sort(), srcCount: src.length });
}
process.stderr.write(`candidates=${candidates.length} qualified=${qualified.length} rejected=${JSON.stringify(rejected)}\n`);
process.stdout.write(JSON.stringify(qualified, null, 1));
