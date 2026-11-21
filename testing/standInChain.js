// A stand-in chain at the provider, for the tests that run the runner's own
// steps against it: every eth_call, gas estimate, transaction and log read is
// recorded with the contract it is addressed to and answered from the state
// the transactions leave (a DO request, the order placed on it, its approval,
// its metadata rows). The module is no test file and lives outside test/:
// node's test runner runs every .js file under a directory named test.
import assert from 'node:assert/strict';
import { ethers } from 'ethers';
import { ECAddress } from '../enums.js';
import etnyAbi from '../contract/abi/etnyAbi.js';
import ecldAbi from '../contract/abi/ecldAbi.js';
import protocolAbi from '../contract/abi/polygonProtocolAbi.js';
import registryAbi from '../contract/abi/imageRegistryAbi.js';

export const WALLET = '0x71d005d502bd2EEBD2368f35EA33e66cD7A63CB7';
export const NODE = '0x837EA0A09612CFF93a787db84Bbe11c65E431133';
// Order statuses the stand-in chain answers: a session's order stays
// PROCESSING once approved, a task's order reads as closed.
const PROCESSING = 1;
const CLOSED = 2;
// The key the stand-in chain signs every order's result transaction with.
const ENCLAVE = ethers.Wallet.createRandom();

export const AMOY_TOKEN = ECAddress.POLYGON.TESTNET_ADDRESS;
export const BLOXBERG_TOKEN = ECAddress.BLOXBERG.TESTNET_ADDRESS;
export const BLOXBERG_POX10_TOKEN = ECAddress.BLOXBERG.TESTNET_POX10_ADDRESS;
export const BLOXBERG_MAINNET_TOKEN = ECAddress.BLOXBERG.MAINNET_ADDRESS;

// The contracts of Polygon Amoy's two networks, by the label the recorded
// traffic names them with: the test ECLD both are paid in, and the PoX and
// the image registry of each.
export const AMOY = {
  chainId: 80002,
  contracts: {
    token: [AMOY_TOKEN, ecldAbi.abi],
    pox20: [ECAddress.POLYGON.TESTNET_PROTOCOL_ADDRESS, protocolAbi.abi],
    registry20: [ECAddress.POLYGON.IMAGE_REGISTRY.PYNITHY.TESTNET_ADDRESS, registryAbi.abi],
    pox10: [ECAddress.POLYGON.AMOY_POX10_PROTOCOL_ADDRESS, protocolAbi.abi],
    registry10: [ECAddress.POLYGON.IMAGE_REGISTRY.PYNITHY.AMOY_POX10_ADDRESS, registryAbi.abi]
  }
};
// The contracts of the bloxberg testnet's two networks: tETNY with the PoX
// 2.0 and its registry, and the PoX 1.0 network's proxy, token and PoX in
// one, with its registry.
export const BLOXBERG = {
  chainId: 8995,
  contracts: {
    token: [BLOXBERG_TOKEN, etnyAbi.abi],
    pox20: [ECAddress.BLOXBERG.TESTNET_PROTOCOL_ADDRESS, protocolAbi.abi],
    registry20: [ECAddress.BLOXBERG.IMAGE_REGISTRY.PYNITHY.TESTNET_ADDRESS, registryAbi.abi],
    pox10: [BLOXBERG_POX10_TOKEN, etnyAbi.abi],
    registry10: [ECAddress.BLOXBERG.IMAGE_REGISTRY.PYNITHY.TESTNET_POX10_ADDRESS, registryAbi.abi]
  }
};
// The contracts of the two ECLD testnets whose token address is one, LitVM
// LiteForge and IoTeX, on one stand-in on LitVM's chain id: the shared test
// ECLD, and the PoX and the image registry of each.
export const SHARED_TOKEN_TESTNETS = {
  chainId: 4441,
  contracts: {
    token: [ECAddress.LITVM.TESTNET_ADDRESS, ecldAbi.abi],
    poxLitvm: [ECAddress.LITVM.TESTNET_PROTOCOL_ADDRESS, protocolAbi.abi],
    registryLitvm: [ECAddress.LITVM.IMAGE_REGISTRY.PYNITHY.TESTNET_ADDRESS, registryAbi.abi],
    poxIotex: [ECAddress.IOTEX.TESTNET_PROTOCOL_ADDRESS, protocolAbi.abi],
    registryIotex: [ECAddress.IOTEX.IMAGE_REGISTRY.PYNITHY.TESTNET_ADDRESS, registryAbi.abi]
  }
};
// Bloxberg mainnet's contracts: the ETNY proxy, token and PoX in one, and its
// image registry.
export const BLOXBERG_MAINNET = {
  chainId: 8995,
  contracts: {
    pox: [BLOXBERG_MAINNET_TOKEN, etnyAbi.abi],
    registry: [ECAddress.BLOXBERG.IMAGE_REGISTRY.PYNITHY.MAINNET_ADDRESS, registryAbi.abi]
  }
};

// The certificate the stand-in registry `registry` holds for `trustedZone`,
// unless the chain is given another.
export const certificateOf = (trustedZone, registry) => `certificate of ${trustedZone} in ${registry}`;

// The next turn of the event loop: the reads the event watchers of a run make
// on their first tick are made by then.
export const settle = () => new Promise((resolve) => setImmediate(resolve));

// A chain holding `contracts` ({ label: [address, abi] }) on `chainId`:
// { provider, signer, log, at, during, unanswered, balance }. log is the
// traffic in the order it was made, one entry per eth_call ('call'), gas
// estimate ('estimate'), transaction ('send') and log read ('logs'), each
// with the label of the contract it is addressed to and, for the first
// three, the function's name and arguments. during(kind, name, run) calls
// run() once, at the first `kind` entry of the function `name`. The set
// unanswered names what reverts every eth_call: a contract by its label, or
// one function of it as label.function. balance is the wallet's balance of
// every token, in tokens. `certificate` is the certificate a registry answers
// for a trustedzone, given the trustedzone's name and the registry's label.
export const chainOf = ({ chainId, contracts }, { certificate = certificateOf } = {}) => {
  const byAddress = new Map(Object.entries(contracts).map(([label, [address, abi]]) => [
    address.toLowerCase(),
    { label, address, iface: new ethers.Interface(abi), requests: [], orders: [], placed: [] }
  ]));
  const at = (address) => {
    const contract = byAddress.get(String(address).toLowerCase());
    if (!contract) throw new Error(`no contract of this test at ${address}`);
    return contract;
  };
  const log = [];
  const receipts = new Map();
  const hooks = [];
  const unanswered = new Set();
  const record = (kind, tx) => {
    const contract = at(tx.to);
    const call = contract.iface.parseTransaction({ data: tx.data });
    if (!call) throw new Error(`${contract.label} has no function for ${tx.data.slice(0, 10)}`);
    const entry = { kind, label: contract.label, name: call.name, args: call.args };
    if (call.name === 'allowance') entry.spender = at(call.args[1]).label;
    if (call.name === 'approve') entry.spender = at(call.args[0]).label;
    log.push(entry);
    const hook = hooks.findIndex((h) => h.kind === kind && h.name === call.name);
    if (hook >= 0) hooks.splice(hook, 1)[0].run();
    return { contract, call };
  };
  const reverted = () => { throw Object.assign(new Error('execution reverted'), { code: 'CALL_EXCEPTION' }); };
  // The result row of an order: 'v3:<result transaction>:<result CID>', the
  // transaction an _addResultToOrder call to the order's PoX, signed for the
  // chain by ENCLAVE.
  const resultRow = async (contract, orderId) => {
    const transaction = await ENCLAVE.signTransaction({
      type: 0,
      chainId,
      nonce: 0,
      gasLimit: 100000,
      gasPrice: 1,
      to: contract.address,
      data: contract.iface.encodeFunctionData('_addResultToOrder', [orderId, 'v3:0:checksum:enclave challenge'])
    });
    return `v3:${transaction}:QmResult`;
  };
  const answer = async ({ contract, call }) => {
    if (unanswered.has(contract.label) || unanswered.has(`${contract.label}.${call.name}`)) reverted();
    const request = () => contract.requests[Number(call.args[0])] || reverted();
    const order = () => contract.orders[Number(call.args[0])] || reverted();
    switch (call.name) {
      case 'balanceOf': return [ethers.parseEther(String(chain.balance))];
      case 'allowance': return [0];
      case '_getOrdersCount': return [contract.orders.length];
      case '_getOrder': return [WALLET, NODE, order().doRequest, 0, order().status];
      case '_getDORequest': return [WALLET, 1, 1, 40, 1, request().duration, 3, 1];
      case '_getDORequestMetadata': return [WALLET, ...request().metadata];
      case '_getDPRequestMetadata': return [NODE, '', '', '', ''];
      case '_getMyDPRequests': return [[1]];
      case '_getMetadataCountForRequest': return [request().rows.length];
      case '_getMetadataValueForRequest': return request().rows[Number(call.args[1])];
      case '_getMetadataCountForDPRequest': return [0];
      case '_getResultFromOrder': return [await resultRow(contract, order() && call.args[0])];
      case 'getLatestTrustedZoneImageCertPublicKey':
        return ['QmTrustedZone', certificate(call.args[0], contract.label), 'QmTrustedZoneCompose'];
      case 'getLatestImageVersionPublicKey':
        return [`QmImage-${contract.label}`, 'certificate of the securelock', `QmCompose-${contract.label}`];
      default: throw new Error(`no answer of this test for ${call.name}`);
    }
  };
  const eventLog = (contract, name, values) => ({ address: contract.address, ...contract.iface.encodeEventLog(name, values) });
  // What a transaction leaves on its contract, and the logs of its receipt. A
  // DO request is given an order at once; a session's order (a request whose
  // input metadata is tagged v3s) is PROCESSING once approved, a task's
  // CLOSED.
  const effect = ({ contract, call }) => {
    const { requests, orders, placed } = contract;
    if (call.name === '_addDORequest') {
      const metadata = Array.from(call.args).slice(7).map(String);
      const request = requests.length;
      requests.push({ metadata, duration: Number(call.args[4]), session: metadata[2].startsWith('v3s:'), rows: [] });
      placed.push(eventLog(contract, '_orderPlacedEV', [orders.length, request, 0]));
      orders.push({ doRequest: request, status: 0 });
      return [eventLog(contract, '_addDORequestEV', [WALLET, request])];
    }
    if (call.name === '_approveOrder') {
      const order = orders[Number(call.args[0])];
      order.status = requests[order.doRequest].session ? PROCESSING : CLOSED;
      return [eventLog(contract, '_orderApprovedEV', [WALLET, NODE, call.args[0]])];
    }
    if (call.name === '_addMetadataToRequest') {
      requests[Number(call.args[0])].rows.push([call.args[1], call.args[2]]);
    }
    return [];
  };
  const provider = {
    getNetwork: async () => ({ chainId: BigInt(chainId) }),
    getBlockNumber: async () => 16,
    call: async (tx) => {
      const read = record('call', tx);
      return read.contract.iface.encodeFunctionResult(read.call.fragment, await answer(read));
    },
    estimateGas: async (tx) => {
      record('estimate', tx);
      return 100000n;
    },
    getLogs: async (filter) => {
      const contract = at(filter.address);
      log.push({ kind: 'logs', label: contract.label });
      return filter.topics[0] === contract.iface.getEvent('_orderPlacedEV').topicHash ? contract.placed : [];
    },
    send: async (method, [hash]) => {
      assert.equal(method, 'eth_getTransactionReceipt');
      return { status: '0x1', blockNumber: '0x10', logs: receipts.get(hash) };
    },
    getTransactionReceipt: async (hash) => ({ hash, status: 1, blockNumber: 16, logs: [] })
  };
  const signer = {
    provider,
    getAddress: async () => WALLET,
    sendTransaction: async (tx) => {
      const sent = record('send', tx);
      const hash = ethers.id(`transaction ${chainId} ${receipts.size}`);
      receipts.set(hash, effect(sent));
      return { hash };
    }
  };
  const chain = {
    provider, signer, log, at, unanswered, balance: '5000', during: (kind, name, run) => hooks.push({ kind, name, run })
  };
  return chain;
};
