// ROADMAP Phase 1 step 4: Run follows Input Check. When Input Check has been
// evaluated and is not READY, Run is shown as blocked and opens Input Check;
// a Run stopped by its inputs is told in plain words.
import test from 'node:test';
import assert from 'node:assert/strict';
import { runInputGate } from '../src/workspace/load-calc-current-system-view.js';
import { runInputFailureSentence } from '../src/workspace/load-calc-consumer-controller.js';

const readyReport = { packageState: 'READY', readyMethodIds: ['GRAVITY'], blockedMethodIds: [], blockers: [] };
const blockedReport = {
  packageState: 'BLOCKED', readyMethodIds: [], blockedMethodIds: ['GRAVITY'],
  blockers: [{ code: 'MISSING_VALUE' }, { code: 'MASTER_NOT_READY' }, { code: 'MISSING_VALUE' }],
};
const state = (report, readiness = {}) => ({
  commonInputState: { report, commonInput: null, staleness: null, error: null },
  workflowReadiness: { validationEvaluated: Boolean(report), ...readiness },
});

test('Input Check READY: Run is not blocked', () => {
  assert.equal(runInputGate(state(readyReport)).blocked, false);
});

test('Input Check not evaluated yet: Run stays available (it checks the inputs itself)', () => {
  assert.equal(runInputGate(state(null)).blocked, false);
});

test('Input Check not READY: Run blocked, with the Input Check issue count', () => {
  const gate = runInputGate(state(blockedReport, { validationBlockerCount: 9 }));
  assert.equal(gate.blocked, true);
  assert.equal(gate.issueCount, 9);
  assert.equal(gate.label, 'Blocked: 9 issues — open Input Check');
  assert.match(gate.sentence, /^Run is blocked: Input Check is not READY \(9 issues\)\. Open Input Check \(step 6\)/u);
});

test('Input Check not READY with no count from the step: falls back to the report blockers', () => {
  const gate = runInputGate(state(blockedReport));
  assert.equal(gate.issueCount, 3);
  assert.equal(gate.label, 'Blocked: 3 issues — open Input Check');
});

test('One issue is written in the singular', () => {
  assert.equal(runInputGate(state(blockedReport, { validationBlockerCount: 1 })).label, 'Blocked: 1 issue — open Input Check');
});

test('A current READY seal is not blocked even if a later report is not READY', () => {
  const sealed = state(blockedReport, { validationBlockerCount: 2 });
  sealed.commonInputState = {
    ...sealed.commonInputState,
    staleness: { stale: false },
    commonInput: { packageState: 'READY', sealedMethodIds: ['GRAVITY'], blockedMethodIds: [] },
  };
  assert.equal(runInputGate(sealed).blocked, false);
});

test('Run stopped by its inputs: plain sentence instead of the internal message', () => {
  for (const code of [
    'COMMON_INPUT_PRODUCT_SCREENING_SNAPSHOT_NOT_READY',
    'NON_FEA_EMPIRICAL_RUN_AUTHORIZATION_NOT_READY',
    'CURRENT_COMMON_INPUT_EMPIRICAL_RUN_COMMON_INPUT_NOT_READY',
  ]) {
    const sentence = runInputFailureSentence(code, 'A product screening snapshot requires a fully READY Common Input checker report.');
    assert.match(sentence, /^Run stopped: Input Check is not READY/u, code);
    assert.doesNotMatch(sentence, /screening snapshot|Common Input checker/u, code);
  }
  assert.match(runInputFailureSentence('COMMON_INPUT_EVALUATION_FAILED', 'bad master'), /could not be checked \(bad master\)/u);
});

test('Other Run failures keep their own message', () => {
  assert.equal(runInputFailureSentence('CURRENT_COMMON_INPUT_EMPIRICAL_RUN_FAILED', 'x'), null);
  assert.equal(runInputFailureSentence(null, 'x'), null);
});
