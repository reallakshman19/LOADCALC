import { freezeDeep } from '../dataset-utils.js';
import { fullyRestrainedAxialForceN } from '../../core/empirical-restraint-loads/index.js';
import { acrossElbow, createThermalBendingContext } from './thermal-bending-context.js';

// Guide and line stop work, plan step 6 (build order 4), the thermal part.
// Label SCREENING: bounds, not one answer.
//
// A line stop is the fixed point of its straight run. On each side the run
// grows away from the stop towards an elbow by delta = alpha x dT x L, L =
// stop to elbow corner. The run past the elbow has to move sideways by the
// part of delta across it, and pushes back along the stop's run:
//   - with a guide on the run past the elbow (the first one from the elbow,
//     L_b = elbow corner to that guide): guided cantilever
//       lower 3 E I d / L_b^3, upper 12 E I d / L_b^3 + sideways friction of
//       the rests between the elbow and that guide;
//   - with no guide there: only friction holds it if its far end is free
//       lower = sideways design friction of its rests;
//     an upper bound needs its far end: when more legs follow, their
//     flexibility is not modelled here, so no upper bound; when it runs to the
//     line end (often a nozzle), the force if that end were fixed,
//       friction + 12 E I d / L^3, L = elbow corner to run end,
//     is a design finding (SHORT_LEG_TO_LINE_END), not a bound.
// The stop carries, on each side, friction (ACCURATE, step 4) + push. Like
// friction, the design value is the larger side.
// A side that ends at the line end (free end, tee or nozzle) has an unknown
// end condition: shown, not guessed. A side that ends at another axial stop
// cannot grow: design finding E·A·α·ΔT, never a normal load.
// A run past the elbow that is not square to the stop's run also takes part
// of delta along itself; that part is not counted (noted on the side).

export const SUPPORT_LINE_STOP_THERMAL_SCHEMA = 'support-line-stop-thermal/v1';

/**
 * @param {object} input
 * @param {object} input.lineStops from buildSupportLineStopLoads (friction per side)
 * @param {object} input.restraintTable from buildSupportRestraintTable
 * @param {object} input.routeLegs from buildRouteLegs (with axialRuns)
 * @param {object} input.frictionLoads from buildSupportFrictionLoads (lateral friction of rests)
 * @param {object} input.profile Project Data profile (thermal view)
 * @param {object} [input.distribution] vertical Run (ledger sections, fallback)
 * @param {object[]} [input.pipeSections] sealed input pipe sections per entity
 * @param {Record<string, number>} [input.expansionByLine] approved table alpha per line
 */
export function buildSupportLineStopThermal({ lineStops, restraintTable, routeLegs, frictionLoads, profile, distribution = null, pipeSections = null, expansionByLine = null } = {}) {
  if (!Array.isArray(lineStops?.rows)) throw new TypeError('lineStops.rows is required.');
  const context = createThermalBendingContext({ restraintTable, routeLegs, distribution, profile, pipeSections, expansionByLine });
  const siteById = new Map(restraintTable.rows.map((site) => [site.siteId, site]));
  const lateralFriction = new Map((frictionLoads?.rows || []).map((row) => [row.siteId, row.lateralMaxN]));
  const base = {
    schema: SUPPORT_LINE_STOP_THERMAL_SCHEMA,
    label: 'SCREENING',
    basis: 'Per side: friction (ACCURATE) + push from the run past the elbow. Guide there: 3·E·I·δ/L³ to 12·E·I·δ/L³ (+ rest friction). No guide: lower = its rests sliding sideways; no upper bound from this hand method (the legs beyond, or a line end such as a nozzle, decide it). Design = larger side.',
    thermal: context.thermal.summary,
  };

  const rows = lineStops.rows.map((stop) => {
    const site = siteById.get(stop.siteId);
    const run = site ? context.runOfSite(site) : null;
    const common = { siteId: stop.siteId, tags: stop.tags, code: stop.code, frictionDesignN: stop.designAxialN };
    if (stop.status !== 'CALCULATED' || !run) {
      return { ...common, status: stop.status !== 'CALCULATED' ? stop.status : 'NO_RUN', sides: [], lowerN: null, upperN: null, findings: [] };
    }
    const sides = stop.sides.map((side) => sidePush(side, site, run, context, lateralFriction));
    const findings = sides.filter((side) => side.finding).map((side) => side.finding);
    const blocked = sides.find((side) => side.status.startsWith('BLOCKED'));
    const unknown = sides.filter((side) => side.status === 'LINE_END_UNKNOWN').map((side) => side.towards);
    const total = (side, key) => side.frictionN + (Number.isFinite(side[key]) ? side[key] : 0);
    // An upper bound only when every side has one: a side that runs to the
    // line end, or past an unguided elbow, leaves it open (never understated).
    const openSides = sides.filter((side) => !Number.isFinite(side.pushUpperN)).map((side) => side.towards);
    return {
      ...common,
      status: blocked ? blocked.status : (unknown.length ? 'CALCULATED_LINE_END_UNKNOWN' : 'CALCULATED'),
      sides,
      lowerN: blocked ? null : Math.max(...sides.map((side) => total(side, 'pushLowerN'))),
      upperN: blocked || openSides.length ? null : Math.max(...sides.map((side) => total(side, 'pushUpperN'))),
      upperOpenSides: openSides,
      unknownSides: unknown,
      findings,
    };
  });
  return freezeDeep({
    ...base,
    status: rows.some((row) => row.status.startsWith('BLOCKED') || row.lowerN === null) ? 'CALCULATED_WITH_BLOCKED_STOPS' : 'CALCULATED',
    rows,
    summary: {
      stopCount: rows.length,
      boundedCount: rows.filter((row) => Number.isFinite(row.upperN)).length,
      maxUpperN: Math.max(0, ...rows.map((row) => row.upperN || 0)),
      lineEndUnknownCount: rows.filter((row) => row.unknownSides?.length).length,
      findingCount: rows.flatMap((row) => row.findings).length,
    },
  });
}

function sidePush(side, site, run, context, lateralFriction) {
  const base = { towards: side.towards, frictionN: side.frictionN, pushLowerN: null, pushUpperN: null };
  const t = context.thermal;
  if (t.status !== 'READY') return { ...base, status: 'BLOCKED_THERMAL_DATA', note: t.reason };
  const deltaT = t.deltaTFor(run.lineKey);
  const material = t.materialFor(run.lineKey);
  const growing = context.alphaFor(run.lineKey);
  if (!Number.isFinite(deltaT) || !material || !growing) return { ...base, status: 'BLOCKED_THERMAL_DATA', note: 'No operating temperature or material for this line.' };
  const E = material.elasticModulusMpa;

  if (side.boundary.kind === 'NEXT_STOP') {
    // Two axial stops on one run: growth between them is blocked.
    const section = context.sections(run, site.pipe.chainageMm, side.boundary.chainageMm);
    const forceN = section && deltaT !== 0
      ? fullyRestrainedAxialForceN({ elasticModulusMpa: E, metalAreaMm2: section.maxA, expansionPerC: growing.alpha, deltaTC: deltaT })
      : (deltaT === 0 ? 0 : null);
    return {
      ...base,
      status: 'GROWTH_BLOCKED_BY_NEXT_STOP',
      pushLowerN: 0,
      pushUpperN: 0,
      note: 'Growth to the next stop is blocked: not a normal load (design finding).',
      finding: forceN ? { code: 'GROWTH_BLOCKED_BETWEEN_STOPS', otherSiteId: side.boundary.siteId, fullyRestrainedForceN: forceN } : null,
    };
  }

  const past = acrossElbow(context, run, side.towards);
  if (!past) {
    if (deltaT === 0) return { ...base, status: 'CALCULATED', pushLowerN: 0, pushUpperN: 0, note: 'No growth: operating temperature equals installation.' };
    return { ...base, status: 'LINE_END_UNKNOWN', note: 'This side runs to the line end (free end, tee or nozzle): end condition unknown, push not estimated.' };
  }
  const { nextRun, tangentMm, turnRad, runEndMm, elbowMmOnNext } = past;
  const growLengthMm = Math.abs(runEndMm - site.pipe.chainageMm) + tangentMm;
  const growthMm = growing.alpha * deltaT * growLengthMm;
  const sideways = Math.sin(turnRad);
  const deflectionMm = Math.abs(growthMm * sideways);
  const detail = {
    ...base,
    nextRunId: nextRun.runId,
    nextOrientation: nextRun.orientation,
    deltaTC: deltaT,
    growLengthMm,
    growthMm,
    deflectionMm,
    thermalExpansionPerC: growing.alpha,
    thermalExpansionSource: growing.source,
    alongNextRunNote: Math.abs(Math.cos(turnRad)) > 1e-6 ? 'Run past the elbow is not square: the part of the growth along it is not counted.' : null,
  };
  if (deflectionMm === 0) return { ...detail, status: 'CALCULATED', pushLowerN: 0, pushUpperN: 0, note: 'No growth: operating temperature equals installation.' };

  // Supports on the run past the elbow, nearest the elbow first.
  const sitesPast = (context.sitesByRun.get(nextRun.runId) || [])
    .map((row) => ({ row, fromElbowMm: Math.abs(row.pipe.chainageMm - elbowMmOnNext) }))
    .sort((a, b) => a.fromElbowMm - b.fromElbowMm);
  const firstGuide = sitesPast.find(({ row }) => context.isGuide(row));
  const restFriction = (upToMm) => sitesPast
    .filter(({ row, fromElbowMm }) => fromElbowMm < upToMm && !context.isGuide(row) && row.status === 'READY')
    .reduce((sum, { row }) => sum + (Number.isFinite(lateralFriction.get(row.siteId)) ? lateralFriction.get(row.siteId) : 0), 0);

  // Pipe section of the run past the elbow; where the data has none there
  // (a short fitting-only piece), the stop's own run on the same line.
  const sectionOf = (fromMm, toMm) => {
    const own = context.sections(nextRun, fromMm, toMm);
    if (own) return { section: own, source: 'RUN_PAST_ELBOW' };
    const fallback = nextRun.lineKey === run.lineKey ? context.sections(run, site.pipe.chainageMm, runEndMm) : null;
    return fallback ? { section: fallback, source: 'STOP_RUN_SAME_LINE' } : null;
  };

  if (firstGuide) {
    const lengthMm = firstGuide.fromElbowMm + tangentMm;
    const found = sectionOf(elbowMmOnNext, firstGuide.row.pipe.chainageMm);
    if (!found) return { ...detail, status: 'BLOCKED_NO_PIPE_SECTION', note: 'No pipe section for the run past the elbow.' };
    const { section } = found;
    const friction = restFriction(firstGuide.fromElbowMm);
    return {
      ...detail,
      status: 'CALCULATED',
      basisKind: 'GUIDE_ON_NEXT_RUN',
      guideSiteId: firstGuide.row.siteId,
      bendLengthMm: lengthMm,
      restFrictionN: friction,
      pipeSizes: [...section.sizes],
      sectionSource: found.source,
      pushLowerN: (3 * E * section.minI * deflectionMm) / lengthMm ** 3,
      pushUpperN: (12 * E * section.maxI * deflectionMm) / lengthMm ** 3 + friction,
    };
  }
  // No guide past the elbow. Lower: its rests slide sideways (far end free).
  // Upper: only bounded by this hand method when its far end is held, and
  // that is not known here. If the run past the elbow ends at another
  // elbow, the legs beyond add flexibility this method does not model: no
  // upper bound. If it ends at the line end (often a nozzle), the force if
  // that end were fixed is reported as a design finding, not as a bound.
  const friction = restFriction(Infinity);
  const farEnd = side.towards === 'END' ? 'END' : 'START';
  const farIsLineEnd = !acrossElbow(context, nextRun, farEnd);
  const result = {
    ...detail,
    status: 'CALCULATED',
    basisKind: 'NO_GUIDE_ON_NEXT_RUN',
    restFrictionN: friction,
    pushLowerN: friction,
    pushUpperN: null,
    upperStatus: farIsLineEnd ? 'LINE_END_IF_FIXED_IS_A_FINDING' : 'NEEDS_FOLLOWING_LEGS',
    note: farIsLineEnd
      ? 'No guide past the elbow and that run goes to the line end: lower = its rests sliding sideways; if the line end is fixed (nozzle), see the finding.'
      : 'No guide past the elbow and more legs beyond it: lower = its rests sliding sideways; an upper bound needs the flexibility of the following legs (not estimated).',
  };
  if (farIsLineEnd) {
    const lengthMm = nextRun.lengthMm + tangentMm;
    const found = sectionOf(nextRun.startMm, nextRun.endMm);
    if (found) {
      // Never more than blocking the stop's growth completely: E·A·α·ΔT of
      // the stop's own run. A leg so short that bending would need more than
      // that cannot absorb the growth at all.
      const bendingN = friction + (12 * E * found.section.maxI * deflectionMm) / lengthMm ** 3;
      const ownSection = context.sections(run, site.pipe.chainageMm, runEndMm);
      const blockedN = ownSection
        ? fullyRestrainedAxialForceN({ elasticModulusMpa: E, metalAreaMm2: ownSection.maxA, expansionPerC: growing.alpha, deltaTC: deltaT })
        : null;
      const capped = Number.isFinite(blockedN) && bendingN > blockedN;
      result.finding = {
        code: 'SHORT_LEG_TO_LINE_END',
        nextRunId: nextRun.runId,
        legLengthMm: lengthMm,
        deflectionMm,
        forceIfLineEndFixedN: capped ? blockedN : bendingN,
        cappedAtFullyRestrained: capped,
        note: capped
          ? 'If the line end is fixed (e.g. a nozzle), this leg is too short to absorb the growth: up to the fully blocked force E·A·α·ΔT.'
          : 'Force on the stop if the line end were fixed (e.g. a nozzle): the leg past the elbow would have to bend by the full growth.',
      };
    }
  }
  return result;
}
