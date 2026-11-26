import test from 'node:test';
import assert from 'node:assert/strict';
import {
  designFrictionN,
  freeThermalGrowthMm,
  frictionNeutralPoint,
  fullyRestrainedAxialForceN,
  guidedCantileverBoundsN,
  lineStopFrictionN,
  pipeMetalAreaMm2,
  pipeSecondMomentMm4,
} from '../src/core/empirical-restraint-loads/index.js';

const near = (actual, expected, relTol, label) => assert.ok(
  Math.abs(actual - expected) <= Math.abs(expected) * relTol, `${label}: ${actual} vs ${expected}`,
);

test('6" Sch 40 section properties match tables (I ≈ 28.1 in⁴, A ≈ 5.58 in²)', () => {
  near(pipeSecondMomentMm4(168.3, 7.11), 28.14 * 25.4 ** 4, 0.005, 'I');
  near(pipeMetalAreaMm2(168.3, 7.11), 5.581 * 25.4 ** 2, 0.005, 'A');
});

test('free growth: 30 m carbon steel at ΔT 100 °C grows 35.1 mm', () => {
  near(freeThermalGrowthMm({ lengthMm: 30000, expansionPerC: 1.17e-5, deltaTC: 100 }), 35.1, 1e-9, 'δ');
});

test('guided cantilever bounds: 3·EIΔ/L³ and 12·EIΔ/L³', () => {
  const I = pipeSecondMomentMm4(168.3, 7.11);
  const bounds = guidedCantileverBoundsN({ elasticModulusMpa: 203000, secondMomentMm4: I, deflectionMm: 10, lengthMm: 3000 });
  near(bounds.upperN, 12 * 203000 * I * 10 / 3000 ** 3, 1e-12, 'upper');
  near(bounds.lowerN, bounds.upperN / 4, 1e-12, 'lower');
  assert.equal(bounds.label, 'SCREENING');
});

test('fully restrained axial force: E·A·α·ΔT', () => {
  const A = pipeMetalAreaMm2(168.3, 7.11);
  near(fullyRestrainedAxialForceN({ elasticModulusMpa: 203000, metalAreaMm2: A, expansionPerC: 1.17e-5, deltaTC: 100 }),
    203000 * A * 1.17e-3, 1e-12, 'F');
});

test('friction: design μN, neutral point and line stop held friction', () => {
  assert.equal(designFrictionN({ normalForceN: 1000, frictionCoefficient: 0.3 }), 300);
  assert.equal(designFrictionN({ normalForceN: -50, frictionCoefficient: 0.3 }), 0, 'lifted support has no friction');
  const supports = [0, 3000, 6000, 9000, 12000].map((chainageMm) => ({ chainageMm, normalForceN: 1000, frictionCoefficient: 0.3 }));
  const neutral = frictionNeutralPoint(supports);
  assert.equal(neutral.chainageMm, 6000);
  assert.equal(neutral.frictionBeforeN, 600);
  assert.equal(neutral.frictionAfterN, 600);
  // Stop at 0 holding the leg out to 12 m: four sliding supports beyond it.
  assert.equal(lineStopFrictionN({ supports, stopChainageMm: 0, heldEndChainageMm: 12000 }), 1200);
});
