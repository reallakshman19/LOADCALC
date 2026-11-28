// End-to-end 1885S Load Calc Run in Node, no browser.
//
// Drives the app's own controllers and stores in the same order as the
// browser benchmark (benchmarks/browser/1885s-run-steps.js). Steps 1-5 are
// the Workspace "Sample 1885S" button's own function
// (src/workspace/sample-project/load-sample-project.js):
//   1. load public/fixtures/Sjson.json (dataset, topology, supports, load path)
//   2. bundled masters (piping class, weights, material map) auto-normalise
//   3. upload a Line List into Master Data
//   4. proposals from approved masters -> accept; clear-winner fitting weights -> accept
//   5. the 5 SAMPLE ASSUMPTION fitting weights -> accept
//   6. Run (Option B, the AUTO method), then the friction / line stop / guide view
//      and the Results pane markup, exactly as the Load Calc controller builds them.
//
// The stores are app singletons, so call runHeadless1885S once per process
// (the test runner gives every test file its own process).
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
// for the 5 fittings with no master row. Same list as the browser benchmark;
// the tests check the sample project's JSON file still holds exactly these.
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
  const { projectDataStore } = await import('../../src/workspace/project-data/project-data-store.js');
  const { loadSampleProject } = await import('../../src/workspace/sample-project/load-sample-project.js');
  const { sampleAssumptionItems } = await import('../../src/workspace/sample-project/sample-assumption-notice.js');
  const { nonFeaEnrichmentStore } = await import('../../src/workspace/enrichment/non-fea-enrichment-store.js');
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

  // 1-5. Model, masters, Line List, proposals and fitting weights: the same
  // function as the Workspace "Sample 1885S" button. The sample Line List is
  // fetched from public/ as the button does; another Line List is passed in.
  const loaded = await loadSampleProject({
    eventBus: EventBus,
    baseUrl: '/',
    lineList: lineListPath === SAMPLE_LINE_LIST ? null : {
      bytes: new Uint8Array(readFileSync(ROOT + lineListPath)),
      fileName: lineListPath.split('/').pop(),
    },
  });
  const { dataset, lineRows } = loaded;

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
  // The SAMPLE ASSUMPTION notice the Load Calc controller puts on the Results page.
  const sampleAssumptions = sampleAssumptionItems({
    acceptedRecords: nonFeaEnrichmentStore.getSnapshot().acceptedRecords, profile,
  });

  // Results pane, with the arguments the Load Calc controller passes.
  const renderPane = () => {
    const pane = { innerHTML: '' };
    renderEngineeringLoadPane(
      pane, engineeringModelStore.getDistribution(), supportSiteModel, routePartitionModel,
      engineeringModelStore.getAuthorizedExecution(), null,
      engineeringModelStore.getCurrentCommonInputExecution(), horizontal,
    );
    return pane.innerHTML;
  };
  const paneHtml = renderPane();

  // Opening the Project Data or Calculation Defaults screen after the Run: both
  // write the product defaults on first open. The Run must stay current.
  const { nonFeaCommonInputStore } = await import('../../src/workspace/non-fea-common-input-store.js');
  const screenWrite = projectDataStore.applyProductDefaults();
  const afterScreensOpen = {
    screenWroteDefaults: screenWrite !== null,
    commonInputStale: nonFeaCommonInputStore.getSnapshot().staleness?.stale ?? null,
    paneUnchanged: renderPane() === paneHtml,
  };

  return {
    dataset, profile, lineRows, distribution, runtime, horizontal, restraintTable,
    supportSiteModel, routePartitionModel, paneHtml, warnings, sampleAssumptions, afterScreensOpen,
    inputs: {
      proposals: loaded.proposals,
      fittingClearWinners: loaded.fittingClearWinners,
      fittingReviewRows: loaded.fittingReviewRows,
      sampleAssumptionWeights: loaded.sampleAssumptionWeights,
      acceptedRecords: loaded.acceptedRecords,
      pendingProposals: loaded.pendingProposals,
      inputCheck: loaded.inputCheck,
      readyMethods: loaded.readyMethods,
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
