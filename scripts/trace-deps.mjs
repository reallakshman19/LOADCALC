// Trace the static + dynamic import closure of an app entry.
// Usage: node trace-deps.mjs <appRoot> <sourceRoot> <entry...>
// Files present under appRoot override the same path under sourceRoot.
import fs from 'node:fs';
import path from 'node:path';

const [appRoot, sourceRoot, ...entries] = process.argv.slice(2);
const SPEC_RE = [
  /\bimport\s+(?:[\w*{}\s,$]+?\s+from\s+)?['"]([^'"]+)['"]/g,
  /\bexport\s+(?:\*(?:\s+as\s+\w+)?|\{[^}]*\})\s+from\s+['"]([^'"]+)['"]/g,
  /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  /new\s+URL\(\s*['"]([^'"]+)['"]\s*,\s*import\.meta\.url\s*\)/g,
];
const CSS_RE = [/@import\s+(?:url\()?['"]([^'"]+)['"]/g, /url\(\s*['"]?(\.{1,2}\/[^'")]+)['"]?\s*\)/g];

const seen = new Set();
const bare = new Map();
const unresolved = [];
const dynamicNonLiteral = [];

function physical(rel) {
  const a = path.join(appRoot, rel);
  if (fs.existsSync(a) && fs.statSync(a).isFile()) return a;
  const s = path.join(sourceRoot, rel);
  if (fs.existsSync(s) && fs.statSync(s).isFile()) return s;
  return null;
}
function resolveRel(fromRel, spec) {
  const clean = spec.split('?')[0];
  const base = path.posix.normalize(path.posix.join(path.posix.dirname(fromRel), clean));
  for (const cand of [base, `${base}.js`, `${base}.mjs`, `${base}/index.js`]) {
    if (physical(cand)) return cand;
  }
  return null;
}
function visit(rel) {
  if (seen.has(rel)) return;
  seen.add(rel);
  const file = physical(rel);
  const ext = path.extname(rel);
  if (!['.js', '.mjs', '.css'].includes(ext)) return;
  let text = fs.readFileSync(file, 'utf8');
  if (ext !== '.css' && /import\(\s*[^'"\s)]/.test(text.replace(/\/\/.*$/gm, ''))) {
    const m = text.match(/import\(\s*[^'"\s)][^)]{0,60}/g);
    if (m) dynamicNonLiteral.push(`${rel}: ${m.join(' | ')}`);
  }
  for (const re of ext === '.css' ? CSS_RE : SPEC_RE) {
    for (const m of text.matchAll(re)) {
      const spec = m[1];
      if (spec.startsWith('.') || spec.startsWith('/')) {
        const target = spec.startsWith('/') ? spec.slice(1) : resolveRel(rel, spec);
        if (target && physical(target)) visit(target);
        else unresolved.push(`${rel} -> ${spec}`);
      } else if (!spec.startsWith('http') && !spec.startsWith('data:') && !spec.startsWith('node:')) {
        const pkg = spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0];
        if (!bare.has(pkg)) bare.set(pkg, new Set());
        bare.get(pkg).add(rel);
      } else if (spec.startsWith('node:')) {
        if (!bare.has(spec)) bare.set(spec, new Set());
        bare.get(spec).add(rel);
      }
    }
  }
}
entries.forEach(visit);
const out = {
  files: [...seen].sort(),
  bare: Object.fromEntries([...bare].map(([k, v]) => [k, [...v].sort()])),
  unresolved,
  dynamicNonLiteral,
};
fs.writeFileSync(path.join(process.env.OUT_DIR || '.', 'trace.json'), JSON.stringify(out, null, 1));
console.log(`files=${out.files.length} bare=${Object.keys(out.bare).join(',')} unresolved=${unresolved.length} dynNonLiteral=${dynamicNonLiteral.length}`);
