export const ECStatus = {
  ERROR: 'Error',
  SUCCESS: 'Success',
  DEFAULT: 'Running'
};

export const ECEvent = {
  INIT: 'Encrypting task',
  SENDING: "Sending task",
  CREATED: 'Waiting for network',
  ORDER_PLACED: 'Approving',
  IN_PROGRESS: 'In Progress',
  DOWNLOADING: 'Downloading result',
  VERIFYING: 'Decrypting result',
  FINISHED: 'Finished'
};

export const ECOrderTaskStatus = {
  0: 'SUCCESS',
  1: 'SYSTEM_ERROR',
  2: 'KEY_ERROR',
  3: 'SYNTAX_WARNING',
  4: 'BASE_EXCEPTION',
  5: 'PAYLOAD_NOT_DEFINED',
  6: 'PAYLOAD_CHECKSUM_ERROR',
  7: 'INPUT_CHECKSUM_ERROR',
  // Extended diagnostics emitted by newer trustedzone builds. 21+ are
  // customer-side outcomes; 40-49 are operator-side infrastructure failures
  // (securelock never ran / produced unusable output) and are the codes the
  // runner treats as retriable with a fresh DO request.
  21: 'EXECUTION_TIMEOUT',
  28: 'IMPORT_ERROR', // serverless backend failed to import inside the enclave
  40: 'SECURELOCK_NOT_STARTED',
  41: 'SECURELOCK_NO_RESULT',
  42: 'SECURELOCK_MALFORMED',
  43: 'SIGNATURE_ERROR',
  44: 'STORAGE_ERROR',
  45: 'INTERNAL_ERROR'
};

// Name for a task code, tolerant of codes newer than this runner.
export const taskStatusName = (code) => {
  const n = parseInt(code, 10);
  return ECOrderTaskStatus[n] !== undefined ? ECOrderTaskStatus[n] : `UNKNOWN_${code}`;
};

// Task codes attributed to the node operator rather than the submitted code.
// The escrow for such orders is refunded by the validator, so resubmitting the
// same task as a new DO request is safe and is what the runner's retry does.
export const isOperatorFaultCode = (code) => {
  const n = parseInt(code, 10);
  return Number.isInteger(n) && n >= 40 && n <= 49;
};

export const ECOrderTaskStatusCode = {
  SUCCESS: 'SUCCESS',
  SYSTEM_ERROR: 'SYSTEM_ERROR',
  KEY_ERROR: 'KEY_ERROR',
  SYNTAX_WARNING: 'SYNTAX_WARNING',
  BASE_EXCEPTION: 'BASE_EXCEPTION',
  PAYLOAD_NOT_DEFINED: 'PAYLOAD_NOT_DEFINED',
  PAYLOAD_CHECKSUM_ERROR: 'PAYLOAD_CHECKSUM_ERROR',
  INPUT_CHECKSUM_ERROR: 'INPUT_CHECKSUM_ERROR'
};

export const ECNetworkByChainId = {
  BLOXBERG: {
    TESTNET: 8995,
    MAINNET: 8995
  },
  POLYGON: {
    TESTNET: 80002,
    MAINNET: 137
  },
  IOTEX: {
    TESTNET: 4690
  },
  SEPOLIA: {
    TESTNET: 11155111
  },
  LITVM: {
    TESTNET: 4441
  }
};

export const ECNetworkByChainIdDictionary = {
  8995: 'bloxberg',
  80002: 'amoy',
  137: 'matic',
  4690: 'iotex',
  11155111: 'sepolia',
  4441: 'litvm'
};

export const ECNetwork = {
  BLOXBERG: {
    TESTNET: 'Bloxberg TESTNET',
    MAINNET: 'Bloxberg MAINNET'
  },
  POLYGON: {
    TESTNET: 'Polygon TESTNET',
    MAINNET: 'Polygon MAINNET'
  },
  IOTEX: {
    TESTNET: 'IoTeX TESTNET'
  },
  SEPOLIA: {
    TESTNET: 'Sepolia TESTNET'
  },
  LITVM: {
    TESTNET: 'LitVM TESTNET'
  }
};

export const ECRunner = {
  BLOXBERG: {
    PYNITHY_RUNNER_TESTNET: 'etny-pynithy-testnet',
    NODENITHY_RUNNER_TESTNET: 'etny-nodenithy-testnet',
    PYNITHY_RUNNER: 'etny-pynithy',
    NODENITHY_RUNNER: 'etny-nodenithy'
  },
  POLYGON: {
    PYNITHY_RUNNER_TESTNET: 'ecld-pynithy-amoy',
    NODENITHY_RUNNER_TESTNET: 'ecld-nodenithy-amoy',
    PYNITHY_RUNNER: 'ecld-pynithy',
    NODENITHY_RUNNER: 'ecld-nodenithy'
  },
  IOTEX: {
    PYNITHY_RUNNER_TESTNET: 'ecld-pynithy-iotex-testnet',
    NODENITHY_RUNNER_TESTNET: 'ecld-nodenithy-iotex-testnet'
  },
  SEPOLIA: {
    PYNITHY_RUNNER_TESTNET: 'ecld-pynithy-ethereum-sepolia',
    NODENITHY_RUNNER_TESTNET: 'ecld-nodenithy-ethereum-sepolia'
  },
  LITVM: {
    PYNITHY_RUNNER_TESTNET: 'ecld-pynithy-litvm-testnet',
    NODENITHY_RUNNER_TESTNET: 'ecld-nodenithy-litvm-testnet'
  }
};

// Shared image-registry contract for the whole ECLD family (Polygon + all
// EVM testnets deployed from pox-smart-contract). Bloxberg keeps its own.
const ECLD_IMAGE_REGISTRY = '0x689f3806874d3c8A973f419a4eB24e6fBA7E830F';

export const ECAddress = {
  BLOXBERG: {
    TESTNET_ADDRESS: '0x02882F03097fE8cD31afbdFbB5D72a498B41112c',
    MAINNET_ADDRESS: '0x549A6E06BB2084100148D50F51CF77a3436C3Ae7',
    IMAGE_REGISTRY: {
      PYNITHY: {
        TESTNET_ADDRESS: '0x15D73a742529C3fb11f3FA32EF7f0CC3870ACA31',
        MAINNET_ADDRESS: '0x15D73a742529C3fb11f3FA32EF7f0CC3870ACA31'
      },
      NODENITHY: {
        TESTNET_ADDRESS: '0x15D73a742529C3fb11f3FA32EF7f0CC3870ACA31',
        MAINNET_ADDRESS: '0x15D73a742529C3fb11f3FA32EF7f0CC3870ACA31'
      }
    }
  },
  POLYGON: {
    // TESTNET_ADDRESS is the ERC-20 token (ECLD) contract; TESTNET_PROTOCOL_ADDRESS
    // is the PoX protocol contract. Testnet = Polygon Amoy (Mumbai is sunset).
    // Token verified on-chain via the Amoy PoX contract's erc20Address().
    TESTNET_ADDRESS: '0x9927809B61122B2af3f3b3A3303875e0687b8eE3',
    TESTNET_PROTOCOL_ADDRESS: '0x1579b37C5a69ae02dDd23263A2b1318DE66a27C3',
    MAINNET_ADDRESS: '0xc6920888988cAcEeA7ACCA0c96f2D65b05eE22Ba',
    MAINNET_PROTOCOL_ADDRESS: '0x439945BE73fD86fcC172179021991E96Beff3Cc4',
    IMAGE_REGISTRY: {
      PYNITHY: {
        TESTNET_ADDRESS: '0xeFA33c3976f31961285Ae4f5D10188616C912728',
        MAINNET_ADDRESS: ECLD_IMAGE_REGISTRY
      },
      NODENITHY: {
        TESTNET_ADDRESS: '0xeFA33c3976f31961285Ae4f5D10188616C912728',
        MAINNET_ADDRESS: ECLD_IMAGE_REGISTRY
      }
    }
  },
  IOTEX: {
    // ECLD-family token shared across the EVM testnets.
    TESTNET_ADDRESS: '0x95Aa17fCFaAB75e8ed7d7DF218045795dCeB9c50',
    TESTNET_PROTOCOL_ADDRESS: '0xD56385A97413Ed80E28B1b54A193b98F2C49c975',
    IMAGE_REGISTRY: {
      PYNITHY: { TESTNET_ADDRESS: '0xa7467A6391816be9367a1cC52E0ef0c15FfE3cCC' },
      NODENITHY: { TESTNET_ADDRESS: '0xa7467A6391816be9367a1cC52E0ef0c15FfE3cCC' }
    }
  },
  SEPOLIA: {
    TESTNET_ADDRESS: '0x95Aa17fCFaAB75e8ed7d7DF218045795dCeB9c50',
    TESTNET_PROTOCOL_ADDRESS: '0x29D3eC870565B6A1510232bd950A8Bc8336f0EB2',
    IMAGE_REGISTRY: {
      PYNITHY: { TESTNET_ADDRESS: '0x55e0ad455Be85162b71a790f00Fc305680E3CE53' },
      NODENITHY: { TESTNET_ADDRESS: '0x55e0ad455Be85162b71a790f00Fc305680E3CE53' }
    }
  },
  LITVM: {
    // LitVM LiteForge reuses the Sepolia-family protocol + registry contracts.
    TESTNET_ADDRESS: '0x95Aa17fCFaAB75e8ed7d7DF218045795dCeB9c50',
    TESTNET_PROTOCOL_ADDRESS: '0x29D3eC870565B6A1510232bd950A8Bc8336f0EB2',
    IMAGE_REGISTRY: {
      PYNITHY: { TESTNET_ADDRESS: '0x55e0ad455Be85162b71a790f00Fc305680E3CE53' },
      NODENITHY: { TESTNET_ADDRESS: '0x55e0ad455Be85162b71a790f00Fc305680E3CE53' }
    }
  }
};

export const ECNetworkName = {
  BLOXBERG: 'bloxberg',
  MUMBAI: 'maticmum',
  AMOY: 'amoy',
  POLYGON: 'matic',
  IOTEX: 'iotex',
  SEPOLIA: 'sepolia',
  LITVM: 'litvm',
  OTHER: 'other'
};

export const ECNetworkNameDictionary = {
  [ECAddress.BLOXBERG.MAINNET_ADDRESS]: 'bloxberg',
  [ECAddress.BLOXBERG.TESTNET_ADDRESS]: 'bloxberg',
  [ECAddress.POLYGON.MAINNET_ADDRESS]: 'matic',
  [ECAddress.POLYGON.TESTNET_ADDRESS]: 'amoy',
  [ECAddress.IOTEX.TESTNET_ADDRESS]: 'iotex',
  [ECAddress.SEPOLIA.TESTNET_ADDRESS]: 'sepolia',
  [ECAddress.LITVM.TESTNET_ADDRESS]: 'litvm'
};

export const ECNetworkName1Dictionary = {
  [ECAddress.BLOXBERG.MAINNET_ADDRESS]: 'BLOXBERG',
  [ECAddress.BLOXBERG.TESTNET_ADDRESS]: 'BLOXBERG',
  [ECAddress.POLYGON.MAINNET_ADDRESS]: 'POLYGON',
  [ECAddress.POLYGON.TESTNET_ADDRESS]: 'AMOY',
  [ECAddress.IOTEX.TESTNET_ADDRESS]: 'IOTEX',
  [ECAddress.SEPOLIA.TESTNET_ADDRESS]: 'SEPOLIA',
  [ECAddress.LITVM.TESTNET_ADDRESS]: 'LITVM'
};

// ---------------------------------------------------------------------------
// Network resolver
//
// Historically the runner branched on `networkAddress` (the ERC-20 token
// address) with 2-network switch statements (Bloxberg / Polygon). Adding the
// ECLD-family EVM testnets (Amoy / IoTeX / Sepolia / LitVM) makes that
// unmaintainable, so every network is described once, here, keyed by its token
// address. `resolveNetworkConfig(networkAddress)` returns that descriptor and
// the runner/contracts consume it instead of hardcoding pairs.
//
//   family:          'bloxberg' (ETNY token, Bloxberg protocol/ABI) or
//                    'ecld' (ECLD token, Polygon protocol/ABI) — the two
//                    contract families the runner knows how to talk to.
//   protocolAddress: PoX protocol contract (for the ecld family this differs
//                    from the token address; for bloxberg it IS the token
//                    address, matching the legacy EtnyContract behaviour).
//   imageRegistry:   { PYNITHY, NODENITHY } on-chain Image Registry addresses.
//   isMainnet:       production network (CAS attestation, real funds).
//   networkName:     short name returned by getNetworkName() (chain-id dict).
// ---------------------------------------------------------------------------
export const ECNetworkConfig = {
  [ECAddress.BLOXBERG.TESTNET_ADDRESS]: {
    family: 'bloxberg',
    protocolAddress: ECAddress.BLOXBERG.TESTNET_ADDRESS,
    imageRegistry: {
      PYNITHY: ECAddress.BLOXBERG.IMAGE_REGISTRY.PYNITHY.TESTNET_ADDRESS,
      NODENITHY: ECAddress.BLOXBERG.IMAGE_REGISTRY.NODENITHY.TESTNET_ADDRESS
    },
    isMainnet: false,
    networkName: 'bloxberg',
    networkKey: 'BLOXBERG'
  },
  [ECAddress.BLOXBERG.MAINNET_ADDRESS]: {
    family: 'bloxberg',
    protocolAddress: ECAddress.BLOXBERG.MAINNET_ADDRESS,
    imageRegistry: {
      PYNITHY: ECAddress.BLOXBERG.IMAGE_REGISTRY.PYNITHY.MAINNET_ADDRESS,
      NODENITHY: ECAddress.BLOXBERG.IMAGE_REGISTRY.NODENITHY.MAINNET_ADDRESS
    },
    isMainnet: true,
    networkName: 'bloxberg',
    networkKey: 'BLOXBERG'
  },
  [ECAddress.POLYGON.MAINNET_ADDRESS]: {
    family: 'ecld',
    protocolAddress: ECAddress.POLYGON.MAINNET_PROTOCOL_ADDRESS,
    imageRegistry: {
      PYNITHY: ECAddress.POLYGON.IMAGE_REGISTRY.PYNITHY.MAINNET_ADDRESS,
      NODENITHY: ECAddress.POLYGON.IMAGE_REGISTRY.NODENITHY.MAINNET_ADDRESS
    },
    isMainnet: true,
    networkName: 'matic',
    networkKey: 'POLYGON'
  },
  [ECAddress.POLYGON.TESTNET_ADDRESS]: {
    family: 'ecld',
    protocolAddress: ECAddress.POLYGON.TESTNET_PROTOCOL_ADDRESS,
    imageRegistry: {
      PYNITHY: ECAddress.POLYGON.IMAGE_REGISTRY.PYNITHY.TESTNET_ADDRESS,
      NODENITHY: ECAddress.POLYGON.IMAGE_REGISTRY.NODENITHY.TESTNET_ADDRESS
    },
    isMainnet: false,
    networkName: 'amoy',
    networkKey: 'POLYGON'
  }
};

// IOTEX / SEPOLIA / LITVM all share the same ECLD token address, so they cannot
// be keyed by token address alone. They are resolved by (chainId) at runtime;
// see resolveNetworkConfig. Their descriptors:
export const ECEcldTestnetConfig = {
  4690: {
    family: 'ecld',
    protocolAddress: ECAddress.IOTEX.TESTNET_PROTOCOL_ADDRESS,
    imageRegistry: {
      PYNITHY: ECAddress.IOTEX.IMAGE_REGISTRY.PYNITHY.TESTNET_ADDRESS,
      NODENITHY: ECAddress.IOTEX.IMAGE_REGISTRY.NODENITHY.TESTNET_ADDRESS
    },
    isMainnet: false,
    networkName: 'iotex',
    networkKey: 'IOTEX'
  },
  11155111: {
    family: 'ecld',
    protocolAddress: ECAddress.SEPOLIA.TESTNET_PROTOCOL_ADDRESS,
    imageRegistry: {
      PYNITHY: ECAddress.SEPOLIA.IMAGE_REGISTRY.PYNITHY.TESTNET_ADDRESS,
      NODENITHY: ECAddress.SEPOLIA.IMAGE_REGISTRY.NODENITHY.TESTNET_ADDRESS
    },
    isMainnet: false,
    networkName: 'sepolia',
    networkKey: 'SEPOLIA'
  },
  4441: {
    family: 'ecld',
    protocolAddress: ECAddress.LITVM.TESTNET_PROTOCOL_ADDRESS,
    imageRegistry: {
      PYNITHY: ECAddress.LITVM.IMAGE_REGISTRY.PYNITHY.TESTNET_ADDRESS,
      NODENITHY: ECAddress.LITVM.IMAGE_REGISTRY.NODENITHY.TESTNET_ADDRESS
    },
    isMainnet: false,
    networkName: 'litvm',
    networkKey: 'LITVM'
  }
};

// The ERC-20 token address shared by every ECLD-family testnet deployed from
// pox-smart-contract (IoTeX / Sepolia / LitVM). It cannot be mapped to a single
// network, so it resolves to a provisional descriptor until a chainId is known.
export const ECLD_SHARED_TESTNET_TOKEN = ECAddress.IOTEX.TESTNET_ADDRESS;

// Provisional descriptor for the shared-token ECLD testnets before the chainId
// is known. Enough to build the token contract (EcldContract) in the sync
// constructor; the protocol/registry are finalised by resolveNetworkContext().
const ECLD_PROVISIONAL_CONFIG = {
  family: 'ecld',
  protocolAddress: undefined,
  imageRegistry: { PYNITHY: undefined, NODENITHY: undefined },
  isMainnet: false,
  networkName: undefined,
  networkKey: undefined,
  provisional: true
};

/**
 * Resolve a network descriptor from the token `networkAddress`, optionally
 * disambiguated by `chainId` for the ECLD-family testnets that share a token
 * address (IoTeX / Sepolia / LitVM). When the shared token is used without a
 * chainId, returns a provisional ECLD descriptor (protocol/registry unresolved)
 * so the token contract can still be built; call again with a chainId to get the
 * full descriptor. Returns undefined for genuinely unknown networks.
 */
export function resolveNetworkConfig(networkAddress, chainId) {
  if (chainId && ECEcldTestnetConfig[chainId]) return ECEcldTestnetConfig[chainId];
  const direct = ECNetworkConfig[networkAddress];
  if (direct) return direct;
  if (networkAddress === ECLD_SHARED_TESTNET_TOKEN) return ECLD_PROVISIONAL_CONFIG;
  return undefined;
}

export const ZERO_CHECKSUM = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

export const ECError = {
  PARSE_ERROR: 'EtnyParseError',
  IPFS_DOWNLOAD_ERROR: 'ECIPFSDownloadError'
};


export const  ECLog = {
    ERROR: 1,
    WARNING: 2,
    INFO: 3,
    DEBUG: 4,
};
