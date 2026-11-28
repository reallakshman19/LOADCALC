// Hand checks shared by the 1885S end-to-end tests. Each one recomputes a
// result from its inputs with the textbook formula, independently of the code
// that produced it, and compares.
import assert from 'node:assert/strict';
import { COMMON_EXPECTED } from './expected-1885s.mjs';
import { caseOf, tagOf } from './headless-1885s-run.mjs';

const near = (actual, expected, tolerance, label) => {
  assert.ok(Number.isFinite(actual), `${label}: not a number (${actual})`);
  assert.ok(Math.abs(actual - expected) <= tolerance, `${label}: ${actual} vs ${expected} (± ${tolerance})`);
};
export { near };

/** Inputs went in the way the browser benchmark puts them in. */
export function checkInputs(result, proposals) {
  assert.equal(result.inputs.inputCheck, 'READY');
  assert.deepEqual([...result.inputs.readyMethods].sort(), ['SUSTAINED_REACTIONS', 'WEIGHT_AND_GRAVITY']);
  assert.equal(result.inputs.proposals, proposals);
  assert.equal(result.inputs.fittingClearWinners, COMMON_EXPECTED.fittingClearWinners);
  assert.equal(result.inputs.fittingReviewRows, COMMON_EXPECTED.fittingReviewRows);
  assert.equal(result.inputs.acceptedRecords,
    proposals + COMMON_EXPECTED.fittingClearWinners + COMMON_EXPECTED.sampleFittingWeights);
  assert.equal(result.inputs.pendingProposals, 0);
  assert.equal(result.runtime.selectedMethod, COMMON_EXPECTED.method);
  assert.deepEqual(result.warnings, [], 'no view part failed quietly');
}

/**
 * Vertical: totals, and two hand checks per load case:
 * (1) every contribution is its mass x g;
 * (2) the support reactions add up to the applied weight (vertical equilibrium).
 */
export function checkVertical(result, appliedN, supportVerticalN = {}) {
  const cases = ['EMPTY', 'OPE', 'HYD'];
  for (const [tag, values] of Object.entries(supportVerticalN)) {
    values.forEach((expected, index) => {
      const sites = caseOf(result.distribution, cases[index]).supportResults.filter((row) => row.tags.includes(tag));
      assert.equal(sites.length, 1, `${tag} is one support site`);
      near(sites[0].verticalForceN, expected, 0.5, `${tag} ${cases[index]} vertical`);
    });
  }
  for (const [loadCaseId, expected] of Object.entries(appliedN)) {
    const loadCase = caseOf(result.distribution, loadCaseId);
    assert.ok(loadCase, `${loadCaseId} present`);
    assert.equal(loadCase.equilibrium.status, 'PASSED', `${loadCaseId} equilibrium`);
    near(loadCase.equilibrium.appliedForceN, expected, 0.1, `${loadCaseId} applied`);
    near(loadCase.completenessAudit.coverageRatio, 1, 1e-9, `${loadCaseId} coverage`);
    assert.equal(loadCase.supportResults.length, COMMON_EXPECTED.supportSites);
    const codes = {};
    loadCase.exceptionLedger.forEach((row) => { codes[row.code] = (codes[row.code] || 0) + 1; });
    assert.deepEqual(codes, COMMON_EXPECTED.exceptionCounts, `${loadCaseId} exceptions`);

    let mass = 0;
    for (const row of loadCase.contributionLedger) {
      // A branch's load handed to its host line is force with no mass of its
      // own (the mass is counted once, on the branch).
      if (row.formula?.branchTransferFromRouteId) { assert.equal(row.massKg, 0); continue; }
      near(row.verticalForceN, row.massKg * 9.80665, 1e-6 * Math.max(1, row.verticalForceN), `${row.contributionId} = m·g`);
      mass += row.massKg;
    }
    near(mass * 9.80665, expected, 0.1, `${loadCaseId} Σ m·g`);
    const reactions = loadCase.supportResults.reduce((sum, row) => sum + row.verticalForceN, 0);
    near(reactions, expected, 0.1, `${loadCaseId} Σ reactions`);
  }
}

export function checkRestraintTable(result) {
  assert.equal(result.restraintTable.summary.siteCount, COMMON_EXPECTED.supportSites);
  assert.deepEqual(result.restraintTable.summary.countsByCode, COMMON_EXPECTED.restraintCodes);
  assert.deepEqual(result.restraintTable.summary.blockedSiteIds, []);
}

/** Friction (ACCURATE): design = mu x N_OPE, N_OPE read from the Run itself. */
export function checkFriction(result, totalN) {
  const friction = result.horizontal;
  assert.equal(friction.status, 'CALCULATED');
  assert.equal(friction.loadCaseId, 'OPE');
  const ope = new Map(caseOf(result.distribution, 'OPE').supportResults.map((row) => [row.supportSiteId, row.verticalForceN]));
  let total = 0;
  let sliding = 0;
  let liftedOff = 0;
  for (const row of friction.rows) {
    if (!row.directions.length) continue;
    const normal = Math.max(0, ope.get(row.siteId));
    near(row.normalForceN, normal, 1e-6, `${tagOf(row)} N_OPE`);
    near(row.designFrictionN, row.mu * normal, 1e-6, `${tagOf(row)} μ·N`);
    total += row.designFrictionN;
    if (normal > 0) sliding += 1;
    else liftedOff += 1;
  }
  assert.equal(sliding, COMMON_EXPECTED.slidingSupports);
  // The lifted-off rest (Option B lift-off, S8811951/B2) carries no load, so no friction.
  assert.equal(liftedOff, 1);
  assert.equal(friction.summary.slidingSiteCount, sliding);
  near(friction.summary.totalDesignFrictionN, total, 1e-6, 'Σ friction');
  near(total, totalN, 0.1, 'total design friction');
}

/** Line stops (ACCURATE): each side = Σ axial friction of its supports; design = larger side. */
export function checkLineStops(result, designN) {
  const { lineStops } = result.horizontal;
  assert.equal(lineStops.rows.length, COMMON_EXPECTED.lineStops);
  for (const row of lineStops.rows) {
    assert.equal(row.status, 'CALCULATED', `${tagOf(row)} status`);
    const sides = row.sides.map((side) => {
      const sum = side.supports.reduce((total, support) => total + support.axialFrictionN, 0);
      near(side.frictionN, sum, 1e-6, `${tagOf(row)} ${side.towards} Σ μ·N`);
      return side.frictionN;
    });
    near(row.designAxialN, Math.max(...sides), 1e-6, `${tagOf(row)} design = larger side`);
    if (sides.length === 2) near(row.netAxialN, Math.abs(sides[0] - sides[1]), 1e-6, `${tagOf(row)} net`);
  }
  for (const [tag, expected] of Object.entries(designN)) {
    const row = lineStops.rows.find((candidate) => candidate.tags.includes(tag));
    assert.ok(row, `${tag} is a line stop`);
    near(row.designAxialN, expected, 0.5, `${tag} design axial`);
  }
}

/**
 * Guides (SCREENING): guided cantilever, per calculated end
 *   Δ = α·ΔT·L_growth·(sideways part), lower = 3·E·I_min·Δ/L³, upper = 12·E·I_max·Δ/L³.
 */
export function checkGuides(result, boundsN = {}) {
  const { guides } = result.horizontal;
  assert.equal(guides.rows.length, COMMON_EXPECTED.guides);
  for (const row of guides.rows) {
    for (const end of row.ends.filter((candidate) => candidate.status === 'CALCULATED')) {
      const label = `${tagOf(row)} ${end.end}`;
      if (!(end.deflectionMm > 0)) {
        // No temperature above installation: no growth, no push.
        assert.equal(end.lowerN, 0, `${label} lower`);
        assert.equal(end.upperN, 0, `${label} upper`);
        continue;
      }
      const delta = end.thermalExpansionPerC * end.deltaTC * end.growthLengthMm * end.acrossFactor;
      near(end.deflectionMm, delta, 1e-9 + 1e-9 * delta, `${label} Δ`);
      const l3 = end.guideToCornerMm ** 3;
      near(end.lowerN, (3 * end.elasticModulusMpa * end.secondMomentMm4.min * delta) / l3, 1e-6, `${label} lower`);
      near(end.upperN, (12 * end.elasticModulusMpa * end.secondMomentMm4.max * delta) / l3, 1e-6, `${label} upper`);
    }
    if (row.lowerN !== null) {
      near(row.lowerN, Math.max(...row.ends.map((end) => end.lowerN ?? 0)), 1e-9, `${tagOf(row)} lower = worst end`);
      near(row.upperN, Math.max(...row.ends.map((end) => end.upperN ?? 0)), 1e-9, `${tagOf(row)} upper = worst end`);
    }
  }
  for (const [tag, [lower, upper]] of Object.entries(boundsN)) {
    const row = guides.rows.find((candidate) => candidate.tags.includes(tag));
    assert.ok(row, `${tag} is a guide`);
    near(row.lowerN, lower, 0.1, `${tag} lower`);
    near(row.upperN, upper, 0.1, `${tag} upper`);
  }
}

/** The Results pane shows what was calculated, current (not HISTORICAL), with its labels. */
export function checkResultsPane(result) {
  const html = result.paneHtml;
  const ope = html.split('<section class="load-case-evidence"').find((section) => section.includes('<h2>OPE '));
  assert.ok(ope, 'OPE section rendered');
  assert.doesNotMatch(ope, /HISTORICAL/u, 'OPE results are current');
  const friction = result.horizontal;
  assert.ok(ope.includes(`Total design friction ${friction.summary.totalDesignFrictionN.toFixed(3)} N over ${COMMON_EXPECTED.slidingSupports} sliding supports.`));
  assert.ok(ope.includes('Friction, design μ·N (N, ACCURATE)'));
  assert.ok(ope.includes('Line stops: axial load, friction part (ACCURATE)'));
  assert.ok(ope.includes('With thermal push, lower – upper (N, SCREENING)'));
  assert.ok(ope.includes('Guides: lateral load from thermal growth (SCREENING bounds)'));
  assert.equal((ope.match(/data-line-stop-site-id=/gu) || []).length, COMMON_EXPECTED.lineStops);
  assert.equal((ope.match(/data-guide-site-id=/gu) || []).length, COMMON_EXPECTED.guides);
  for (const row of friction.lineStops.rows) {
    assert.ok(ope.includes(`<td>${tagOf(row)}</td>`), `${tagOf(row)} shown`);
    assert.ok(ope.includes(row.designAxialN.toFixed(3)), `${tagOf(row)} design axial shown`);
  }
  for (const row of friction.guides.rows) {
    if (row.lowerN !== null) assert.ok(ope.includes(row.lowerN.toFixed(3)), `${tagOf(row)} guide lower shown`);
  }
  // Friction is shown in the operating case only.
  const empty = html.split('<section class="load-case-evidence"').find((section) => section.includes('<h2>EMPTY '));
  assert.doesNotMatch(empty, /Total design friction/u);
  return ope;
}
