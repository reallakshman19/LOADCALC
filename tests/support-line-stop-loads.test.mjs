import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createEmptyProjectDataProfile,
  replaceProjectDataValue,
} from '../src/workspace/project-data/project-data-contract.js';
import { buildRouteLegs } from '../src/workspace/routes/route-legs.js';
import { buildSupportLineStopLoads } from '../src/workspace/support-sites/support-line-stop-loads.js';

// Guide / line stop plan, step 2 (legs) and step 4 friction part.

function profile(toleranceMm = 1, offsetMaxAngleDeg = null, approved = true) {
  const pol = { source: 'FIXTURE_POLICY', authority: 'PROJECT_POLICY' };
  let value = replaceProjectDataValue(createEmptyProjectDataProfile(), 'topology.portMatchToleranceMm', toleranceMm, pol, true);
  if (offsetMaxAngleDeg !== null) {
    value = replaceProjectDataValue(value, 'topology.legOffsetMaxAngleDeg', offsetMaxAngleDeg, pol, approved);
  }
  return value;
}

// Builds a route from pieces given in route order; `reversed` pieces are
// stored against the route direction in the source.
function routeModel(pieces) {
  let at = 0;
  const edges = [];
  const entityChainages = [];
  pieces.forEach(({ id, type = 'PIPE', from, to, reversed = false }) => {
    const lengthMm = Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z);
    edges.push({ entityId: id, entityType: type, startMm: reversed ? to : from, endMm: reversed ? from : to, lengthMm, pointComponent: lengthMm === 0, topologyCarrier: false });
    entityChainages.push({ entityId: id, startMm: at, endMm: at + lengthMm, sourceStartChainageMm: reversed ? at + lengthMm : at, sourceEndChainageMm: reversed ? at : at + lengthMm });
    at += lengthMm;
  });
  return { routes: [{ routeId: 'r1', branchId: 'b1', lineKey: 'L1', status: 'READY', entityChainages }], edges };
}

const p = (x, y, z = 0) => ({ x, y, z });

test('legs run through in-line items and end at elbows and sloped offsets', () => {
  const model = routeModel([
    { id: 'P1', from: p(0, 0), to: p(4000, 0) },
    { id: 'FLAN', type: 'FLAN', from: p(4000, 0), to: p(4100, 0) },
    { id: 'GASK', type: 'GASK', from: p(4100, 0), to: p(4100, 0) }, // point component, no length
    { id: 'P2', from: p(4100, 0), to: p(10000, 0.4), reversed: true }, // 0.4 mm off line, within 1 mm
    { id: 'E1', type: 'ELBO', from: p(10000, 0.4), to: p(10300, 300.4) },
    { id: 'P3', from: p(10300, 300.4), to: p(10300, 5000) },
    { id: 'P4', from: p(10300, 5000), to: p(10300, 5146, -40) }, // sloped offset
    { id: 'P5', from: p(10300, 5146, -40), to: p(10300, 9000, -40) },
  ]);
  const legs = buildRouteLegs({ routePartitionModel: model, profile: profile(1) });
  assert.equal(legs.status, 'READY');
  assert.deepEqual(legs.legs.map((leg) => [leg.kind, leg.entityIds.join(',')]), [
    ['STRAIGHT', 'P1,FLAN,P2'],
    ['BEND', 'E1'],
    ['STRAIGHT', 'P3'],
    ['STRAIGHT', 'P4'],
    ['STRAIGHT', 'P5'],
  ]);
  assert.ok(Math.abs(legs.legs[0].lengthMm - 10000) < 0.01);
  assert.deepEqual(legs.legs[0].axis, { x: 1, y: 0.00004, z: 0 });
  assert.equal(legs.legs[3].orientation, 'SLOPED');
  assert.equal(legs.legs[4].orientation, 'HORIZONTAL');

  const strict = buildRouteLegs({ routePartitionModel: model, profile: profile(0.1) });
  assert.deepEqual(strict.legs[0].entityIds, ['P1', 'FLAN'], 'a 0.4 mm offset breaks the leg at a 0.1 mm tolerance');
});

// Like S8811951/B2 past PS-12248: a 40 mm step down through a 146 mm piece
// sloped about 16 degrees, a straight run, the step back up, then an elbow.
const steppedRoute = () => routeModel([
  { id: 'A', from: p(0, 0, 0), to: p(5000, 0, 0) },
  { id: 'OFF1', from: p(5000, 0, 0), to: p(5140.4, 0, -40) },
  { id: 'B', from: p(5140.4, 0, -40), to: p(10000, 0, -40) },
  { id: 'OFF2', from: p(10000, 0, -40), to: p(10140.4, 0, 0) },
  { id: 'C', from: p(10140.4, 0, 0), to: p(10300, 0, 0) },
  { id: 'E1', type: 'ELBO', from: p(10300, 0, 0), to: p(10600, 300, 0) },
  { id: 'D', from: p(10600, 300, 0), to: p(10600, 3000, 0) },
]);

test('legs running the same way join through shallow offsets only when an approved angle allows it', () => {
  const joined = buildRouteLegs({ routePartitionModel: steppedRoute(), profile: profile(1, 30) });
  assert.equal(joined.offsetMaxAngleDeg, 30);
  assert.deepEqual(joined.axialRuns.map((run) => run.legIds.length), [5, 1]);
  assert.deepEqual(joined.axialRuns[0].offsets.map((o) => o.angleDeg), [15.9, 15.9]); // atan(40 / 140.4)
  // 5,000 + 146.0 + 4,859.6 + 146.0 + 159.6 mm along the pipe
  assert.ok(Math.abs(joined.axialRuns[0].lengthMm - 10311.2) < 0.1);

  const plain = (p2) => buildRouteLegs({ routePartitionModel: steppedRoute(), profile: p2 }).axialRuns.map((run) => run.legIds.length);
  assert.deepEqual(plain(profile(1)), [1, 1, 1, 1, 1, 1], 'not set: every straight leg is its own run');
  assert.deepEqual(plain(profile(1, 30, false)), [1, 1, 1, 1, 1, 1], 'not approved: not used');
  assert.deepEqual(plain(profile(1, 10)), [1, 1, 1, 1, 1, 1], '16 degrees is above a 10 degree limit');
});

test('a pair of 45 degree elbows is a 45 degree offset, not 22.5', () => {
  // Each elbow's chord sits at 22.5 degrees; the step itself turns 45.
  const model = routeModel([
    { id: 'A', from: p(0, 0, 0), to: p(5000, 0, 0) },
    { id: 'E1', type: 'ELBO', from: p(5000, 0, 0), to: p(5100, 0, -41.42) },
    { id: 'E2', type: 'ELBO', from: p(5100, 0, -41.42), to: p(5200, 0, -82.84) },
    { id: 'B', from: p(5200, 0, -82.84), to: p(9000, 0, -82.84) },
  ]);
  const runs = buildRouteLegs({ routePartitionModel: model, profile: profile(1, 30) }).axialRuns;
  assert.deepEqual(runs.map((run) => run.legIds.length), [1, 1]);
});

test('PS-12248 hand check: friction past a 16 degree step reaches the stop', () => {
  // OPE loads from the 2026-11-27 Run, mu 0.3. Start side: 8,772 + 2,453 + 3,756 N
  // (one value here). End side, past the step: PS-12250 7,324 N; PS-12249 lifted off.
  const routeLegs = buildRouteLegs({ routePartitionModel: steppedRoute(), profile: profile(1, 30) });
  const at = (siteId, code, entityId, chainageMm) => site(siteId, code, chainageMm, { entityId });
  const restraintTable = { rows: [
    at('START3', 'R', 'A', 1500), at('PS-12248', 'R+G+LS', 'A', 4000),
    at('PS-12249', 'R', 'B', 6200), at('PS-12250', 'R', 'B', 9000), at('PAST_ELBOW', 'R', 'D', 12000),
  ] };
  const frictionLoads = friction([['START3', 4494.3], ['PS-12248', 0], ['PS-12249', 0], ['PS-12250', 2197.2], ['PAST_ELBOW', 999]]);
  const stop = buildSupportLineStopLoads({ restraintTable, frictionLoads, routeLegs }).rows[0];
  const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} vs ${b}`);
  close(stop.sides[0].frictionN, 4494.3);
  close(stop.sides[1].frictionN, 2197.2);
  close(stop.designAxialN, 4494.3); // unchanged by the step
  close(stop.netAxialN, 2297.1); // was 4,494.3 when the step ended the leg
  assert.equal(stop.leg.offsets.length, 2);

  const strict = buildSupportLineStopLoads({ restraintTable, frictionLoads, routeLegs: buildRouteLegs({ routePartitionModel: steppedRoute(), profile: profile(1) }) }).rows[0];
  assert.equal(strict.sides[1].frictionN, 0, 'without the rule the step ends the leg');
});

// One leg along X from 0 to 10,000 mm, an elbow, then a leg along Y.
const legsFixture = {
  status: 'READY',
  legs: [
    { legId: 'r1:leg:1', routeId: 'r1', kind: 'STRAIGHT', startMm: 0, endMm: 10000, lengthMm: 10000, axis: p(1, 0), orientation: 'HORIZONTAL', entityIds: ['P1'] },
    { legId: 'r1:leg:2', routeId: 'r1', kind: 'BEND', startMm: 10000, endMm: 10424, lengthMm: 424, axis: p(0.71, 0.71), orientation: 'HORIZONTAL', entityIds: ['E1'] },
    { legId: 'r1:leg:3', routeId: 'r1', kind: 'STRAIGHT', startMm: 10424, endMm: 15000, lengthMm: 4576, axis: p(0, 1), orientation: 'HORIZONTAL', entityIds: ['P2'] },
  ],
};
const site = (siteId, code, chainageMm, { entityId = 'P1', status = 'READY', axial = code.includes('LS') ? 'BOTH' : 'FREE' } = {}) => ({
  siteId, tags: [siteId], code, status,
  restrains: status === 'READY' ? { vertical: 'UP_ONLY_LIFT_OFF_ALLOWED', axial, lateral: code.includes('G') ? 'BOTH' : 'FREE' } : null,
  pipe: { routeId: 'r1', entityId, chainageMm },
});
const friction = (rows) => ({ status: 'CALCULATED', loadCaseId: 'OPE', rows: rows.map(([siteId, axialMaxN]) => ({ siteId, axialMaxN })) });

test('a line stop holds the larger side of the axial friction on its leg', () => {
  const restraintTable = { rows: [
    site('S1', 'R', 1000), site('S2', 'R+G', 3000), site('STOP', 'R+LS', 5000),
    site('S3', 'R', 8000), site('LIFTED', 'R', 9000), site('NONE', 'NONE', 9500, { status: 'NOT_A_SUPPORT' }),
    site('S4', 'R', 12000, { entityId: 'P2' }),
  ] };
  // mu 0.3: 0.3 x 1,000 / 2,000 / 4,000 / 0 / 5,000 N.
  const frictionLoads = friction([['S1', 300], ['S2', 600], ['STOP', 0], ['S3', 1200], ['LIFTED', 0], ['NONE', null], ['S4', 1500]]);
  const result = buildSupportLineStopLoads({ restraintTable, frictionLoads, routeLegs: legsFixture });
  assert.equal(result.status, 'CALCULATED');
  assert.equal(result.label, 'ACCURATE');
  assert.equal(result.rows.length, 1);
  const stop = result.rows[0];
  assert.equal(stop.siteId, 'STOP');
  assert.equal(stop.legId, 'r1:leg:1');
  const [start, end] = stop.sides;
  assert.equal(start.frictionN, 900); // 300 + 600
  assert.deepEqual(start.supports.map((s) => s.siteId), ['S2', 'S1']);
  assert.equal(end.frictionN, 1200); // 1,200 + 0; S4 is past the elbow, on another leg
  assert.deepEqual(end.supports.map((s) => s.siteId), ['S3', 'LIFTED']);
  assert.equal(end.boundary.kind, 'LEG_END');
  assert.equal(stop.designAxialN, 1200);
  assert.equal(stop.netAxialN, 300);
  assert.equal(stop.pushN, null);
  assert.deepEqual(stop.findings, []);
});

test('two stops on one leg: each holds up to the other, and a design finding is raised', () => {
  const restraintTable = { rows: [
    site('S1', 'R', 1000), site('A', 'R+LS', 2000), site('S2', 'R', 4000), site('S3', 'R+G', 6000),
    site('B', 'R+G+LS', 7000), site('S4', 'R', 9000),
  ] };
  const frictionLoads = friction([['S1', 100], ['A', 0], ['S2', 200], ['S3', 300], ['B', 0], ['S4', 400]]);
  const result = buildSupportLineStopLoads({ restraintTable, frictionLoads, routeLegs: legsFixture });
  const a = result.rows.find((row) => row.siteId === 'A');
  const b = result.rows.find((row) => row.siteId === 'B');
  assert.deepEqual(a.sides.map((s) => s.frictionN), [100, 500]);
  assert.equal(a.sides[1].boundary.kind, 'NEXT_STOP');
  assert.equal(a.sides[1].boundary.siteId, 'B');
  assert.equal(a.designAxialN, 500);
  assert.deepEqual(b.sides.map((s) => s.frictionN), [500, 400]);
  assert.equal(b.designAxialN, 500);
  assert.equal(a.findings[0].code, 'TWO_AXIAL_STOPS_ON_ONE_LEG');
  assert.deepEqual(b.findings[0].otherSiteIds, ['A']);
});

test('an unknown support or a missing vertical result on the held side blocks the stop', () => {
  const unknown = buildSupportLineStopLoads({
    restraintTable: { rows: [site('STOP', 'R+LS', 5000), site('Q', '?', 7000, { status: 'BLOCKED_UNKNOWN_FUNCTION' })] },
    frictionLoads: friction([['STOP', 0], ['Q', null]]),
    routeLegs: legsFixture,
  });
  assert.equal(unknown.status, 'CALCULATED_WITH_BLOCKED_STOPS');
  assert.equal(unknown.rows[0].status, 'BLOCKED_UNKNOWN_SUPPORT_ON_LEG');
  assert.equal(unknown.rows[0].designAxialN, null);

  const missing = buildSupportLineStopLoads({
    restraintTable: { rows: [site('STOP', 'R+LS', 5000), site('S1', 'R', 1000)] },
    frictionLoads: friction([['STOP', 0]]),
    routeLegs: legsFixture,
  });
  assert.equal(missing.rows[0].status, 'BLOCKED_MISSING_VERTICAL_ON_LEG');

  const none = buildSupportLineStopLoads({ restraintTable: { rows: [] }, frictionLoads: { status: 'NO_OPERATING_CASE', rows: [] }, routeLegs: legsFixture });
  assert.equal(none.status, 'NO_FRICTION_RESULT');
});
