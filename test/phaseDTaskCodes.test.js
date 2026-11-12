// Phase D task codes and the result string v5: the handover and termination
// outcomes 41-43 are named, the replay notice 54 is named, and every example
// result of the shared fixture (test/fixtures/result-v5.json, a copy of
// pox-smart-contract-litvm/spec/result-v5.json) parses through
// parseTransactionBytes to its version, task code, checksum and challenge.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ethers } from 'ethers';
import EthernityCloudRunner from '../runner.js';
import { ECOrderTaskStatus, OPERATOR_FAULT_CODES, isOperatorFaultCode, taskStatusName } from '../enums.js';
import { SESSION_ERROR_CODE_NAMES } from '../session.js';
import contractBloxberg from '../contract/abi/etnyAbi.js';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/result-v5.json', import.meta.url), 'utf8'));
const ORDER_ID = 1234;
const POX = '0x549A6E06BB2084100148D50F51CF77a3436C3Ae7';
const wallet = ethers.Wallet.createRandom();

// The embedded result transaction of a trustedzone: _addResultToOrder(orderId,
// result), signed by the task wallet.
const signedResult = async (result) => {
  const iface = new ethers.Interface(contractBloxberg.abi);
  return wallet.signTransaction({
    to: POX,
    chainId: 8995,
    nonce: 0,
    gasLimit: 1000000,
    gasPrice: 1000000,
    data: iface.encodeFunctionData('_addResultToOrder', [ORDER_ID, result])
  });
};

test('the handover and termination codes are named', () => {
  assert.equal(taskStatusName(41), 'SERVICE_TRANSFERRED');
  assert.equal(taskStatusName(42), 'SERVICE_TRANSFER_FORCED');
  assert.equal(taskStatusName(43), 'TERMINATED');
  assert.equal(taskStatusName('42'), 'SERVICE_TRANSFER_FORCED');
  assert.equal(taskStatusName(40), 'CAS_ATTESTATION_FAULT');
  assert.equal(taskStatusName(44), 'UNKNOWN_44');
});

test('the handover and termination codes are not operator faults', () => {
  assert.deepEqual(OPERATOR_FAULT_CODES, [37, 39, 40]);
  for (const code of [41, 42, 43]) {
    assert.equal(isOperatorFaultCode(code), false);
  }
});

test('the replay notice 54 is named among the session error codes', () => {
  assert.equal(SESSION_ERROR_CODE_NAMES[53], 'unsupported-securelock');
  assert.equal(SESSION_ERROR_CODE_NAMES[54], 'session-replay-unavailable');
});

test('the fixture holds the seven v5 examples with fifteen fields each', () => {
  assert.equal(fixture.version, 'v5');
  assert.equal(fixture.fieldCount, 15);
  const examples = Object.values(fixture.examples);
  assert.equal(examples.length, 7);
  for (const example of examples) {
    assert.equal(example.result.split(fixture.separator).length, fixture.fieldCount, example.name);
  }
  assert.deepEqual(
    examples.map((example) => example.inputs.taskCode).filter((code) => code > 40).sort(),
    [41, 42]
  );
});

test('parseTransactionBytes reads every v5 example to its version, task code, checksum and challenge', async () => {
  const runner = new EthernityCloudRunner('LOCAL');
  runner.protocolAbi = contractBloxberg.abi;
  for (const example of Object.values(fixture.examples)) {
    const parsed = runner.parseTransactionBytes(await signedResult(example.result));
    const field = (name) => example.fields.find((f) => f.name === name).value;
    assert.equal(parsed.version, 'v5', example.name);
    assert.equal(parsed.from, wallet.address, example.name);
    assert.equal(parsed.to, POX, example.name);
    assert.equal(parsed.chainId, 8995n, example.name);
    assert.equal(parsed.orderId, BigInt(ORDER_ID), example.name);
    assert.equal(parsed.taskCode, String(example.inputs.taskCode), example.name);
    assert.equal(parsed.taskCode, field('taskCode'), example.name);
    assert.equal(parsed.taskCodeString, ECOrderTaskStatus[example.inputs.taskCode], example.name);
    assert.doesNotMatch(parsed.taskCodeString, /^UNKNOWN_/, example.name);
    assert.equal(parsed.checksum, field('resultChecksum'), example.name);
    assert.equal(parsed.enclaveChallenge, field('enclaveChallenge'), example.name);
  }
});

test('a transferred and a forced-transfer result are reported by name', async () => {
  const runner = new EthernityCloudRunner('LOCAL');
  runner.protocolAbi = contractBloxberg.abi;
  const byCode = {};
  for (const example of Object.values(fixture.examples)) {
    byCode[example.inputs.taskCode] = example;
  }
  assert.equal(runner.parseTransactionBytes(await signedResult(byCode[41].result)).taskCodeString, 'SERVICE_TRANSFERRED');
  assert.equal(runner.parseTransactionBytes(await signedResult(byCode[42].result)).taskCodeString, 'SERVICE_TRANSFER_FORCED');
});
