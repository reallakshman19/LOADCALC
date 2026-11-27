import { projectDataEntry } from '../project-data/project-data-contract.js';

// Thermal expansion coefficient by material and temperature, for the thermal
// checks (Project Data thermoMechanicalBasis.thermalExpansionTable).
//
// Table: unit mm/mm/°C, basis MEAN_FROM_INSTALLATION (the mean coefficient
// between installation and T, so growth = coefficient x (T - installation) x L),
// one row per Line List material code, one value per temperature column.
// The coefficient at a line's operating temperature is interpolated linearly
// between the two columns either side. Nothing is guessed: a table that is not
// approved, a material with no row, a temperature outside the columns or a
// blank cell either side gives no value, and the caller keeps
// materialElasticProperties.

export const THERMAL_EXPANSION_TABLE_PATH = 'thermoMechanicalBasis.thermalExpansionTable';
export const THERMAL_EXPANSION_TABLE_SCHEMA = 'thermal-expansion-table/v1';

/** Coefficient for one material at one temperature, with why when there is none. */
export function expansionCoefficientAt(table, material, temperatureC) {
  if (!table || table.schema !== THERMAL_EXPANSION_TABLE_SCHEMA) return { value: null, status: 'NO_TABLE' };
  const temperatures = table.temperaturesC || [];
  const row = table.materials?.[material];
  if (!Array.isArray(row)) return { value: null, status: 'NO_MATERIAL_ROW', material };
  if (!Number.isFinite(temperatureC)) return { value: null, status: 'NO_TEMPERATURE' };
  for (let i = 0; i < temperatures.length; i += 1) {
    const t0 = temperatures[i];
    if (temperatureC === t0) {
      return Number.isFinite(row[i]) ? { value: row[i], status: 'TABLE', bracketC: [t0, t0] } : { value: null, status: 'NOT_FILLED', bracketC: [t0, t0] };
    }
    const t1 = temperatures[i + 1];
    if (Number.isFinite(t1) && temperatureC > t0 && temperatureC < t1) {
      if (!Number.isFinite(row[i]) || !Number.isFinite(row[i + 1])) return { value: null, status: 'NOT_FILLED', bracketC: [t0, t1] };
      const value = row[i] + ((row[i + 1] - row[i]) * (temperatureC - t0)) / (t1 - t0);
      return { value, status: 'TABLE', bracketC: [t0, t1] };
    }
  }
  return { value: null, status: 'OUT_OF_RANGE', rangeC: [temperatures[0], temperatures[temperatures.length - 1]] };
}

/**
 * Coefficient per model line from the approved table, each line's material
 * (Line List) and operating temperature.
 * @param {object} input
 * @param {object} input.profile Project Data profile
 * @param {Record<string, string>} input.materialByLine { lineKey: Line List material code }
 * @param {Record<string, number>} input.temperatureByLine { lineKey: operating temperature °C }
 */
export function lineExpansionCoefficients({ profile, materialByLine = {}, temperatureByLine = {} } = {}) {
  const entry = profile ? projectDataEntry(profile, THERMAL_EXPANSION_TABLE_PATH) : null;
  if (!entry) return { status: 'NOT_SET', byLine: {}, lines: [] };
  if (entry.approved !== true) return { status: 'NOT_APPROVED', byLine: {}, lines: [] };
  const table = entry.value;
  const byLine = {};
  const lines = Object.keys(temperatureByLine).sort().map((lineKey) => {
    const material = materialByLine[lineKey] || null;
    const temperatureC = temperatureByLine[lineKey];
    const result = material ? expansionCoefficientAt(table, material, temperatureC) : { value: null, status: 'NO_LINE_MATERIAL' };
    if (Number.isFinite(result.value)) byLine[lineKey] = result.value;
    return { lineKey, material, temperatureC, ...result };
  });
  return { status: 'READY', unit: table?.unit || null, basis: table?.basis || null, byLine, lines };
}
