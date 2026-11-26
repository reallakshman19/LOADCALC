// Compare empirical vertical methods on route S8811951/B2 (1885S, EMPTY)
// against the independent continuous beam (lift-off released).
// Usage: node benchmarks/checks/route-b2-empirical-methods.mjs
import { items, sup, v2, beamLiftoffReleased } from './route-b2-data.mjs';
import {
  solveContinuousSpan,
  LEVER_OVERHANG_MOMENT_V1,
  THREE_MOMENT_LIFTOFF_V1,
} from '../../src/core/empirical-continuous-span/index.js';

const g = 9.80665;
const supports = sup.map((chainageMm, i) => ({ siteId: `S${i}`, chainageMm }));
const loads = items.map(([kg, a, b, distributed]) => (distributed && b > a
  ? { startMm: a, endMm: b, forceN: kg * g }
  : { chainageMm: (a + b) / 2, forceN: kg * g }));

const rows = [
  ['V2 tributary (current Run)', v2],
  ['A lever + overhang moment', values(solveContinuousSpan({ supports, loads, method: LEVER_OVERHANG_MOMENT_V1 }))],
  ['B three-moment + lift-off', values(solveContinuousSpan({ supports, loads, method: THREE_MOMENT_LIFTOFF_V1 }))],
];

console.log('support ch (mm)'.padEnd(30), sup.map((x) => x.toFixed(0).padStart(7)).join(''));
console.log('beam reference (N)'.padEnd(30), beamLiftoffReleased.map((x) => String(x).padStart(7)).join(''));
for (const [name, r] of rows) {
  console.log(name.padEnd(30), r.map((x) => x.toFixed(0).padStart(7)).join(''));
  console.log('  error vs beam'.padEnd(30), r.map((x, i) => (beamLiftoffReleased[i]
    ? `${((x / beamLiftoffReleased[i] - 1) * 100).toFixed(1)}%`
    : (Math.abs(x) < 1 ? '0' : 'lift')).padStart(7)).join(''));
}

function values(result) {
  return supports.map((row) => result.reactionsBySiteId[row.siteId]);
}
