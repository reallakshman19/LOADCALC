// Horizontal support loads shown on the Results page, built from a vertical Run:
// design friction (guide / line stop plan step 3), line stop axial friction
// (step 4), line stop thermal push and guide lateral bounds (steps 4 and 5).
// Pure: every input is passed in, so the app and the end-to-end suite call the
// same code. A failure in the thermal parts hides only those parts.
import { projectDataValue } from '../project-data/project-data-contract.js';
import { buildRouteLegs } from '../routes/route-legs.js';
import { buildSupportFrictionLoads } from './support-friction-loads.js';
import { buildSupportGuideLateralLoads } from './support-guide-lateral-loads.js';
import { buildSupportLineStopLoads } from './support-line-stop-loads.js';
import { buildSupportLineStopThermal } from './support-line-stop-thermal.js';
import { buildSupportRestraintTable } from './support-restraint-table.js';
import { withLineListOperatingTemperatures } from './line-list-temperatures.js';
import { lineExpansionCoefficients } from './thermal-expansion-table.js';

/**
 * @returns {object|null} friction rows plus lineStops, lineStopThermal, guides
 *   and temperatureSource; null when the Run has no load cases.
 */
export function buildHorizontalLoadResults({
  distribution,
  profile,
  supportSiteModel,
  routePartitionModel,
  lineRows = [],
  commonInputSnapshot = null,
  warn = (message, error) => console.warn(message, error),
} = {}) {
  if (!distribution?.loadCases?.length) return null;
  let friction = null;
  try {
    const restraintTable = buildSupportRestraintTable({ supportSiteModel, routePartitionModel, profile });
    // Thermal checks use the Line List's operating temperature per line where
    // Project Data does not set that line itself (a view; Project Data unchanged).
    const modelLines = [...new Set((routePartitionModel?.routes || []).map((route) => route.lineKey).filter(Boolean))];
    const thermal = withLineListOperatingTemperatures(profile, lineRows, modelLines);
    // Expansion coefficient per line from the approved table (material from
    // the Line List, at the line's operating temperature).
    const operatingC = projectDataValue(thermal.profile, 'thermoMechanicalBasis.operatingTemperaturesC') || {};
    const expansion = lineExpansionCoefficients({
      profile,
      materialByLine: Object.fromEntries(lineRows
        .filter((row) => modelLines.includes(String(row.lineKey)) && String(row.material || '').trim())
        .map((row) => [String(row.lineKey), String(row.material).trim()])),
      temperatureByLine: Object.fromEntries(modelLines
        .map((lineKey) => [lineKey, Number.isFinite(operatingC[lineKey]) ? operatingC[lineKey] : operatingC.DEFAULT])
        .filter(([, value]) => Number.isFinite(value))),
    });
    friction = buildSupportFrictionLoads({ restraintTable, distribution, profile: thermal.profile });
    const routeLegs = buildRouteLegs({ routePartitionModel, profile });
    const lineStops = buildSupportLineStopLoads({ restraintTable, frictionLoads: friction, routeLegs });
    const pipeSections = pipeSectionsFromCommonInput(commonInputSnapshot, routePartitionModel);
    let guides = null;
    try {
      guides = buildSupportGuideLateralLoads({
        restraintTable, routeLegs, distribution, profile: thermal.profile,
        pipeSections, expansionByLine: expansion.byLine,
      });
    } catch (error) {
      warn('Guide lateral loads not shown:', error);
    }
    let lineStopThermal = null;
    try {
      lineStopThermal = buildSupportLineStopThermal({
        lineStops, restraintTable, routeLegs, frictionLoads: friction, profile: thermal.profile, distribution,
        pipeSections, expansionByLine: expansion.byLine,
      });
    } catch (error) {
      warn('Line stop thermal push not shown:', error);
    }
    const temperatureSource = {
      source: thermal.source,
      appliedByLine: thermal.applied,
      conflicts: thermal.conflicts,
      expansion: { status: expansion.status, lines: expansion.lines },
    };
    return Object.freeze({ ...friction, lineStops, lineStopThermal, guides, temperatureSource });
  } catch (error) {
    warn('Friction or line stop loads not shown:', error);
    return friction;
  }
}

// Pipe OD and wall per pipe entity, as the sealed common input carries them
// (master data), for the guide and line stop bending checks. Read-only.
export function pipeSectionsFromCommonInput(snapshot, routePartitionModel) {
  const components = snapshot?.commonInput?.enrichedModel?.components
    || snapshot?.request?.enrichedProjection?.enrichedModel?.components
    || [];
  const entityBySource = new Map((routePartitionModel?.edges || [])
    .filter((edge) => edge.source?.sourceEntityId)
    .map((edge) => [String(edge.source.sourceEntityId), edge.entityId]));
  return components
    .filter((component) => component.type === 'PIPE')
    .map((component) => ({
      entityId: entityBySource.get(String(component.sourceEntityId)),
      outsideDiameterMm: component.engineeringProperties?.outerDiameterMm?.value,
      wallThicknessMm: component.engineeringProperties?.wallThicknessMm?.value,
    }))
    .filter((row) => row.entityId);
}
