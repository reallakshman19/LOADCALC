import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createEmptyProjectDataProfile,
  replaceProjectDataValue,
} from '../src/workspace/project-data/project-data-contract.js';
import { buildRouteLegs } from '../src/workspace/routes/route-legs.js';
import { buildSupportLineStopLoads } from '../src/workspace/support-sites/support-line-stop-loads.js';

// Guide / line stop plan, step 2 (legs) and step 4 friction part.

function profile(toleranceMm = 1) {
  const pol = { source: 'FIXTURE_POLICY', authority: 'PROJECT_POLICY' };
  return replaceProjectDataValue(createEmptyProjectDataProfile(), 'topology.portMatchToleranceMm', toleranceMm, pol, true);
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
