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
  // Extended diagnostics emitted by newer enclave builds (canonical registry:
  // the trustedzone TaskStatus enum, etny_exec.py and task_status.js). 20-36
  // and 38 are customer-side outcomes; 37, 39 and 40 are node-side faults the
  // validator refunds, listed in OPERATOR_FAULT_CODES below.
  20: 'SIGNATURE_ERROR',
  21: 'SYNTAX_ERROR',
  22: 'MEMORY_ERROR',
  23: 'NAME_ERROR',
  24: 'TYPE_ERROR',
  25: 'VALUE_ERROR',
  26: 'INDEX_ERROR',
  27: 'ATTRIBUTE_ERROR',
  28: 'IMPORT_ERROR', // serverless backend failed to import inside the enclave
  29: 'OS_ERROR',
  30: 'ZERO_DIVISION_ERROR',
  31: 'RUNTIME_ERROR',
  32: 'CONFIG_ERROR', // required enclave config value empty in the sealed image
  33: 'EXECUTION_TIMEOUT',
  34: 'ESR_GAS_LIMIT_EXCEEDED', // ESR state commits would exceed the per-order relayed-gas budget
  35: 'SECURITY_VIOLATION', // a state commit was authorized under a caller other than the task
                           // submitter (the in-enclave ownership check was bypassed); set by the
                           // securelock and/or the trustedzone re-adjudication
  36: 'ESR_NONCE_VIOLATION', // a commit's idempotency nonce was already used -- duplicate suppressed
  37: 'ESR_RELAY_TIMEOUT', // signed state commits did not land on the registry -- node relay failure; refundable
  38: 'ESR_COMMIT_LIMIT_EXCEEDED', // more than 100 state commits in one run (per-run cap); dApp fault, no refund
  39: 'SESSION_RELAY_FAULT', // the node withheld session input delivery or failed to relay; refundable
  // The CAS that provisioned the enclave presented a quote the enclave could
  // not bind to its own injected environment; the enclave terminated the
  // order for refund. Codes above 40 are not defined by any enclave and the
  // node emits no task codes of its own, so nothing on the network produces
  // them.
  40: 'CAS_ATTESTATION_FAULT'
};

// Name for a task code, tolerant of codes newer than this runner.
export const taskStatusName = (code) => {
  const n = parseInt(code, 10);
  return ECOrderTaskStatus[n] !== undefined ? ECOrderTaskStatus[n] : `UNKNOWN_${code}`;
};

// Task codes attributed to the node operator rather than the submitted code:
// the node did not relay signed state commits (37), withheld session input or
// output rows (39), or was provisioned by a CAS whose self-attestation failed
// the ValidatorRegistry checks (40). The escrow for such orders is refunded by
// the validator, so resubmitting the same task as a new DO request is safe and
// is what the runner's retry does. 38 (per-run commit cap) is a dApp-side
// fault and is not refunded.
export const OPERATOR_FAULT_CODES = [37, 39, 40];

export const isOperatorFaultCode = (code) => OPERATOR_FAULT_CODES.includes(parseInt(code, 10));

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

// An -unsafe network: a network type ending in _UNSAFE, with the chain and
// contracts of the type it is named after and the trustedzones that run without
// a CAS, whose names end in -unsafe. The runner runs an -unsafe trustedzone only
// on an -unsafe network, chosen with setNetwork(), and no other trustedzone there.
export const UNSAFE_NETWORK_SUFFIX = '_UNSAFE';
export const UNSAFE_TRUSTEDZONE_SUFFIX = '-unsafe';

export const ECNetwork = {
  BLOXBERG: {
    TESTNET: 'Bloxberg TESTNET',
    TESTNET_UNSAFE: 'Bloxberg TESTNET_UNSAFE',
    MAINNET: 'Bloxberg MAINNET'
  },
  POLYGON: {
    TESTNET: 'Polygon TESTNET',
    TESTNET_UNSAFE: 'Polygon TESTNET_UNSAFE',
    MAINNET: 'Polygon MAINNET'
  },
  IOTEX: {
    TESTNET: 'IoTeX TESTNET'
  },
  SEPOLIA: {
    TESTNET: 'Sepolia TESTNET',
    TESTNET_UNSAFE: 'Sepolia TESTNET_UNSAFE'
  },
  LITVM: {
    TESTNET: 'LitVM TESTNET',
    TESTNET_UNSAFE: 'LitVM TESTNET_UNSAFE'
  }
};

export const ECRunner = {
  BLOXBERG: {
    PYNITHY_RUNNER_TESTNET: 'etny-pynithy-testnet',
    NODENITHY_RUNNER_TESTNET: 'etny-nodenithy-testnet',
    PYNITHY_RUNNER_TESTNET_UNSAFE: 'etny-pynithy-testnet-unsafe',
    NODENITHY_RUNNER_TESTNET_UNSAFE: 'etny-nodenithy-testnet-unsafe',
    PYNITHY_RUNNER: 'etny-pynithy',
    NODENITHY_RUNNER: 'etny-nodenithy'
  },
  POLYGON: {
    PYNITHY_RUNNER_TESTNET: 'ecld-pynithy-amoy',
    NODENITHY_RUNNER_TESTNET: 'ecld-nodenithy-amoy',
    PYNITHY_RUNNER_TESTNET_UNSAFE: 'ecld-pynithy-amoy-unsafe',
    NODENITHY_RUNNER_TESTNET_UNSAFE: 'ecld-nodenithy-amoy-unsafe',
    PYNITHY_RUNNER: 'ecld-pynithy',
    NODENITHY_RUNNER: 'ecld-nodenithy'
  },
  IOTEX: {
    PYNITHY_RUNNER_TESTNET: 'ecld-pynithy-iotex-testnet',
    NODENITHY_RUNNER_TESTNET: 'ecld-nodenithy-iotex-testnet'
  },
  SEPOLIA: {
    PYNITHY_RUNNER_TESTNET: 'ecld-pynithy-ethereum-sepolia',
    NODENITHY_RUNNER_TESTNET: 'ecld-nodenithy-ethereum-sepolia',
    PYNITHY_RUNNER_TESTNET_UNSAFE: 'ecld-pynithy-ethereum-sepolia-unsafe',
    NODENITHY_RUNNER_TESTNET_UNSAFE: 'ecld-nodenithy-ethereum-sepolia-unsafe'
  },
  LITVM: {
    PYNITHY_RUNNER_TESTNET: 'ecld-pynithy-litvm-testnet',
    NODENITHY_RUNNER_TESTNET: 'ecld-nodenithy-litvm-testnet',
    PYNITHY_RUNNER_TESTNET_UNSAFE: 'ecld-pynithy-litvm-testnet-unsafe',
    NODENITHY_RUNNER_TESTNET_UNSAFE: 'ecld-nodenithy-litvm-testnet-unsafe'
  }
};

// Shared image-registry contract for the whole ECLD family (Polygon + all
// EVM testnets deployed from pox-smart-contract). Bloxberg keeps its own.
const ECLD_IMAGE_REGISTRY = '0x689f3806874d3c8A973f419a4eB24e6fBA7E830F';

export const ECAddress = {
  BLOXBERG: {
    TESTNET_ADDRESS: '0x02882F03097fE8cD31afbdFbB5D72a498B41112c',
    MAINNET_ADDRESS: '0x549A6E06BB2084100148D50F51CF77a3436C3Ae7',
    // The testnet reads ECImageRegistryV3, where its trustedzones and the
    // securelocks published against them are registered: the deployment of
    // 2026-10-06, whose securelock names belong to their publishers.
    IMAGE_REGISTRY: {
      PYNITHY: {
        TESTNET_ADDRESS: '0xa372a6e1Eb7Fcf343AF6b91E809b900C55001CD1',
        MAINNET_ADDRESS: '0x15D73a742529C3fb11f3FA32EF7f0CC3870ACA31'
      },
      NODENITHY: {
        TESTNET_ADDRESS: '0xa372a6e1Eb7Fcf343AF6b91E809b900C55001CD1',
        MAINNET_ADDRESS: '0x15D73a742529C3fb11f3FA32EF7f0CC3870ACA31'
      }
    }
  },
  POLYGON: {
    // TESTNET_ADDRESS is the ERC-20 token (tECLD) contract; TESTNET_PROTOCOL_ADDRESS
    // is the PoX protocol contract. Testnet = Polygon Amoy (Mumbai is sunset).
    // The protocol is the separate-ERC20 EthernityImplementationV2 1.1 of
    // 2026-10-28, on the storage and token of the previous implementation
    // 0x1579b37C5a69ae02dDd23263A2b1318DE66a27C3; its erc20Address() is the
    // token below. The image registry is the ECImageRegistryV3 of the same day.
    TESTNET_ADDRESS: '0x9927809B61122B2af3f3b3A3303875e0687b8eE3',
    TESTNET_PROTOCOL_ADDRESS: '0xB8f46D2B943fFbe2A061Ae8be087ef5055AD96A3',
    MAINNET_ADDRESS: '0xc6920888988cAcEeA7ACCA0c96f2D65b05eE22Ba',
    MAINNET_PROTOCOL_ADDRESS: '0x439945BE73fD86fcC172179021991E96Beff3Cc4',
    IMAGE_REGISTRY: {
      PYNITHY: {
        TESTNET_ADDRESS: '0x0C0f52ebd72cd2d2cBe94F385c9e23cec528b706',
        MAINNET_ADDRESS: ECLD_IMAGE_REGISTRY
      },
      NODENITHY: {
        TESTNET_ADDRESS: '0x0C0f52ebd72cd2d2cBe94F385c9e23cec528b706',
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
    // Ethereum Sepolia: the PoX is the EthernityImplementationV2 1.1 of
    // 2026-10-14, the one Sepolia's CAS set validates orders on; the token is
    // that family's own tECLD (the previous family's 0x95Aa17fC... is the
    // address IoTeX and LitVM still use), and the image registry is the
    // ECImageRegistryV3 of the same day.
    TESTNET_ADDRESS: '0x2E27677fb67531eb09134fE331C27899f87ADe10',
    TESTNET_PROTOCOL_ADDRESS: '0x798975F9FdD90A21Cb11Ac26F1377e1542c58f9c',
    IMAGE_REGISTRY: {
      PYNITHY: { TESTNET_ADDRESS: '0xa7E43a269E3307cf9d246b07df2B89CAA1b4C42F' },
      NODENITHY: { TESTNET_ADDRESS: '0xa7E43a269E3307cf9d246b07df2B89CAA1b4C42F' }
    }
  },
  LITVM: {
    // LitVM LiteForge: the PoX is the EthernityImplementationV2 1.1 of
    // 2026-10-11, the one LitVM's CAS set validates orders on; the token and
    // the image registry are the Sepolia-family deployments on chain 4441.
    TESTNET_ADDRESS: '0x95Aa17fCFaAB75e8ed7d7DF218045795dCeB9c50',
    TESTNET_PROTOCOL_ADDRESS: '0xE35991de1f2A435e29E70406FA2781b1AffCb168',
    // The ECImageRegistryV3 of 2026-10-12.
    IMAGE_REGISTRY: {
      PYNITHY: { TESTNET_ADDRESS: '0xAf8Ce29103E1f59feDD49688ff070Ffc2346AF1D' },
      NODENITHY: { TESTNET_ADDRESS: '0xAf8Ce29103E1f59feDD49688ff070Ffc2346AF1D' }
    }
  }
};

export const ECNetworkName = {
  BLOXBERG: 'bloxberg',
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
//   agentNetwork:    the network's name in the node agent (mvp-pox-node
//                    config.py), which is its segment of the bootnode's payload
//                    intake route, POST /payload/<agentNetwork>/<doRequestId>/<cid>.
//                    Carried only by the networks the public intake serves in
//                    this release: the Bloxberg testnet, Polygon Amoy, LitVM
//                    LiteForge and Ethereum Sepolia (each with its -unsafe twin,
//                    which the intake takes under the same route). A run on a
//                    descriptor without it has no default storage and is refused
//                    before any transaction until initializeStorage() is called
//                    (runner.initializeDefaultStorage).
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
    networkKey: 'BLOXBERG',
    agentNetwork: 'bloxberg_testnet'
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
    networkKey: 'POLYGON',
    agentNetwork: 'polygon_amoy'
  }
};

// IOTEX and LITVM share the same tECLD address (0x95Aa17fC..., Sepolia's too
// until its family of 2026-10-14), so these testnets cannot be keyed by token
// address alone. They are resolved by (chainId) at runtime; see
// resolveNetworkConfig. Their descriptors:
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
    networkKey: 'SEPOLIA',
    agentNetwork: 'ethereum_sepolia'
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
    networkKey: 'LITVM',
    agentNetwork: 'litvm_liteforge'
  }
};

// The ERC-20 token address shared by the ECLD-family testnets deployed from
// pox-smart-contract by the same wallet (IoTeX / LitVM; Sepolia's too until its
// family of 2026-10-14). It cannot be mapped to a single network, so it
// resolves to a provisional descriptor until a chainId is known.
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
 * address (IoTeX / LitVM). Sepolia's token is its own since 2026-10-14 and
 * names its descriptor directly. When the shared token is used without a
 * chainId, returns a provisional ECLD descriptor (protocol/registry unresolved)
 * so the token contract can still be built; call again with a chainId to get the
 * full descriptor. Returns undefined for genuinely unknown networks.
 */
export function resolveNetworkConfig(networkAddress, chainId) {
  if (chainId && ECEcldTestnetConfig[chainId]) return ECEcldTestnetConfig[chainId];
  const direct = ECNetworkConfig[networkAddress];
  if (direct) return direct;
  if (networkAddress === ECAddress.SEPOLIA.TESTNET_ADDRESS) return ECEcldTestnetConfig[ECNetworkByChainId.SEPOLIA.TESTNET];
  if (networkAddress === ECLD_SHARED_TESTNET_TOKEN) return ECLD_PROVISIONAL_CONFIG;
  return undefined;
}

export const ZERO_CHECKSUM = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

export const ECError = {
  PARSE_ERROR: 'EtnyParseError',
  IPFS_DOWNLOAD_ERROR: 'ECIPFSDownloadError',
  // No node placed an order on the DO request within the wait; the request
  // was cancelled and its escrow returned.
  NO_NODE: 'ECNoNodeError'
};


export const  ECLog = {
    ERROR: 1,
    WARNING: 2,
    INFO: 3,
    DEBUG: 4,
};
