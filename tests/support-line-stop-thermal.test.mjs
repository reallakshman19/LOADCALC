import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createEmptyProjectDataProfile,
  replaceProjectDataValue,
} from '../src/workspace/project-data/project-data-contract.js';
import { buildRouteLegs } from '../src/workspace/routes/route-legs.js';
import { buildSupportLineStopLoads } from '../src/workspace/support-sites/support-line-stop-loads.js';
import { buildSupportLineStopThermal } from '../src/workspace/support-sites/support-line-stop-thermal.js';

// Line stop thermal push (SCREENING). Hand check, 6" Sch 40 L-bend, dT 100 C:
//   EI = 203,000 x 1.1716e7 = 2.3784e12 N.mm2, A = 3,600.5 mm2, alpha 1.17e-5
//   stop 3,000 mm from the elbow tangent + 229.3 mm to the corner:
//     delta = 1.17e-5 x 100 x 3,229.3 = 3.7783 mm (all of it across a square run)
//   guide 2,000 mm past the tangent, L_b = 2,229.3 mm: 2,433.3 / 9,733.2 N
//   no guide, run past the elbow 6,000 mm, L = 6,229.3 mm: 12 EI d / L^3 = 446.1 N
//   two stops on one run: E A alpha dT = 855,144 N (design finding)

const pol = { source: 'FIXTURE_POLICY', authority: 'PROJECT_POLICY' };
function profile(operatingC = 121) {
  let value = createEmptyProjectDataProfile();
  value = replaceProjectDataValue(value, 'topology.portMatchToleranceMm', 1, pol, true);
  value = replaceProjectDataValue(value, 'thermoMechanicalBasis.installationTemperatureC', 21, pol, true);
  value = replaceProjectDataValue(value, 'thermoMechanicalBasis.operatingTemperaturesC', { DEFAULT: operatingC }, pol, true);
  value = replaceProjectDataValue(value, 'thermoMechanicalBasis.materialElasticProperties', { DEFAULT: { elasticModulusMpa: 203000, thermalExpansionPerC: 1.17e-5 } }, pol, true);
  return value;
}
const p = (x, y, z = 0) => ({ x, y, z });
const R = 229.3;
function lBend(p2LengthMm = 6000) {
  const pieces = [
    { id: 'P1', type: 'PIPE', from: p(0, 0), to: p(5000, 0) },
    { id: 'E1', type: 'ELBO', from: p(5000, 0), to: p(5000 + R, R) },
    { id: 'P2', type: 'PIPE', from: p(5000 + R, R), to: p(5000 + R, R + p2LengthMm) },
  ];
  let at = 0;
  const edges = [];
  const entityChainages = [];
  pieces.forEach(({ id, type, from, to }) => {
    const lengthMm = Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z);
    edges.push({ entityId: id, entityType: type, startMm: from, endMm: to, lengthMm, pointComponent: false, topologyCarrier: false });
    entityChainages.push({ entityId: id, startMm: at, endMm: at + lengthMm, sourceStartChainageMm: at, sourceEndChainageMm: at + lengthMm });
    at += lengthMm;
  });
  return { routes: [{ routeId: 'r1', branchId: 'b1', lineKey: 'L1', status: 'READY', entityChainages }], edges };
}
const P2_START = 5000 + R * Math.SQRT2; // chainage where P2 begins (elbow tangent)
const site = (siteId, code, entityId, chainageMm, lateral) => ({
  siteId, tags: [siteId], code, status: 'READY',
  restrains: { vertical: 'UP_ONLY_LIFT_OFF_ALLOWED', axial: code.includes('LS') ? 'BOTH' : 'FREE', lateral: code.includes('G') ? 'BOTH' : 'FREE' },
  pipe: { routeId: 'r1', entityId, chainageMm, lateral },
});
const X_LAT = p(0, 1);
const Y_LAT = p(-1, 0);
const distribution = { loadCases: [{ loadCaseId: 'OPE', contributionLedger: ['P1', 'P2'].map((entityId) => ({ routeId: 'r1', entityId, formula: { outsideDiameterMm: 168.3, insideDiameterMm: 154.08 } })) }] };
const close = (a, b, tol = 0.5) => assert.ok(Math.abs(a - b) <= tol, `${a} vs ${b}`);

function run(rows, frictionRows, operatingC = 121) {
  const prof = profile(operatingC);
  const routeLegs = buildRouteLegs({ routePartitionModel: lBend(), profile: prof });
  const restraintTable = { rows };
  const frictionLoads = { status: 'CALCULATED', loadCaseId: 'OPE', rows: frictionRows.map(([siteId, axialMaxN, lateralMaxN = 0]) => ({ siteId, axialMaxN, lateralMaxN })) };
  const lineStops = buildSupportLineStopLoads({ restraintTable, frictionLoads, routeLegs });
  return buildSupportLineStopThermal({ lineStops, restraintTable, routeLegs, frictionLoads, profile: prof, distribution });
}

test('guide on the run past the elbow: guided-cantilever push added to the side friction', () => {
  const result = run(
    [site('STOP', 'R+LS', 'P1', 2000, X_LAT), site('R1', 'R', 'P1', 4000, X_LAT), site('G', 'R+G', 'P2', P2_START + 2000, Y_LAT)],
    [['STOP', 0], ['R1', 300], ['G', 0]],
  );
  assert.equal(result.label, 'SCREENING');
  const stop = result.rows[0];
  const end = stop.sides.find((side) => side.towards === 'END');
  close(end.growLengthMm, 3229.3, 0.01);
  close(end.deflectionMm, 3.7783, 1e-4);
  assert.equal(end.basisKind, 'GUIDE_ON_NEXT_RUN');
  close(end.bendLengthMm, 2229.3, 0.01);
  close(end.pushLowerN, 2433.3);
  close(end.pushUpperN, 9733.2);
  close(end.frictionN, 300);
  close(stop.lowerN, 300 + 2433.3);
  // The other side runs to the line end: shown as unknown, not guessed, so
  // the stop's upper bound stays open (the END side alone: 300 + 9,733.2 N).
  assert.equal(stop.sides.find((side) => side.towards === 'START').status, 'LINE_END_UNKNOWN');
  assert.equal(stop.status, 'CALCULATED_LINE_END_UNKNOWN');
  assert.equal(stop.upperN, null);
  assert.deepEqual(stop.upperOpenSides, ['START']);
});

test('no guide past the elbow, run to the line end: lower = rest friction; fixed-end force is a finding', () => {
  const result = run(
    [site('STOP', 'R+LS', 'P1', 2000, X_LAT), site('R2', 'R', 'P2', P2_START + 3000, Y_LAT)],
    [['STOP', 0], ['R2', 0, 150]],
  );
  const stop = result.rows[0];
  const end = stop.sides.find((side) => side.towards === 'END');
  assert.equal(end.basisKind, 'NO_GUIDE_ON_NEXT_RUN');
  close(end.restFrictionN, 150);
  close(end.pushLowerN, 150);
  assert.equal(end.pushUpperN, null, 'no upper bound from the hand method');
  assert.equal(end.upperStatus, 'LINE_END_IF_FIXED_IS_A_FINDING');
  close(end.finding.forceIfLineEndFixedN, 150 + 446.1); // 12 EI d / 6,229.3^3
  assert.equal(stop.upperN, null, 'never an understated upper bound');
  assert.deepEqual(stop.upperOpenSides, ['START', 'END']);
  assert.equal(stop.findings[0].code, 'SHORT_LEG_TO_LINE_END');
});

test('a very short leg to the line end: the finding is capped at the fully blocked force', () => {
  // 100 mm past the elbow, L = 329.3 mm: 12 EI d / L^3 = 3.02 MN, more than
  // blocking the growth completely, E A alpha dT = 855,144 N: capped there.
  const prof = profile();
  const routeLegs = buildRouteLegs({ routePartitionModel: lBend(100), profile: prof });
  const restraintTable = { rows: [site('STOP', 'R+LS', 'P1', 2000, X_LAT)] };
  const frictionLoads = { status: 'CALCULATED', loadCaseId: 'OPE', rows: [{ siteId: 'STOP', axialMaxN: 0, lateralMaxN: 0 }] };
  const lineStops = buildSupportLineStopLoads({ restraintTable, frictionLoads, routeLegs });
  const result = buildSupportLineStopThermal({ lineStops, restraintTable, routeLegs, frictionLoads, profile: prof, distribution });
  const finding = result.rows[0].findings[0];
  assert.equal(finding.code, 'SHORT_LEG_TO_LINE_END');
  assert.equal(finding.cappedAtFullyRestrained, true);
  close(finding.forceIfLineEndFixedN, 855144, 1);
});

test('no guide past the elbow and more legs beyond: no upper bound (needs the following legs)', () => {
  // Same L-bend plus a second elbow and a third run along X.
  const prof = profile();
  const model = lBend();
  const extra = [
    { id: 'E2', type: 'ELBO', from: p(5000 + R, R + 6000), to: p(5000 + 2 * R, 2 * R + 6000) },
    { id: 'P3', type: 'PIPE', from: p(5000 + 2 * R, 2 * R + 6000), to: p(9000, 2 * R + 6000) },
  ];
  let at = model.routes[0].entityChainages.at(-1).endMm;
  extra.forEach(({ id, type, from, to }) => {
    const lengthMm = Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z);
    model.edges.push({ entityId: id, entityType: type, startMm: from, endMm: to, lengthMm, pointComponent: false, topologyCarrier: false });
    model.routes[0].entityChainages.push({ entityId: id, startMm: at, endMm: at + lengthMm, sourceStartChainageMm: at, sourceEndChainageMm: at + lengthMm });
    at += lengthMm;
  });
  const routeLegs = buildRouteLegs({ routePartitionModel: model, profile: prof });
  const restraintTable = { rows: [site('STOP', 'R+LS', 'P1', 2000, X_LAT)] };
  const frictionLoads = { status: 'CALCULATED', loadCaseId: 'OPE', rows: [{ siteId: 'STOP', axialMaxN: 0, lateralMaxN: 0 }] };
  const lineStops = buildSupportLineStopLoads({ restraintTable, frictionLoads, routeLegs });
  const result = buildSupportLineStopThermal({ lineStops, restraintTable, routeLegs, frictionLoads, profile: prof, distribution });
  const end = result.rows[0].sides.find((side) => side.towards === 'END');
  assert.equal(end.upperStatus, 'NEEDS_FOLLOWING_LEGS');
  assert.equal(end.pushUpperN, null);
  assert.equal(end.finding, undefined);
});

test('two stops on one run: blocked growth is a design finding, not a load', () => {
  const result = run(
    [site('A', 'R+LS', 'P1', 2000, X_LAT), site('R1', 'R', 'P1', 3000, X_LAT), site('B', 'R+LS', 'P1', 4500, X_LAT)],
    [['A', 0], ['R1', 300], ['B', 0]],
  );
  const a = result.rows.find((row) => row.siteId === 'A');
  const end = a.sides.find((side) => side.towards === 'END');
  assert.equal(end.status, 'GROWTH_BLOCKED_BY_NEXT_STOP');
  assert.equal(end.pushUpperN, 0);
  close(a.findings[0].fullyRestrainedForceN, 855144, 1);
  assert.equal(end.frictionN, 300); // that side carries its friction only
  close(a.lowerN, 300, 1e-9);
});

test('no temperature rise: no push', () => {
  const result = run(
    [site('STOP', 'R+LS', 'P1', 2000, X_LAT), site('G', 'R+G', 'P2', P2_START + 2000, Y_LAT)],
    [['STOP', 0], ['G', 0]],
    21,
  );
  const end = result.rows[0].sides.find((side) => side.towards === 'END');
  assert.equal(end.pushUpperN, 0);
  assert.equal(result.rows[0].upperN, 0);
});
