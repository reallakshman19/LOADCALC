import { freezeDeep, stringValue } from '../dataset-utils.js';
import { projectDataValue } from '../project-data/project-data-contract.js';
import { createNonFeaProductDefaultProvider } from '../project-data/non-fea-product-default-profile.js';
import { SUPPORT_TYPE_OVERRIDE_PATH } from './support-site-model.js';

// Guide and line stop work, step 1 (docs/guide-line-stop-load-plan.md):
// one row per physical support site saying what it restrains, where friction
// acts, the friction coefficient and the gap. Data only, no mechanics.
//
// Directions are relative to the pipe at the support: AXIAL along the pipe,
// LATERAL horizontal and perpendicular to it, VERTICAL along source +Z.
// A site whose function is unknown is BLOCKED; it never becomes a REST.

export const SUPPORT_RESTRAINT_TABLE_SCHEMA = 'support-restraint-table/v1';

const FUNCTIONS = Object.freeze(['REST', 'GUIDE', 'LINESTOP', 'ANCHOR']);
const CODES = Object.freeze({ REST: 'R', GUIDE: 'G', LINESTOP: 'LS', ANCHOR: 'A' });

/**
 * @param {object} input
 * @param {object} input.supportSiteModel from buildSupportSiteModel
 * @param {object} input.routePartitionModel from buildRoutePartitionModel
 * @param {object} input.profile Project Data profile (Product defaults are composed in)
 */
export function buildSupportRestraintTable({ supportSiteModel, routePartitionModel, profile } = {}) {
  if (!Array.isArray(supportSiteModel?.sites)) throw new TypeError('supportSiteModel.sites is required.');
  if (!Array.isArray(routePartitionModel?.routes) || !Array.isArray(routePartitionModel?.edges)) {
    throw new TypeError('routePartitionModel with routes and edges is required.');
  }
  const effective = createNonFeaProductDefaultProvider({ profile }).effectiveProfile;
  const capabilities = projectDataValue(effective, 'topology.supportTypeCapabilities') || {};
  const toleranceMm = projectDataValue(effective, 'topology.portMatchToleranceMm');
  const friction = projectDataValue(effective, 'restraintPolicy.frictionCoefficients') || {};
  const gaps = projectDataValue(effective, 'restraintPolicy.restraintGapsMm') || {};
  const declared = projectDataValue(effective, SUPPORT_TYPE_OVERRIDE_PATH) || {};
  const edgeById = new Map(routePartitionModel.edges.map((edge) => [edge.entityId, edge]));

  const rows = supportSiteModel.sites.map((site) => siteRow(site, {
    capabilities, toleranceMm, friction, gaps, declared, edgeById, routes: routePartitionModel.routes,
  }));
  const countsByCode = {};
  rows.forEach((row) => { countsByCode[row.code] = (countsByCode[row.code] || 0) + 1; });
  return freezeDeep({
    schema: SUPPORT_RESTRAINT_TABLE_SCHEMA,
    datasetId: supportSiteModel.datasetId ?? null,
    directionBasis: 'AXIAL along the pipe at the site; LATERAL horizontal, perpendicular to it; VERTICAL source +Z',
    status: rows.some((row) => row.status === 'BLOCKED_UNKNOWN_FUNCTION') ? 'PROPOSAL_WITH_BLOCKED_SITES' : 'PROPOSAL_READY',
    rows,
    summary: {
      siteCount: rows.length,
      countsByCode,
      blockedSiteIds: rows.filter((row) => row.status === 'BLOCKED_UNKNOWN_FUNCTION').map((row) => row.siteId),
    },
  });
}

function siteRow(site, context) {
  const members = (site.assemblies || []).flatMap((assembly) => assembly.members || []);
  const types = members.map((member) => stringValue(member.sourceType).toUpperCase()).filter(Boolean);
  const functions = FUNCTIONS.filter((name) => types.includes(name));
  const unknownTypes = [...new Set(types.filter((type) => !FUNCTIONS.includes(type)))];
  const tags = [...new Set(site.tags || members.map((member) => member.tag))];
  const declaredNone = functions.length === 0 && tags.length > 0
    && tags.every((tag) => stringValue(context.declared[tag]).toUpperCase() === 'NONE');
  const overridden = members.some((member) => member.sourceTypeAuthority === 'PROJECT_DATA_SUPPORT_TYPE_OVERRIDE');
  const pipe = pipeAtSite(site.positionMm, context);

  let status = 'READY';
  if (unknownTypes.length) status = 'BLOCKED_UNKNOWN_FUNCTION';
  else if (functions.length === 0) status = declaredNone ? 'NOT_A_SUPPORT' : 'BLOCKED_UNKNOWN_FUNCTION';

  const anchor = functions.includes('ANCHOR');
  const bearing = anchor || members.some((member) => context.capabilities[member.sourceType]?.vertical === true);
  const axialHeld = anchor || functions.includes('LINESTOP');
  const lateralHeld = anchor || functions.includes('GUIDE');
  const restrains = status === 'READY'
    ? {
      vertical: anchor ? 'BOTH' : (bearing ? 'UP_ONLY_LIFT_OFF_ALLOWED' : 'NONE'),
      axial: axialHeld ? 'BOTH' : 'FREE',
      lateral: lateralHeld ? 'BOTH' : 'FREE',
      rotation: anchor ? 'ALL' : 'FREE',
    }
    : null;
  // Friction acts on a bearing surface, in each horizontal direction left free.
  const frictionDirections = restrains && bearing && !anchor
    ? [...(axialHeld ? [] : ['AXIAL']), ...(lateralHeld ? [] : ['LATERAL'])]
    : [];
  const mu = frictionDirections.length ? frictionCoefficient(context.friction) : null;
  const gapMm = restrains && (axialHeld || lateralHeld) ? gapValue(context.gaps) : null;

  return {
    siteId: site.siteId,
    tags,
    positionMm: site.positionMm,
    lineKeys: [...new Set(members.map((member) => member.lineKey).filter(Boolean))],
    branchIds: [...new Set(site.branchIds || members.map((member) => member.branchId))],
    code: status === 'READY' ? functions.map((name) => CODES[name]).join('+')
      : status === 'NOT_A_SUPPORT' ? 'NONE' : '?',
    functions,
    status,
    typeAuthority: status === 'NOT_A_SUPPORT' || overridden ? 'PROJECT_DATA_SUPPORT_TYPE_OVERRIDE' : (functions.length ? 'SOURCE' : null),
    restrains,
    friction: { directions: frictionDirections, mu: mu?.value ?? null, muBasis: mu?.basis ?? null },
    gapMm: gapMm?.value ?? null,
    gapBasis: gapMm?.basis ?? null,
    pipe,
    partCount: members.length,
    // Parts with no SUPPORT_TYPE in the source model, including those typed
    // since by an owner decision (Project Data override).
    blankTypePartCount: members.filter((member) => !stringValue(member.sourceType)
      || member.sourceTypeAuthority === 'PROJECT_DATA_SUPPORT_TYPE_OVERRIDE').length,
    unknownTypes,
  };
}

// The pipe edge the site sits on, its direction, and its route chainage.
function pipeAtSite(point, { routes, edgeById, toleranceMm }) {
  if (!point || !Number.isFinite(toleranceMm)) return null;
  for (const route of routes) {
    for (const row of route.entityChainages || []) {
      const edge = edgeById.get(row.entityId);
      if (!edge || edge.pointComponent || edge.topologyCarrier || !(edge.lengthMm > 0)) continue;
      const projection = projectToSegment(point, edge.startMm, edge.endMm);
      if (projection.distanceMm > toleranceMm) continue;
      const d = { x: edge.endMm.x - edge.startMm.x, y: edge.endMm.y - edge.startMm.y, z: edge.endMm.z - edge.startMm.z };
      const length = Math.hypot(d.x, d.y, d.z);
      const axis = { x: d.x / length, y: d.y / length, z: d.z / length };
      const horizontal = Math.hypot(axis.x, axis.y);
      const lateral = horizontal > 1e-9 ? { x: -axis.y / horizontal, y: axis.x / horizontal, z: 0 } : null;
      return {
        routeId: route.routeId,
        entityId: edge.entityId,
        chainageMm: row.sourceStartChainageMm + projection.ratio * (row.sourceEndChainageMm - row.sourceStartChainageMm),
        axis: roundVector(axis),
        lateral: lateral ? roundVector(lateral) : null,
        orientation: Math.abs(axis.z) > 0.95 ? 'VERTICAL' : (Math.abs(axis.z) < 0.05 ? 'HORIZONTAL' : 'SLOPED'),
      };
    }
  }
  return null;
}

function frictionCoefficient(table) {
  if (Number.isFinite(table.DEFAULT)) {
    return { value: table.DEFAULT, basis: 'DEFAULT (slide plate type not known; PTFE would be STEEL_ON_PTFE)' };
  }
  if (Number.isFinite(table.STEEL_ON_STEEL)) return { value: table.STEEL_ON_STEEL, basis: 'STEEL_ON_STEEL' };
  return null;
}

function gapValue(table) {
  return Number.isFinite(table.DEFAULT) ? { value: table.DEFAULT, basis: 'DEFAULT' } : null;
}

function projectToSegment(point, start, end) {
  const d = { x: end.x - start.x, y: end.y - start.y, z: end.z - start.z };
  const lengthSquared = d.x ** 2 + d.y ** 2 + d.z ** 2;
  const raw = lengthSquared > 0
    ? ((point.x - start.x) * d.x + (point.y - start.y) * d.y + (point.z - start.z) * d.z) / lengthSquared
    : 0;
  const ratio = Math.max(0, Math.min(1, raw));
  const closest = { x: start.x + ratio * d.x, y: start.y + ratio * d.y, z: start.z + ratio * d.z };
  return { ratio, distanceMm: Math.hypot(point.x - closest.x, point.y - closest.y, point.z - closest.z) };
}

function roundVector(v) {
  const r = (n) => Math.round(n * 1e6) / 1e6 + 0;
  return { x: r(v.x), y: r(v.y), z: r(v.z) };
}
