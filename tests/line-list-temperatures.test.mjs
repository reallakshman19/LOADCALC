import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createEmptyProjectDataProfile,
  projectDataValue,
  replaceProjectDataValue,
} from '../src/workspace/project-data/project-data-contract.js';
import { withLineListOperatingTemperatures } from '../src/workspace/support-sites/line-list-temperatures.js';

// Line List master rows as the app normalizes them (lineKey = Service + Line number).
const rows = [
  { lineKey: 'S8810101', t1: '325', t2: '309', t3: '5' },
  { lineKey: 'S8811951', t1: '325', t2: '309' },
  { lineKey: 'W8810111', t2: '62' }, // another service, same number: not in the model
  { lineKey: 'S8810103', t2: '' }, // no operating temperature: not used
];
const pol = { source: 'FIXTURE_POLICY', authority: 'PROJECT_POLICY' };
const profile = (operating) => replaceProjectDataValue(createEmptyProjectDataProfile(), 'thermoMechanicalBasis.operatingTemperaturesC', operating, pol, true);
const modelLines = ['S8810101', 'S8810103', 'S8811951', 'S8810111'];

test('the Line List operating temperature (T2) is used per model line; DEFAULT stays for the rest', () => {
  const result = withLineListOperatingTemperatures(profile({ DEFAULT: 21 }), rows, modelLines);
  assert.equal(result.source, 'LINE_LIST_MASTER');
  assert.deepEqual(result.applied, { S8810101: 309, S8811951: 309 });
  assert.deepEqual(projectDataValue(result.profile, 'thermoMechanicalBasis.operatingTemperaturesC'), { DEFAULT: 21, S8810101: 309, S8811951: 309 });
});

test('a line set in Project Data wins over the Line List', () => {
  const result = withLineListOperatingTemperatures(profile({ DEFAULT: 21, S8810101: 250 }), rows, modelLines);
  assert.deepEqual(result.applied, { S8811951: 309 });
  assert.equal(projectDataValue(result.profile, 'thermoMechanicalBasis.operatingTemperaturesC').S8810101, 250);
});

test('no Line List, or two different temperatures for one line: Project Data as it is', () => {
  const none = withLineListOperatingTemperatures(profile({ DEFAULT: 21 }), [], modelLines);
  assert.equal(none.source, 'PROJECT_DATA');
  const conflict = withLineListOperatingTemperatures(profile({ DEFAULT: 21 }), [{ lineKey: 'S8810101', t2: '309' }, { lineKey: 'S8810101', t2: '250' }], modelLines);
  assert.deepEqual(conflict.conflicts, ['S8810101']);
  assert.deepEqual(conflict.applied, {});
});
