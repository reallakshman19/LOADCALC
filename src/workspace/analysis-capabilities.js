import { AnalysisCapabilityRegistry } from './analysis-capability-registry.js';
import { supportLoadCapability } from './support-load-capability.js';

// LOADCALC: the Empirical Calc V3 source-bound ROM capability is not
// registered. Its prepared execution was supplied only by the upstream
// Empirical V3 safety workbench, which this app does not include, so the
// capability could never become ready here.
export function createDefaultAnalysisCapabilityRegistry() {
  return new AnalysisCapabilityRegistry()
    .register(supportLoadCapability);
}
