// Hand-calc building blocks for guide and line stop loads (empirical, non-FEA).
// Method and build order: docs/guide-line-stop-load-plan.md.
//
// Units: length mm, force N, E in MPa (= N/mm²), α per °C, ΔT in °C.
// Status: formulas only, not wired into the Run yet. See HANDOVER.md, steps 1-5.

/** Second moment of area of a round pipe, mm⁴. */
export function pipeSecondMomentMm4(outsideDiameterMm, wallThicknessMm) {
  const D = positive(outsideDiameterMm, 'outsideDiameterMm');
  const d = D - 2 * positive(wallThicknessMm, 'wallThicknessMm');
  if (!(d >= 0)) throw new RangeError('Wall thickness exceeds the radius.');
  return Math.PI / 64 * (D ** 4 - d ** 4);
}

/** Metal cross-section area of a round pipe, mm². */
export function pipeMetalAreaMm2(outsideDiameterMm, wallThicknessMm) {
  const D = positive(outsideDiameterMm, 'outsideDiameterMm');
  const d = D - 2 * positive(wallThicknessMm, 'wallThicknessMm');
  if (!(d >= 0)) throw new RangeError('Wall thickness exceeds the radius.');
  return Math.PI / 4 * (D ** 2 - d ** 2);
}

/** Free thermal growth of a straight leg: δ = α·ΔT·L (mm, signed with ΔT). */
export function freeThermalGrowthMm({ lengthMm, expansionPerC, deltaTC }) {
  return finite(expansionPerC, 'expansionPerC') * finite(deltaTC, 'deltaTC') * nonNegative(lengthMm, 'lengthMm');
}

/**
 * Force to bend a leg of length L sideways by Δ (perpendicular leg growth
 * pushing into the first guide after an elbow). Kellogg guided cantilever.
 *   lowerN: 3·E·I·Δ/L³  (elbow end free to rotate)
 *   upperN: 12·E·I·Δ/L³ (both ends held against rotation)
 * Elbow flexibility moves the real value between the bounds. SCREENING result.
 */
export function guidedCantileverBoundsN({ elasticModulusMpa, secondMomentMm4, deflectionMm, lengthMm }) {
  const EI = positive(elasticModulusMpa, 'elasticModulusMpa') * positive(secondMomentMm4, 'secondMomentMm4');
  const L = positive(lengthMm, 'lengthMm');
  const delta = Math.abs(finite(deflectionMm, 'deflectionMm'));
  return {
    lowerN: 3 * EI * delta / L ** 3,
    upperN: 12 * EI * delta / L ** 3,
    label: 'SCREENING',
  };
}

/** Axial force if a straight leg's growth is fully blocked: E·A·α·ΔT. Design-finding bound only. */
export function fullyRestrainedAxialForceN({ elasticModulusMpa, metalAreaMm2, expansionPerC, deltaTC }) {
  return positive(elasticModulusMpa, 'elasticModulusMpa') * positive(metalAreaMm2, 'metalAreaMm2')
    * Math.abs(finite(expansionPerC, 'expansionPerC') * finite(deltaTC, 'deltaTC'));
}

/** Design friction at one sliding support: μ·N (N, magnitude). ACCURATE if N is. */
export function designFrictionN({ normalForceN, frictionCoefficient }) {
  return nonNegative(frictionCoefficient, 'frictionCoefficient') * Math.max(0, finite(normalForceN, 'normalForceN'));
}

/**
 * Neutral (zero-movement) point of a free straight leg with no axial stop:
 * the sliding support where friction on the two sides balances. A leg grows
 * away from this point in both directions.
 * @param {{chainageMm: number, normalForceN: number, frictionCoefficient: number}[]} supports
 */
export function frictionNeutralPoint(supports) {
  const rows = sortedFriction(supports);
  const totalN = rows.reduce((sum, row) => sum + row.frictionN, 0);
  if (!rows.length || totalN === 0) return { chainageMm: null, frictionBeforeN: 0, frictionAfterN: 0, totalN };
  let before = 0;
  for (const row of rows) {
    if (before + row.frictionN >= totalN / 2) {
      return { chainageMm: row.chainageMm, frictionBeforeN: before, frictionAfterN: totalN - before - row.frictionN, totalN };
    }
    before += row.frictionN;
  }
  const last = rows[rows.length - 1];
  return { chainageMm: last.chainageMm, frictionBeforeN: totalN - last.frictionN, frictionAfterN: 0, totalN };
}

/**
 * Friction a line stop holds: Σ μ·N of the sliding supports between the stop
 * and the end of the leg it holds (stop itself excluded). This is the line
 * stop's ACCURATE lower bound; adjacent-leg push is added separately.
 */
export function lineStopFrictionN({ supports, stopChainageMm, heldEndChainageMm }) {
  const stop = finite(stopChainageMm, 'stopChainageMm');
  const end = finite(heldEndChainageMm, 'heldEndChainageMm');
  const [low, high] = stop <= end ? [stop, end] : [end, stop];
  return sortedFriction(supports)
    .filter((row) => row.chainageMm !== stop && row.chainageMm >= low && row.chainageMm <= high)
    .reduce((sum, row) => sum + row.frictionN, 0);
}

function sortedFriction(supports) {
  if (!Array.isArray(supports)) throw new TypeError('supports must be an array.');
  return supports.map((row, index) => ({
    chainageMm: finite(row?.chainageMm, `supports[${index}].chainageMm`),
    frictionN: designFrictionN(row),
  })).sort((left, right) => left.chainageMm - right.chainageMm);
}

function finite(value, label) {
  if (!Number.isFinite(value)) throw new TypeError(`${label} must be a finite number.`);
  return value;
}

function positive(value, label) {
  if (!(finite(value, label) > 0)) throw new RangeError(`${label} must be positive.`);
  return value;
}

function nonNegative(value, label) {
  if (!(finite(value, label) >= 0)) throw new RangeError(`${label} must not be negative.`);
  return value;
}
