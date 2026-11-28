import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyRestraintReviewPicks,
  restraintReviewRows,
} from '../src/workspace/support-sites/support-restraint-review-view.js';

// Restraints review: only supports whose parts all have a blank SUPPORT_TYPE
// can be typed here; picks become topology.supportTypeOverridesByTag by tag.

const row = (siteId, tags, code, status, partCount, blankTypePartCount, typeAuthority) => ({
  siteId, tags, code, status, partCount, blankTypePartCount, typeAuthority,
  lineKeys: ['S8811951'], positionMm: { x: 1, y: 2, z: 3 }, restrains: null, friction: { directions: [] }, unknownTypes: [],
});
const table = {
  status: 'PROPOSAL_WITH_BLOCKED_SITES',
  rows: [
    row('s1', ['PS-1'], 'R+G', 'READY', 2, 0, 'SOURCE'), // typed by the model
    row('s2', ['PS-2'], 'R', 'READY', 1, 1, 'PROJECT_DATA_SUPPORT_TYPE_OVERRIDE'), // owner-typed REST
    row('s3', ['=ATTA/1'], 'NONE', 'NOT_A_SUPPORT', 1, 1, 'PROJECT_DATA_SUPPORT_TYPE_OVERRIDE'),
    row('s4', ['PS-4', 'PS-4B'], '?', 'BLOCKED_UNKNOWN_FUNCTION', 2, 2, null), // no type yet
    row('s5', ['PS-5'], 'R', 'READY', 3, 2, 'SOURCE'), // frame parts blank, but typed by its rest part
  ],
};
const overrides = { 'PS-2': 'REST', '=ATTA/1': 'NONE' };

test('only all-blank supports are editable, with their current choice', () => {
  const rows = restraintReviewRows(table, overrides);
  const by = Object.fromEntries(rows.map((r) => [r.siteId, r]));
  assert.equal(by.s1.editable, false);
  assert.equal(by.s1.typeFrom, 'model');
  assert.equal(by.s5.editable, false, 'a typed part decides the type');
  assert.equal(by.s2.editable, true);
  assert.equal(by.s2.choice, 'REST');
  assert.equal(by.s3.choice, 'NONE');
  assert.equal(by.s4.editable, true);
  assert.equal(by.s4.choice, '');
  assert.equal(by.s4.tag, 'PS-4');
});

test('picks update the override map for every tag of the site, and only real changes count', () => {
  const rows = restraintReviewRows(table, overrides);
  const result = applyRestraintReviewPicks(overrides, rows, { s2: 'REST', s3: '', s4: 'GUIDE', s1: 'LINESTOP' });
  assert.deepEqual(result.overrides, { 'PS-2': 'REST', 'PS-4': 'GUIDE', 'PS-4B': 'GUIDE' });
  assert.deepEqual(result.changes, ['=ATTA/1: NONE → not set', 'PS-4: not set → GUIDE']);
  assert.throws(() => applyRestraintReviewPicks(overrides, rows, { s4: 'ANCHOR' }), /Unknown support type/);
});
