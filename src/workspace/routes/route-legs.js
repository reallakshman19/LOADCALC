import { freezeDeep } from '../dataset-utils.js';
import { projectDataValue } from '../project-data/project-data-contract.js';
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

export const ROUTE_LEGS_SCHEMA = 'route-legs/v1';
const BEND_TYPES = /^(ELBO|ELBOW|BEND)$/u;

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
  const edgeById = new Map(routePartitionModel.edges.map((edge) => [edge.entityId, edge]));
  const legs = routePartitionModel.routes
    .filter((route) => route.status === 'READY')
    .flatMap((route) => routeLegs(route, edgeById, toleranceMm));
  return freezeDeep({
    schema: ROUTE_LEGS_SCHEMA,
    status: 'READY',
    blockers: [],
    toleranceMm,
    basis: 'Straight legs in route chainage order; a leg ends at an elbow, bend or any change of direction.',
    legs,
  });
}

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
