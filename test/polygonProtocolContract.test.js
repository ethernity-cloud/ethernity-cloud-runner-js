import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ethers } from 'ethers';
import PolygonProtocolContract from '../contract/operation/polygonProtocolContract.js';
import { ECAddress } from '../enums.js';

// A provider bound to a static network makes no request when it is built.
const providerOn = (chainId) => new ethers.JsonRpcProvider('http://127.0.0.1:1', ethers.Network.from(chainId), { staticNetwork: true });

test('both protocol contracts of an ecld network are bound to that network\'s PoX, the read-only one included', () => {
  const provider = providerOn(80002);
  const walletContext = { provider, signer: ethers.Wallet.createRandom().connect(provider) };
  const pox = ECAddress.POLYGON.TESTNET_PROTOCOL_ADDRESS;
  try {
    const protocol = new PolygonProtocolContract(pox, walletContext);
    assert.equal(protocol.getContract().target, pox);
    assert.equal(protocol.protocolContractWithProvider.target, pox);
    assert.notEqual(pox, ECAddress.POLYGON.MAINNET_PROTOCOL_ADDRESS);
  } finally {
    provider.destroy();
  }
});
