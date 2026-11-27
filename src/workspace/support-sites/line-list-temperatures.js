import { projectDataEntry, replaceProjectDataValue } from '../project-data/project-data-contract.js';

// Operating temperatures for the thermal checks (friction movement, guide
// bounds, line stop push) from the Line List master. Project Data's own
// evidence for thermoMechanicalBasis.operatingTemperaturesC says the Line
// List master takes precedence for hot lines; this applies that.
//
// Source: the Line List's operating temperature at working conditions (T2,
// e.g. "AT WORKING CONDITIONS | Temp. ºC"), keyed by the master's line key
// (Service + Line number, e.g. S8811951) as in the model's branch names.
// A line key set explicitly in Project Data wins over the Line List. Lines
// the Line List does not cover keep Project Data's DEFAULT. The result is a
// view for these checks only: Project Data itself is not changed.

export const LINE_LIST_TEMPERATURE_FIELD = 't2';

/**
 * @param {object[]} lineRows Line List master normalized rows ({ lineKey, t2, ... })
 * @param {string[]} [lineKeys] model line keys to keep (others are ignored)
 * @returns {{ byLine: Record<string, number>, rows: object[] }}
 */
export function lineListOperatingTemperatures(lineRows, lineKeys = null) {
  const wanted = lineKeys ? new Set(lineKeys) : null;
  const byLine = {};
  const rows = [];
  (Array.isArray(lineRows) ? lineRows : []).forEach((row) => {
    const lineKey = String(row?.lineKey || '').trim();
    if (!lineKey || (wanted && !wanted.has(lineKey))) return;
    const value = Number(String(row[LINE_LIST_TEMPERATURE_FIELD] ?? '').trim());
    if (String(row[LINE_LIST_TEMPERATURE_FIELD] ?? '').trim() === '' || !Number.isFinite(value)) return;
    if (Object.hasOwn(byLine, lineKey) && byLine[lineKey] !== value) {
      rows.push({ lineKey, conflict: true, values: [byLine[lineKey], value] });
      return;
    }
    byLine[lineKey] = value;
    rows.push({ lineKey, temperatureC: value, sourceRowNumber: row._sourceRowNumber ?? null });
  });
  // A line listed twice with different temperatures is not used.
  rows.filter((row) => row.conflict).forEach((row) => { delete byLine[row.lineKey]; });
  return { byLine, rows };
}

/**
 * Returns the profile the thermal checks should use, and what changed.
 * @param {object} profile Project Data profile
 * @param {object[]} lineRows Line List master normalized rows
 * @param {string[]} [lineKeys] model line keys
 */
export function withLineListOperatingTemperatures(profile, lineRows, lineKeys = null) {
  const entry = profile ? projectDataEntry(profile, 'thermoMechanicalBasis.operatingTemperaturesC') : null;
  const current = entry?.value && typeof entry.value === 'object' ? entry.value : {};
  const { byLine, rows } = lineListOperatingTemperatures(lineRows, lineKeys);
  const applied = Object.fromEntries(Object.entries(byLine).filter(([lineKey]) => !Object.hasOwn(current, lineKey)));
  const conflicts = rows.filter((row) => row.conflict).map((row) => row.lineKey);
  if (!profile || !Object.keys(applied).length) {
    return { profile, applied: {}, conflicts, source: 'PROJECT_DATA' };
  }
  const merged = { ...current, ...applied };
  const evidence = {
    source: 'Line List master: operating temperature at working conditions (T2), by Service + Line number',
    locator: `Applied for ${Object.keys(applied).join(', ')}; Project Data keeps DEFAULT and any line set there`,
    authority: 'EXACT_APPROVED_MASTER',
  };
  return {
    profile: replaceProjectDataValue(profile, 'thermoMechanicalBasis.operatingTemperaturesC', merged, evidence, entry?.approved !== false),
    applied,
    conflicts,
    source: 'LINE_LIST_MASTER',
  };
}
