export const ECStatus = {
  ERROR: 'error',
  SUCCESS: 'success',
  DEFAULT: ''
};

export const ECEvent = {
  TASK_PROGRESS: 'ecTaskProgress',
  TASK_COMPLETED: 'ecTaskCompleted'
};

export const ECOrderTaskStatus = {
  0: 'SUCCESS',
  1: 'SYSTEM_ERROR',
  2: 'KEY_ERROR',
  3: 'SYNTAX_WARNING',
  4: 'BASE_EXCEPTION',
  5: 'PAYLOAD_NOT_DEFINED',
  6: 'PAYLOAD_CHECKSUM_ERROR',
  7: 'INPUT_CHECKSUM_ERROR'
};

export const ECRunner = {
  PYNITHY_RUNNER_TESTNET: 'etny-pynithy-testnet',
  NODENITHY_RUNNER_TESTNET: 'etny-nodenithy-testnet'
  // PYNITHY_RUNNER: 'etny-pynithy',
  // NODENITHY_RUNNER: 'etny-nodenithy'
};

export const ZERO_CHECKSUM = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
export const TESTNET_ADDRESS = '0x02882F03097fE8cD31afbdFbB5D72a498B41112c';
export const MAINNET_ADDRESS = '0x549A6E06BB2084100148D50F51CF77a3436C3Ae7';
