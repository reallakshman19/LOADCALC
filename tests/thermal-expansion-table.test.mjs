import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createEmptyProjectDataProfile,
  replaceProjectDataValue,
} from '../src/workspace/project-data/project-data-contract.js';
import { expansionCoefficientAt, lineExpansionCoefficients } from '../src/workspace/support-sites/thermal-expansion-table.js';

// Test values only (not ASME data): CSS 1.30e-5 at 300 C, 1.32e-5 at 325 C.
const temperaturesC = [-29, 0, 21, 50, 75, 100, 125, 150, 175, 200, 225, 250, 275, 300, 325, 350, 375, 400];
const blank = () => temperaturesC.map(() => null);
const css = blank();
css[temperaturesC.indexOf(300)] = 1.30e-5;
css[temperaturesC.indexOf(325)] = 1.32e-5;
const table = {
  schema: 'thermal-expansion-table/v1', unit: 'mm/mm/°C', basis: 'MEAN_FROM_INSTALLATION', temperaturesC,
  materials: { CSS: css, SS316L: blank() },
};
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-12, `${a} vs ${b}`);

test('linear interpolation between the two temperature columns either side', () => {
  close(expansionCoefficientAt(table, 'CSS', 309).value, 1.3072e-5); // 1.30 + 0.02 x 9/25
  close(expansionCoefficientAt(table, 'CSS', 300).value, 1.30e-5);
  assert.deepEqual(expansionCoefficientAt(table, 'CSS', 309).bracketC, [300, 325]);
});

test('nothing is guessed: blank cell, no row, outside the columns', () => {
  assert.equal(expansionCoefficientAt(table, 'CSS', 290).status, 'NOT_FILLED'); // 275 is blank
  assert.equal(expansionCoefficientAt(table, 'SA825', 309).status, 'NO_MATERIAL_ROW');
  assert.equal(expansionCoefficientAt(table, 'CSS', 450).status, 'OUT_OF_RANGE');
  assert.equal(expansionCoefficientAt(table, 'CSS', 450).value, null);
});

test('only an approved table is used, per line material and temperature', () => {
  const pol = { source: 'FIXTURE_POLICY', authority: 'PROJECT_POLICY' };
  const set = (approved) => replaceProjectDataValue(createEmptyProjectDataProfile(), 'thermoMechanicalBasis.thermalExpansionTable', table, pol, approved);
  const input = { materialByLine: { S8811951: 'CSS', W1: 'SS316L' }, temperatureByLine: { S8811951: 309, W1: 62 } };
  assert.equal(lineExpansionCoefficients({ profile: set(false), ...input }).status, 'NOT_APPROVED');
  const ready = lineExpansionCoefficients({ profile: set(true), ...input });
  assert.equal(ready.status, 'READY');
  close(ready.byLine.S8811951, 1.3072e-5);
  assert.equal(ready.byLine.W1, undefined, 'SS316L row is blank');
  assert.equal(ready.lines.find((line) => line.lineKey === 'W1').status, 'NOT_FILLED');
});
