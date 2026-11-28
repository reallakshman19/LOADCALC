// End to end, no browser, with the client Line List (insulation, densities,
// operating temperatures). The Line List is a client document kept on this
// computer only (never committed): without it these tests are skipped.
import test from 'node:test';
import assert from 'node:assert/strict';
import { hasRealLineList, REAL_LINE_LIST, runHeadless1885S, caseOf } from './e2e/headless-1885s-run.mjs';
import { REAL_EXPECTED, SAMPLE_EXPECTED } from './e2e/expected-1885s.mjs';
import {
  checkFriction, checkGuides, checkInputs, checkLineStops, checkRestraintTable, checkResultsPane, checkVertical, near,
} from './e2e/checks-1885s.mjs';

const skip = hasRealLineList() ? false : 'client Line List not on this computer (local only, never committed)';
const result = skip ? null : await runHeadless1885S({ lineListPath: REAL_LINE_LIST });

test('1885S real Line List: inputs reach a READY seal, Option B', { skip }, () => {
  checkInputs(result, REAL_EXPECTED.proposals);
});

test('1885S real Line List: vertical totals, m·g per item, Σ reactions = applied (ACCURATE)', { skip }, () => {
  checkVertical(result, REAL_EXPECTED.appliedN, REAL_EXPECTED.supportVerticalN);
  // Hand check: the EMPTY difference from the sample run is the insulation.
  const empty = caseOf(result.distribution, 'EMPTY').equilibrium.appliedForceN;
  near(empty - SAMPLE_EXPECTED.appliedN.EMPTY, REAL_EXPECTED.insulationN, 0.2, 'insulation weight');
  near(REAL_EXPECTED.insulationN / 9.80665, 1407, 1, 'insulation mass, kg');
});

test('1885S real Line List: restraint table, 36 sites', { skip }, () => {
  checkRestraintTable(result);
});

test('1885S real Line List: operating temperatures come from the Line List (T2)', { skip }, () => {
  const { temperatureSource } = result.horizontal;
  assert.equal(temperatureSource.source, 'LINE_LIST_MASTER');
  assert.deepEqual(temperatureSource.conflicts, []);
  const lines = Object.entries(temperatureSource.appliedByLine);
  assert.equal(lines.length, 5);
  lines.forEach(([, value]) => assert.equal(value, REAL_EXPECTED.operatingC));
  // The expansion table is a placeholder until the owner fills it.
  assert.equal(temperatureSource.expansion.status, 'NOT_APPROVED');
});

test('1885S real Line List: design friction μ·N_OPE (ACCURATE)', { skip }, () => {
  checkFriction(result, REAL_EXPECTED.frictionTotalN);
});

test('1885S real Line List: line stop axial friction (ACCURATE)', { skip }, () => {
  checkLineStops(result, REAL_EXPECTED.lineStopDesignN);
});

test('1885S real Line List: guide lateral bounds, guided cantilever (SCREENING)', { skip }, () => {
  checkGuides(result, REAL_EXPECTED.guideBoundsN);
  assert.equal(result.horizontal.guides.summary.tooCloseCount, 0);
});

test('1885S real Line List: line stop thermal push (SCREENING), upper bounds open', { skip }, () => {
  const { lineStopThermal, lineStops } = result.horizontal;
  const expected = REAL_EXPECTED.lineStopThermal;
  assert.equal(lineStopThermal.summary.stopCount, lineStops.rows.length);
  assert.equal(lineStopThermal.summary.boundedCount, expected.bounded);
  assert.equal(lineStopThermal.summary.lineEndUnknownCount, expected.lineEndUnknown);
  assert.equal(lineStopThermal.summary.findingCount, expected.findings);
  const friction = new Map(lineStops.rows.map((row) => [row.siteId, row.designAxialN]));
  for (const row of lineStopThermal.rows) {
    // The push can only add to the friction, and no upper bound is shown
    // while the line ends are unknown (never a meaningless MN-scale number).
    assert.ok(row.lowerN >= friction.get(row.siteId) - 1e-6, `${row.tags[0]} lower ≥ friction`);
    assert.equal(row.upperN, null, `${row.tags[0]} upper open`);
  }
  const ps12060 = lineStopThermal.rows.find((row) => row.tags.includes('PS-12060'));
  const finding = ps12060.findings.find((row) => row.code === 'SHORT_LEG_TO_LINE_END');
  near(finding.forceIfLineEndFixedN / 1000, expected.ps12060FindingKN, 0.1, 'PS-12060 if line end fixed, kN');
});

test('1885S real Line List: Results pane shows the current values and labels', { skip }, () => {
  const ope = checkResultsPane(result);
  assert.ok(ope.includes('S8811951 309 °C (Line List)'));
  assert.match(ope, /FINDING: Leg to the line end/u);
});
