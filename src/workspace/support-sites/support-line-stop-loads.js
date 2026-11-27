import { freezeDeep } from '../dataset-utils.js';

// Guide and line stop work, step 4, friction part (docs/guide-line-stop-load-plan.md).
// Label ACCURATE: it follows the vertical result (Option B) and mu.
//
// "Leg" below means the straight run the stop sits on: one straight leg, or
// legs joined through shallow offsets (route-legs.js, axialRuns).
// A line stop is the fixed point of the straight leg it sits on. On each
// side, the leg slides away from the stop and friction at the sliding
// supports pulls back towards it. Each side is the stop's held length: from
// the stop to the end of the leg, or to the next axial stop on the leg.
//   side friction = sum of axial design friction (mu x N_OPE) on that side
//   design axial load = the larger side (one side may not slide, e.g. on
//     start-up), the usual design practice;
//   net = |start side - end side|, only if both sides slide fully.
// Friction beyond an elbow acts along the next leg, not this one; it reaches
// the stop only by bending the elbow (the flexibility push, SCREENING, not
// built). Two axial stops on one leg block that leg's growth: reported as a
// design finding, and each stop is given the full friction up to the other.

export const SUPPORT_LINE_STOP_LOADS_SCHEMA = 'support-line-stop-loads/v1';

/**
 * @param {object} input
 * @param {object} input.restraintTable from buildSupportRestraintTable
 * @param {object} input.frictionLoads from buildSupportFrictionLoads
 * @param {object} input.routeLegs from buildRouteLegs
 */
export function buildSupportLineStopLoads({ restraintTable, frictionLoads, routeLegs } = {}) {
  if (!Array.isArray(restraintTable?.rows)) throw new TypeError('restraintTable.rows is required.');
  if (!Array.isArray(routeLegs?.legs)) throw new TypeError('routeLegs.legs is required.');
  const base = {
    schema: SUPPORT_LINE_STOP_LOADS_SCHEMA,
    loadCaseId: frictionLoads?.loadCaseId ?? null,
    label: 'ACCURATE',
    basis: `Friction part only: sum of axial mu x N_OPE on each side of the stop, along its straight run, up to the run end or the next axial stop. Design = larger side. Push from adjacent legs (thermal, SCREENING) is not included. ${routeLegs.offsetRule || ''}`.trim(),
  };
  if (frictionLoads?.status !== 'CALCULATED' || routeLegs.status !== 'READY') {
    return freezeDeep({ ...base, status: frictionLoads?.status !== 'CALCULATED' ? 'NO_FRICTION_RESULT' : 'NO_LEGS', rows: [] });
  }
  // A run is one straight leg, or legs joined through shallow offsets.
  const legById = new Map(routeLegs.legs.map((leg) => [leg.legId, leg]));
  const runs = routeLegs.axialRuns
    || routeLegs.legs.filter((leg) => leg.kind === 'STRAIGHT').map((leg) => ({ ...leg, runId: leg.legId, legIds: [leg.legId], offsets: [] }));
  const legByEntity = new Map();
  runs.forEach((run) => run.legIds.forEach((legId) => legById.get(legId)?.entityIds
    .forEach((id) => legByEntity.set(`${run.routeId}|${id}`, { ...run, legId: run.runId }))));
  const frictionBySite = new Map(frictionLoads.rows.map((row) => [row.siteId, row]));
  const legOf = (site) => (site.pipe ? legByEntity.get(`${site.pipe.routeId}|${site.pipe.entityId}`) || null : null);

  const sitesByLeg = new Map();
  restraintTable.rows.forEach((site) => {
    const leg = legOf(site);
    if (!leg) return;
    if (!sitesByLeg.has(leg.legId)) sitesByLeg.set(leg.legId, []);
    sitesByLeg.get(leg.legId).push(site);
  });
  sitesByLeg.forEach((sites) => sites.sort((a, b) => a.pipe.chainageMm - b.pipe.chainageMm));

  const isStop = (site) => site.status === 'READY' && site.restrains?.axial === 'BOTH';
  const rows = restraintTable.rows.filter(isStop).map((stop) => {
    const leg = legOf(stop);
    const common = { siteId: stop.siteId, tags: stop.tags, code: stop.code, routeId: stop.pipe?.routeId ?? null, chainageMm: stop.pipe?.chainageMm ?? null };
    if (!leg) return { ...common, status: 'NO_LEG', legId: null, sides: [], designAxialN: null, netAxialN: null, findings: [] };
    const onLeg = sitesByLeg.get(leg.legId) || [];
    const otherStops = onLeg.filter((site) => site !== stop && isStop(site));
    const sides = [
      side('START', onLeg.filter((s) => s.pipe.chainageMm < stop.pipe.chainageMm).reverse(), leg.startMm, isStop, frictionBySite),
      side('END', onLeg.filter((s) => s !== stop && s.pipe.chainageMm >= stop.pipe.chainageMm), leg.endMm, isStop, frictionBySite),
    ];
    const findings = otherStops.length
      ? [{ code: 'TWO_AXIAL_STOPS_ON_ONE_LEG', otherSiteIds: otherStops.map((site) => site.siteId), note: 'Growth between the stops is blocked; axial force tends to E·A·α·ΔT when the line is hot. Not a normal load.' }]
      : [];
    const blocked = sides.find((row) => row.status !== 'CALCULATED');
    const values = sides.map((row) => row.frictionN);
    return {
      ...common,
      status: blocked ? blocked.status : 'CALCULATED',
      legId: leg.legId,
      leg: { startMm: leg.startMm, endMm: leg.endMm, lengthMm: leg.lengthMm, axis: leg.axis, orientation: leg.orientation, legIds: leg.legIds, offsets: leg.offsets },
      sides,
      designAxialN: blocked ? null : Math.max(...values),
      netAxialN: blocked ? null : Math.abs(values[0] - values[1]),
      pushN: null,
      pushStatus: 'NOT_BUILT_SCREENING',
      findings,
    };
  });
  return freezeDeep({
    ...base,
    status: rows.some((row) => row.status !== 'CALCULATED') ? 'CALCULATED_WITH_BLOCKED_STOPS' : 'CALCULATED',
    rows,
    summary: {
      stopCount: rows.length,
      calculatedCount: rows.filter((row) => row.status === 'CALCULATED').length,
      maxDesignAxialN: Math.max(0, ...rows.map((row) => row.designAxialN || 0)),
    },
  });
}

// One side of a stop: walk away from it along the leg until the leg end or
// the next axial stop, adding the axial friction available at each support.
function side(towards, sitesAway, legEndMm, isStop, frictionBySite) {
  const supports = [];
  let boundary = { kind: 'LEG_END', chainageMm: legEndMm, siteId: null };
  let status = 'CALCULATED';
  for (const site of sitesAway) {
    if (isStop(site)) { boundary = { kind: 'NEXT_STOP', chainageMm: site.pipe.chainageMm, siteId: site.siteId }; break; }
    if (site.status === 'NOT_A_SUPPORT') continue;
    if (site.status !== 'READY') { status = 'BLOCKED_UNKNOWN_SUPPORT_ON_LEG'; supports.push({ siteId: site.siteId, chainageMm: site.pipe.chainageMm, axialFrictionN: null }); continue; }
    const friction = frictionBySite.get(site.siteId);
    const axial = friction?.axialMaxN;
    if (!Number.isFinite(axial)) { status = 'BLOCKED_MISSING_VERTICAL_ON_LEG'; supports.push({ siteId: site.siteId, chainageMm: site.pipe.chainageMm, axialFrictionN: null }); continue; }
    supports.push({ siteId: site.siteId, code: site.code, chainageMm: site.pipe.chainageMm, axialFrictionN: axial });
  }
  return {
    towards,
    status,
    boundary,
    supports,
    frictionN: status === 'CALCULATED' ? supports.reduce((sum, row) => sum + row.axialFrictionN, 0) : null,
  };
}
