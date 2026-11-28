import { projectDataValue } from '../project-data/project-data-contract.js';
import { createNonFeaProductDefaultProvider } from '../project-data/non-fea-product-default-profile.js';
import { pipeMetalAreaMm2, pipeSecondMomentMm4 } from '../../core/empirical-restraint-loads/index.js';

// Shared ground for the thermal SCREENING checks (guide lateral bounds, line
// stop thermal push): which straight run each support sits on, what lies past
// a run's end across an elbow, the line temperatures and material values, and
// the pipe section on a stretch of a run.

/**
 * @param {object} input
 * @param {object} input.restraintTable from buildSupportRestraintTable
 * @param {object} input.routeLegs from buildRouteLegs (with axialRuns)
 * @param {object} [input.distribution] vertical Run (ledger sections, fallback)
 * @param {object} input.profile Project Data profile (thermal view)
 * @param {object[]} [input.pipeSections] [{ entityId, outsideDiameterMm, wallThicknessMm }]
 * @param {Record<string, number>} [input.expansionByLine] approved table coefficient per line
 */
export function createThermalBendingContext({ restraintTable, routeLegs, distribution = null, profile, pipeSections = null, expansionByLine = null } = {}) {
  if (!Array.isArray(restraintTable?.rows)) throw new TypeError('restraintTable.rows is required.');
  if (!Array.isArray(routeLegs?.legs) || !Array.isArray(routeLegs?.axialRuns)) throw new TypeError('routeLegs with axialRuns is required.');
  const legsByRoute = new Map();
  routeLegs.legs.forEach((leg) => {
    if (!legsByRoute.has(leg.routeId)) legsByRoute.set(leg.routeId, []);
    legsByRoute.get(leg.routeId).push(leg);
  });
  legsByRoute.forEach((legs) => legs.sort((a, b) => a.index - b.index));
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
  const thermal = thermalBasis(profile);
  // Growth uses alpha of the growing line: the approved table value when
  // there is one, else Project Data materialElasticProperties.
  const alphaFor = (lineKey) => {
    const table = expansionByLine?.[lineKey];
    if (Number.isFinite(table)) return { alpha: table, source: 'THERMAL_EXPANSION_TABLE' };
    const material = thermal.materialFor?.(lineKey);
    return material ? { alpha: material.thermalExpansionPerC, source: 'MATERIAL_ELASTIC_PROPERTIES' } : null;
  };
  return {
    legsByRoute,
    runByLeg,
    runOfSite,
    sitesByRun,
    isGuide: (site) => site.status === 'READY' && site.restrains?.lateral === 'BOTH',
    isStop: (site) => site.status === 'READY' && site.restrains?.axial === 'BOTH',
    thermal,
    alphaFor,
    sections: sectionLookup(distribution, pipeSections, routeLegs),
  };
}

/**
 * What lies past one end of a run: the elbow(s) and the next straight run.
 * Returns null at a route end (line end, tee or nozzle).
 *   tangentMm: elbow tangent point to the elbow corner, from the chord
 *   runEndMm: the run's end chainage (elbow tangent point)
 *   elbowMmOnNext: the chainage where the next run meets the elbow
 */
export function acrossElbow(context, run, end) {
  const legs = context.legsByRoute.get(run.routeId) || [];
  const step = end === 'END' ? 1 : -1;
  let index = end === 'END' ? run.lastLegIndex + 1 : run.firstLegIndex - 1;
  const bends = [];
  while (legs[index] && legs[index].kind === 'BEND') { bends.push(legs[index]); index += step; }
  const next = legs[index];
  const nextRun = next ? context.runByLeg.get(next.legId) : null;
  if (!nextRun) return null;
  const turnRad = Math.acos(Math.min(1, Math.abs(dot(run.axis, nextRun.axis))));
  // Elbow corner beyond the tangent point: t = chord / (2 cos(turn/2)).
  const tangentMm = bends.reduce((sum, bend) => sum + bend.lengthMm, 0) / (2 * Math.cos(turnRad / 2));
  return {
    nextRun,
    bends,
    turnRad,
    tangentMm,
    runEndMm: end === 'END' ? run.endMm : run.startMm,
    elbowMmOnNext: end === 'END' ? nextRun.startMm : nextRun.endMm,
  };
}

export function thermalBasis(profile) {
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

// Pipe sections on a stretch of a run: from the pipe sections the sealed
// input carries (master data OD and wall, per pipe entity) when given, else
// from the Run's OPE ledger (OD and bore, when the Run computed pipe masses
// itself). Where the stretch has more than one size (a reducer), min and max
// I and A are both given, so a lower bound can use the smaller and an upper
// bound the larger.
function sectionLookup(distribution, pipeSections, routeLegs) {
  const byEntity = new Map();
  const add = (entityId, od, wall) => {
    if (!entityId || !(od > 0) || !(wall > 0) || !(2 * wall < od)) return;
    byEntity.set(entityId, { I: pipeSecondMomentMm4(od, wall), A: pipeMetalAreaMm2(od, wall), size: `${od} x ${round(wall, 0.01)}` });
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
      maxA: Math.max(...rows.map((row) => row.A)),
      sizes: new Set(rows.map((row) => row.size)),
    };
  };
}

export const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
export function round(value, step) { return Math.round(value / step) / Math.round(1 / step); }
