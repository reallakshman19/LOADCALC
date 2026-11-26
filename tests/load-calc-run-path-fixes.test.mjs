import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalizeWorkspaceDataset } from '../src/workspace/dataset-adapter.js';

// Fixes found while driving the 1885S benchmark to Run (2026-11-26).

test('SJSON length unit is read from the POSI text attributes when the package declares none', () => {
  const source = JSON.parse(readFileSync(new URL('../benchmarks/Sjson.json', import.meta.url), 'utf8'));
  const dataset = normalizeWorkspaceDataset(source, 'Sjson.json');
  assert.equal(dataset.sharedModel.units.length, 'mm');
  assert.equal(
    dataset.sharedModel.diagnostics.some((row) => row.code === 'WORKSPACE_LENGTH_UNIT_UNKNOWN'),
    false,
  );
});

test('every 1885S support attaches on its own pipe (centreline projection + order/geometry check)', async () => {
  const { buildPipingPortTopologyGraph } = await import('../src/core/piping-topology/index.js');
  const { buildSupportAttachmentModel } = await import('../src/core/support-restraints/index.js');
  const source = JSON.parse(readFileSync(new URL('../benchmarks/Sjson.json', import.meta.url), 'utf8'));
  const dataset = normalizeWorkspaceDataset(source, 'Sjson.json');
  const model = buildSupportAttachmentModel(dataset.sharedModel, buildPipingPortTopologyGraph(dataset.sharedModel));
  assert.equal(model.attachments.length, 139);
  const far = model.attachments.filter((row) => !(row.distanceCanonical <= 0.5));
  assert.deepEqual(far.map((row) => row.supportKey), []);
  // B1 supports listed after elbow 23 sit on the TAIL pipe, not the elbow.
  const tail = model.attachments.find((row) => row.supportKey === '=1006649732/51417');
  assert.match(tail.attachedComponentKey, /B1 TAIL$/);
});
