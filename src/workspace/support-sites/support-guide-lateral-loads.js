import { freezeDeep } from '../dataset-utils.js';
import { projectDataEntry } from '../project-data/project-data-contract.js';
import { guidedCantileverBoundsN } from '../../core/empirical-restraint-loads/index.js';
import { acrossElbow, createThermalBendingContext, dot, round } from './thermal-bending-context.js';

// Guide and line stop work, plan step 7 (build order 5): guide lateral load
// from thermal growth, by the guided-cantilever hand method (Kellogg).
// Label SCREENING: two bounds, not one answer.
//
// At each end of a straight run that turns at an elbow, the run past the
// elbow grows towards it by delta = alpha x dT x Lg. The part of that growth
// across the guided run (horizontal, perpendicular to it) bends the guided run
// between the elbow and its FIRST guide, over L = guide to elbow corner:
//   lower = 3 E I Delta / L^3  (elbow end free to rotate)
//   upper = 12 E I Delta / L^3 (elbow end held against rotation)
// Lg: from the nearest axial stop on the run past the elbow to the elbow, or
// that whole run when it has no stop (an upper value; its far end may move).
// A riser past the elbow grows vertically: it loads the rests, not the guide.
// Guides further from the elbow than the first one are shielded by it.
// alpha and dT of the growing line; E of the guided line; I of the pipe
// between the guide and the elbow (thermal-bending-context.js).
// "Guide too close to the elbow": upper bound above the guide's design
// capacity (restraintPolicy.guideLateralCapacityN), only when one is set.

export const SUPPORT_GUIDE_LATERAL_LOADS_SCHEMA = 'support-guide-lateral-loads/v1';
const CAPACITY_PATH = 'restraintPolicy.guideLateralCapacityN';

/**
 * @param {object} input
 * @param {object} input.restraintTable from buildSupportRestraintTable
 * @param {object} input.routeLegs from buildRouteLegs (with axialRuns)
 * @param {object} input.distribution vertical Run result (ledger sections, fallback)
 * @param {object} input.profile Project Data profile (thermal view)
 * @param {object[]} [input.pipeSections] sealed input pipe sections per entity
 * @param {Record<string, number>} [input.expansionByLine] approved table alpha per line
 */
export function buildSupportGuideLateralLoads({ restraintTable, routeLegs, distribution, profile, pipeSections = null, expansionByLine = null } = {}) {
  const context = createThermalBendingContext({ restraintTable, routeLegs, distribution, profile, pipeSections, expansionByLine });
  const base = {
    schema: SUPPORT_GUIDE_LATERAL_LOADS_SCHEMA,
    label: 'SCREENING',
    basis: 'Guided cantilever: lower 3·E·I·Δ/L³ (elbow free to rotate), upper 12·E·I·Δ/L³ (held). Δ = growth of the run past the elbow, across the guided run. L = first guide to elbow corner.',
    thermal: context.thermal.summary,
  };
  const capacity = capacityTable(profile);
  const { isGuide, runOfSite, sitesByRun } = context;

  const rows = restraintTable.rows.filter(isGuide).map((guide) => {
    const run = runOfSite(guide);
    const common = { siteId: guide.siteId, tags: guide.tags, code: guide.code, routeId: guide.pipe?.routeId ?? null, chainageMm: guide.pipe?.chainageMm ?? null };
    if (!run) return { ...common, status: 'NO_RUN', ends: [], lowerN: null, upperN: null, flag: null };
    const guides = (sitesByRun.get(run.runId) || []).filter(isGuide);
    const ends = ['START', 'END'].map((end) => {
      const first = end === 'START' ? guides[0] : guides[guides.length - 1];
      if (first !== guide) return { end, status: 'SHIELDED', shieldedBySiteId: first.siteId, lowerN: 0, upperN: 0 };
      return endLoad(end, guide, run, context);
    });
    const blocked = ends.find((row) => row.status.startsWith('BLOCKED'));
    const lowerN = blocked ? null : Math.max(...ends.map((row) => row.lowerN));
    const upperN = blocked ? null : Math.max(...ends.map((row) => row.upperN));
    const cap = capacityFor(capacity, guide);
    let flag = null;
    if (upperN !== null && cap !== null) {
      const governing = ends.reduce((a, b) => (b.upperN > a.upperN ? b : a));
      flag = upperN > cap
        ? { code: 'GUIDE_TOO_CLOSE_TO_ELBOW', capacityN: cap, minimumDistanceMm: governing.minimumLengthFor ? governing.minimumLengthFor(cap) : null }
        : { code: 'WITHIN_CAPACITY', capacityN: cap };
    }
    const cleanEnds = ends.map(({ minimumLengthFor: _helper, ...row }) => row);
    if (flag?.minimumDistanceMm != null) flag.minimumDistanceMm = Math.round(flag.minimumDistanceMm);
    return { ...common, status: blocked ? blocked.status : 'CALCULATED', runId: run.runId, ends: cleanEnds, lowerN, upperN, flag };
  });
  return freezeDeep({
    ...base,
    status: rows.some((row) => row.status !== 'CALCULATED') ? 'CALCULATED_WITH_BLOCKED_GUIDES' : 'CALCULATED',
    capacityStatus: capacity.status,
    rows,
    summary: {
      guideCount: rows.length,
      maxUpperN: Math.max(0, ...rows.map((row) => row.upperN || 0)),
      tooCloseCount: rows.filter((row) => row.flag?.code === 'GUIDE_TOO_CLOSE_TO_ELBOW').length,
    },
  });
}

// One end of the guided run: what lies past it, how much it grows across the
// run, and the two bounds.
function endLoad(end, guide, run, context) {
  const past = acrossElbow(context, run, end);
  if (!past) return { end, status: 'ROUTE_END', note: 'No elbow and run past this end in this route (route end, tee or nozzle).', lowerN: 0, upperN: 0 };
  const { nextRun, tangentMm, runEndMm, elbowMmOnNext } = past;
  const lengthMm = Math.abs(runEndMm - guide.pipe.chainageMm) + tangentMm;
  const across = guide.pipe.lateral ? Math.abs(dot(nextRun.axis, guide.pipe.lateral)) : 0;
  const detail = {
    end,
    nextRunId: nextRun.runId,
    nextOrientation: nextRun.orientation,
    guideToCornerMm: lengthMm,
    elbowTangentMm: tangentMm,
    acrossFactor: round(across, 1e-6),
  };
  if (across < 1e-6) {
    return { ...detail, status: 'NO_LATERAL_COMPONENT', note: nextRun.orientation === 'VERTICAL' ? 'Riser past the elbow: its growth is vertical and loads the rests, not the guide.' : 'Run past the elbow grows along the guided run.', lowerN: 0, upperN: 0 };
  }
  // Growth length of the run past the elbow, towards the elbow.
  const stops = (context.sitesByRun.get(nextRun.runId) || []).filter(context.isStop);
  const nearestStop = stops.length
    ? stops.reduce((a, b) => (Math.abs(b.pipe.chainageMm - elbowMmOnNext) < Math.abs(a.pipe.chainageMm - elbowMmOnNext) ? b : a))
    : null;
  const growthLengthMm = nearestStop ? Math.abs(nearestStop.pipe.chainageMm - elbowMmOnNext) : nextRun.lengthMm;
  const growthBasis = nearestStop ? { kind: 'FROM_AXIAL_STOP', siteId: nearestStop.siteId } : { kind: 'WHOLE_RUN_NO_STOP_UPPER_VALUE' };

  const t = context.thermal;
  if (t.status !== 'READY') return { ...detail, status: 'BLOCKED_THERMAL_DATA', note: t.reason, lowerN: null, upperN: null, growthLengthMm, growthBasis };
  // Growth uses the growing run's line (temperature and alpha); bending uses
  // the guided run's E.
  const deltaT = t.deltaTFor(nextRun.lineKey);
  const material = t.materialFor(run.lineKey);
  const growing = context.alphaFor(nextRun.lineKey);
  if (!Number.isFinite(deltaT) || !material || !growing) return { ...detail, status: 'BLOCKED_THERMAL_DATA', note: 'No operating temperature or material for this line.', lowerN: null, upperN: null, growthLengthMm, growthBasis };
  const growthMm = growing.alpha * deltaT * growthLengthMm;
  const deflectionMm = growthMm * across;
  if (deflectionMm === 0) {
    return { ...detail, status: 'CALCULATED', deltaTC: deltaT, growthLengthMm, growthBasis, deflectionMm, note: 'No growth: operating temperature equals installation.', lowerN: 0, upperN: 0 };
  }
  const section = context.sections(run, guide.pipe.chainageMm, runEndMm);
  if (!section) return { ...detail, status: 'BLOCKED_NO_PIPE_SECTION', note: 'No pipe section for the guided run (sealed input or vertical Run).', lowerN: null, upperN: null, growthLengthMm, growthBasis, deltaTC: deltaT, deflectionMm };
  const E = material.elasticModulusMpa;
  return {
    ...detail,
    status: 'CALCULATED',
    deltaTC: deltaT,
    growthLengthMm,
    growthBasis,
    deflectionMm,
    elasticModulusMpa: E,
    thermalExpansionPerC: growing.alpha,
    thermalExpansionSource: growing.source,
    secondMomentMm4: { min: section.minI, max: section.maxI },
    pipeSizes: [...section.sizes],
    lowerN: guidedCantileverBoundsN({ elasticModulusMpa: E, secondMomentMm4: section.minI, deflectionMm, lengthMm }).lowerN,
    upperN: guidedCantileverBoundsN({ elasticModulusMpa: E, secondMomentMm4: section.maxI, deflectionMm, lengthMm }).upperN,
    // Distance at which the upper bound equals a capacity: (12 E I Delta / F)^(1/3), corner-based.
    minimumLengthFor: (capacityN) => Math.cbrt((12 * E * section.maxI * Math.abs(deflectionMm)) / capacityN),
  };
}

function capacityTable(profile) {
  const entry = profile ? projectDataEntry(profile, CAPACITY_PATH) : null;
  if (!entry) return { status: 'NOT_SET', table: null };
  if (entry.approved !== true || !entry.value || typeof entry.value !== 'object') return { status: 'NOT_APPROVED', table: null };
  if (!Object.keys(entry.value).length) return { status: 'NOT_SET', table: null };
  return { status: 'READY', table: entry.value };
}

function capacityFor(capacity, site) {
  if (!capacity.table) return null;
  const byTag = (site.tags || []).map((tag) => capacity.table[tag]).find((value) => value > 0);
  if (byTag) return byTag;
  return capacity.table.DEFAULT > 0 ? capacity.table.DEFAULT : null;
}
