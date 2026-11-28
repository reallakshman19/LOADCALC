// Prints the 1885S results table (guide / line stop plan, step 7) as Markdown,
// from the same Node run as the end-to-end suite (tests/e2e/).
// Run: node benchmarks/checks/1885s-results-table.mjs            (client Line List if present)
//      node benchmarks/checks/1885s-results-table.mjs --sample   (sample Line List in the repo)
import {
  REAL_LINE_LIST, SAMPLE_LINE_LIST, caseOf, hasRealLineList, runHeadless1885S, tagOf,
} from '../../tests/e2e/headless-1885s-run.mjs';

const useSample = process.argv.includes('--sample') || !hasRealLineList();
const result = await runHeadless1885S({ lineListPath: useSample ? SAMPLE_LINE_LIST : REAL_LINE_LIST });
const { distribution, horizontal, restraintTable } = result;

const n = (value) => (Number.isFinite(value) ? Math.round(value).toLocaleString('en-US') : '—');
const bySite = (rows) => new Map((rows || []).map((row) => [row.siteId, row]));
const vertical = Object.fromEntries(['EMPTY', 'OPE', 'HYD'].map((id) => [id, bySite(caseOf(distribution, id).supportResults.map((row) => ({ ...row, siteId: row.supportSiteId })))]));
const friction = bySite(horizontal.rows);
const stops = bySite(horizontal.lineStops?.rows);
const thermal = bySite(horizontal.lineStopThermal?.rows);
const guides = bySite(horizontal.guides?.rows);

const line = (row) => row.lineKeys.map((key) => key.replace(/^.*?-(S\d+)-.*$/u, '$1')).join(',');
const branch = (row) => row.branchIds.map((id) => String(id).replace(/^.*\//u, '')).join(',');

const thermalText = (row) => {
  if (!row) return '';
  const upper = Number.isFinite(row.upperN) ? n(row.upperN) : 'open';
  const finding = [...new Set((row.findings || []).map((f) => (f.code === 'SHORT_LEG_TO_LINE_END'
    ? `${n(f.forceIfLineEndFixedN / 1000)} kN if the line end is fixed${f.cappedAtFullyRestrained ? ' (= fully blocked growth)' : ''}`
    : `growth blocked between stops ≈ ${n(f.fullyRestrainedForceN / 1000)} kN`)))].join('; ');
  return `${n(row.lowerN)} – ${upper}${finding ? `; FINDING: ${finding}` : ''}`;
};

const rows = [...restraintTable.rows].sort((a, b) => line(a).localeCompare(line(b))
  || branch(a).localeCompare(branch(b), 'en', { numeric: true })
  || a.positionMm.x - b.positionMm.x || a.positionMm.y - b.positionMm.y);

console.log(`Line List: ${useSample ? 'sample (repo)' : 'client (local only)'}; method ${result.runtime.selectedMethod}; N, rounded.\n`);
console.log('| # | Support | Line | Branch | Type | EMPTY | OPE | HYD | Friction μ·N_OPE | Line stop axial, friction | Line stop with push, lower – upper | Guide lateral, lower – upper |');
console.log('| ---: | --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | --- | --- |');
const totals = { EMPTY: 0, OPE: 0, HYD: 0, friction: 0 };
rows.forEach((row, index) => {
  const v = (id) => vertical[id].get(row.siteId)?.verticalForceN;
  ['EMPTY', 'OPE', 'HYD'].forEach((id) => { totals[id] += v(id) || 0; });
  const f = friction.get(row.siteId);
  const design = f && f.directions.length ? f.designFrictionN : null;
  totals.friction += design || 0;
  const stop = stops.get(row.siteId);
  const guide = guides.get(row.siteId);
  console.log(`| ${index + 1} | ${tagOf(row)} | ${line(row)} | ${branch(row)} | ${row.code} | ${n(v('EMPTY'))} | ${n(v('OPE'))} | ${n(v('HYD'))} | ${design === null ? '—' : n(design)} | ${stop ? n(stop.designAxialN) : ''} | ${thermalText(thermal.get(row.siteId))} | ${guide ? `${n(guide.lowerN)} – ${n(guide.upperN)}` : ''} |`);
});
console.log(`| | **Total** | | | | **${n(totals.EMPTY)}** | **${n(totals.OPE)}** | **${n(totals.HYD)}** | **${n(totals.friction)}** | | | |`);

// Check: the table adds up to the Run's own applied weight and friction total.
const checks = ['EMPTY', 'OPE', 'HYD'].map((id) => [id, totals[id] - caseOf(distribution, id).equilibrium.appliedForceN]);
checks.push(['friction', totals.friction - horizontal.summary.totalDesignFrictionN]);
const bad = checks.filter(([, diff]) => Math.abs(diff) > 0.01);
console.log(`\nCheck: column totals vs Run totals, differences ${checks.map(([id, diff]) => `${id} ${diff.toFixed(3)} N`).join(', ')}.`);
if (bad.length) { console.error('Totals do not match the Run.'); process.exitCode = 1; }
