import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createEmptyProjectDataProfile,
  replaceProjectDataValue,
} from '../src/workspace/project-data/project-data-contract.js';
import { buildSupportFrictionLoads } from '../src/workspace/support-sites/support-friction-loads.js';

// Guide / line stop plan, step 3: design friction = mu x N_OPE.
// Hand values: 1885S operating loads from the 2026-11-26 Run, mu 0.3.

const row = (siteId, code, directions, status = 'READY') => ({
  siteId, tags: [siteId], code, status,
  friction: { directions, mu: directions.length ? 0.3 : null, muBasis: directions.length ? 'DEFAULT' : null },
  pipe: { axis: { x: 0, y: 1, z: 0 }, lateral: { x: -1, y: 0, z: 0 } },
});
const restraintTable = {
  rows: [
    row('PS-12059', 'R', ['AXIAL', 'LATERAL']),
    row('PS-12242', 'R+G', ['AXIAL']),
    row('PS-12243', 'R+LS', ['LATERAL']),
    row('PS-12060', 'R+G+LS', []),
    row('ATTA', 'NONE', [], 'NOT_A_SUPPORT'),
    row('LIFTED', 'R', ['AXIAL', 'LATERAL']),
  ],
};
const result = (siteId, verticalForceN) => ({ supportSiteId: siteId, verticalForceN });
const distribution = {
  loadCases: [
    { loadCaseId: 'EMPTY', status: 'CALCULATED', supportResults: [result('PS-12059', 6787)] },
    {
      loadCaseId: 'OPE',
      status: 'CALCULATED_WITH_EXCEPTIONS',
      supportResults: [
        result('PS-12059', 8234), result('PS-12242', 2503), result('PS-12243', 2705),
        result('PS-12060', 6859), result('ATTA', 0), result('LIFTED', 0),
      ],
    },
  ],
};

function profile(operating) {
  const pol = { source: 'FIXTURE_POLICY', authority: 'PROJECT_POLICY' };
  let value = createEmptyProjectDataProfile();
  value = replaceProjectDataValue(value, 'thermoMechanicalBasis.installationTemperatureC', 21, pol, true);
  value = replaceProjectDataValue(value, 'thermoMechanicalBasis.operatingTemperaturesC', operating, pol, true);
  return value;
}

test('design friction is mu x N_OPE in the directions the support leaves free', () => {
  const friction = buildSupportFrictionLoads({ restraintTable, distribution, profile: profile({ DEFAULT: 21 }) });
  assert.equal(friction.loadCaseId, 'OPE');
  assert.equal(friction.label, 'ACCURATE');
  assert.equal(friction.status, 'CALCULATED');
  const by = (id) => friction.rows.find((r) => r.siteId === id);
  const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} vs ${b}`);
  close(by('PS-12059').designFrictionN, 2470.2); // 0.3 x 8,234 = 2,470 N, either direction
  close(by('PS-12059').axialMaxN, 2470.2);
  close(by('PS-12059').lateralMaxN, 2470.2);
  close(by('PS-12242').axialMaxN, 750.9); // guide holds lateral: friction along the pipe only
  assert.equal(by('PS-12242').lateralMaxN, 0);
  close(by('PS-12243').lateralMaxN, 811.5); // line stop holds axial: friction across the pipe only
  assert.equal(by('PS-12243').axialMaxN, 0);
  assert.equal(by('PS-12060').designFrictionN, 0); // both horizontal directions held
  assert.equal(by('ATTA').designFrictionN, null);
  assert.equal(by('ATTA').status, 'NOT_A_SUPPORT');
  assert.equal(by('LIFTED').designFrictionN, 0, 'a lifted-off support carries no friction');
  close(friction.summary.totalDesignFrictionN, 2470.2 + 750.9 + 811.5);
  assert.equal(friction.summary.slidingSiteCount, 3);
});

test('movement-based friction is 0 only when no line is hotter than installation', () => {
  const cold = buildSupportFrictionLoads({ restraintTable, distribution, profile: profile({ DEFAULT: 21 }) });
  assert.equal(cold.movement.state, 'NO_THERMAL_MOVEMENT');
  assert.equal(cold.rows.find((r) => r.siteId === 'PS-12059').movementBasedFrictionN, 0);
  const hot = buildSupportFrictionLoads({ restraintTable, distribution, profile: profile({ DEFAULT: 21, S8811951: 150 }) });
  assert.equal(hot.movement.state, 'MOVEMENT_BASED_NOT_BUILT');
  assert.equal(hot.rows.find((r) => r.siteId === 'PS-12059').movementBasedFrictionN, null);
});

test('no operating case means no friction result', () => {
  const none = buildSupportFrictionLoads({ restraintTable, distribution: { loadCases: [distribution.loadCases[0]] }, profile: null });
  assert.equal(none.status, 'NO_OPERATING_CASE');
  assert.deepEqual(none.rows, []);
});
