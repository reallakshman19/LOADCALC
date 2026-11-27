// Prints the 1885S support restraint table (guide/line stop plan, step 1).
// Run: node benchmarks/checks/1885s-restraint-table.mjs   (add --json for the raw rows)
import { readFileSync } from 'node:fs';
import { normalizeWorkspaceDataset } from '../../src/workspace/dataset-adapter.js';
import { buildRoutePartitionModel } from '../../src/workspace/routes/route-partition-model.js';
import { buildSupportSiteModel } from '../../src/workspace/support-sites/support-site-model.js';
import { buildSupportRestraintTable } from '../../src/workspace/support-sites/support-restraint-table.js';

const read = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const dataset = normalizeWorkspaceDataset(read('../Sjson.json'), 'Sjson.json');
const profile = read('../../project-data/1885s-project-data-profile.json');
const table = buildSupportRestraintTable({
  supportSiteModel: buildSupportSiteModel(dataset, profile),
  routePartitionModel: buildRoutePartitionModel(dataset, profile),
  profile,
});

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(table, null, 2));
} else {
  const n = (v) => Math.round(v).toLocaleString('en-US');
  const line = (row) => row.lineKeys.map((key) => key.replace(/^.*?-(S\d+)-.*$/, '$1')).join(',')
    + ' ' + row.branchIds.map((id) => String(id).replace(/^.*\//, '')).join(',');
  const short = { UP_ONLY_LIFT_OFF_ALLOWED: 'up only', BOTH: 'both', FREE: 'free', NONE: 'none' };
  console.log('| # | Tag | Line / branch | X | Y | Z | Type | Vertical | Axial | Lateral | Friction (μ) | Pipe | Type from |');
  console.log('| ---: | --- | --- | ---: | ---: | ---: | --- | --- | --- | --- | --- | --- | --- |');
  [...table.rows]
    .sort((a, b) => line(a).localeCompare(line(b)) || a.positionMm.x - b.positionMm.x || a.positionMm.y - b.positionMm.y)
    .forEach((row, index) => {
      const tag = row.tags.find((t) => t.startsWith('PS-')) || row.tags[0];
      const r = row.restrains;
      const friction = row.friction.directions.length ? `${row.friction.directions.join('+').toLowerCase()} (${row.friction.mu})` : '—';
      console.log(`| ${index + 1} | ${tag} | ${line(row)} | ${n(row.positionMm.x)} | ${n(row.positionMm.y)} | ${n(row.positionMm.z)} | ${row.code} | ${r ? short[r.vertical] : '—'} | ${r ? short[r.axial] : '—'} | ${r ? short[r.lateral] : '—'} | ${friction} | ${row.pipe?.orientation?.toLowerCase() ?? '—'} | ${row.typeAuthority === 'SOURCE' ? 'source' : row.typeAuthority ? 'owner decision' : '—'} |`);
    });
  console.log('\nstatus', table.status, JSON.stringify(table.summary));
}
