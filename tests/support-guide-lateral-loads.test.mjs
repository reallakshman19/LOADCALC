import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createEmptyProjectDataProfile,
  replaceProjectDataValue,
} from '../src/workspace/project-data/project-data-contract.js';
import { buildRouteLegs } from '../src/workspace/routes/route-legs.js';
import { buildSupportGuideLateralLoads } from '../src/workspace/support-sites/support-guide-lateral-loads.js';

// Guide lateral load, guided cantilever (SCREENING). Hand check, 6" Sch 40 L-bend:
//   I = pi/64 (168.3^4 - 154.08^4) = 1.1716e7 mm4, E 203,000 MPa, EI = 2.3784e12 N.mm2
//   run past the elbow 6,000 mm, dT 100 C, alpha 1.17e-5: Delta = 7.02 mm
//   first guide 3,000 mm from the elbow tangent; 90 deg elbow R 229.3: L = 3,229.3 mm
//   lower 3 EI Delta / L^3 = 1,487.4 N; upper 12 EI Delta / L^3 = 5,949.5 N

const pol = { source: 'FIXTURE_POLICY', authority: 'PROJECT_POLICY' };
function profile({ operatingC = 121, capacity = null } = {}) {
  let value = createEmptyProjectDataProfile();
  value = replaceProjectDataValue(value, 'topology.portMatchToleranceMm', 1, pol, true);
  value = replaceProjectDataValue(value, 'thermoMechanicalBasis.installationTemperatureC', 21, pol, true);
  value = replaceProjectDataValue(value, 'thermoMechanicalBasis.operatingTemperaturesC', { DEFAULT: operatingC }, pol, true);
  value = replaceProjectDataValue(value, 'thermoMechanicalBasis.materialElasticProperties', { DEFAULT: { elasticModulusMpa: 203000, thermalExpansionPerC: 1.17e-5 } }, pol, true);
  if (capacity !== null) value = replaceProjectDataValue(value, 'restraintPolicy.guideLateralCapacityN', capacity, pol, true);
  return value;
}

function routeModel(pieces) {
  let at = 0;
  const edges = [];
  const entityChainages = [];
  pieces.forEach(({ id, type = 'PIPE', from, to }) => {
    const lengthMm = Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z);
    edges.push({ entityId: id, entityType: type, startMm: from, endMm: to, lengthMm, pointComponent: false, topologyCarrier: false });
    entityChainages.push({ entityId: id, startMm: at, endMm: at + lengthMm, sourceStartChainageMm: at, sourceEndChainageMm: at + lengthMm });
    at += lengthMm;
  });
  return { routes: [{ routeId: 'r1', branchId: 'b1', lineKey: 'L1', status: 'READY', entityChainages }], edges };
}
const p = (x, y, z = 0) => ({ x, y, z });
const R = 229.3;
// Guided run along X, a 90 deg elbow, then a run of 6,000 mm along Y (or up Z).
const lBend = (riser = false) => routeModel([
  { id: 'P1', from: p(0, 0), to: p(5000, 0) },
  riser
    ? { id: 'E1', type: 'ELBO', from: p(5000, 0), to: p(5000 + R, 0, R) }
    : { id: 'E1', type: 'ELBO', from: p(5000, 0), to: p(5000 + R, R) },
  riser
    ? { id: 'P2', from: p(5000 + R, 0, R), to: p(5000 + R, 0, R + 6000) }
    : { id: 'P2', from: p(5000 + R, R), to: p(5000 + R, R + 6000) },
]);
const site = (siteId, code, entityId, chainageMm, lateral) => ({
  siteId, tags: [siteId], code, status: 'READY',
  restrains: { vertical: 'UP_ONLY_LIFT_OFF_ALLOWED', axial: code.includes('LS') ? 'BOTH' : 'FREE', lateral: code.includes('G') ? 'BOTH' : 'FREE' },
  pipe: { routeId: 'r1', entityId, chainageMm, lateral },
});
const alongX = p(0, 1); // lateral of a run along X
const alongY = p(-1, 0);
// The Run's ledger: P1 and P2 are 6" Sch 40; a 3" pipe elsewhere must not count.
const ledgerRow = (entityId, od, id) => ({ routeId: 'r1', entityId, formula: { outsideDiameterMm: od, insideDiameterMm: id } });
const distribution = { loadCases: [{ loadCaseId: 'OPE', contributionLedger: [ledgerRow('P1', 168.3, 154.08), ledgerRow('P2', 168.3, 154.08), ledgerRow('OTHER_3IN', 88.9, 73.66)] }] };
const run = ({ rows, prof = profile(), riser = false }) => buildSupportGuideLateralLoads({
  restraintTable: { rows },
  routeLegs: buildRouteLegs({ routePartitionModel: lBend(riser), profile: prof }),
  distribution,
  profile: prof,
});
const close = (a, b, tol = 0.5) => assert.ok(Math.abs(a - b) <= tol, `${a} vs ${b}`);

test('first guide from an elbow: guided-cantilever bounds match the hand check', () => {
  const result = run({ rows: [site('G2', 'R+G', 'P1', 1000, alongX), site('G1', 'R+G', 'P1', 2000, alongX)] });
  assert.equal(result.label, 'SCREENING');
  const g1 = result.rows.find((row) => row.siteId === 'G1');
  const end = g1.ends.find((row) => row.end === 'END');
  close(end.elbowTangentMm, 229.3, 0.01);
  close(end.guideToCornerMm, 3229.3, 0.01);
  close(end.deflectionMm, 7.02, 1e-9);
  assert.equal(end.growthBasis.kind, 'WHOLE_RUN_NO_STOP_UPPER_VALUE');
  close(g1.lowerN, 1487.4);
  close(g1.upperN, 5949.5);
  // G2 is further from the elbow: shielded by G1. Its other end is the route start.
  const g2 = result.rows.find((row) => row.siteId === 'G2');
  assert.equal(g2.ends.find((row) => row.end === 'END').status, 'SHIELDED');
  assert.equal(g2.ends.find((row) => row.end === 'START').status, 'ROUTE_END');
  assert.equal(g2.upperN, 0);
});

test('only the pipe between the guide and the elbow sets I (a reducer elsewhere on the run does not)', () => {
  // A 3" piece at the start of the same straight run, behind the guide.
  const model = routeModel([
    { id: 'P0', from: p(-1000, 0), to: p(0, 0) },
    { id: 'P1', from: p(0, 0), to: p(5000, 0) },
    { id: 'E1', type: 'ELBO', from: p(5000, 0), to: p(5000 + R, R) },
    { id: 'P2', from: p(5000 + R, R), to: p(5000 + R, R + 6000) },
  ]);
  const prof = profile();
  const result = buildSupportGuideLateralLoads({
    restraintTable: { rows: [site('G1', 'R+G', 'P1', 3000, alongX)] }, // chainage 3,000 = 2,000 along P1
    routeLegs: buildRouteLegs({ routePartitionModel: model, profile: prof }),
    distribution: { loadCases: [] },
    profile: prof,
    pipeSections: [
      { entityId: 'P0', outsideDiameterMm: 88.9, wallThicknessMm: 7.62 },
      { entityId: 'P1', outsideDiameterMm: 168.3, wallThicknessMm: 7.11 },
      { entityId: 'P2', outsideDiameterMm: 168.3, wallThicknessMm: 7.11 },
    ],
  });
  const end = result.rows[0].ends.find((row) => row.end === 'END');
  assert.deepEqual(end.pipeSizes, ['168.3 x 7.11']);
  close(result.rows[0].lowerN, 1487.4);
  close(result.rows[0].upperN, 5949.5);
});

test('a line stop on the run past the elbow shortens the growing length', () => {
  // Stop 2,000 mm past the elbow: Delta = 1.17e-5 x 100 x 2,000 = 2.34 mm, a third of the load.
  const elbowEnd = 5000 + R * Math.SQRT2;
  const result = run({ rows: [site('G1', 'R+G', 'P1', 2000, alongX), site('LS', 'R+LS', 'P2', elbowEnd + 2000, alongY)] });
  const g1 = result.rows.find((row) => row.siteId === 'G1');
  assert.equal(g1.ends.find((row) => row.end === 'END').growthBasis.siteId, 'LS');
  close(g1.lowerN, 1487.4 / 3);
  close(g1.upperN, 5949.5 / 3);
});

test('a riser past the elbow does not load the guide sideways', () => {
  const result = run({ rows: [site('G1', 'R+G', 'P1', 2000, alongX)], riser: true });
  const end = result.rows[0].ends.find((row) => row.end === 'END');
  assert.equal(end.status, 'NO_LATERAL_COMPONENT');
  assert.equal(result.rows[0].upperN, 0);
});

test('no temperature rise gives 0; a capacity flags a guide too close to the elbow', () => {
  const cold = run({ rows: [site('G1', 'R+G', 'P1', 2000, alongX)], prof: profile({ operatingC: 21 }) });
  assert.equal(cold.rows[0].upperN, 0);
  assert.equal(cold.thermal.noMovement, true);
  assert.equal(cold.rows[0].flag, null, 'no capacity set: no flag');

  const flagged = run({ rows: [site('G1', 'R+G', 'P1', 2000, alongX)], prof: profile({ capacity: { DEFAULT: 3000 } }) });
  assert.equal(flagged.rows[0].flag.code, 'GUIDE_TOO_CLOSE_TO_ELBOW');
  // (12 EI Delta / 3,000 N)^(1/3) = 4,058 mm from the elbow corner
  close(flagged.rows[0].flag.minimumDistanceMm, 4058, 1);
  const ok = run({ rows: [site('G1', 'R+G', 'P1', 2000, alongX)], prof: profile({ capacity: { DEFAULT: 10000 } }) });
  assert.equal(ok.rows[0].flag.code, 'WITHIN_CAPACITY');
});

test('no pipe section in the Run blocks the guide instead of guessing', () => {
  const prof = profile();
  const result = buildSupportGuideLateralLoads({
    restraintTable: { rows: [site('G1', 'R+G', 'P1', 2000, alongX)] },
    routeLegs: buildRouteLegs({ routePartitionModel: lBend(), profile: prof }),
    distribution: { loadCases: [] },
    profile: prof,
  });
  assert.equal(result.rows[0].status, 'BLOCKED_NO_PIPE_SECTION');
  assert.equal(result.rows[0].upperN, null);

  // The sealed input's pipe sections (OD and wall per pipe entity) are used when given.
  const fromInput = buildSupportGuideLateralLoads({
    restraintTable: { rows: [site('G1', 'R+G', 'P1', 2000, alongX)] },
    routeLegs: buildRouteLegs({ routePartitionModel: lBend(), profile: prof }),
    distribution: { loadCases: [] },
    profile: prof,
    pipeSections: [{ entityId: 'P1', outsideDiameterMm: 168.3, wallThicknessMm: 7.11 }],
  });
  close(fromInput.rows[0].upperN, 5949.5);

  // No growth needs no section: 0, not blocked.
  const cold = buildSupportGuideLateralLoads({
    restraintTable: { rows: [site('G1', 'R+G', 'P1', 2000, alongX)] },
    routeLegs: buildRouteLegs({ routePartitionModel: lBend(), profile: prof }),
    distribution: { loadCases: [] },
    profile: profile({ operatingC: 21 }),
  });
  assert.equal(cold.rows[0].status, 'CALCULATED');
  assert.equal(cold.rows[0].upperN, 0);
});
