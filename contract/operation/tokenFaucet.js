import { ethers } from 'ethers';
import { waitForReceipt } from '../../utils.js';

const FAUCET_ABI = ['function faucet() returns (bool)'];

// Sends faucet() on the token at `tokenAddress` from the wallet of `signer`
// and waits until `provider` carries the transaction's receipt
// (utils.waitForReceipt: a reverted transaction is an error). The one
// implementation of the draw; the runner decides the networks it runs on
// (the network descriptor's faucet). `report` takes the transaction's hash
// once it is sent. Returns the hash.
export async function drawTokenFaucet(tokenAddress, signer, provider, report = () => {}) {
  const token = new ethers.Contract(tokenAddress, FAUCET_ABI, signer);
  const tx = await token.faucet();
  report(tx.hash);
  await waitForReceipt(provider, tx.hash);
  return tx.hash;
}
