import { ethers } from 'ethers';

// The wallet's allowance for the PoX at `protocolAddress` on `token`, the
// ERC-20 ethers contract bound to the wallet's `signer`, raised to `tokens`
// (a decimal string, in tokens) when it is below it: a PoX apart from the
// token pulls a DO request's escrow from the wallet with transferFrom, and
// `tokens` is that escrow. The one implementation of the step, called by
// EtnyContract and EcldContract alike; runner.checkAllowance decides the
// networks it runs on and the escrow, and takes the step's messages through
// `report`. True when the allowance covers `tokens` on return, false when
// the approval transaction is not mined.
export async function checkAndSetAllowance(token, signer, protocolAddress, tokens, report = () => {}) {
  const required = ethers.parseUnits(tokens, 'ether');
  const wallet = await signer.getAddress();
  const allowance = await token.allowance(wallet, protocolAddress);
  report(`Allowance for ${protocolAddress}: ${ethers.formatEther(allowance)} tokens, ${tokens} required`);
  if (allowance < required) {
    report(`Approving allowance for ${tokens} tokens`);
    const approveTx = await token.approve(protocolAddress, required);
    try {
      await approveTx.wait();
    } catch (error) {
      report(`Allowance approval failed: ${error.shortMessage || error.message}`);
      return false;
    }
    report(`Allowance approved (${approveTx.hash})`);
  }
  return true;
}
