// A task the enclave reports with a non-zero task code ends in ERROR with its
// error report kept as the result; the run's input dataset is sent with the
// request. LOCAL-mode runs talk to a stand-in for the ecld-test API; the
// chain-side result handling and the input metadata run on stand-in state.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import jsrsasign from 'jsrsasign';
import EthernityCloudRunner from '../runner.js';
import { ECStatus, ZERO_CHECKSUM } from '../enums.js';
import { sha256 } from '../crypto.js';
import * as ipfsClient from '../ipfs.js';

const localApi = (taskCode, taskCodeName, result) => {
  const bodies = [];
  globalThis.fetch = async (url, init) => {
    if (init && init.body) bodies.push(JSON.parse(init.body));
    const payload = url.endsWith('/v1/health')
      ? { backend: [] }
      : { task_code: taskCode, task_code_name: taskCodeName, result, checksum: sha256(result) };
    return { ok: true, json: async () => payload };
  };
  return bodies;
};

test('a LOCAL task with task code 0 succeeds', async () => {
  localApi(0, 'SUCCESS', 'ok');
  const runner = new EthernityCloudRunner('LOCAL');
  await runner.run(null, 'demo', 'f()');
  assert.equal(runner.getStatus(), ECStatus.SUCCESS);
  assert.equal(runner.getLastError(), null);
});

test('a LOCAL task that raised is an error with its report', async () => {
  localApi(4, 'BASE_EXCEPTION', "BASE_EXCEPTION: RuntimeError('boom')");
  const runner = new EthernityCloudRunner('LOCAL');
  await runner.run(null, 'demo', 'f()');
  assert.equal(runner.getStatus(), ECStatus.ERROR);
  assert.match(runner.getLastError(), /BASE_EXCEPTION \(4\)/);
  assert.deepEqual(runner.getResultTaskCode(), { code: 4, name: 'BASE_EXCEPTION' });
  assert.equal(await runner.getResult(), "BASE_EXCEPTION: RuntimeError('boom')");
});

test('the input dataset reaches the LOCAL task; no input sends null', async () => {
  const bodies = localApi(0, 'SUCCESS', 'ok');
  const runner = new EthernityCloudRunner('LOCAL');
  await runner.run(null, 'demo', 'f()', '', null, { inputData: 'a,b,c\n1,2,3' });
  await runner.run(null, 'demo', 'f()');
  assert.deepEqual(bodies.filter((b) => 'payload' in b), [
    { payload: 'f()', input: 'a,b,c\n1,2,3' },
    { payload: 'f()', input: null }
  ]);
});

test('inputData must be a string', async () => {
  const runner = new EthernityCloudRunner('LOCAL');
  await assert.rejects(runner.run(null, 'demo', 'f()', '', null, { inputData: Buffer.from('x') }),
    /inputData must be a string/);
});

// A runner whose result reader answers with `taskCode`; the rest of
// getOrderResult runs as written.
const chainResult = (taskCode, taskCodeName, value) => {
  const runner = new EthernityCloudRunner('LOCAL');
  runner.orderId = 12;
  runner.getResultFromOrder = async () => ({
    success: true, resultTaskCode: taskCodeName, resultTaskCodeInt: taskCode, result: value
  });
  return runner;
};

test('an order result with task code 0 succeeds', async () => {
  const runner = chainResult(0, 'SUCCESS', 'ok');
  await runner.getOrderResult();
  assert.equal(runner.getStatus(), ECStatus.SUCCESS);
  assert.equal(await runner.getResult(), 'ok');
});

test('an order result with a non-zero task code is an error that keeps the report', async () => {
  const report = "BASE_EXCEPTION: RuntimeError('ESR is not enabled')\nTraceback ...";
  const runner = chainResult(4, 'BASE_EXCEPTION', report);
  await runner.getOrderResult();
  assert.equal(runner.getStatus(), ECStatus.ERROR);
  assert.match(runner.getLastError(), /BASE_EXCEPTION \(4\)/);
  assert.equal(await runner.getResult(), report);
});

// An EC P-384 certificate, the kind an enclave registers, for sealing.
const certificate = () => {
  const kp = jsrsasign.KEYUTIL.generateKeypair('EC', 'secp384r1');
  return new jsrsasign.KJUR.asn1.x509.Certificate({
    version: 3,
    serial: { int: 1 },
    issuer: { str: '/CN=enclave' },
    subject: { str: '/CN=enclave' },
    notbefore: '250101000000Z',
    notafter: '350101000000Z',
    sbjpubkey: kp.pubKeyObj,
    sigalg: 'SHA256withECDSA',
    cakey: kp.prvKeyObj
  }).getPEM();
};

test('an input dataset is stored sealed and named with its sha256', async () => {
  ipfsClient.initializeIntake('bloxberg_testnet');
  const runner = new EthernityCloudRunner('LOCAL');
  runner.enclavePublicKey = certificate();
  runner.inputData = 'the dataset';
  const metadata = await runner.getV3InputMedata();
  assert.equal(metadata, `v3:${runner.fileSetHash}:${sha256('the dataset')}`);
  assert.match(runner.fileSetHash, /^b[a-z2-7]+$/);
});

test('no input, or a session, is the empty input metadata', async () => {
  const runner = new EthernityCloudRunner('LOCAL');
  runner.inputData = null;
  assert.equal(await runner.getV3InputMedata(), `v3::${ZERO_CHECKSUM}`);
  runner.inputData = 'ignored by a session';
  runner._sessionRequest = true;
  assert.equal(await runner.getV3InputMedata(), `v3s::${ZERO_CHECKSUM}`);
  assert.equal(runner.fileSetHash, '');
});
