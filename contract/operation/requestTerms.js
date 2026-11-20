// The _addDORequest arguments a run's resources leave out, or give as 0.
export const REQUEST_DEFAULTS = {
  cpu: 1,
  memory: 1,
  storage: 40,
  bandwidth: 1,
  duration: 1,
  validators: 1,
  taskPrice: 10
};

// The _addDORequest arguments of `resources`: its values for the keys of
// REQUEST_DEFAULTS, the defaults for the keys it leaves out or gives as 0.
// The one place the legacy request's terms come from: the protocol contracts
// send them, runner.checkWalletBalance and runner.checkAllowance price them.
export const requestTerms = (resources) =>
  Object.fromEntries(
    Object.entries(REQUEST_DEFAULTS).map(([key, value]) => [key, (resources && resources[key]) || value])
  );

// The escrow of a legacy _addDORequest for `resources`, in tokens: the task
// price of every instance over the duration, taskPrice x validators x
// duration. The EthernityImplementationV2 pulls it from the wallet with
// transferFrom (Ethernity20Extension._addDORequest: _tokensToWeis(_maxPrice)
// * _instances * _duration); the bloxberg mainnet PoX requires the wallet's
// balance to cover it (Ethernity.sol _addDORequest: balances[msg.sender] >=
// _maxPrice * _instances * _duration * 10**18) and transfers _maxPrice *
// _duration tokens of it to itself in the same call.
export const requestEscrow = (resources) => {
  const terms = requestTerms(resources);
  return terms.taskPrice * terms.validators * terms.duration;
};
