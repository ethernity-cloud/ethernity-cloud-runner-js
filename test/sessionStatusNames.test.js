// SESSION_STATUS_NAMES names the session status byte of a v5 result (field 11)
// exactly as the shared fixture's constants.sessionStatusCodes does, with
// transferred 6 and transfer-forced 7, and the fixture's handover examples
// carry those two statuses.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SESSION_STATUS_NAMES } from '../session.js';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/result-v5.json', import.meta.url), 'utf8'));

test('the session status names are the fixture table inverted', () => {
  const codes = fixture.constants.sessionStatusCodes;
  assert.equal(codes.transferred, 6);
  assert.equal(codes['transfer-forced'], 7);
  const inverted = Object.fromEntries(Object.entries(codes).map(([name, code]) => [code, name]));
  assert.deepEqual(SESSION_STATUS_NAMES, inverted);
  assert.equal(SESSION_STATUS_NAMES[parseInt(fixture.constants.noSessionStatus, 16)], undefined);
});

test('the handover examples carry the transferred and transfer-forced statuses', () => {
  const statusOf = (example) => parseInt(example.fields.find((f) => f.name === 'sessionStatus').value, 16);
  const byCode = {};
  for (const example of Object.values(fixture.examples)) {
    byCode[example.inputs.taskCode] = example;
  }
  assert.equal(SESSION_STATUS_NAMES[statusOf(byCode[41])], 'transferred');
  assert.equal(SESSION_STATUS_NAMES[statusOf(byCode[42])], 'transfer-forced');
  assert.equal(statusOf(fixture.examples.plain), parseInt(fixture.constants.noSessionStatus, 16));
});
