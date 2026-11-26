import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createEmptyProjectDataProfile,
  replaceProjectDataValue,
} from '../src/workspace/project-data/project-data-contract.js';
import { createNonFeaProductDefaultProvider } from '../src/workspace/project-data/non-fea-product-default-profile.js';
import { calculateSupportLoadDistribution } from '../src/workspace/engineering-loads/support-load-distribution-v3.js';

// Host R1: 2 m pipe on supports at x=0 and x=2000, olet at x=1000.
// Branch R2 (B2): 0.5 m pipe hanging from the olet, no support of its own.
function fixture({ href = 'OLET-1' } = {}) {
  let profile = createEmptyProjectDataProfile();
  const src = { source: 'FIXTURE_SOURCE', authority: 'SOURCE_EXPLICIT' };
  const pol = { source: 'FIXTURE_POLICY', authority: 'PROJECT_POLICY' };
  for (const [path, value] of [
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
    profile = replaceProjectDataValue(profile, path, value, path.startsWith('sourcesAndUnits.') ? src : pol, true);
  }
  profile = createNonFeaProductDefaultProvider({ profile }).effectiveProfile;
  const pipe = (entityId, branchId) => ({
    entityId, entityType: 'PIPE', lineKey: 'L1', branchId,
    sourceEntityId: entityId, jsonPointer: `/${entityId}`, componentReference: entityId, properties: {},
  });
  const dataset = {
    datasetId: 'BRANCH-TRANSFER', version: 1, sourceSha256: '4'.repeat(64),
    entities: [
      pipe('PIPE-1', 'B1'),
      pipe('PIPE-2', 'B2'),
      { entityId: 'B2', entityType: 'BRANCH', properties: { attributes: { HREF: href, HPOS: { x: 1000, y: 100, z: 0 } } } },
    ],
  };
  const site = (siteId, x) => ({ siteId, tags: [siteId], positionMm: { x, y: 0, z: 0 }, assemblies: [{ members: [{ sourceType: 'REST' }] }] });
  const edge = (entityId, start, end, extra = {}) => ({
    entityId, entityType: 'PIPE', lengthMm: Math.hypot(end.x - start.x, end.y - start.y, end.z - start.z),
    pointComponent: false, topologyCarrier: false, startMm: start, endMm: end, ...extra,
  });
  const routePartitionModel = {
    schema: 'route-partition-model/v1',
    routes: [
      {
        routeId: 'R1', branchId: 'B1', status: 'READY', blockers: [],
        edgeIds: ['PIPE-1', 'OLET-1'], physicalEdgeIds: ['PIPE-1'],
        entityChainages: [
          { entityId: 'PIPE-1', startMm: 0, endMm: 2000, pointMm: 1000, sourceStartChainageMm: 0, sourceEndChainageMm: 2000 },
          { entityId: 'OLET-1', startMm: 1000, endMm: 1000, pointMm: 1000, sourceStartChainageMm: 1000, sourceEndChainageMm: 1000 },
        ],
      },
      {
        routeId: 'R2', branchId: 'B2', status: 'READY', blockers: [],
        edgeIds: ['PIPE-2'], physicalEdgeIds: ['PIPE-2'],
        entityChainages: [
          { entityId: 'PIPE-2', startMm: 0, endMm: 500, pointMm: 250, sourceStartChainageMm: 0, sourceEndChainageMm: 500 },
        ],
      },
    ],
    edges: [
      edge('PIPE-1', { x: 0, y: 0, z: 0 }, { x: 2000, y: 0, z: 0 }),
      edge('OLET-1', { x: 1000, y: 0, z: 0 }, { x: 1000, y: 0, z: 0 }, { pointComponent: true, lengthMm: 0 }),
      edge('PIPE-2', { x: 1000, y: 100, z: 0 }, { x: 1000, y: 600, z: 0 }),
    ],
  };
  return calculateSupportLoadDistribution({
    dataset,
    supportSiteModel: { schema: 'support-site-model/v1', sites: [site('S-A', 0), site('S-B', 2000)] },
    routePartitionModel,
    masterData: {},
    profile,
  }).loadCases[0];
}

test('an unsupported branch hands its weight to the host pipe at its HREF fitting', () => {
  const result = fixture();
  const { equilibrium, completenessAudit } = result;
  assert.equal(equilibrium.passed, true);
  assert.equal(completenessAudit.unallocatedForceN, 0);
  assert.ok(Math.abs(completenessAudit.coverageRatio - 1) < 1e-12);
  const transfer = result.exceptionLedger.find((row) => row.code === 'BRANCH_LOAD_TRANSFERRED_TO_HOST');
  assert.ok(transfer && transfer.verticalForceN > 0);
  assert.equal(transfer.hostEntityId, 'OLET-1');
  // Host weight 2 m, branch 0.5 m at the host midpoint: each support carries half of 2.5 m.
  const [a, b] = ['S-A', 'S-B'].map((id) => result.supportResults.find((row) => row.supportSiteId === id).verticalForceN);
  assert.ok(Math.abs(a - b) < 1e-9);
  assert.ok(Math.abs(transfer.verticalForceN * 5 - (a + b)) < 1e-6, 'branch is 0.5 m of 2.5 m total');
  assert.ok(Math.abs(equilibrium.appliedForceN - (a + b)) < 1e-9, 'applied force is not double counted');
});

test('without an HREF the branch stays unallocated, as before', () => {
  const result = fixture({ href: '' });
  assert.ok(result.completenessAudit.unallocatedForceN > 0);
  assert.equal(result.exceptionLedger.some((row) => row.code === 'BRANCH_LOAD_TRANSFERRED_TO_HOST'), false);
});
