// 1885S benchmark Run, driven from the browser console (or an agent's
// javascript tool). Paste ONE step at a time and wait for it to return:
// agent JS tools time out at about 45 s, and step 1 reloads the page.
// Start the dev server first: npm run dev  (http://localhost:5173).
// Steps 1-6 were used on 2026-11-26 to get the results recorded in ROADMAP.md.

// ---- Step 1: clean state (clears localStorage and the master-data IndexedDB, then reloads)
localStorage.clear(); await new Promise((r) => { const q = indexedDB.deleteDatabase('MasterDataDB'); q.onsuccess = q.onerror = q.onblocked = () => r(); }); location.reload(); 'ok';

// ---- Step 2: load the benchmark model
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const put = async (sel, url, name) => { const b = await fetch(url, { cache: 'no-store' }).then((r) => r.blob()); const dt = new DataTransfer(); dt.items.add(new File([b], name)); const el = document.querySelector(sel); el.files = dt.files; el.dispatchEvent(new Event('change', { bubbles: true })); };
await sleep(2000); await put('[data-role="dataset-file"]', '/fixtures/Sjson.json', 'Sjson.json'); await sleep(5000); 'loaded';

// ---- Step 3: open Load Calc, Master Data step, upload the sample Line List
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const step = (re) => [...document.querySelectorAll('nav[aria-label="Load calculation process"] button')].find((b) => re.test(b.textContent)).click();
const put = async (sel, url, name) => { const b = await fetch(url, { cache: 'no-store' }).then((r) => r.blob()); const dt = new DataTransfer(); dt.items.add(new File([b], name)); const el = document.querySelector(sel); el.files = dt.files; el.dispatchEvent(new Event('change', { bubbles: true })); };
[...document.querySelectorAll('button')].find((b) => /Edit, Topo fix and Load Calc/.test(b.textContent)).click(); await sleep(2000);
step(/Master Data/); await sleep(2000);
await put('[data-master-file="lineList"]', '/master-data/sample-1885s-line-list.csv', 'sample-1885s-line-list.csv'); await sleep(5000); 'a done';

// ---- Step 4: proposals from masters, accept, then catalogue fitting weights
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const btn = (re, root = document) => [...root.querySelectorAll('button')].find((b) => b.offsetParent && re.test(b.textContent));
btn(/Open Enrichment & Overrides/).click(); await sleep(1500);
btn(/Generate proposals from approved masters/).click(); await sleep(3000);
btn(/Accept all unblocked/)?.click(); await sleep(3000);
btn(/Review fitting weights/).click(); await sleep(2500);
let dlg = document.querySelector('dialog[open], [role=dialog]');
btn(/Fill all clear winners/, dlg).click(); await sleep(500);
btn(/Apply weights shown/, dlg).click(); await sleep(3000);
btn(/Accept all unblocked/)?.click(); await sleep(2000); 'b done';

// ---- Step 5: 5 placeholder fitting weights (SAMPLE ASSUMPTION, owner-approved 2026-11-26;
// also listed in public/master-data/sample-1885s-placeholder-weights.json), Input Check, Seal, open Run
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const btn = (re, root = document) => [...root.querySelectorAll('button')].find((b) => b.offsetParent && re.test(b.textContent));
const step = (re) => [...document.querySelectorAll('nav[aria-label="Load calculation process"] button')].find((b) => re.test(b.textContent)).click();
const rows = [
  ['=1006649732/51284', 408, 'Flanged Control Valve DN150 900# RF'],
  ['=1006649732/51463', 15, 'Weldneck Flange DN50 900#'],
  ['=1006649732/51476', 4, 'Weldneck Flange DN20 900# (no DN20 blind row)'],
  ['=1006649732/51483', 4, 'Weldneck Flange DN20 900# (no DN20 blind row)'],
  ['=1006649732/51485', 3, 'Weldneck Flange DN15 900#'],
];
const getForm = () => btn(/^Stage proposal$/).closest('form, section, fieldset');
const set = (f, n, v) => { const e = f.querySelector(`[name="${n}"]`); e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); };
for (const [id, kg, basis] of rows) {
  let f = getForm(); set(f, 'selectorKind', 'ENTITY'); set(f, 'fieldId', 'COMPONENT_WEIGHT');
  f = getForm(); set(f, 'authority', 'ACCEPTED_OVERRIDE');
  f = getForm(); set(f, 'recordId', `sample-assumption:COMPONENT_WEIGHT:${id}`); set(f, 'selectorKey', id); set(f, 'value', String(kg)); set(f, 'unit', 'kg');
  set(f, 'sourceId', 'SAMPLE ASSUMPTION — not project data'); set(f, 'revision', '2026-11-26');
  set(f, 'rationale', `SAMPLE ASSUMPTION — not project data. Placeholder weight from catalogue: ${basis}.`);
  [...f.querySelectorAll('button')].find((b) => /^Stage proposal$/.test(b.textContent.trim())).click(); await sleep(1000);
}
btn(/Accept all unblocked/)?.click(); await sleep(2500);
step(/Input Check/); await sleep(3000);
btn(/^Seal Validated Input$/)?.click(); await sleep(4000);
step(/Run/); await sleep(1500); 'ready';

// ---- Step 6: Run (about 38 s) and summarise every load case
[...document.querySelectorAll('button')].find((b) => b.offsetParent && /Run Load Calc — Gravity/.test(b.textContent)).click();
await new Promise((r) => setTimeout(r, 38000));
const d = AnalysisWorkspace.getEngineeringSupportLoadDistribution();
const out = {};
if (d) for (const c of d.loadCases) {
  const codes = {}; c.exceptionLedger.forEach((e) => { codes[e.code] = (codes[e.code] || 0) + 1; });
  out[c.loadCaseId] = {
    status: c.status, eq: c.equilibrium.status,
    applied: +c.equilibrium.appliedForceN.toFixed(1), reaction: +c.equilibrium.reactionN.toFixed(1),
    unalloc: +c.equilibrium.unallocatedForceN.toFixed(1), transfer: +(c.equilibrium.branchTransferForceN || 0).toFixed(1),
    coverage: +(c.completenessAudit.coverageRatio * 100).toFixed(2), codes,
  };
}
out;
// Expected (2026-11-26, commit 0cd2a79): EMPTY / OPE / HYD applied 87.6 / 100.4 / 104.0 kN,
// equilibrium PASSED, coverage 100 %, 83 × OVERHANG_CANTILEVER_TRANSFER, 2 × BRANCH_LOAD_TRANSFERRED_TO_HOST.

// ---- Step 7 (UNTESTED helper): export one route's loads in the benchmarks/checks/route-b2-data.mjs format
const rp = AnalysisWorkspace.getRoutePartitionModel();
const dist = AnalysisWorkspace.getEngineeringSupportLoadDistribution();
const routeMatch = 'S8811951'; const branch = '/B2:'; // change to pick another route
const route = rp.routes.find((r) => r.routeId.includes(routeMatch) && r.routeId.includes(branch));
const empty = dist.loadCases.find((c) => c.loadCaseId === 'EMPTY');
const byEntity = new Map(route.entityChainages.map((row) => [row.entityId, row]));
const items = empty.ledger.filter((row) => row.routeId === route.routeId).map((row) => {
  const ch = byEntity.get(row.entityId);
  const distributed = rp.edges.find((e) => e.entityId === row.entityId)?.entityType === 'PIPE' ? 1 : 0;
  return [+row.massKg.toFixed(2), +ch.startMm.toFixed(2), +ch.endMm.toFixed(2), distributed];
});
const sup = empty.supportResults.filter((s) => (s.routeIds || []).includes(route.routeId)).map((s) => s.chainageMm);
({ routeId: route.routeId, items, sup });
