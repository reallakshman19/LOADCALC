// End to end, no browser: Sjson.json + bundled masters + the sample Line List
// in the repo -> Run (Option B) -> friction, line stops, guides -> Results pane.
// Same steps as benchmarks/browser/1885s-run-steps.js. Hand checks in
// tests/e2e/checks-1885s.mjs; expected numbers in tests/e2e/expected-1885s.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { runHeadless1885S, SAMPLE_LINE_LIST } from './e2e/headless-1885s-run.mjs';
import { SAMPLE_EXPECTED } from './e2e/expected-1885s.mjs';
import {
  checkFriction, checkGuides, checkInputs, checkLineStops, checkRestraintTable, checkResultsPane, checkVertical, near,
} from './e2e/checks-1885s.mjs';

const result = await runHeadless1885S({ lineListPath: SAMPLE_LINE_LIST });

test('1885S sample: inputs reach a READY seal and the AUTO method is Option B', () => {
  checkInputs(result, SAMPLE_EXPECTED.proposals);
});

test('1885S sample: vertical totals, m·g per item and Σ reactions = applied (ACCURATE)', () => {
  checkVertical(result, SAMPLE_EXPECTED.appliedN, SAMPLE_EXPECTED.supportVerticalN);
});

test('1885S sample: restraint table, 36 sites', () => {
  checkRestraintTable(result);
});

test('1885S sample: design friction μ·N_OPE (ACCURATE)', () => {
  checkFriction(result, SAMPLE_EXPECTED.frictionTotalN);
});

test('1885S sample: line stop axial friction (ACCURATE)', () => {
  checkLineStops(result, SAMPLE_EXPECTED.lineStopDesignN);
});

test('1885S sample: no line temperatures, so guides and thermal push are 0 (SCREENING)', () => {
  const { guides, lineStopThermal, temperatureSource } = result.horizontal;
  assert.equal(temperatureSource.source, 'PROJECT_DATA');
  assert.equal(guides.thermal.noMovement, true);
  checkGuides(result);
  guides.rows.forEach((row) => { assert.equal(row.lowerN, 0); assert.equal(row.upperN, 0); });
  // No growth: the line stop load is its friction alone, lower = upper.
  const byStop = new Map(result.horizontal.lineStops.rows.map((row) => [row.siteId, row.designAxialN]));
  for (const row of lineStopThermal.rows) {
    near(row.lowerN, byStop.get(row.siteId), 1e-6, `${row.tags[0]} lower = friction`);
    near(row.upperN, byStop.get(row.siteId), 1e-6, `${row.tags[0]} upper = friction`);
  }
});

test('1885S sample: Results pane shows the current values and labels', () => {
  const ope = checkResultsPane(result);
  assert.ok(ope.includes('expansion table not filled / not approved yet'));
});
