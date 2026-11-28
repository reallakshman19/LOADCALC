// "SAMPLE ASSUMPTION" notice for the Results page.
//
// Owner rule: sample assumptions stay labelled as such wherever results are
// shown. This lists the inputs of the current Run that are not project data:
//   - accepted records whose source is SAMPLE ASSUMPTION (the 5 placeholder
//     fitting weights the sample project adds);
//   - operating fluid densities taken from the Project Data fallback because
//     the Line List row has none;
//   - Project Data configured defaults whose basis says SAMPLE ASSUMPTION
//     (0 mm insulation where the Line List gives no thickness).
// Nothing is listed when every input is project data.

const SAMPLE_PREFIX = /^SAMPLE ASSUMPTION/u;

/**
 * @param {{ acceptedRecords?: object[], profile?: object|null }} input
 * @returns {string[]} one plain sentence per kind of assumption
 */
export function sampleAssumptionItems({ acceptedRecords = [], profile = null } = {}) {
  const items = [];

  const placeholders = acceptedRecords.filter((record) => SAMPLE_PREFIX.test(String(record?.sourceId || '')));
  const byField = new Map();
  placeholders.forEach((record) => {
    const rows = byField.get(record.fieldId) || [];
    rows.push(record);
    byField.set(record.fieldId, rows);
  });
  for (const [fieldId, rows] of byField) {
    const values = rows.map((row) => `${row.value} ${row.unit || ''}`.trim()).join(', ');
    const what = fieldId === 'COMPONENT_WEIGHT' ? 'fitting weights are placeholders' : `${fieldId} values are placeholders`;
    items.push(`${rows.length} ${what} (${values}), not project data.`);
  }

  const fallbackLines = new Set();
  let fallbackValue = null;
  acceptedRecords.forEach((record) => {
    if (record?.fieldId !== 'OPERATING_FLUID_DENSITY' || record.authority !== 'PROJECT_CONFIGURED_DEFAULT') return;
    if (record.evidence?.fluidDensitySource !== 'projectData:DEFAULT') return;
    fallbackLines.add(String(record.evidence?.lineKey || record.selectorKey));
    fallbackValue = `${record.value} ${String(record.unit || '').replace(/m3$/u, 'm³')}`.trim();
  });
  if (fallbackLines.size) {
    items.push(`Operating fluid density ${fallbackValue} fallback on ${fallbackLines.size} line(s) with no density in the Line List: ${[...fallbackLines].sort().join(', ')}.`);
  }

  const defaults = profile?.qualificationPolicy?.configuredDefaults?.value?.defaults || [];
  defaults
    .filter((row) => SAMPLE_PREFIX.test(String(row?.basis || '')))
    .forEach((row) => {
      items.push(`${fieldLabel(row.fieldId)} ${row.value} ${row.unit || ''} wherever the Line List gives none (Project Data default ${row.defaultId}).`.replace(/\s+/gu, ' '));
    });

  return items;
}

/** HTML for the top of the Results page; empty when there is nothing to say. */
export function sampleAssumptionNoticeMarkup(items) {
  if (!items?.length) return '';
  return `<section class="sample-assumption-notice" data-sample-assumption-notice role="note" style="border:1px solid #b45309;background:#2a1a05;color:#fde68a;border-radius:6px;padding:8px 12px;margin:0 0 12px">
    <strong>SAMPLE ASSUMPTION inputs in this Run</strong> — these are not project data; replace them before using the loads for design.
    <ul style="margin:6px 0 0 18px;padding:0">${items.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>
  </section>`;
}

function fieldLabel(fieldId) {
  if (fieldId === 'INSULATION_THICKNESS') return 'Insulation thickness';
  return String(fieldId || '').toLowerCase().replace(/_/gu, ' ').replace(/^./u, (letter) => letter.toUpperCase());
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/gu, '&amp;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;')
    .replace(/"/gu, '&quot;');
}
