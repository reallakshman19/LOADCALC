import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createEmptyProjectDataProfile,
  replaceProjectDataValue,
} from '../src/workspace/project-data/project-data-contract.js';
import { buildLoadCalcMasterEnrichmentProposals } from '../src/workspace/load-calc-master-candidates.js';

// Master proposals for a pipe: insulation thickness and operating fluid density
// come from the Line List row; a blank thickness is not proposed.

const pol = { source: 'FIXTURE_POLICY', authority: 'PROJECT_POLICY' };
const projectProfile = replaceProjectDataValue(createEmptyProjectDataProfile(), 'loadCalculation.materialDensitiesKgPerM3', { DEFAULT: 7850 }, pol, true);
const dataset = (lineId) => ({
  entities: [{ entityId: 'E1', properties: { attributes: { ABORE: '150mm' } } }],
  sharedModel: { components: [{ type: 'PIPE', componentKey: 'PIPE-1', sourceEntityId: 'E1', identity: { lineId } }] },
});
const masters = (insThk) => ({
  lineList: { fileName: 'line-list', normalizedRows: [{ lineKey: 'S8811951', pipingClass: '91261M7', insThk, operatingFluidDensity: '67', densitySource: 'linelist-density-mixed' }] },
  pipingClass: { fileName: 'piping-class', normalizedRows: [{ pipingClass: '91261M7', convertedBore: 150, componentType: 'PIPE', wallThickness: 14.27 }] },
});
const byField = (result) => Object.fromEntries(result.proposals.map((p) => [p.record.fieldId, p.record]));

test('the Line List insulation thickness is proposed for the pipe, from the Line List', () => {
  const result = buildLoadCalcMasterEnrichmentProposals({ dataset: dataset('S8811951'), masters: masters('80'), projectProfile });
  const fields = byField(result);
  assert.equal(fields.INSULATION_THICKNESS?.value, 80);
  assert.equal(fields.INSULATION_THICKNESS.unit, 'mm');
  assert.equal(fields.INSULATION_THICKNESS.authority, 'EXACT_APPROVED_MASTER');
  assert.equal(fields.INSULATION_THICKNESS.sourceId, 'line-list');
  assert.equal(fields.INSULATION_THICKNESS.evidence.lineKey, 'S8811951');
  assert.equal(fields.OPERATING_FLUID_DENSITY.value, 67);
  assert.equal(fields.PIPE_WALL_THICKNESS?.value, 14.27);
});

test('a blank or zero Line List thickness is not proposed (the configured default applies)', () => {
  assert.equal(byField(buildLoadCalcMasterEnrichmentProposals({ dataset: dataset('S8811951'), masters: masters(''), projectProfile })).INSULATION_THICKNESS, undefined);
  assert.equal(byField(buildLoadCalcMasterEnrichmentProposals({ dataset: dataset('S8811951'), masters: masters('0'), projectProfile })).INSULATION_THICKNESS, undefined);
});
