// End-to-end 1885S Load Calc Run in Node, no browser.
//
// Drives the app's own controllers and stores in the same order as the
// browser benchmark (benchmarks/browser/1885s-run-steps.js):
//   1. load benchmarks/Sjson.json (dataset, topology, supports, load path)
//   2. bundled masters (piping class, weights, material map) auto-normalise
//   3. upload a Line List into Master Data
//   4. proposals from approved masters -> accept; clear-winner fitting weights -> accept
//   5. the 5 SAMPLE ASSUMPTION fitting weights -> accept
//   6. Run (Option B, the AUTO method), then the friction / line stop / guide view
//      and the Results pane markup, exactly as the Load Calc controller builds them.
//
// The stores are app singletons, so call runHeadless1885S once per process
// (the test runner gives every test file its own process).
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

export const SAMPLE_LINE_LIST = 'public/master-data/sample-1885s-line-list.csv';
// The client Line List is local only (public/fixtures/AML-*.xlsx, in
// .git/info/exclude) and never committed; it is found by that pattern so its
// document number stays out of the repo. LOADCALC_E2E_SAMPLE_ONLY=1 runs as if
// it were absent.
export const REAL_LINE_LIST = findClientLineList();
export const hasRealLineList = () => !process.env.LOADCALC_E2E_SAMPLE_ONLY && REAL_LINE_LIST !== null;

function findClientLineList() {
  const folder = ROOT + 'public/fixtures';
  if (!existsSync(folder)) return null;
  const name = readdirSync(folder).filter((file) => /^AML-.*\.xlsx$/iu.test(file)).sort()[0];
  return name ? `public/fixtures/${name}` : null;
}

// SAMPLE ASSUMPTION (owner-approved 2026-11-26): placeholder catalogue weights
// for the 5 fittings with no master row. Same list as the browser benchmark.
export const SAMPLE_FITTING_WEIGHTS = Object.freeze([
  ['=1006649732/51284', 408, 'Flanged Control Valve DN150 900# RF'],
  ['=1006649732/51463', 15, 'Weldneck Flange DN50 900#'],
  ['=1006649732/51476', 4, 'Weldneck Flange DN20 900# (no DN20 blind row)'],
  ['=1006649732/51483', 4, 'Weldneck Flange DN20 900# (no DN20 blind row)'],
  ['=1006649732/51485', 3, 'Weldneck Flange DN15 900#'],
]);

let used = false;

export async function runHeadless1885S({ lineListPath = SAMPLE_LINE_LIST } = {}) {
  if (used) throw new Error('runHeadless1885S runs once per process (app stores are singletons).');
  used = true;
  servePublicFolderToFetch();
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (...args) => { warnings.push(args.map(String).join(' ')); };
  try {
    return await run(lineListPath, warnings);
  } finally {
    console.warn = originalWarn;
  }
}

async function run(lineListPath, warnings) {
  const { EventBus } = await import('../../src/workspace/event-bus.js');
  const { EVENT_TOPICS } = await import('../../src/workspace/event-topics.js');
  const { WorkspaceState } = await import('../../src/workspace/workspace-state.js');
  const { DatasetController } = await import('../../src/workspace/dataset-controller.js');
  const { EngineeringModelController, ENGINEERING_MODEL_EVENTS } = await import('../../src/workspace/engineering-model-controller.js');
  const { engineeringModelStore } = await import('../../src/workspace/engineering-model-store.js');
  const { SharedModelController } = await import('../../src/workspace/shared-model-controller.js');
  const { TopologyController } = await import('../../src/workspace/topology-controller.js');
  const { TopologyStore } = await import('../../src/workspace/topology-store.js');
  const { SupportRestraintController } = await import('../../src/workspace/support-restraint-controller.js');
  const { SupportRestraintStore } = await import('../../src/workspace/support-restraint-store.js');
  const { ModelLoadController } = await import('../../src/workspace/model-load-controller.js');
  const { ModelLoadStore } = await import('../../src/workspace/model-load-store.js');
  const { SupportLoadScreeningController } = await import('../../src/workspace/support-load-screening-controller.js');
  const { SupportLoadScreeningStore } = await import('../../src/workspace/support-load-screening-store.js');
  const { masterDataController } = await import('../../src/workspace/master-data-controller.js');
  const masterUi = await import('../../src/workspace/master-data-ui.js');
  const { parseMasterFile, autoMapMasterColumns } = await import('../../src/workspace/master-data-events-handler.js');
  const { normalizeLineList } = await import('../../src/workspace/master-data-normalizers.js');
  const { projectDataStore } = await import('../../src/workspace/project-data/project-data-store.js');
  const { nonFeaEnrichmentStore } = await import('../../src/workspace/enrichment/non-fea-enrichment-store.js');
  const { evaluateCurrentNonFeaCommonInput } = await import('../../src/workspace/non-fea-common-input-runtime.js');
  const { buildLoadCalcMasterEnrichmentProposals } = await import('../../src/workspace/load-calc-master-candidates.js');
  const { buildFittingWeightReviewRows, fittingWeightRecordFor } = await import('../../src/workspace/load-calc-fitting-weight-review.js');
  const { currentFrictionLoads } = await import('../../src/workspace/load-calc-consumer-controller.js');
  const { buildSupportRestraintTable } = await import('../../src/workspace/support-sites/support-restraint-table.js');
  const { renderEngineeringLoadPane } = await import('../../src/workspace/load-calc-current-system-view.js');

  // Same controllers, same order as bootstrap.js, without the panels.
  new DatasetController(EventBus, WorkspaceState).init();
  const engineeringModelController = new EngineeringModelController(EventBus, WorkspaceState, masterDataController);
  engineeringModelController.init();
  new SharedModelController(EventBus, WorkspaceState, null).init();
  new TopologyController(EventBus, TopologyStore, null).init();
  new SupportRestraintController(EventBus, SupportRestraintStore, TopologyStore, null).init();
  new ModelLoadController(EventBus, ModelLoadStore, null).init();
  new SupportLoadScreeningController(EventBus, SupportLoadScreeningStore, null).init();

  // 1. Dataset
  const datasetBytes = new Uint8Array(readFileSync(ROOT + 'benchmarks/Sjson.json'));
  EventBus.publish(EVENT_TOPICS.DATASET_LOAD_REQUESTED, {
    rawPackage: JSON.parse(new TextDecoder().decode(datasetBytes)),
    sourceName: 'Sjson.json',
    sourceBytes: datasetBytes,
    sourceSha256: createHash('sha256').update(datasetBytes).digest('hex'),
  });
  const dataset = WorkspaceState.getSnapshot().dataset;
  if (!dataset) throw new Error('Sjson.json did not load.');

  // 2. Bundled masters (the piping class master arrives through fetch).
  await masterDataController.restorePromise;
  for (let i = 0; i < 100 && !masterDataController.getMasterData().pipingClass.rawRows.length; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  masterUi.autoNormalizeBundledMasters();
  await masterUi.autoGenerateMasterEnrichment();
  await masterUi.autoBindMasterSources();
  await masterUi.autoEnsureDefaultQualificationProfile();

  // 3. Line List upload, as the Master Data file input does it.
  const lineListName = lineListPath.split('/').pop();
  const parsed = await parseMasterFile(new Blob([readFileSync(ROOT + lineListPath)]), lineListName, 'lineList');
  const fieldMap = autoMapMasterColumns(parsed.rawRows, 'lineList') || {};
  const lineRows = normalizeLineList(parsed.rawRows, fieldMap);
  masterDataController.commitMasterImport('lineList', {
    rawRows: parsed.rawRows, fieldMap, normalizedRows: lineRows, diagnostics: [],
    fileName: lineListName, sheetName: parsed.sheetName, sourceMetadata: parsed.sourceMetadata,
  });
  await masterUi.autoBindMasterSources();

  // 4. Proposals from approved masters, then clear-winner fitting weights.
  const masters = masterDataController.getMasterData();
  const generated = buildLoadCalcMasterEnrichmentProposals({ dataset, masters, projectProfile: projectDataStore.getProfile() });
  generated.proposals.forEach((proposal) => nonFeaEnrichmentStore.stageProposal(proposal));
  nonFeaEnrichmentStore.acceptAllProposals();
  const review = buildFittingWeightReviewRows({ dataset, masters });
  const fittingRecords = review.rows
    .filter((row) => row.clearWinner)
    .map((row) => fittingWeightRecordFor(row, row.candidates[0], 0, masters));
  fittingRecords.forEach((record) => nonFeaEnrichmentStore.stageProposal({
    proposalId: record.recordId, rationale: 'End-to-end suite: clear catalogue winner.', record,
  }));
  nonFeaEnrichmentStore.acceptAllProposals();

  // 5. SAMPLE ASSUMPTION fitting weights, as the Stage proposal form builds them.
  for (const [entityId, kg, basis] of SAMPLE_FITTING_WEIGHTS) {
    const recordId = `sample-assumption:COMPONENT_WEIGHT:${entityId}`;
    const sourceId = 'SAMPLE ASSUMPTION — not project data';
    nonFeaEnrichmentStore.stageProposal({
      proposalId: recordId,
      rationale: `SAMPLE ASSUMPTION — not project data. Placeholder weight from catalogue: ${basis}.`,
      record: {
        recordId, selectorKind: 'ENTITY', selectorKey: entityId, fieldId: 'COMPONENT_WEIGHT',
        value: kg, unit: 'kg', authority: 'ACCEPTED_OVERRIDE', sourceId, revision: '2026-11-26',
        evidence: { source: sourceId, locator: entityId },
      },
    });
  }
  nonFeaEnrichmentStore.acceptAllProposals();
  const enrichment = nonFeaEnrichmentStore.getSnapshot();
  const inputCheck = evaluateCurrentNonFeaCommonInput().report;

  // 6. Run, through the same controller method as the Run button.
  let failure = null;
  EventBus.subscribe(ENGINEERING_MODEL_EVENTS.FAILED, (event) => { failure = event; });
  const runtime = engineeringModelController.calculateCurrentCommonInput();
  if (!runtime) throw new Error(`Run failed: ${failure?.code} ${failure?.message}`);
  const distribution = engineeringModelStore.getDistribution();
  const profile = projectDataStore.getProfile();
  const supportSiteModel = engineeringModelStore.getSupportSiteModel();
  const routePartitionModel = engineeringModelStore.getRoutePartitionModel();
  // Friction, line stops and guides exactly as the Load Calc controller builds
  // them for the Results page (from the same stores).
  const horizontal = currentFrictionLoads(distribution);
  const restraintTable = buildSupportRestraintTable({ supportSiteModel, routePartitionModel, profile });

  // Results pane, with the arguments the Load Calc controller passes.
  const pane = { innerHTML: '' };
  renderEngineeringLoadPane(
    pane, distribution, supportSiteModel, routePartitionModel,
    engineeringModelStore.getAuthorizedExecution(), null,
    engineeringModelStore.getCurrentCommonInputExecution(), horizontal,
  );

  return {
    dataset, profile, lineRows, distribution, runtime, horizontal, restraintTable,
    supportSiteModel, routePartitionModel, paneHtml: pane.innerHTML, warnings,
    inputs: {
      proposals: generated.proposals.length,
      fittingClearWinners: fittingRecords.length,
      fittingReviewRows: review.rows.length,
      acceptedRecords: enrichment.acceptedRecords.length,
      pendingProposals: enrichment.proposals.length,
      inputCheck: inputCheck?.packageState,
      readyMethods: inputCheck?.readyMethodIds || [],
    },
  };
}

// The app fetches bundled masters from the site root ('/master-data/...');
// in Node those paths are read from public/.
function servePublicFolderToFetch() {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    if (typeof url === 'string' && url.startsWith('/')) {
      const path = ROOT + 'public' + decodeURIComponent(url.split('?')[0]);
      return existsSync(path)
        ? new Response(readFileSync(path), { status: 200 })
        : new Response('not found', { status: 404 });
    }
    return realFetch(url, init);
  };
}

export function caseOf(distribution, loadCaseId) {
  return distribution.loadCases.find((loadCase) => loadCase.loadCaseId === loadCaseId);
}

export function tagOf(row) {
  return (row.tags || []).find((tag) => tag.startsWith('PS-')) || (row.tags || [])[0] || row.siteId;
}
