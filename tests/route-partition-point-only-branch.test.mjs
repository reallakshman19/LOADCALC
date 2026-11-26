import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRoutePartitionModel } from '../src/workspace/routes/route-partition-model.js';
import { createEmptyProjectDataProfile } from '../src/workspace/project-data/project-data-contract.js';

function entity(entityId, branchId, start, end, entityType = 'PIPE', lineKey = 'L1') {
  return {
    entityId, branchId, lineKey, entityType, category: 'component',
    properties: { geometry: { start, end }, attributes: {} },
  };
}

const p = (x) => ({ x, y: 0, z: 0 });

test('a point-only branch attaches to the route it touches', () => {
  const model = buildRoutePartitionModel({
    datasetId: 'ds',
    entities: [
      entity('pipe-1', 'B4', p(0), p(1000)),
      entity('flange-1', 'B4', p(1000), p(1100), 'FLANGE'),
      entity('gauge-1', 'B5', p(1100), p(1100), 'INSTRUMENT'),
    ],
  }, createEmptyProjectDataProfile());
  assert.equal(model.status, 'READY');
  assert.equal(model.routes.length, 1);
  const [route] = model.routes;
  assert.ok(route.edgeIds.includes('gauge-1'));
  const row = route.entityChainages.find((r) => r.entityId === 'gauge-1');
  assert.equal(row.pointMm, 1100);
  assert.deepEqual(route.attachedPointComponents.map((r) => [r.entityId, r.fromBranchId]), [['gauge-1', 'B5']]);
  assert.equal('pointOnlyEdges' in route, false);
  assert.ok(Object.isFrozen(route));
});

test('a point-only branch touching nothing stays unattached', () => {
  const model = buildRoutePartitionModel({
    datasetId: 'ds',
    entities: [
      entity('pipe-1', 'B4', p(0), p(1000)),
      entity('gauge-1', 'B5', p(5000), p(5000), 'INSTRUMENT'),
    ],
  }, createEmptyProjectDataProfile());
  assert.equal(model.routes.length, 2);
  const orphan = model.routes.find((r) => r.branchId === 'B5');
  assert.deepEqual(orphan.entityChainages, []);
});

test('a point-only branch on another line is not attached', () => {
  const model = buildRoutePartitionModel({
    datasetId: 'ds',
    entities: [
      entity('pipe-1', 'B4', p(0), p(1000), 'PIPE', 'L1'),
      entity('gauge-1', 'B5', p(1000), p(1000), 'INSTRUMENT', 'L2'),
    ],
  }, createEmptyProjectDataProfile());
  assert.equal(model.routes.length, 2);
});
