import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  createEmptyProjectDataProfile,
  replaceProjectDataValue,
} from '../src/workspace/project-data/project-data-contract.js';
import { buildSupportSiteModel } from '../src/workspace/support-sites/support-site-model.js';
import { buildSupportRestraintTable } from '../src/workspace/support-sites/support-restraint-table.js';
import { normalizeWorkspaceDataset } from '../src/workspace/dataset-adapter.js';
import { buildRoutePartitionModel } from '../src/workspace/routes/route-partition-model.js';

// Guide / line stop plan, step 1: the restraint table.

function profile(overrides = null) {
  let value = createEmptyProjectDataProfile();
  const pol = { source: 'FIXTURE_POLICY', authority: 'PROJECT_POLICY' };
  value = replaceProjectDataValue(value, 'topology.supportTypeCapabilities', {
    REST: { vertical: true }, GUIDE: { vertical: false }, LINESTOP: { vertical: false },
  }, pol, true);
  value = replaceProjectDataValue(value, 'restraintPolicy.frictionCoefficients', { STEEL_ON_STEEL: 0.3, STEEL_ON_PTFE: 0.1, DEFAULT: 0.3 }, pol, true);
  value = replaceProjectDataValue(value, 'restraintPolicy.restraintGapsMm', { DEFAULT: 0 }, pol, true);
  value = replaceProjectDataValue(value, 'topology.portMatchToleranceMm', 1, pol, true);
  if (overrides) value = replaceProjectDataValue(value, 'topology.supportTypeOverridesByTag', overrides, pol, true);
  return value;
}

// Pipe along +X at z=0 from x=0 to 10,000; one support part per [tag, type, x].
function fixture(parts, overrides) {
  const p = profile(overrides);
  const dataset = {
    datasetId: 'RESTRAINT-TABLE',
    entities: parts.map(([tag, type, x], index) => ({
      entityId: `SUP-${index}`, sourceEntityId: `SUP-${index}`, componentReference: `SUP-${index}`, jsonPointer: `/s/${index}`,
      category: 'support', branchId: 'B1', lineKey: 'L1', name: tag,
      properties: { attributes: { SUPPORT_TAG: tag, SUPPORT_TYPE: type }, geometry: { center: { x, y: 0, z: 0 } } },
    })),
  };
  const routePartitionModel = {
    routes: [{
      routeId: 'R1', entityChainages: [{ entityId: 'PIPE-1', startMm: 0, endMm: 10000, sourceStartChainageMm: 0, sourceEndChainageMm: 10000, pointMm: 5000 }],
    }],
    edges: [{ entityId: 'PIPE-1', entityType: 'PIPE', lengthMm: 10000, pointComponent: false, topologyCarrier: false, startMm: { x: 0, y: 0, z: 0 }, endMm: { x: 10000, y: 0, z: 0 } }],
  };
  const supportSiteModel = buildSupportSiteModel(dataset, p);
  const table = buildSupportRestraintTable({ supportSiteModel, routePartitionModel, profile: p });
  const byTag = (tag) => table.rows.find((row) => row.tags.includes(tag));
  return { table, byTag, supportSiteModel };
}

test('each support function gives its restrained directions and friction directions', () => {
  const { table, byTag } = fixture([
    ['S-R', 'REST', 1000],
    ['S-RG', 'REST', 3000], ['S-RG', 'GUIDE', 3000],
    ['S-RLS', 'REST', 5000], ['S-RLS', 'LINESTOP', 5000],
    ['S-RGLS', 'REST', 7000], ['S-RGLS', 'GUIDE', 7000], ['S-RGLS', 'LINESTOP', 7000],
    ['S-FRAME', '', 7000],
  ]);
  const r = byTag('S-R');
  assert.equal(r.code, 'R');
  assert.deepEqual(r.restrains, { vertical: 'UP_ONLY_LIFT_OFF_ALLOWED', axial: 'FREE', lateral: 'FREE', rotation: 'FREE' });
  assert.deepEqual(r.friction.directions, ['AXIAL', 'LATERAL']);
  assert.equal(r.friction.mu, 0.3);
  assert.equal(r.gapMm, null);
  const rg = byTag('S-RG');
  assert.equal(rg.code, 'R+G');
  assert.equal(rg.restrains.lateral, 'BOTH');
  assert.deepEqual(rg.friction.directions, ['AXIAL']);
  assert.equal(rg.gapMm, 0);
  const rls = byTag('S-RLS');
  assert.equal(rls.code, 'R+LS');
  assert.equal(rls.restrains.axial, 'BOTH');
  assert.deepEqual(rls.friction.directions, ['LATERAL']);
  const all = byTag('S-RGLS');
  assert.equal(all.code, 'R+G+LS', 'a blank frame part at the same site does not change the function');
  assert.deepEqual(all.friction.directions, []);
  assert.equal(all.blankTypePartCount, 1);
  // Directions are relative to the pipe: along +X, lateral is horizontal and perpendicular.
  assert.deepEqual(r.pipe.axis, { x: 1, y: 0, z: 0 });
  assert.deepEqual(r.pipe.lateral, { x: 0, y: 1, z: 0 });
  assert.equal(r.pipe.orientation, 'HORIZONTAL');
  assert.ok(Math.abs(r.pipe.chainageMm - 1000) < 1e-9);
  assert.equal(table.status, 'PROPOSAL_READY');
});

test('a support with no known function is blocked, never a silent REST', () => {
  const { table, byTag } = fixture([['S-R', 'REST', 1000], ['S-BLANK', '', 4000], ['S-ODD', 'SPRING', 6000]]);
  for (const tag of ['S-BLANK', 'S-ODD']) {
    const row = byTag(tag);
    assert.equal(row.status, 'BLOCKED_UNKNOWN_FUNCTION');
    assert.equal(row.code, '?');
    assert.equal(row.restrains, null);
  }
  assert.deepEqual(byTag('S-ODD').unknownTypes, ['SPRING']);
  assert.equal(table.status, 'PROPOSAL_WITH_BLOCKED_SITES');
  assert.equal(table.summary.blockedSiteIds.length, 2);
});

test('Project Data can type a blank support or mark it NONE; a source type always wins', () => {
  const { table, byTag, supportSiteModel } = fixture(
    [['S-BLANK', '', 2000], ['S-PENE', '', 4000], ['S-SRC', 'GUIDE', 6000], ['S-SRC', 'REST', 6000]],
    { 'S-BLANK': 'REST', 'S-PENE': 'NONE', 'S-SRC': 'LINESTOP' },
  );
  const typed = byTag('S-BLANK');
  assert.equal(typed.code, 'R');
  assert.equal(typed.typeAuthority, 'PROJECT_DATA_SUPPORT_TYPE_OVERRIDE');
  // The site model carries it, so the vertical Run sees a bearing REST.
  const member = supportSiteModel.members.find((row) => row.tag === 'S-BLANK');
  assert.equal(member.sourceType, 'REST');
  assert.equal(member.sourceTypeAuthority, 'PROJECT_DATA_SUPPORT_TYPE_OVERRIDE');
  const pene = byTag('S-PENE');
  assert.equal(pene.status, 'NOT_A_SUPPORT');
  assert.equal(pene.code, 'NONE');
  assert.equal(supportSiteModel.members.find((row) => row.tag === 'S-PENE').sourceType, '');
  assert.equal(byTag('S-SRC').code, 'R+G', 'override ignored where the source has a type');
  assert.equal(table.status, 'PROPOSAL_READY');
});

test('an unknown override value blocks the support-site model instead of guessing', () => {
  const { supportSiteModel } = fixture([['S-BLANK', '', 2000]], { 'S-BLANK': 'ANCHOR-ISH' });
  assert.equal(supportSiteModel.status, 'BLOCKED');
  assert.ok(supportSiteModel.blockers.some((row) => row.code === 'SUPPORT_TYPE_OVERRIDE_INVALID'));
});

test('1885S restraint table with the owner decisions of 2026-11-26', () => {
  const read = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
  const dataset = normalizeWorkspaceDataset(read('../benchmarks/Sjson.json'), 'Sjson.json');
  const p = read('../project-data/1885s-project-data-profile.json');
  const table = buildSupportRestraintTable({
    supportSiteModel: buildSupportSiteModel(dataset, p),
    routePartitionModel: buildRoutePartitionModel(dataset, p),
    profile: p,
  });
  assert.equal(table.status, 'PROPOSAL_READY');
  assert.deepEqual(table.summary.countsByCode, { R: 19, 'R+LS': 6, 'R+G': 1, 'R+G+LS': 5, NONE: 5 });
  const ps12248 = table.rows.filter((row) => row.tags.includes('PS-12248'));
  assert.equal(ps12248.length, 1, 'PS-12248 is one support');
  assert.equal(ps12248[0].code, 'R+G+LS');
  const ps12297 = table.rows.find((row) => row.tags.includes('PS-12297'));
  assert.equal(ps12297.code, 'R');
  assert.equal(ps12297.typeAuthority, 'PROJECT_DATA_SUPPORT_TYPE_OVERRIDE');
  assert.ok(table.rows.every((row) => row.status === 'NOT_A_SUPPORT' || row.pipe?.orientation === 'HORIZONTAL'));
});
