// LOADCALC entry point.
//
// Isolated from Advanced_Analysis (src/main.js). Keeps only the Workspace view,
// the Load Calc view and the 3D Edit (topology-edit) surface they share. The
// LAFEA, LFEA pipeline, Empirical V3 safety workbench and LFEA pre-flight
// surfaces are not part of this app.
import './index.css';
import './workspace/workspace.css';
import './workspace/dataset.css';
import './workspace/viewport-renderer.css';
import './workspace/analysis-session.css';
import './workspace/analysis-ledger.css';
import './workspace/enrichment/first-cut-workbench.css';
import { bootstrapAnalysisWorkspace } from './workspace/bootstrap.js';
import { authorizedEnrichmentConsumerController } from './workspace/enrichment/authorized-enrichment-runtime.js';
import { createAuthorizedEnrichmentWorkspaceApi } from './workspace/enrichment/authorized-enrichment-workspace-api.js';
import { ENGINEERING_MODEL_EVENTS } from './workspace/engineering-model-controller.js';
import { EventBus } from './workspace/event-bus.js';

const applicationRoot = document.getElementById('root');
const coreWorkspace = bootstrapAnalysisWorkspace(applicationRoot);
const authorizedEnrichmentApi = createAuthorizedEnrichmentWorkspaceApi({
  documentRef: applicationRoot.ownerDocument,
  controller: authorizedEnrichmentConsumerController,
  onEmpiricalAuthorizationChanged(state) { EventBus.publish(ENGINEERING_MODEL_EVENTS.CHANGED, { reason: 'authorization-changed', authorizationState: state }); },
  onEmpiricalChanged(execution) { EventBus.publish(ENGINEERING_MODEL_EVENTS.CHANGED, { reason: 'calculated', distribution: execution.distribution, execution }); },
  onEmpiricalFailed(error) { EventBus.publish(ENGINEERING_MODEL_EVENTS.FAILED, { message: error instanceof Error ? error.message : String(error), code: error?.code || 'EMPIRICAL_RUNTIME_EXECUTION_FAILED' }); },
});

const workspace = Object.freeze({
  ...coreWorkspace,
  ...authorizedEnrichmentApi,
});

globalThis.AnalysisWorkspace = workspace;
if (import.meta.hot) import.meta.hot.dispose(() => workspace.destroy());
