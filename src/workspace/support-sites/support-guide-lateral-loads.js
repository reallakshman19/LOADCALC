import { freezeDeep } from '../dataset-utils.js';
import { projectDataEntry, projectDataValue } from '../project-data/project-data-contract.js';
import { createNonFeaProductDefaultProvider } from '../project-data/non-fea-product-default-profile.js';
import { guidedCantileverBoundsN, pipeSecondMomentMm4 } from '../../core/empirical-restraint-loads/index.js';

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
// E and I: E and alpha from thermoMechanicalBasis.materialElasticProperties;
// the pipe section exactly as the vertical Run used it (OPE ledger).
// "Guide too close to the elbow": upper bound above the guide's design
// capacity (restraintPolicy.guideLateralCapacityN), only when one is set.

export const SUPPORT_GUIDE_LATERAL_LOADS_SCHEMA = 'support-guide-lateral-loads/v1';
const CAPACITY_PATH = 'restraintPolicy.guideLateralCapacityN';

/**
 * @param {object} input
 * @param {object} input.restraintTable from buildSupportRestraintTable
 * @param {object} input.routeLegs from buildRouteLegs (with axialRuns)
 * @param {object} input.distribution vertical Run result (OPE ledger gives pipe sections)
 * @param {object} input.profile Project Data profile
 */
export function buildSupportGuideLateralLoads({ restraintTable, routeLegs, distribution, profile, pipeSections = null } = {}) {
  if (!Array.isArray(restraintTable?.rows)) throw new TypeError('restraintTable.rows is required.');
  if (!Array.isArray(routeLegs?.legs) || !Array.isArray(routeLegs?.axialRuns)) throw new TypeError('routeLegs with axialRuns is required.');
  const thermal = thermalBasis(profile);
  const base = {
    schema: SUPPORT_GUIDE_LATERAL_LOADS_SCHEMA,
    label: 'SCREENING',
    basis: 'Guided cantilever: lower 3·E·I·Δ/L³ (elbow free to rotate), upper 12·E·I·Δ/L³ (held). Δ = growth of the run past the elbow, across the guided run. L = first guide to elbow corner.',
    thermal: thermal.summary,
  };
  const sections = sectionLookup(distribution, pipeSections, routeLegs);
  const capacity = capacityTable(profile);
  const legsByRoute = new Map();
  routeLegs.legs.forEach((leg) => {
    if (!legsByRoute.has(leg.routeId)) legsByRoute.set(leg.routeId, []);
    legsByRoute.get(leg.routeId).push(leg);
  });
  legsByRoute.forEach((legs) => legs.sort((a, b) => a.index - b.index));
  const legById = new Map(routeLegs.legs.map((leg) => [leg.legId, leg]));
  const runByLeg = new Map();
  routeLegs.axialRuns.forEach((run) => run.legIds.forEach((legId) => runByLeg.set(legId, run)));
  const runOfSite = (site) => {
    if (!site.pipe) return null;
    const leg = routeLegs.legs.find((row) => row.routeId === site.pipe.routeId && row.entityIds.includes(site.pipe.entityId));
    return leg ? runByLeg.get(leg.legId) || null : null;
  };
  const sitesByRun = new Map();
  restraintTable.rows.forEach((site) => {
    const run = runOfSite(site);
    if (!run) return;
    if (!sitesByRun.has(run.runId)) sitesByRun.set(run.runId, []);
    sitesByRun.get(run.runId).push(site);
  });
  sitesByRun.forEach((sites) => sites.sort((a, b) => a.pipe.chainageMm - b.pipe.chainageMm));
  const isGuide = (site) => site.status === 'READY' && site.restrains?.lateral === 'BOTH';
  const isStop = (site) => site.status === 'READY' && site.restrains?.axial === 'BOTH';
  const context = { legsByRoute, legById, runByLeg, sitesByRun, isStop, thermal, sections };

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
  const legs = context.legsByRoute.get(run.routeId) || [];
  const step = end === 'END' ? 1 : -1;
  let index = end === 'END' ? run.lastLegIndex + 1 : run.firstLegIndex - 1;
  const bends = [];
  while (legs[index] && legs[index].kind === 'BEND') { bends.push(legs[index]); index += step; }
  const next = legs[index];
  if (!next) return { end, status: 'ROUTE_END', note: 'No elbow and run past this end in this route (route end, tee or nozzle).', lowerN: 0, upperN: 0 };
  const nextRun = context.runByLeg.get(next.legId);
  if (!nextRun) return { end, status: 'ROUTE_END', note: 'No straight run past the elbow.', lowerN: 0, upperN: 0 };

  const runAxis = run.axis;
  const nextAxis = nextRun.axis;
  const cosTurn = Math.abs(dot(runAxis, nextAxis));
  const turnRad = Math.acos(Math.min(1, cosTurn));
  // Elbow corner beyond the tangent point: t = chord / (2 cos(turn/2)).
  const tangentMm = bends.reduce((sum, bend) => sum + bend.lengthMm, 0) / (2 * Math.cos(turnRad / 2));
  const runEndMm = end === 'END' ? run.endMm : run.startMm;
  const lengthMm = Math.abs(runEndMm - guide.pipe.chainageMm) + tangentMm;
  const across = guide.pipe.lateral ? Math.abs(dot(nextAxis, guide.pipe.lateral)) : 0;
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
  const elbowAtStartOfNext = end === 'END';
  const stops = (context.sitesByRun.get(nextRun.runId) || []).filter(context.isStop);
  const elbowMm = elbowAtStartOfNext ? nextRun.startMm : nextRun.endMm;
  const nearestStop = stops.length
    ? stops.reduce((a, b) => (Math.abs(b.pipe.chainageMm - elbowMm) < Math.abs(a.pipe.chainageMm - elbowMm) ? b : a))
    : null;
  const growthLengthMm = nearestStop ? Math.abs(nearestStop.pipe.chainageMm - elbowMm) : nextRun.lengthMm;
  const growthBasis = nearestStop ? { kind: 'FROM_AXIAL_STOP', siteId: nearestStop.siteId } : { kind: 'WHOLE_RUN_NO_STOP_UPPER_VALUE' };

  const t = context.thermal;
  if (t.status !== 'READY') return { ...detail, status: 'BLOCKED_THERMAL_DATA', note: t.reason, lowerN: null, upperN: null, growthLengthMm, growthBasis };
  const deltaT = t.deltaTFor(nextRun.lineKey);
  const material = t.materialFor(run.lineKey);
  if (!Number.isFinite(deltaT) || !material) return { ...detail, status: 'BLOCKED_THERMAL_DATA', note: 'No operating temperature or material for this line.', lowerN: null, upperN: null, growthLengthMm, growthBasis };
  const growthMm = material.thermalExpansionPerC * deltaT * growthLengthMm;
  const deflectionMm = growthMm * across;
  if (deflectionMm === 0) {
    return { ...detail, status: 'CALCULATED', deltaTC: deltaT, growthLengthMm, growthBasis, deflectionMm, note: 'No growth: operating temperature equals installation.', lowerN: 0, upperN: 0 };
  }
  const section = context.sections(run, guide.pipe.chainageMm, runEndMm);
  if (!section) return { ...detail, status: 'BLOCKED_NO_PIPE_SECTION', note: 'No pipe section for the guided run (sealed input or vertical Run).', lowerN: null, upperN: null, growthLengthMm, growthBasis, deltaTC: deltaT, deflectionMm };
  const result = {
    ...detail,
    status: 'CALCULATED',
    deltaTC: deltaT,
    growthLengthMm,
    growthBasis,
    deflectionMm,
    elasticModulusMpa: material.elasticModulusMpa,
    thermalExpansionPerC: material.thermalExpansionPerC,
    secondMomentMm4: { min: section.minI, max: section.maxI },
    pipeSizes: [...section.sizes],
    lowerN: 0,
    upperN: 0,
  };
  result.lowerN = guidedCantileverBoundsN({ elasticModulusMpa: material.elasticModulusMpa, secondMomentMm4: section.minI, deflectionMm, lengthMm }).lowerN;
  result.upperN = guidedCantileverBoundsN({ elasticModulusMpa: material.elasticModulusMpa, secondMomentMm4: section.maxI, deflectionMm, lengthMm }).upperN;
  // Distance at which the upper bound equals a capacity: (12 E I Delta / F)^(1/3), corner-based.
  result.minimumLengthFor = (capacityN) => Math.cbrt((12 * material.elasticModulusMpa * section.maxI * Math.abs(deflectionMm)) / capacityN);
  return result;
}

function thermalBasis(profile) {
  if (!profile) return { status: 'BLOCKED', reason: 'No Project Data profile.', summary: { status: 'BLOCKED' } };
  const effective = createNonFeaProductDefaultProvider({ profile }).effectiveProfile;
  const installation = projectDataValue(effective, 'thermoMechanicalBasis.installationTemperatureC');
  const operating = projectDataValue(effective, 'thermoMechanicalBasis.operatingTemperaturesC');
  const materials = projectDataValue(effective, 'thermoMechanicalBasis.materialElasticProperties');
  if (!Number.isFinite(installation) || !operating || typeof operating !== 'object' || !materials || typeof materials !== 'object') {
    return { status: 'BLOCKED', reason: 'Installation temperature, operating temperatures or material properties are missing.', summary: { status: 'BLOCKED' } };
  }
  const deltaTFor = (lineKey) => {
    const value = Number.isFinite(operating[lineKey]) ? operating[lineKey] : operating.DEFAULT;
    return Number.isFinite(value) ? value - installation : null;
  };
  const materialFor = (lineKey) => {
    const row = materials[lineKey] || materials.DEFAULT;
    return row && row.elasticModulusMpa > 0 && Number.isFinite(row.thermalExpansionPerC) ? row : null;
  };
  const values = Object.values(operating).filter(Number.isFinite);
  return {
    status: 'READY',
    deltaTFor,
    materialFor,
    summary: {
      status: 'READY',
      installationTemperatureC: installation,
      operatingTemperaturesC: operating,
      noMovement: values.length > 0 && values.every((value) => value === installation),
    },
  };
}

// Pipe sections on a stretch of a run (guide to elbow): from the pipe
// sections the sealed input carries (master data OD and wall, per pipe
// entity) when given, else from the Run's OPE ledger (OD and bore, when the
// Run computed pipe masses itself). Where the stretch has more than one size
// (a reducer), the lower bound uses the smallest I and the upper the largest.
function sectionLookup(distribution, pipeSections, routeLegs) {
  const byEntity = new Map();
  const add = (entityId, od, wall) => {
    if (!entityId || !(od > 0) || !(wall > 0) || !(2 * wall < od)) return;
    byEntity.set(entityId, { I: pipeSecondMomentMm4(od, wall), size: `${od} x ${round(wall, 0.01)}` });
  };
  if (Array.isArray(pipeSections)) pipeSections.forEach((row) => add(row.entityId, row.outsideDiameterMm, row.wallThicknessMm));
  if (!byEntity.size) {
    const loadCase = (distribution?.loadCases || []).find((row) => row.loadCaseId === 'OPE')
      || (distribution?.loadCases || [])[0];
    (loadCase?.contributionLedger || []).forEach((row) => {
      const od = row.formula?.outsideDiameterMm;
      const id = row.formula?.insideDiameterMm;
      if (od > 0 && id > 0) add(row.entityId, od, (od - id) / 2);
    });
  }
  const legById = new Map(routeLegs.legs.map((leg) => [leg.legId, leg]));
  // Sections of the pipes on `run` overlapping chainage [fromMm, toMm].
  return (run, fromMm, toMm) => {
    const [low, high] = fromMm <= toMm ? [fromMm, toMm] : [toMm, fromMm];
    const rows = run.legIds.flatMap((legId) => legById.get(legId)?.pieces || [])
      .filter((piece) => piece.endMm > low && piece.startMm < high)
      .map((piece) => byEntity.get(piece.entityId)).filter(Boolean);
    if (!rows.length) return null;
    return {
      minI: Math.min(...rows.map((row) => row.I)),
      maxI: Math.max(...rows.map((row) => row.I)),
      sizes: new Set(rows.map((row) => row.size)),
    };
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

const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
function round(value, step) { return Math.round(value / step) / Math.round(1 / step); }
