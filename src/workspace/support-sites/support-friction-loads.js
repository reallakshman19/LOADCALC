import { freezeDeep } from '../dataset-utils.js';
import { projectDataValue } from '../project-data/project-data-contract.js';
import { createNonFeaProductDefaultProvider } from '../project-data/non-fea-product-default-profile.js';
import { designFrictionN } from '../../core/empirical-restraint-loads/index.js';

// Guide and line stop work, step 3 (docs/guide-line-stop-load-plan.md):
// friction at each sliding support. Label ACCURATE (owner decision): it
// follows the vertical result (Option B) and the friction coefficient.
//
// Design friction = mu * N_OPE in each horizontal direction the support leaves
// free (from the restraint table). It is the most friction can be in any one
// direction: along and across the pipe are alternatives, their vector sum is
// at most mu * N. Movement-based friction (zero where the pipe does not move)
// needs leg growth and neutral points (steps 2 and 4); it is reported as zero
// only when no line is hotter than installation, otherwise as not built.

export const SUPPORT_FRICTION_LOADS_SCHEMA = 'support-friction-loads/v1';
export const FRICTION_LOAD_CASE = 'OPE';

/**
 * @param {object} input
 * @param {object} input.restraintTable from buildSupportRestraintTable
 * @param {object} input.distribution support-load distribution (vertical Run result)
 * @param {object} input.profile Project Data profile
 */
export function buildSupportFrictionLoads({ restraintTable, distribution, profile } = {}) {
  if (!Array.isArray(restraintTable?.rows)) throw new TypeError('restraintTable.rows is required.');
  const loadCase = (distribution?.loadCases || []).find((row) => row.loadCaseId === FRICTION_LOAD_CASE) || null;
  const movement = thermalMovementState(profile);
  if (!loadCase) {
    return freezeDeep({
      schema: SUPPORT_FRICTION_LOADS_SCHEMA, status: 'NO_OPERATING_CASE', loadCaseId: FRICTION_LOAD_CASE,
      label: 'ACCURATE', movement, rows: [],
    });
  }
  const verticalBySite = new Map(loadCase.supportResults.map((row) => [row.supportSiteId, row.verticalForceN]));
  const rows = restraintTable.rows.map((site) => {
    const normalForceN = verticalBySite.has(site.siteId) ? verticalBySite.get(site.siteId) : null;
    const directions = site.friction?.directions || [];
    const mu = site.friction?.mu;
    const sliding = site.status === 'READY' && directions.length > 0 && Number.isFinite(mu) && Number.isFinite(normalForceN);
    const design = sliding ? designFrictionN({ normalForceN, frictionCoefficient: mu }) : (site.status === 'READY' ? 0 : null);
    return {
      siteId: site.siteId,
      tags: site.tags,
      code: site.code,
      status: site.status === 'READY' ? (Number.isFinite(normalForceN) ? 'CALCULATED' : 'NO_VERTICAL_RESULT') : site.status,
      normalForceN,
      mu: sliding ? mu : null,
      muBasis: sliding ? site.friction.muBasis : null,
      directions,
      designFrictionN: design,
      axialMaxN: sliding && directions.includes('AXIAL') ? design : (design === null ? null : 0),
      lateralMaxN: sliding && directions.includes('LATERAL') ? design : (design === null ? null : 0),
      axis: site.pipe?.axis ?? null,
      lateral: site.pipe?.lateral ?? null,
      movementBasedFrictionN: movement.state === 'NO_THERMAL_MOVEMENT' && design !== null ? 0 : null,
    };
  });
  return freezeDeep({
    schema: SUPPORT_FRICTION_LOADS_SCHEMA,
    status: loadCase.status === 'CALCULATED' || loadCase.status === 'CALCULATED_WITH_EXCEPTIONS' ? 'CALCULATED' : 'VERTICAL_NOT_PUBLISHABLE',
    loadCaseId: FRICTION_LOAD_CASE,
    label: 'ACCURATE',
    basis: 'Design friction = mu x N_OPE, in each horizontal direction the support leaves free; the maximum in any one direction.',
    movement,
    rows,
    summary: {
      slidingSiteCount: rows.filter((row) => row.designFrictionN > 0).length,
      totalDesignFrictionN: rows.reduce((sum, row) => sum + (row.designFrictionN || 0), 0),
    },
  });
}

function thermalMovementState(profile) {
  if (!profile) return { state: 'UNKNOWN', reason: 'No Project Data profile.' };
  const effective = createNonFeaProductDefaultProvider({ profile }).effectiveProfile;
  const installation = projectDataValue(effective, 'thermoMechanicalBasis.installationTemperatureC');
  const operating = projectDataValue(effective, 'thermoMechanicalBasis.operatingTemperaturesC');
  const values = operating && typeof operating === 'object' ? Object.values(operating) : [];
  if (Number.isFinite(installation) && values.length && values.every((value) => value === installation)) {
    return {
      state: 'NO_THERMAL_MOVEMENT',
      reason: `Every operating temperature equals installation (${installation} °C): the pipe does not move, so movement-based friction is 0.`,
    };
  }
  return {
    state: 'MOVEMENT_BASED_NOT_BUILT',
    reason: 'Operating temperatures differ from installation; movement-based friction needs leg growth and neutral points (plan steps 2 and 4).',
  };
}
