import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createEmptyProjectDataProfile,
  replaceProjectDataValue,
} from '../src/workspace/project-data/project-data-contract.js';
import { createNonFeaProductDefaultProvider } from '../src/workspace/project-data/non-fea-product-default-profile.js';
import {
  EMPIRICAL_LOAD_METHOD,
  EMPIRICAL_LOAD_THREE_MOMENT_METHOD,
  calculateSupportLoadDistributionFromQualifiedCaseMassesForMethod,
  calculateSupportLoadDistributionThreeMoment,
  calculateSupportLoadDistribution,
} from '../src/workspace/engineering-loads/support-load-distribution-v3.js';
import { items as b2Items, sup as b2Supports, beamLiftoffReleased } from '../benchmarks/checks/route-b2-data.mjs';

// Option B (CONTINUOUS_SPAN_THREE_MOMENT_V1) wired into the support-load Run kernel.

const G = 9.80665;

function profile() {
  let value = createEmptyProjectDataProfile();
  const src = { source: 'FIXTURE_SOURCE', authority: 'SOURCE_EXPLICIT' };
  const pol = { source: 'FIXTURE_POLICY', authority: 'PROJECT_POLICY' };
  for (const [path, item] of [
    ['sourcesAndUnits.lineListSource', { sha256: '1'.repeat(64) }],
    ['sourcesAndUnits.pipingClassSource', { sha256: '2'.repeat(64) }],
    ['sourcesAndUnits.componentWeightSource', { sha256: '3'.repeat(64) }],
    ['loadCalculation.materialDensitiesKgPerM3', { MAT: 7850 }],
    ['loadCalculation.pipeSectionProperties', {
      L1: { outsideDiameterMm: 100, wallThicknessMm: 5, materialCode: 'MAT', insulationCode: 'NONE', insulationThicknessMm: 0 },
    }],
    ['loadCalculation.operatingFluidDensitiesKgPerM3', { L1: 800 }],
    ['loadCalculation.hydroFluidDensitiesKgPerM3', { L1: 1000 }],
    ['loadCalculation.insulationDensitiesKgPerM3', { NONE: 0 }],
    ['loadCalculation.componentWeightsKg', { DUMMY: 1 }],
    ['loadCalculation.activeLoadCases', ['EMPTY']],
    ['topology.supportTypeCapabilities', { REST: { vertical: true } }],
  ]) {
    value = replaceProjectDataValue(value, path, item, path.startsWith('sourcesAndUnits.') ? src : pol, true);
  }
  return createNonFeaProductDefaultProvider({ profile: value }).effectiveProfile;
}

/**
 * One route built from pieces laid end to end. Each piece:
 * { id, type, to: {x,y,z}, massKg }. Supports are given by position.
 */
function route(pieces, supportPoints) {
  const entities = [];
  const edges = [];
  const entityChainages = [];
  const masses = [];
  let at = { x: 0, y: 0, z: 0 };
  let chainageMm = 0;
  for (const piece of pieces) {
    const start = at;
    const end = piece.to;
    const lengthMm = Math.hypot(end.x - start.x, end.y - start.y, end.z - start.z);
    const pointComponent = lengthMm === 0;
    entities.push({
      entityId: piece.id, entityType: piece.type, lineKey: 'L1', branchId: 'B1',
      sourceEntityId: piece.id, jsonPointer: `/${piece.id}`, componentReference: piece.id, properties: {},
    });
    edges.push({ entityId: piece.id, entityType: piece.type, lengthMm, pointComponent, topologyCarrier: false, startMm: start, endMm: end });
    entityChainages.push({
      entityId: piece.id, startMm: chainageMm, endMm: chainageMm + lengthMm, pointMm: chainageMm + lengthMm / 2,
      sourceStartChainageMm: chainageMm, sourceEndChainageMm: chainageMm + lengthMm,
    });
    masses.push({
      entityId: piece.id,
      loadCaseId: 'EMPTY',
      massKg: piece.massKg,
      source: {
        kind: 'QUALIFIED_CASE_MASS_RECEIPT',
        authority: 'CURRENT_COMMON_INPUT_EMPIRICAL_MASS_PROJECTION',
        semanticHash: 'fnv1a64:0123456789abcdef',
        caseSemanticHash: 'fnv1a64:0123456789abcdef',
        mode: piece.type === 'PIPE' ? 'DISTRIBUTED' : 'POINT',
      },
    });
    chainageMm += lengthMm;
    at = end;
  }
  const sites = supportPoints.map((positionMm, index) => ({
    siteId: `S${index}`, tags: [`S${index}`], positionMm, assemblies: [{ members: [{ sourceType: 'REST' }] }],
  }));
  return {
    input: {
      dataset: { datasetId: 'THREE-MOMENT', version: 1, sourceSha256: '4'.repeat(64), entities },
      supportSiteModel: { schema: 'support-site-model/v1', sites },
      routePartitionModel: {
        schema: 'route-partition-model/v1',
        routes: [{
          routeId: 'R1', branchId: 'B1', status: 'READY', blockers: [],
          edgeIds: pieces.map((piece) => piece.id), physicalEdgeIds: pieces.map((piece) => piece.id), entityChainages,
        }],
        edges,
      },
      masterData: {},
      profile: profile(),
    },
    masses,
  };
}

function run(method, built) {
  return calculateSupportLoadDistributionFromQualifiedCaseMassesForMethod(method, built.input, built.masses).loadCases[0];
}

const reactions = (loadCase) => loadCase.supportResults.map((row) => row.verticalForceN);

// Route S8811951/B2 as a straight line: pipes distributed, every other item at its midpoint.
function b2() {
  const pieces = [];
  let x = 0;
  b2Items.forEach(([massKg, a, b, distributed], index) => {
    if (a > x + 1e-9) { pieces.push({ id: `GAP-${index}`, type: 'GASK', to: { x: a, y: 0, z: 0 }, massKg: 0 }); x = a; }
    pieces.push({ id: `ITEM-${index}`, type: distributed ? 'PIPE' : (b > a ? 'VALV' : 'FLAN'), to: { x: b, y: 0, z: 0 }, massKg });
    x = b;
  });
  return route(pieces, b2Supports.map((sx) => ({ x: sx, y: 0, z: 0 })));
}

test('route S8811951/B2: three-moment Run result is within 1 % of the continuous-beam reference', () => {
  const result = run(EMPIRICAL_LOAD_THREE_MOMENT_METHOD, b2());
  assert.equal(result.equilibrium.passed, true);
  assert.ok(Math.abs(result.completenessAudit.coverageRatio - 1) < 1e-12);
  assert.equal(result.completenessAudit.unallocatedForceN, 0);
  reactions(result).forEach((value, index) => {
    const reference = beamLiftoffReleased[index];
    if (reference === 0) assert.equal(value, 0, `support ${index} lifts off`);
    else assert.ok(Math.abs(value / reference - 1) < 0.01, `support ${index}: ${value.toFixed(0)} N vs beam ${reference} N`);
  });
  const lift = result.exceptionLedger.filter((row) => row.code === 'SUPPORT_LIFTOFF_RELEASED');
  assert.deepEqual(lift.map((row) => row.supportSiteId), ['S4']);
  assert.equal(result.exceptionLedger.some((row) => row.code === 'OVERHANG_CANTILEVER_TRANSFER'), false);
  assert.equal(result.equilibrium.routeChecks[0].momentReference, 'ROUTE_PLAN_LENGTH_ORIGIN');
  // Every load's shares add up to that load.
  result.contributionLedger.forEach((row) => {
    const shared = row.allocations.reduce((sum, item) => sum + item.verticalForceN, 0);
    assert.ok(Math.abs(shared - row.verticalForceN) < 1e-6 * Math.max(1, row.verticalForceN), row.entityId);
  });
});

test('route S8811951/B2: V2 is still selectable and still gives the tributary result', () => {
  const v2 = reactions(run(EMPIRICAL_LOAD_METHOD, b2()));
  const b = reactions(run(EMPIRICAL_LOAD_THREE_MOMENT_METHOD, b2()));
  // V2 is 41.8 % high at 4,003 mm on this route; B is not.
  assert.ok(v2[1] / beamLiftoffReleased[1] > 1.3);
  assert.ok(Math.abs(b[1] / beamLiftoffReleased[1] - 1) < 0.01);
  assert.ok(v2[4] > 1000, 'V2 keeps the lifting support bearing');
});

test('a vertical riser between two horizontal runs is a point load, not a bending span', () => {
  // Lower run 0-3000 at z=0, riser 2000 mm up at x=3000, upper run 3000-6000 at z=2000.
  // Supports at x=0 (low), x=3000 (top of riser) and x=6000 (high).
  // In plan this is two equal 3,000 mm spans with the riser weight on the middle
  // support: textbook 3/8, 10/8, 3/8 wL, plus the riser weight on the middle one.
  const wKgPerM = 20;
  const riserKg = 50;
  const built = route([
    { id: 'P1', type: 'PIPE', to: { x: 3000, y: 0, z: 0 }, massKg: 3 * wKgPerM },
    { id: 'RISER', type: 'PIPE', to: { x: 3000, y: 0, z: 2000 }, massKg: riserKg },
    { id: 'P2', type: 'PIPE', to: { x: 6000, y: 0, z: 2000 }, massKg: 3 * wKgPerM },
  ], [{ x: 0, y: 0, z: 0 }, { x: 3000, y: 0, z: 2000 }, { x: 6000, y: 0, z: 2000 }]);
  const result = run(EMPIRICAL_LOAD_THREE_MOMENT_METHOD, built);
  assert.equal(result.equilibrium.passed, true);
  const wL = 3 * wKgPerM * G;
  const expected = [3 / 8 * wL, 10 / 8 * wL + riserKg * G, 3 / 8 * wL];
  reactions(result).forEach((value, index) => assert.ok(Math.abs(value - expected[index]) < 1e-6, `S${index}: ${value} vs ${expected[index]}`));
});

test('an unsupported riser at a route end overhangs by its horizontal distance only', () => {
  // Riser 1500 mm down to z=0 at x=0 (no support on it), then horizontal 0-4000.
  // Supports at x=1000 and x=4000: two supports, so plain statics apply.
  const riserKg = 40;
  const pipeKg = 80;
  const built = route([
    { id: 'RISER', type: 'PIPE', to: { x: 0, y: 0, z: -1500 }, massKg: riserKg },
    { id: 'RUN', type: 'PIPE', to: { x: 4000, y: 0, z: -1500 }, massKg: pipeKg },
  ], [{ x: 1000, y: 0, z: -1500 }, { x: 4000, y: 0, z: -1500 }]);
  const result = run(EMPIRICAL_LOAD_THREE_MOMENT_METHOD, built);
  assert.equal(result.equilibrium.passed, true);
  // Moments about the far support (x=4000): riser weight at plan 0, pipe at plan 2000.
  const r1 = (riserKg * G * 4000 + pipeKg * G * 2000) / 3000;
  const r2 = (riserKg + pipeKg) * G - r1;
  const [a, b] = reactions(result);
  assert.ok(Math.abs(a - r1) < 1e-6 && Math.abs(b - r2) < 1e-6, `${a}, ${b} vs ${r1}, ${r2}`);
});

test('a route with one support keeps the V2 overhang bookkeeping', () => {
  const built = route([
    { id: 'RUN', type: 'PIPE', to: { x: 2000, y: 0, z: 0 }, massKg: 30 },
  ], [{ x: 500, y: 0, z: 0 }]);
  const result = run(EMPIRICAL_LOAD_THREE_MOMENT_METHOD, built);
  assert.equal(result.equilibrium.passed, true);
  assert.ok(Math.abs(reactions(result)[0] - 30 * G) < 1e-9);
  assert.ok(result.exceptionLedger.some((row) => row.code === 'OVERHANG_CANTILEVER_TRANSFER'));
  assert.equal(result.exceptionLedger.some((row) => row.code === 'CONTINUOUS_SPAN_UNRESOLVED_TRIBUTARY_FALLBACK'), false);
});

test('an unsupported branch still hands its weight to the host, inside the host solve', () => {
  // Host: 4 m on three supports (0, 2000, 4000); olet at x=1000; 0.5 m branch with no support.
  const p = profile();
  const pipe = (entityId, branchId) => ({
    entityId, entityType: 'PIPE', lineKey: 'L1', branchId,
    sourceEntityId: entityId, jsonPointer: `/${entityId}`, componentReference: entityId, properties: {},
  });
  const edge = (entityId, start, end, extra = {}) => ({
    entityId, entityType: 'PIPE', lengthMm: Math.hypot(end.x - start.x, end.y - start.y, end.z - start.z),
    pointComponent: false, topologyCarrier: false, startMm: start, endMm: end, ...extra,
  });
  const site = (siteId, x) => ({ siteId, tags: [siteId], positionMm: { x, y: 0, z: 0 }, assemblies: [{ members: [{ sourceType: 'REST' }] }] });
  const input = {
    dataset: {
      datasetId: 'BRANCH-B', version: 1, sourceSha256: '4'.repeat(64),
      entities: [
        pipe('PIPE-1', 'B1'), pipe('PIPE-2', 'B2'),
        { entityId: 'B2', entityType: 'BRANCH', properties: { attributes: { HREF: 'OLET-1', HPOS: { x: 1000, y: 100, z: 0 } } } },
      ],
    },
    supportSiteModel: { schema: 'support-site-model/v1', sites: [site('S-A', 0), site('S-B', 2000), site('S-C', 4000)] },
    routePartitionModel: {
      schema: 'route-partition-model/v1',
      routes: [
        {
          routeId: 'R1', branchId: 'B1', status: 'READY', blockers: [],
          edgeIds: ['PIPE-1', 'OLET-1'], physicalEdgeIds: ['PIPE-1'],
          entityChainages: [
            { entityId: 'PIPE-1', startMm: 0, endMm: 4000, pointMm: 2000, sourceStartChainageMm: 0, sourceEndChainageMm: 4000 },
            { entityId: 'OLET-1', startMm: 1000, endMm: 1000, pointMm: 1000, sourceStartChainageMm: 1000, sourceEndChainageMm: 1000 },
          ],
        },
        {
          routeId: 'R2', branchId: 'B2', status: 'READY', blockers: [],
          edgeIds: ['PIPE-2'], physicalEdgeIds: ['PIPE-2'],
          entityChainages: [{ entityId: 'PIPE-2', startMm: 0, endMm: 500, pointMm: 250, sourceStartChainageMm: 0, sourceEndChainageMm: 500 }],
        },
      ],
      edges: [
        edge('PIPE-1', { x: 0, y: 0, z: 0 }, { x: 4000, y: 0, z: 0 }),
        edge('OLET-1', { x: 1000, y: 0, z: 0 }, { x: 1000, y: 0, z: 0 }, { pointComponent: true, lengthMm: 0 }),
        edge('PIPE-2', { x: 1000, y: 100, z: 0 }, { x: 1000, y: 600, z: 0 }),
      ],
    },
    masterData: {},
    profile: p,
  };
  const b = calculateSupportLoadDistributionThreeMoment(input).loadCases[0];
  const v2 = calculateSupportLoadDistribution(input).loadCases[0];
  assert.equal(b.equilibrium.passed, true);
  assert.ok(Math.abs(b.completenessAudit.coverageRatio - 1) < 1e-12);
  const transfer = b.exceptionLedger.find((row) => row.code === 'BRANCH_LOAD_TRANSFERRED_TO_HOST');
  assert.ok(transfer && transfer.verticalForceN > 0);
  const [ra, rb, rc] = ['S-A', 'S-B', 'S-C'].map((id) => b.supportResults.find((row) => row.supportSiteId === id).verticalForceN);
  // Two equal spans L=2000: UDL w over both -> 3/8, 10/8, 3/8 wL; point P at mid of span 1 ->
  // 13/32, 22/32, -3/32 P (the far support stays bearing because the UDL dominates).
  const wL = (ra + rb + rc - transfer.verticalForceN) / 2;
  const P = transfer.verticalForceN;
  const expected = [3 / 8 * wL + 13 / 32 * P, 10 / 8 * wL + 22 / 32 * P, 3 / 8 * wL - 3 / 32 * P];
  [ra, rb, rc].forEach((value, index) => assert.ok(Math.abs(value - expected[index]) < 1e-6, `${value} vs ${expected[index]}`));
  assert.ok(Math.abs(b.equilibrium.appliedForceN - v2.equilibrium.appliedForceN) < 1e-9, 'same total load as V2');
});
