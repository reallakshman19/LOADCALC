import { freezeDeep } from '../dataset-utils.js';
import { projectDataEntry, projectDataValue } from '../project-data/project-data-contract.js';
import { createNonFeaProductDefaultProvider } from '../project-data/non-fea-product-default-profile.js';

// Guide and line stop work, step 2 (docs/guide-line-stop-load-plan.md), the
// geometry part: split each route into straight legs. A leg is a run of
// consecutive pipe pieces on one straight line, in route chainage order. It
// runs through in-line items (flanges, valves, reducers, the run of a tee)
// and ends at any change of direction: an elbow or bend, or a sloped offset.
// "On one line" means both ends of the next piece lie within
// topology.portMatchToleranceMm of the leg's line, going forward.
// Elbows and bends are kept as their own BEND legs, so every piece is in
// exactly one leg. Free thermal growth per leg waits for real temperatures.
//
// Axial runs (for line stop loads): legs joined through shallow offsets. When
// one or more legs, each sloped at most topology.legOffsetMaxAngleDeg to a
// straight leg, lead back to a leg running the same way, the pipe carries
// axial load straight through the step (a short offset is very stiff), so
// they form one run. Only an approved angle is used; without one each
// straight leg is its own run. Elbows and turns above the angle end a run.

export const ROUTE_LEGS_SCHEMA = 'route-legs/v2';
export const LEG_OFFSET_ANGLE_PATH = 'topology.legOffsetMaxAngleDeg';
const BEND_TYPES = /^(ELBO|ELBOW|BEND)$/u;
// "Running the same way": axes within 0.25 degrees (cos 0.25 deg).
const SAME_WAY_COS = Math.cos((0.25 * Math.PI) / 180);

/**
 * @param {object} input
 * @param {object} input.routePartitionModel from buildRoutePartitionModel
 * @param {object} input.profile Project Data profile (Product defaults are composed in)
 */
export function buildRouteLegs({ routePartitionModel, profile } = {}) {
  if (!Array.isArray(routePartitionModel?.routes) || !Array.isArray(routePartitionModel?.edges)) {
    throw new TypeError('routePartitionModel with routes and edges is required.');
  }
  const effective = createNonFeaProductDefaultProvider({ profile }).effectiveProfile;
  const toleranceMm = projectDataValue(effective, 'topology.portMatchToleranceMm');
  if (!Number.isFinite(toleranceMm)) {
    return freezeDeep({
      schema: ROUTE_LEGS_SCHEMA, status: 'BLOCKED',
      blockers: [{ code: 'MISSING_PORT_MATCH_TOLERANCE', projectDataPath: 'topology.portMatchToleranceMm' }],
      legs: [],
    });
  }
  const offset = offsetAngle(profile);
  const edgeById = new Map(routePartitionModel.edges.map((edge) => [edge.entityId, edge]));
  const routeRows = routePartitionModel.routes
    .filter((route) => route.status === 'READY')
    .map((route) => routeLegs(route, edgeById, toleranceMm));
  const legs = routeRows.flat();
  const axialRuns = routeRows.flatMap((rows) => axialRunsOf(rows, offset.maxAngleDeg));
  return freezeDeep({
    schema: ROUTE_LEGS_SCHEMA,
    status: 'READY',
    blockers: [],
    toleranceMm,
    offsetMaxAngleDeg: offset.maxAngleDeg,
    offsetRule: offset.note,
    basis: 'Straight legs in route chainage order; a leg ends at an elbow, bend or any change of direction.',
    legs,
    axialRuns,
  });
}

function offsetAngle(profile) {
  const entry = profile ? projectDataEntry(profile, LEG_OFFSET_ANGLE_PATH) : null;
  if (!entry) return { maxAngleDeg: null, note: 'Not set: every change of direction ends a run.' };
  if (entry.approved !== true || !Number.isFinite(entry.value) || entry.value <= 0 || entry.value >= 90) {
    return { maxAngleDeg: null, note: `${LEG_OFFSET_ANGLE_PATH} is not approved or not between 0 and 90 degrees: not used.` };
  }
  return { maxAngleDeg: entry.value, note: `Sloped offsets of ${entry.value} degrees or less between legs running the same way count as straight.` };
}

// Joins one route's legs (in order) into axial runs.
function axialRunsOf(legs, maxAngleDeg) {
  const runs = [];
  let i = 0;
  while (i < legs.length) {
    const first = legs[i];
    if (first.kind !== 'STRAIGHT') { i += 1; continue; }
    const members = [first];
    const offsets = [];
    let j = i + 1;
    while (maxAngleDeg !== null && j < legs.length) {
      // Look past shallow pieces for a leg running the same way as `first`.
      let k = j;
      const between = [];
      while (k < legs.length && !sameWay(legs[k], first) && offsetAngleDeg(legs[k], first) <= maxAngleDeg) {
        between.push(legs[k]); k += 1;
      }
      if (!between.length || k >= legs.length || legs[k].kind !== 'STRAIGHT' || !sameWay(legs[k], first)) break;
      between.forEach((leg) => offsets.push({ legId: leg.legId, kind: leg.kind, angleDeg: round(offsetAngleDeg(leg, first), 0.1), lengthMm: leg.lengthMm }));
      members.push(...between, legs[k]);
      j = k + 1;
    }
    const last = members[members.length - 1];
    runs.push({
      runId: `${first.legId}:run`,
      routeId: first.routeId,
      legIds: members.map((leg) => leg.legId),
      startMm: first.startMm,
      endMm: last.endMm,
      lengthMm: last.endMm - first.startMm,
      axis: first.axis,
      orientation: first.orientation,
      offsets,
    });
    i = j;
  }
  return runs;
}

function directionCos(leg, reference) { return dot(unit(sub(leg.endPointMm, leg.startPointMm)), unit(sub(reference.endPointMm, reference.startPointMm))); }
function sameWay(leg, reference) { return directionCos(leg, reference) >= SAME_WAY_COS; }
// Angle of a piece to the run. An elbow's chord sits at half its turn, so a
// bend counts at twice its chord angle (a pair of 45 degree elbows is 45).
function offsetAngleDeg(leg, reference) {
  const chordDeg = (Math.acos(Math.max(-1, Math.min(1, directionCos(leg, reference)))) * 180) / Math.PI;
  return leg.kind === 'BEND' ? 2 * chordDeg : chordDeg;
}
function round(value, step) { return Math.round(value / step) / Math.round(1 / step); }

function routeLegs(route, edgeById, toleranceMm) {
  const pieces = (route.entityChainages || [])
    .map((row) => ({ row, edge: edgeById.get(row.entityId) }))
    .filter(({ edge }) => edge && !edge.pointComponent && !edge.topologyCarrier && edge.lengthMm > 0)
    .sort((left, right) => left.row.startMm - right.row.startMm);
  const legs = [];
  let current = null;
  for (const { row, edge } of pieces) {
    // Route-forward ends of this piece.
    const forward = row.sourceStartChainageMm <= row.sourceEndChainageMm;
    const from = forward ? edge.startMm : edge.endMm;
    const to = forward ? edge.endMm : edge.startMm;
    const bend = BEND_TYPES.test(String(edge.entityType || '').toUpperCase());
    if (current && !bend && current.kind === 'STRAIGHT' && continuesLine(current, from, to, toleranceMm)) {
      current.endMm = row.endMm;
      current.endPointMm = to;
      current.entityIds.push(edge.entityId);
      continue;
    }
    current = {
      legId: `${route.routeId}:leg:${legs.length + 1}`,
      routeId: route.routeId,
      branchId: route.branchId,
      lineKey: route.lineKey,
      kind: bend ? 'BEND' : 'STRAIGHT',
      startMm: row.startMm,
      endMm: row.endMm,
      startPointMm: from,
      endPointMm: to,
      axis: unit(sub(to, from)),
      entityIds: [edge.entityId],
    };
    legs.push(current);
  }
  return legs.map((leg, index) => ({
    ...leg,
    index,
    lengthMm: leg.endMm - leg.startMm,
    axis: roundVector(leg.kind === 'STRAIGHT' ? unit(sub(leg.endPointMm, leg.startPointMm)) : leg.axis),
    orientation: orientation(unit(sub(leg.endPointMm, leg.startPointMm))),
  }));
}

function continuesLine(leg, from, to, toleranceMm) {
  const axis = unit(sub(leg.endPointMm, leg.startPointMm));
  const direction = sub(to, from);
  if (dot(direction, axis) <= 0) return false;
  return offLine(from, leg.startPointMm, axis) <= toleranceMm && offLine(to, leg.startPointMm, axis) <= toleranceMm;
}

function offLine(point, origin, axis) {
  const v = sub(point, origin);
  const along = dot(v, axis);
  return Math.hypot(v.x - along * axis.x, v.y - along * axis.y, v.z - along * axis.z);
}

function orientation(axis) {
  if (Math.abs(axis.z) > 0.95) return 'VERTICAL';
  return Math.abs(axis.z) < 0.05 ? 'HORIZONTAL' : 'SLOPED';
}

const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
function unit(v) { const length = Math.hypot(v.x, v.y, v.z); return { x: v.x / length, y: v.y / length, z: v.z / length }; }
function roundVector(v) { const r = (n) => Math.round(n * 1e6) / 1e6 + 0; return { x: r(v.x), y: r(v.y), z: r(v.z) }; }
