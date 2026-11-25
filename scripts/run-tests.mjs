// LOADCALC test runner.
// 1. node:test files under tests/ (*.test.js, *.test.mjs).
// 2. Standalone check scripts listed in scripts/check-manifest.json; each must exit 0.
// Usage: node scripts/run-tests.mjs [--only-tests | --only-checks] [filter]
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';

const args = process.argv.slice(2);
const filter = args.find((a) => !a.startsWith('--')) ?? '';
const runTests = !args.includes('--only-checks');
const runChecks = !args.includes('--only-tests');
const TIMEOUT_MS = 180000;
const CONCURRENCY = Math.max(2, Math.min(8, os.cpus().length - 1));

const tests = fs.readdirSync('tests')
  .filter((f) => /\.test\.m?js$/.test(f))
  .map((f) => `tests/${f}`)
  .filter((f) => f.includes(filter))
  .sort();
const checks = JSON.parse(fs.readFileSync('scripts/check-manifest.json', 'utf8'))
  .filter((f) => f.includes(filter));

function run(entry, argv) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, argv, { env: { ...process.env, CI: '1' } });
    let output = '';
    child.stdout.on('data', (d) => { output += d; });
    child.stderr.on('data', (d) => { output += d; });
    const timer = setTimeout(() => { output += '\n[TIMEOUT]'; child.kill(); }, TIMEOUT_MS);
    child.on('close', (code) => { clearTimeout(timer); resolve({ entry, ok: code === 0, output }); });
  });
}

const jobs = [
  ...(runTests ? tests.map((t) => [t, ['--test', '--test-reporter=dot', t]]) : []),
  ...(runChecks ? checks.map((c) => [c, [c]]) : []),
];
const failures = [];
let done = 0;
const queue = [...jobs];
await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
  while (queue.length) {
    const [entry, argv] = queue.shift();
    const result = await run(entry, argv);
    done += 1;
    process.stdout.write(result.ok ? '.' : 'F');
    if (done % 60 === 0) process.stdout.write(` ${done}/${jobs.length}\n`);
    if (!result.ok) failures.push(result);
  }
}));

process.stdout.write(`\n\n${jobs.length - failures.length}/${jobs.length} passed\n`);
for (const f of failures) {
  process.stdout.write(`\n--- FAIL ${f.entry}\n${f.output.slice(-2000)}\n`);
}
process.exitCode = failures.length ? 1 : 0;
