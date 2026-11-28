// One-click 1885S sample project (ROADMAP Phase 1 step 2).
//
// Puts in, in one go, everything an engineer would otherwise load by hand
// before pressing Run:
//   1. the 1885S model (public/fixtures/Sjson.json);
//   2. the bundled masters (piping class, weights, material map), normalised;
//   3. the sample Line List (public/master-data/sample-1885s-line-list.csv);
//   4. proposals from the approved masters, accepted, and the catalogue
//      fitting weights that have one clear winner, accepted;
//   5. the 5 placeholder fitting weights, labelled SAMPLE ASSUMPTION
//      (public/master-data/sample-1885s-placeholder-weights.json).
// It stops before the Run: the engineer presses Run on the Run step.
//
// The same function runs in the browser (the Workspace "Sample 1885S" button)
// and in Node (tests/e2e/headless-1885s-run.mjs), so the end-to-end suite
// checks exactly what the button does.
import { EVENT_TOPICS } from '../event-topics.js';
import { WorkspaceState } from '../workspace-state.js';
import { masterDataController } from '../master-data-controller.js';
import { parseMasterFile, autoMapMasterColumns } from '../master-data-events-handler.js';
import { normalizeLineList } from '../master-data-normalizers.js';
import { projectDataStore } from '../project-data/project-data-store.js';
import { nonFeaEnrichmentStore } from '../enrichment/non-fea-enrichment-store.js';
import { evaluateCurrentNonFeaCommonInput } from '../non-fea-common-input-runtime.js';
import { buildLoadCalcMasterEnrichmentProposals } from '../load-calc-master-candidates.js';
import { buildFittingWeightReviewRows, fittingWeightRecordFor } from '../load-calc-fitting-weight-review.js';
import {
  autoBindMasterSources,
  autoEnsureDefaultQualificationProfile,
  autoGenerateMasterEnrichment,
  autoNormalizeBundledMasters,
} from '../master-data-ui.js';

export const SAMPLE_PROJECT_FILES = Object.freeze({
  dataset: 'fixtures/Sjson.json',
  lineList: 'master-data/sample-1885s-line-list.csv',
  placeholderWeights: 'master-data/sample-1885s-placeholder-weights.json',
});

export const SAMPLE_ASSUMPTION_SOURCE = 'SAMPLE ASSUMPTION — not project data';
const PLACEHOLDER_REVISION = '2026-11-26';
const MASTER_WAIT_MS = 15000;

/**
 * Loads the 1885S sample project into the app's stores.
 * @param {object} options
 * @param {{ publish: Function }} options.eventBus the app EventBus
 * @param {Function} [options.fetchFn] fetch used for the bundled files
 * @param {string} [options.baseUrl] site root the bundled files are served under
 * @param {{ bytes: Uint8Array, fileName: string }} [options.lineList] another
 *   Line List to use instead of the sample one (the end-to-end suite uses this
 *   for the client Line List)
 * @param {(text: string) => void} [options.onProgress] short status lines
 * @returns {Promise<object>} what went in, and the Input Check state
 */
export async function loadSampleProject({
  eventBus,
  fetchFn = globalThis.fetch,
  baseUrl = defaultBaseUrl(),
  lineList = null,
  onProgress = () => {},
} = {}) {
  if (!eventBus || typeof eventBus.publish !== 'function') throw new TypeError('Sample project needs the app EventBus.');
  if (typeof fetchFn !== 'function') throw new TypeError('Sample project needs fetch to read its bundled files.');
  const root = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  const getBytes = async (path) => {
    const response = await fetchFn(`${root}${path}`, { cache: 'no-store' });
    if (!response?.ok) throw new Error(`Sample project file ${path} could not be read (${response?.status ?? 'no response'}).`);
    return new Uint8Array(await response.arrayBuffer());
  };

  // 1. The 1885S model.
  onProgress('Loading the 1885S model…');
  const datasetBytes = await getBytes(SAMPLE_PROJECT_FILES.dataset);
  eventBus.publish(EVENT_TOPICS.DATASET_LOAD_REQUESTED, {
    rawPackage: JSON.parse(new TextDecoder().decode(datasetBytes)),
    sourceName: 'Sjson.json',
    sourceBytes: datasetBytes,
    sourceSha256: await sha256Hex(datasetBytes),
  });
  const dataset = WorkspaceState.getSnapshot().dataset;
  if (!dataset?.sharedModel) throw new Error('The 1885S model did not load; see the message in the Dataset Tree.');

  // 2. Bundled masters. The piping class master arrives by fetch after start-up.
  onProgress('Waiting for the bundled masters…');
  await masterDataController.restorePromise;
  const waitUntil = Date.now() + MASTER_WAIT_MS;
  while (!masterDataController.getMasterData().pipingClass?.rawRows?.length) {
    if (Date.now() > waitUntil) throw new Error('The bundled piping class master did not load within 15 s. Reload the page and try again.');
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  autoNormalizeBundledMasters();
  // The Calculation Defaults screen writes the product defaults into Project
  // Data the first time it opens. Done here, before the seal, so opening that
  // screen after the Run does not make the Run's input stale (HISTORICAL).
  projectDataStore.applyProductDefaults();
  await autoGenerateMasterEnrichment();
  await autoBindMasterSources();
  await autoEnsureDefaultQualificationProfile();

  // 3. Line List, as the Master Data file input puts it in.
  onProgress('Loading the sample Line List…');
  const lineListFile = lineList || {
    bytes: await getBytes(SAMPLE_PROJECT_FILES.lineList),
    fileName: SAMPLE_PROJECT_FILES.lineList.split('/').pop(),
  };
  const parsed = await parseMasterFile(new Blob([lineListFile.bytes]), lineListFile.fileName, 'lineList');
  const fieldMap = autoMapMasterColumns(parsed.rawRows, 'lineList') || {};
  const lineRows = normalizeLineList(parsed.rawRows, fieldMap);
  if (!lineRows.length) throw new Error(`The Line List ${lineListFile.fileName} gave no usable rows.`);
  masterDataController.commitMasterImport('lineList', {
    rawRows: parsed.rawRows, fieldMap, normalizedRows: lineRows, diagnostics: [],
    fileName: lineListFile.fileName, sheetName: parsed.sheetName, sourceMetadata: parsed.sourceMetadata,
  });
  await autoBindMasterSources();

  // 4. Proposals from the approved masters, then clear-winner fitting weights.
  onProgress('Accepting master proposals and fitting weights…');
  const masters = masterDataController.getMasterData();
  const generated = buildLoadCalcMasterEnrichmentProposals({ dataset, masters, projectProfile: projectDataStore.getProfile() });
  generated.proposals.forEach((proposal) => nonFeaEnrichmentStore.stageProposal(proposal));
  nonFeaEnrichmentStore.acceptAllProposals();
  const review = buildFittingWeightReviewRows({ dataset, masters });
  const fittingRecords = review.rows
    .filter((row) => row.clearWinner)
    .map((row) => fittingWeightRecordFor(row, row.candidates[0], 0, masters));
  fittingRecords.forEach((record) => nonFeaEnrichmentStore.stageProposal({
    proposalId: record.recordId, rationale: 'Sample project: clear catalogue winner.', record,
  }));
  nonFeaEnrichmentStore.acceptAllProposals();

  // 5. SAMPLE ASSUMPTION placeholder weights, as the Stage proposal form builds them.
  onProgress('Adding the 5 SAMPLE ASSUMPTION fitting weights…');
  const placeholders = readPlaceholderWeights(await getBytes(SAMPLE_PROJECT_FILES.placeholderWeights));
  for (const row of placeholders) {
    const recordId = `sample-assumption:COMPONENT_WEIGHT:${row.entityId}`;
    nonFeaEnrichmentStore.stageProposal({
      proposalId: recordId,
      rationale: `${SAMPLE_ASSUMPTION_SOURCE}. Placeholder weight from catalogue: ${row.basis}.`,
      record: {
        recordId, selectorKind: 'ENTITY', selectorKey: row.entityId, fieldId: 'COMPONENT_WEIGHT',
        value: row.weightKg, unit: 'kg', authority: 'ACCEPTED_OVERRIDE',
        sourceId: SAMPLE_ASSUMPTION_SOURCE, revision: PLACEHOLDER_REVISION,
        evidence: { source: SAMPLE_ASSUMPTION_SOURCE, locator: row.entityId },
      },
    });
  }
  nonFeaEnrichmentStore.acceptAllProposals();

  const enrichment = nonFeaEnrichmentStore.getSnapshot();
  const report = evaluateCurrentNonFeaCommonInput().report;
  return Object.freeze({
    dataset,
    lineRows,
    lineListFileName: lineListFile.fileName,
    proposals: generated.proposals.length,
    fittingClearWinners: fittingRecords.length,
    fittingReviewRows: review.rows.length,
    sampleAssumptionWeights: Object.freeze(placeholders.map((row) => Object.freeze({ ...row }))),
    acceptedRecords: enrichment.acceptedRecords.length,
    pendingProposals: enrichment.proposals.length,
    inputCheck: report?.packageState || 'UNKNOWN',
    readyMethods: Object.freeze([...(report?.readyMethodIds || [])]),
  });
}

/** One plain sentence for the status line once the sample is in. */
export function sampleProjectSummary(result) {
  const weights = result.sampleAssumptionWeights.length;
  const ready = result.inputCheck === 'READY';
  return `Sample 1885S loaded: ${result.proposals} master proposals and ${result.fittingClearWinners} catalogue fitting weights accepted, `
    + `${weights} fitting weights are SAMPLE ASSUMPTION placeholders. `
    + (ready ? 'Input Check READY — press Run on the Run step.' : `Input Check ${result.inputCheck} — open Input Check to see what is missing.`);
}

function readPlaceholderWeights(bytes) {
  const file = JSON.parse(new TextDecoder().decode(bytes));
  if (file.fieldId !== 'COMPONENT_WEIGHT' || file.unit !== 'kg' || file.authority !== 'ACCEPTED_OVERRIDE') {
    throw new Error('Placeholder weights file must hold COMPONENT_WEIGHT in kg as ACCEPTED_OVERRIDE.');
  }
  const rows = Array.isArray(file.rows) ? file.rows : [];
  rows.forEach((row) => {
    if (typeof row?.entityId !== 'string' || !row.entityId
        || !(Number.isFinite(row.weightKg) && row.weightKg > 0)
        || typeof row.basis !== 'string' || !row.basis) {
      throw new Error(`Placeholder weight row is incomplete: ${JSON.stringify(row)}`);
    }
  });
  return rows;
}

async function sha256Hex(bytes) {
  if (!globalThis.crypto?.subtle) throw new Error('SHA-256 is unavailable; the sample model cannot be loaded without its source hash.');
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('');
}

function defaultBaseUrl() {
  return String(import.meta.env?.BASE_URL || '/');
}
