// Empirical continuous-span vertical reactions along one route chainage line.
//
// Two methods, both hand-calc (no stiffness matrix, no FE mesh):
//   LEVER_OVERHANG_MOMENT_V1  simple-span lever rule, but a load beyond an end
//                             support is carried as a moment by the end span
//                             (a rest support cannot take moment).
//   THREE_MOMENT_LIFTOFF_V1   Clapeyron three-moment equation (uniform EI,
//                             rigid pinned supports) with one-way supports:
//                             a support that would pull down is released.
//
// Units: chainage mm, force N, moment N·mm. Downward load is a positive forceN;
// an upward (bearing) reaction is positive.
//
// The solve is linear for a fixed set of active supports, so per-load
// contributions (for the audit ledger) are exact and sum to the total.
//
// Used by the Run as CONTINUOUS_SPAN_THREE_MOMENT_V1
// (src/workspace/engineering-loads/support-load-distribution-v3.js).

export const CONTINUOUS_SPAN_SCHEMA = 'empirical-continuous-span/v1';
export const LEVER_OVERHANG_MOMENT_V1 = 'LEVER_OVERHANG_MOMENT_V1';
export const THREE_MOMENT_LIFTOFF_V1 = 'THREE_MOMENT_LIFTOFF_V1';
const METHODS = new Set([LEVER_OVERHANG_MOMENT_V1, THREE_MOMENT_LIFTOFF_V1]);

/**
 * @param {object} input
 * @param {{siteId: string, chainageMm: number}[]} input.supports vertical supports on the route
 * @param {({chainageMm: number, forceN: number} | {startMm: number, endMm: number, forceN: number})[]} input.loads
 * @param {string} [input.method] THREE_MOMENT_LIFTOFF_V1 (default) or LEVER_OVERHANG_MOMENT_V1
 * @param {boolean} [input.liftOff] release supports that would pull down (default true; three-moment only)
 * @param {number} [input.coincidentToleranceMm] supports closer than this share one station (default 1)
 */
export function solveContinuousSpan(input = {}) {
  const method = input.method ?? THREE_MOMENT_LIFTOFF_V1;
  if (!METHODS.has(method)) throw new RangeError(`Unknown continuous-span method: ${method}.`);
  const liftOff = method === THREE_MOMENT_LIFTOFF_V1 && input.liftOff !== false;
  const stations = groupStations(input.supports, input.coincidentToleranceMm ?? 1);
  const loads = normalizeLoads(input.loads);
  const totalForceN = loads.reduce((sum, row) => sum + row.forceN, 0);
  const toleranceN = Math.max(1e-9, Math.abs(totalForceN) * 1e-9);

  if (stations.length === 0) {
    return result({ method, stations, active: [], loads, status: 'NO_SUPPORT', iterations: 0, converged: true });
  }

  let active = stations.map(() => true);
  let iterations = 0;
  let converged = !liftOff;
  while (liftOff && iterations < 4 * stations.length + 4) {
    iterations += 1;
    const solved = solveFixed(method, pick(stations, active), loads);
    const activeIndexes = indexesOf(active);
    let worst = -1;
    solved.reactions.forEach((value, k) => {
      if (value < -toleranceN && (worst < 0 || value < solved.reactions[worst])) worst = k;
    });
    if (worst >= 0 && activeIndexes.length > 1) {
      active = active.map((on, index) => (index === activeIndexes[worst] ? false : on));
      continue;
    }
    // Re-contact: a released support whose re-added reaction is positive would
    // be penetrated by the beam, so it bears again.
    let best = null;
    active.forEach((on, index) => {
      if (on) return;
      const trial = active.map((value, k) => value || k === index);
      const trialSolve = solveFixed(method, pick(stations, trial), loads);
      const position = indexesOf(trial).indexOf(index);
      const reaction = trialSolve.reactions[position];
      if (reaction > toleranceN && (!best || reaction > best.reaction)) best = { index, reaction };
    });
    if (best) {
      active = active.map((on, index) => on || index === best.index);
      continue;
    }
    converged = true;
    break;
  }
  const activeCount = active.filter(Boolean).length;
  const status = activeCount < 2 ? 'SINGLE_SUPPORT_MOMENT_UNRESOLVED' : (converged ? 'RESOLVED' : 'LIFTOFF_NOT_CONVERGED');
  return result({ method, stations, active, loads, status, iterations, converged });
}

function result({ method, stations, active, loads, status, iterations, converged }) {
  const activeStations = pick(stations, active);
  const total = activeStations.length ? solveFixed(method, activeStations, loads) : null;
  const perLoad = activeStations.length
    ? loads.map((load) => solveFixed(method, activeStations, [load]))
    : [];
  const bySite = (reactions) => {
    const map = {};
    stations.forEach((station) => station.siteIds.forEach((siteId) => { map[siteId] = 0; }));
    activeStations.forEach((station, k) => {
      station.siteIds.forEach((siteId) => { map[siteId] = reactions[k] / station.siteIds.length; });
    });
    return map;
  };
  return {
    schema: CONTINUOUS_SPAN_SCHEMA,
    method,
    status,
    converged,
    iterations,
    totalForceN: loads.reduce((sum, row) => sum + row.forceN, 0),
    reactionsBySiteId: total ? bySite(total.reactions) : {},
    releasedSiteIds: stations.filter((_, index) => !active[index]).flatMap((station) => station.siteIds),
    coincidentGroups: stations.filter((station) => station.siteIds.length > 1).map((station) => [...station.siteIds]),
    // Chainage each site's reaction acts at (a coincident group shares one station).
    stationChainageBySiteId: Object.fromEntries(stations.flatMap((station) => (
      station.siteIds.map((siteId) => [siteId, station.chainageMm])
    ))),
    supportMomentsNmm: total ? activeStations.map((station, k) => ({ chainageMm: station.chainageMm, momentNmm: total.moments[k] })) : [],
    unresolvedMomentNmm: total ? total.unresolvedMomentNmm : 0,
    contributions: perLoad.map((solved, index) => ({ loadIndex: index, reactionsBySiteId: bySite(solved.reactions) })),
  };
}

// Reactions for a fixed set of stations (sorted, distinct chainage).
function solveFixed(method, stations, loads) {
  const n = stations.length;
  const s = stations.map((row) => row.chainageMm);
  if (n === 1) {
    const forceN = loads.reduce((sum, row) => sum + row.forceN, 0);
    const momentNmm = pieces(loads, s).reduce((sum, piece) => sum + piece.forceN * (piece.centroidMm - s[0]), 0);
    return { reactions: [forceN], moments: [0], unresolvedMomentNmm: momentNmm };
  }
  const spans = s.slice(1).map((value, i) => value - s[i]);
  const lever = new Array(n).fill(0);
  const leftTerm = new Array(n - 1).fill(0); // equation at a span's left support
  const rightTerm = new Array(n - 1).fill(0); // equation at a span's right support
  let leftOverhangMomentNmm = 0;
  let rightOverhangMomentNmm = 0;

  for (const piece of pieces(loads, s)) {
    if (piece.endMm <= s[0]) {
      lever[0] += piece.forceN;
      leftOverhangMomentNmm += piece.forceN * (s[0] - piece.centroidMm);
      continue;
    }
    if (piece.startMm >= s[n - 1]) {
      lever[n - 1] += piece.forceN;
      rightOverhangMomentNmm += piece.forceN * (piece.centroidMm - s[n - 1]);
      continue;
    }
    const i = spanIndex(s, piece.centroidMm);
    const L = spans[i];
    const u1 = piece.startMm - s[i];
    const u2 = piece.endMm - s[i];
    if (u2 - u1 <= 0) {
      const a = u1;
      const b = L - a;
      lever[i] += piece.forceN * b / L;
      lever[i + 1] += piece.forceN * a / L;
      rightTerm[i] += piece.forceN * a * (L * L - a * a) / L;
      leftTerm[i] += piece.forceN * b * (L * L - b * b) / L;
      continue;
    }
    const w = piece.forceN / (u2 - u1);
    const leverRight = (u) => u * u / 2;
    lever[i + 1] += w / L * (leverRight(u2) - leverRight(u1));
    lever[i] += piece.forceN - w / L * (leverRight(u2) - leverRight(u1));
    const term = (x) => L * L * x * x / 2 - x ** 4 / 4;
    rightTerm[i] += w / L * (term(u2) - term(u1));
    leftTerm[i] += w / L * (term(L - u1) - term(L - u2));
  }

  const moments = new Array(n).fill(0);
  moments[0] = -leftOverhangMomentNmm;
  moments[n - 1] = -rightOverhangMomentNmm;
  if (method === THREE_MOMENT_LIFTOFF_V1 && n > 2) {
    const m = n - 2;
    const lower = new Array(m).fill(0);
    const diag = new Array(m).fill(0);
    const upper = new Array(m).fill(0);
    const rhs = new Array(m).fill(0);
    for (let j = 1; j <= m; j += 1) {
      const r = j - 1;
      const La = spans[j - 1];
      const Lb = spans[j];
      diag[r] = 2 * (La + Lb);
      if (j - 1 >= 1) lower[r] = La; else rhs[r] -= La * moments[0];
      if (j + 1 <= m) upper[r] = Lb; else rhs[r] -= Lb * moments[n - 1];
      rhs[r] -= rightTerm[j - 1] + leftTerm[j];
    }
    thomas(lower, diag, upper, rhs).forEach((value, r) => { moments[r + 1] = value; });
  }

  const reactions = [...lever];
  for (let i = 0; i < n - 1; i += 1) {
    const shear = (moments[i + 1] - moments[i]) / spans[i];
    reactions[i] += shear;
    reactions[i + 1] -= shear;
  }
  return { reactions, moments, unresolvedMomentNmm: 0 };
}

// Split loads at station chainages; each piece lies in one region.
function pieces(loads, s) {
  const out = [];
  for (const load of loads) {
    if (load.kind === 'POINT') {
      out.push({ startMm: load.chainageMm, endMm: load.chainageMm, centroidMm: load.chainageMm, forceN: load.forceN });
      continue;
    }
    const cuts = [load.startMm, ...s.filter((x) => x > load.startMm && x < load.endMm), load.endMm];
    const length = load.endMm - load.startMm;
    for (let k = 0; k < cuts.length - 1; k += 1) {
      out.push({
        startMm: cuts[k],
        endMm: cuts[k + 1],
        centroidMm: (cuts[k] + cuts[k + 1]) / 2,
        forceN: load.forceN * (cuts[k + 1] - cuts[k]) / length,
      });
    }
  }
  return out;
}

function spanIndex(s, x) {
  for (let i = 0; i < s.length - 1; i += 1) if (x >= s[i] && x <= s[i + 1]) return i;
  throw new RangeError(`Chainage ${x} is not inside any span.`);
}

function thomas(a, b, c, d) {
  const n = b.length;
  const cp = new Array(n);
  const dp = new Array(n);
  cp[0] = c[0] / b[0];
  dp[0] = d[0] / b[0];
  for (let i = 1; i < n; i += 1) {
    const den = b[i] - a[i] * cp[i - 1];
    cp[i] = c[i] / den;
    dp[i] = (d[i] - a[i] * dp[i - 1]) / den;
  }
  const x = new Array(n);
  x[n - 1] = dp[n - 1];
  for (let i = n - 2; i >= 0; i -= 1) x[i] = dp[i] - cp[i] * x[i + 1];
  return x;
}

function groupStations(supports, toleranceMm) {
  if (!Array.isArray(supports)) throw new TypeError('supports must be an array.');
  const rows = supports.map((row, index) => {
    if (typeof row?.siteId !== 'string' || !row.siteId) throw new TypeError(`supports[${index}].siteId is required.`);
    if (!Number.isFinite(row.chainageMm)) throw new TypeError(`supports[${index}].chainageMm must be finite.`);
    return { siteId: row.siteId, chainageMm: row.chainageMm };
  }).sort((left, right) => left.chainageMm - right.chainageMm || (left.siteId < right.siteId ? -1 : 1));
  const stations = [];
  for (const row of rows) {
    const last = stations[stations.length - 1];
    if (last && row.chainageMm - last.firstChainageMm <= toleranceMm) {
      last.siteIds.push(row.siteId);
      last.chainageMm = (last.chainageMm * (last.siteIds.length - 1) + row.chainageMm) / last.siteIds.length;
    } else {
      stations.push({ chainageMm: row.chainageMm, firstChainageMm: row.chainageMm, siteIds: [row.siteId] });
    }
  }
  return stations;
}

function normalizeLoads(loads) {
  if (!Array.isArray(loads)) throw new TypeError('loads must be an array.');
  return loads.map((row, index) => {
    if (!Number.isFinite(row?.forceN)) throw new TypeError(`loads[${index}].forceN must be finite.`);
    if (Number.isFinite(row.chainageMm)) return { kind: 'POINT', chainageMm: row.chainageMm, forceN: row.forceN };
    if (Number.isFinite(row.startMm) && Number.isFinite(row.endMm)) {
      const startMm = Math.min(row.startMm, row.endMm);
      const endMm = Math.max(row.startMm, row.endMm);
      if (endMm === startMm) return { kind: 'POINT', chainageMm: startMm, forceN: row.forceN };
      return { kind: 'UNIFORM', startMm, endMm, forceN: row.forceN };
    }
    throw new TypeError(`loads[${index}] needs chainageMm or startMm/endMm.`);
  });
}

function pick(stations, active) {
  return stations.filter((_, index) => active[index]);
}

function indexesOf(active) {
  return active.flatMap((on, index) => (on ? [index] : []));
}
