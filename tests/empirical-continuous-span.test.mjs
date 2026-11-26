import test from 'node:test';
import assert from 'node:assert/strict';
import {
  solveContinuousSpan,
  LEVER_OVERHANG_MOMENT_V1,
  THREE_MOMENT_LIFTOFF_V1,
} from '../src/core/empirical-continuous-span/index.js';
import { items, sup, beamLiftoffReleased } from '../benchmarks/checks/route-b2-data.mjs';

const near = (actual, expected, tol, label) => assert.ok(
  Math.abs(actual - expected) <= tol, `${label}: ${actual} vs ${expected}`,
);
const sites = (...x) => x.map((chainageMm, i) => ({ siteId: `S${i}`, chainageMm }));
const r = (result, i) => result.reactionsBySiteId[`S${i}`];

test('two equal spans, uniform load: 3/8, 10/8, 3/8 of wL', () => {
  const result = solveContinuousSpan({ supports: sites(0, 1000, 2000), loads: [{ startMm: 0, endMm: 2000, forceN: 2000 }] });
  near(r(result, 0), 375, 1e-9, 'end');
  near(r(result, 1), 1250, 1e-9, 'middle');
  near(r(result, 2), 375, 1e-9, 'end');
  assert.equal(result.status, 'RESOLVED');
});

test('three equal spans, uniform load: 0.4, 1.1, 1.1, 0.4 of wL', () => {
  const result = solveContinuousSpan({ supports: sites(0, 1000, 2000, 3000), loads: [{ startMm: 0, endMm: 3000, forceN: 3000 }] });
  [400, 1100, 1100, 400].forEach((expected, i) => near(r(result, i), expected, 1e-9, `support ${i}`));
});

test('two equal spans, central point load in one span: 13/32, 22/32, -3/32 then lift-off', () => {
  const loads = [{ chainageMm: 500, forceN: 3200 }];
  const fixed = solveContinuousSpan({ supports: sites(0, 1000, 2000), loads, liftOff: false });
  near(r(fixed, 0), 1300, 1e-9, 'left');
  near(r(fixed, 1), 2200, 1e-9, 'middle');
  near(r(fixed, 2), -300, 1e-9, 'far end pulls down');
  const lifted = solveContinuousSpan({ supports: sites(0, 1000, 2000), loads });
  assert.deepEqual(lifted.releasedSiteIds, ['S2']);
  near(r(lifted, 0), 1600, 1e-9, 'simple span left');
  near(r(lifted, 1), 1600, 1e-9, 'simple span right');
});

test('overhang moment is carried by the end span (method A and B agree on a single span)', () => {
  // Span 0..1000, 100 N at 1500 (500 mm overhang): R1 = 150, R0 = -50 → released under lift-off.
  const loads = [{ chainageMm: 1500, forceN: 100 }];
  const a = solveContinuousSpan({ supports: sites(0, 1000), loads, method: LEVER_OVERHANG_MOMENT_V1 });
  near(r(a, 0), -50, 1e-9, 'A back support');
  near(r(a, 1), 150, 1e-9, 'A end support');
  const b = solveContinuousSpan({ supports: sites(0, 1000), loads });
  assert.equal(b.status, 'SINGLE_SUPPORT_MOMENT_UNRESOLVED');
  near(b.unresolvedMomentNmm, 100 * 500, 1e-9, 'cantilever moment left unresolved');
});

test('per-load contributions sum to the total reactions', () => {
  const loads = [
    { startMm: 0, endMm: 3000, forceN: 3000 },
    { chainageMm: 2600, forceN: 5000 },
    { chainageMm: 3400, forceN: 800 },
  ];
  const result = solveContinuousSpan({ supports: sites(0, 1200, 2000, 3000), loads });
  for (const siteId of Object.keys(result.reactionsBySiteId)) {
    const sum = result.contributions.reduce((acc, row) => acc + row.reactionsBySiteId[siteId], 0);
    near(sum, result.reactionsBySiteId[siteId], 1e-6, siteId);
  }
  const total = Object.values(result.reactionsBySiteId).reduce((acc, value) => acc + value, 0);
  near(total, 8800, 1e-6, 'force equilibrium');
});

test('coincident supports share one station and split its reaction', () => {
  const result = solveContinuousSpan({
    supports: [{ siteId: 'A', chainageMm: 0 }, { siteId: 'B1', chainageMm: 1000 }, { siteId: 'B2', chainageMm: 1000.4 }],
    loads: [{ startMm: 0, endMm: 1000, forceN: 1000 }],
  });
  assert.deepEqual(result.coincidentGroups, [['B1', 'B2']]);
  near(result.reactionsBySiteId.B1, result.reactionsBySiteId.B2, 1e-12, 'equal split');
  // The station sits at the members' mean chainage (1000.2 mm), so the span is 0.02 % longer.
  near(result.reactionsBySiteId.B1 + result.reactionsBySiteId.B2, 500, 0.2, 'shared station');
});

test('1885S route B2 matches the independent continuous beam within 1 %', () => {
  const g = 9.80665;
  const loads = items.map(([kg, a, b, distributed]) => (distributed && b > a
    ? { startMm: a, endMm: b, forceN: kg * g }
    : { chainageMm: (a + b) / 2, forceN: kg * g }));
  const result = solveContinuousSpan({ supports: sites(...sup), loads, method: THREE_MOMENT_LIFTOFF_V1 });
  assert.deepEqual(result.releasedSiteIds, ['S4']);
  beamLiftoffReleased.forEach((expected, i) => {
    if (expected === 0) near(r(result, i), 0, 1e-9, `support ${i}`);
    else near(r(result, i) / expected, 1, 0.01, `support ${i}`);
  });
});
