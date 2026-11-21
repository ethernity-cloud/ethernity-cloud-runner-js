// The network identifiers of the runner and the values behind them, as
// literals: PUBLISHED holds every table as release 0.6.35 carries it, ADDED
// the entries release 0.6.36 adds (the PoX 1.0 testnet networks of the
// bloxberg testnet and Polygon Amoy). A published identifier keeps its value
// and the network it names: the constructor addresses with their chain ids,
// the (network, type) names setNetwork() takes, the trustedzone names, the
// descriptors they resolve to and the default RPCs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ethers } from 'ethers';
import EthernityCloudRunner from '../runner.js';
import * as enums from '../enums.js';
import { resolveWalletContext } from '../walletContext.js';

const PUBLISHED = {
  ECNetworkByChainId: {
    BLOXBERG: { TESTNET: 8995, MAINNET: 8995 },
    POLYGON: { TESTNET: 80002, MAINNET: 137 },
    IOTEX: { TESTNET: 4690 },
    SEPOLIA: { TESTNET: 11155111 },
    LITVM: { TESTNET: 4441 }
  },
  ECNetworkByChainIdDictionary: {
    8995: 'bloxberg',
    80002: 'amoy',
    137: 'matic',
    4690: 'iotex',
    11155111: 'sepolia',
    4441: 'litvm'
  },
  ECNetwork: {
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
    IOTEX: { TESTNET: 'IoTeX TESTNET' },
    SEPOLIA: { TESTNET: 'Sepolia TESTNET', TESTNET_UNSAFE: 'Sepolia TESTNET_UNSAFE' },
    LITVM: { TESTNET: 'LitVM TESTNET', TESTNET_UNSAFE: 'LitVM TESTNET_UNSAFE' }
  },
  ECRunner: {
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
  },
  ECAddress: {
    BLOXBERG: {
      TESTNET_ADDRESS: '0x02882F03097fE8cD31afbdFbB5D72a498B41112c',
      TESTNET_PROTOCOL_ADDRESS: '0x830c781F0352050343211B6BFA83600B3e77647C',
      MAINNET_ADDRESS: '0x549A6E06BB2084100148D50F51CF77a3436C3Ae7',
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
      TESTNET_ADDRESS: '0x9927809B61122B2af3f3b3A3303875e0687b8eE3',
      TESTNET_PROTOCOL_ADDRESS: '0xd1182deA61CDa785C320cdBE5888EaC4178cAAF2',
      MAINNET_ADDRESS: '0xc6920888988cAcEeA7ACCA0c96f2D65b05eE22Ba',
      MAINNET_PROTOCOL_ADDRESS: '0x439945BE73fD86fcC172179021991E96Beff3Cc4',
      IMAGE_REGISTRY: {
        PYNITHY: {
          TESTNET_ADDRESS: '0x0C0f52ebd72cd2d2cBe94F385c9e23cec528b706',
          MAINNET_ADDRESS: '0x689f3806874d3c8A973f419a4eB24e6fBA7E830F'
        },
        NODENITHY: {
          TESTNET_ADDRESS: '0x0C0f52ebd72cd2d2cBe94F385c9e23cec528b706',
          MAINNET_ADDRESS: '0x689f3806874d3c8A973f419a4eB24e6fBA7E830F'
        }
      }
    },
    IOTEX: {
      TESTNET_ADDRESS: '0x95Aa17fCFaAB75e8ed7d7DF218045795dCeB9c50',
      TESTNET_PROTOCOL_ADDRESS: '0xD56385A97413Ed80E28B1b54A193b98F2C49c975',
      IMAGE_REGISTRY: {
        PYNITHY: { TESTNET_ADDRESS: '0xa7467A6391816be9367a1cC52E0ef0c15FfE3cCC' },
        NODENITHY: { TESTNET_ADDRESS: '0xa7467A6391816be9367a1cC52E0ef0c15FfE3cCC' }
      }
    },
    SEPOLIA: {
      TESTNET_ADDRESS: '0x2E27677fb67531eb09134fE331C27899f87ADe10',
      TESTNET_PROTOCOL_ADDRESS: '0x798975F9FdD90A21Cb11Ac26F1377e1542c58f9c',
      IMAGE_REGISTRY: {
        PYNITHY: { TESTNET_ADDRESS: '0xa7E43a269E3307cf9d246b07df2B89CAA1b4C42F' },
        NODENITHY: { TESTNET_ADDRESS: '0xa7E43a269E3307cf9d246b07df2B89CAA1b4C42F' }
      }
    },
    LITVM: {
      TESTNET_ADDRESS: '0x95Aa17fCFaAB75e8ed7d7DF218045795dCeB9c50',
      TESTNET_PROTOCOL_ADDRESS: '0xE35991de1f2A435e29E70406FA2781b1AffCb168',
      IMAGE_REGISTRY: {
        PYNITHY: { TESTNET_ADDRESS: '0xAf8Ce29103E1f59feDD49688ff070Ffc2346AF1D' },
        NODENITHY: { TESTNET_ADDRESS: '0xAf8Ce29103E1f59feDD49688ff070Ffc2346AF1D' }
      }
    }
  },
  ECNetworkName: {
    BLOXBERG: 'bloxberg',
    AMOY: 'amoy',
    POLYGON: 'matic',
    IOTEX: 'iotex',
    SEPOLIA: 'sepolia',
    LITVM: 'litvm',
    OTHER: 'other'
  },
  // IoTeX and LitVM share one token address: the LitVM entry is the one the
  // two dictionaries hold under it.
  ECNetworkNameDictionary: {
    '0x549A6E06BB2084100148D50F51CF77a3436C3Ae7': 'bloxberg',
    '0x02882F03097fE8cD31afbdFbB5D72a498B41112c': 'bloxberg',
    '0xc6920888988cAcEeA7ACCA0c96f2D65b05eE22Ba': 'matic',
    '0x9927809B61122B2af3f3b3A3303875e0687b8eE3': 'amoy',
    '0x95Aa17fCFaAB75e8ed7d7DF218045795dCeB9c50': 'litvm',
    '0x2E27677fb67531eb09134fE331C27899f87ADe10': 'sepolia'
  },
  ECNetworkName1Dictionary: {
    '0x549A6E06BB2084100148D50F51CF77a3436C3Ae7': 'BLOXBERG',
    '0x02882F03097fE8cD31afbdFbB5D72a498B41112c': 'BLOXBERG',
    '0xc6920888988cAcEeA7ACCA0c96f2D65b05eE22Ba': 'POLYGON',
    '0x9927809B61122B2af3f3b3A3303875e0687b8eE3': 'AMOY',
    '0x95Aa17fCFaAB75e8ed7d7DF218045795dCeB9c50': 'LITVM',
    '0x2E27677fb67531eb09134fE331C27899f87ADe10': 'SEPOLIA'
  },
  ECNetworkConfig: {
    '0x02882F03097fE8cD31afbdFbB5D72a498B41112c': {
      family: 'bloxberg',
      tokenName: 'tETNY',
      protocolAddress: '0x830c781F0352050343211B6BFA83600B3e77647C',
      imageRegistry: {
        PYNITHY: '0xa372a6e1Eb7Fcf343AF6b91E809b900C55001CD1',
        NODENITHY: '0xa372a6e1Eb7Fcf343AF6b91E809b900C55001CD1'
      },
      isMainnet: false,
      networkName: 'bloxberg',
      networkKey: 'BLOXBERG',
      agentNetwork: 'bloxberg_testnet'
    },
    '0x549A6E06BB2084100148D50F51CF77a3436C3Ae7': {
      family: 'bloxberg',
      tokenName: 'ETNY',
      protocolAddress: '0x549A6E06BB2084100148D50F51CF77a3436C3Ae7',
      imageRegistry: {
        PYNITHY: '0x15D73a742529C3fb11f3FA32EF7f0CC3870ACA31',
        NODENITHY: '0x15D73a742529C3fb11f3FA32EF7f0CC3870ACA31'
      },
      isMainnet: true,
      networkName: 'bloxberg',
      networkKey: 'BLOXBERG'
    },
    '0xc6920888988cAcEeA7ACCA0c96f2D65b05eE22Ba': {
      family: 'ecld',
      tokenName: 'ECLD',
      protocolAddress: '0x439945BE73fD86fcC172179021991E96Beff3Cc4',
      imageRegistry: {
        PYNITHY: '0x689f3806874d3c8A973f419a4eB24e6fBA7E830F',
        NODENITHY: '0x689f3806874d3c8A973f419a4eB24e6fBA7E830F'
      },
      isMainnet: true,
      networkName: 'matic',
      networkKey: 'POLYGON'
    },
    '0x9927809B61122B2af3f3b3A3303875e0687b8eE3': {
      family: 'ecld',
      tokenName: 'tECLD',
      protocolAddress: '0xd1182deA61CDa785C320cdBE5888EaC4178cAAF2',
      imageRegistry: {
        PYNITHY: '0x0C0f52ebd72cd2d2cBe94F385c9e23cec528b706',
        NODENITHY: '0x0C0f52ebd72cd2d2cBe94F385c9e23cec528b706'
      },
      isMainnet: false,
      networkName: 'amoy',
      networkKey: 'POLYGON',
      agentNetwork: 'polygon_amoy'
    }
  },
  ECEcldTestnetConfig: {
    4690: {
      family: 'ecld',
      tokenName: 'tECLD',
      protocolAddress: '0xD56385A97413Ed80E28B1b54A193b98F2C49c975',
      imageRegistry: {
        PYNITHY: '0xa7467A6391816be9367a1cC52E0ef0c15FfE3cCC',
        NODENITHY: '0xa7467A6391816be9367a1cC52E0ef0c15FfE3cCC'
      },
      isMainnet: false,
      networkName: 'iotex',
      networkKey: 'IOTEX'
    },
    11155111: {
      family: 'ecld',
      tokenName: 'tECLD',
      protocolAddress: '0x798975F9FdD90A21Cb11Ac26F1377e1542c58f9c',
      imageRegistry: {
        PYNITHY: '0xa7E43a269E3307cf9d246b07df2B89CAA1b4C42F',
        NODENITHY: '0xa7E43a269E3307cf9d246b07df2B89CAA1b4C42F'
      },
      isMainnet: false,
      networkName: 'sepolia',
      networkKey: 'SEPOLIA',
      agentNetwork: 'ethereum_sepolia'
    },
    4441: {
      family: 'ecld',
      tokenName: 'tECLD',
      protocolAddress: '0xE35991de1f2A435e29E70406FA2781b1AffCb168',
      imageRegistry: {
        PYNITHY: '0xAf8Ce29103E1f59feDD49688ff070Ffc2346AF1D',
        NODENITHY: '0xAf8Ce29103E1f59feDD49688ff070Ffc2346AF1D'
      },
      isMainnet: false,
      networkName: 'litvm',
      networkKey: 'LITVM',
      agentNetwork: 'litvm_liteforge'
    }
  }
};

// What release 0.6.36 adds to the published tables, and its one new table.
const ADDED = {
  ECNetworkByChainId: {
    BLOXBERG: { TESTNET_POX10: 8995 },
    POLYGON: { AMOY_POX10: 80002 }
  },
  ECNetwork: {
    BLOXBERG: { TESTNET_POX10: 'Bloxberg TESTNET_POX10' },
    POLYGON: { AMOY_POX10: 'Polygon AMOY_POX10' }
  },
  ECRunner: {
    BLOXBERG: {
      PYNITHY_RUNNER_TESTNET_POX10: 'etny-pynithy-testnet-pox10',
      NODENITHY_RUNNER_TESTNET_POX10: 'etny-nodenithy-testnet-pox10'
    },
    POLYGON: {
      PYNITHY_RUNNER_AMOY_POX10: 'ecld-pynithy-amoy-pox10',
      NODENITHY_RUNNER_AMOY_POX10: 'ecld-nodenithy-amoy-pox10'
    }
  },
  ECAddress: {
    BLOXBERG: {
      TESTNET_POX10_ADDRESS: '0x69A7bEB5Da2d3dA711d52E491D71e51296b08745',
      IMAGE_REGISTRY: {
        PYNITHY: { TESTNET_POX10_ADDRESS: '0x7dBC1b591cc3b7136D863bc7430C6Db50E929665' },
        NODENITHY: { TESTNET_POX10_ADDRESS: '0x7dBC1b591cc3b7136D863bc7430C6Db50E929665' }
      }
    },
    POLYGON: {
      AMOY_POX10_PROTOCOL_ADDRESS: '0x9Aad82557c84c11C4031382d8Bf2cacF8f256a02',
      IMAGE_REGISTRY: {
        PYNITHY: { AMOY_POX10_ADDRESS: '0xa2EE2a9118d0011AF05a6196c862D37d8c29F8eC' },
        NODENITHY: { AMOY_POX10_ADDRESS: '0xa2EE2a9118d0011AF05a6196c862D37d8c29F8eC' }
      }
    }
  },
  ECNetworkNameDictionary: {
    '0x69A7bEB5Da2d3dA711d52E491D71e51296b08745': 'bloxberg'
  },
  ECNetworkName1Dictionary: {
    '0x69A7bEB5Da2d3dA711d52E491D71e51296b08745': 'BLOXBERG'
  }
};

const POX10_TESTNETS = {
  BLOXBERG: {
    family: 'bloxberg',
    tokenName: 'tE10',
    tokenAddress: '0x69A7bEB5Da2d3dA711d52E491D71e51296b08745',
    protocolAddress: '0x69A7bEB5Da2d3dA711d52E491D71e51296b08745',
    imageRegistry: {
      PYNITHY: '0x7dBC1b591cc3b7136D863bc7430C6Db50E929665',
      NODENITHY: '0x7dBC1b591cc3b7136D863bc7430C6Db50E929665'
    },
    isMainnet: false,
    networkName: 'bloxberg',
    networkKey: 'BLOXBERG',
    networkType: 'TESTNET_POX10',
    faucet: null
  },
  POLYGON: {
    family: 'ecld',
    tokenName: 'tECLD',
    tokenAddress: '0x9927809B61122B2af3f3b3A3303875e0687b8eE3',
    protocolAddress: '0x9Aad82557c84c11C4031382d8Bf2cacF8f256a02',
    imageRegistry: {
      PYNITHY: '0xa2EE2a9118d0011AF05a6196c862D37d8c29F8eC',
      NODENITHY: '0xa2EE2a9118d0011AF05a6196c862D37d8c29F8eC'
    },
    isMainnet: false,
    networkName: 'amoy',
    networkKey: 'POLYGON',
    networkType: 'AMOY_POX10',
    faucet: { below: 100, amount: 1000 }
  }
};

// The descriptor of the shared ECLD testnet token before a chain id names
// its network.
const PROVISIONAL = {
  family: 'ecld',
  tokenName: 'tECLD',
  protocolAddress: undefined,
  imageRegistry: { PYNITHY: undefined, NODENITHY: undefined },
  isMainnet: false,
  networkName: undefined,
  networkKey: undefined,
  provisional: true
};

const BLOXBERG_TESTNET = '0x02882F03097fE8cD31afbdFbB5D72a498B41112c';
const BLOXBERG_MAINNET = '0x549A6E06BB2084100148D50F51CF77a3436C3Ae7';
const POLYGON_MAINNET = '0xc6920888988cAcEeA7ACCA0c96f2D65b05eE22Ba';
const AMOY = '0x9927809B61122B2af3f3b3A3303875e0687b8eE3';
const SEPOLIA = '0x2E27677fb67531eb09134fE331C27899f87ADe10';
const SHARED = '0x95Aa17fCFaAB75e8ed7d7DF218045795dCeB9c50';
const BLOXBERG_TESTNET_POX10 = '0x69A7bEB5Da2d3dA711d52E491D71e51296b08745';

// Each published way of constructing a runner: the constructor's address, the
// chain id it takes as its third argument (undefined for none), the chain the
// wallet is on and the descriptor the pair names.
const PUBLISHED_CONSTRUCTIONS = [
  ['Bloxberg testnet', BLOXBERG_TESTNET, undefined, 8995, PUBLISHED.ECNetworkConfig[BLOXBERG_TESTNET]],
  ['Bloxberg mainnet', BLOXBERG_MAINNET, undefined, 8995, PUBLISHED.ECNetworkConfig[BLOXBERG_MAINNET]],
  ['Polygon mainnet', POLYGON_MAINNET, undefined, 137, PUBLISHED.ECNetworkConfig[POLYGON_MAINNET]],
  ['Polygon Amoy', AMOY, undefined, 80002, PUBLISHED.ECNetworkConfig[AMOY]],
  ['IoTeX testnet', SHARED, 4690, 4690, PUBLISHED.ECEcldTestnetConfig[4690]],
  ['Ethereum Sepolia', SEPOLIA, undefined, 11155111, PUBLISHED.ECEcldTestnetConfig[11155111]],
  ['Ethereum Sepolia, with its chain id', SEPOLIA, 11155111, 11155111, PUBLISHED.ECEcldTestnetConfig[11155111]],
  ['LitVM LiteForge', SHARED, 4441, 4441, PUBLISHED.ECEcldTestnetConfig[4441]]
];

// Each published (network, type) name of setNetwork(), on the construction
// it names a network of, with the trustedzone it makes the default.
const PUBLISHED_NAMES = [
  [BLOXBERG_TESTNET, undefined, 8995, 'BLOXBERG', 'TESTNET', 'etny-pynithy-testnet'],
  [BLOXBERG_TESTNET, undefined, 8995, 'BLOXBERG', 'TESTNET_UNSAFE', 'etny-pynithy-testnet-unsafe'],
  [BLOXBERG_MAINNET, undefined, 8995, 'BLOXBERG', 'MAINNET', 'etny-pynithy'],
  [POLYGON_MAINNET, undefined, 137, 'POLYGON', 'MAINNET', 'ecld-pynithy'],
  [AMOY, undefined, 80002, 'POLYGON', 'TESTNET', 'ecld-pynithy-amoy'],
  [AMOY, undefined, 80002, 'POLYGON', 'TESTNET_UNSAFE', 'ecld-pynithy-amoy-unsafe'],
  [SHARED, 4690, 4690, 'IOTEX', 'TESTNET', 'ecld-pynithy-iotex-testnet'],
  [SEPOLIA, undefined, 11155111, 'SEPOLIA', 'TESTNET', 'ecld-pynithy-ethereum-sepolia'],
  [SEPOLIA, undefined, 11155111, 'SEPOLIA', 'TESTNET_UNSAFE', 'ecld-pynithy-ethereum-sepolia-unsafe'],
  [SHARED, 4441, 4441, 'LITVM', 'TESTNET', 'ecld-pynithy-litvm-testnet'],
  [SHARED, 4441, 4441, 'LITVM', 'TESTNET_UNSAFE', 'ecld-pynithy-litvm-testnet-unsafe']
];

const isTable = (value) => value !== null && typeof value === 'object';

// `published` with the entries of `added` put in, table by table.
const withAdded = (published, added) => {
  const merged = { ...published };
  for (const [key, value] of Object.entries(added)) {
    merged[key] = key in published ? withAdded(published[key], value) : value;
  }
  return merged;
};

// The paths at which `added` holds a value where `published` holds one.
const replaced = (published, added, path = []) =>
  Object.entries(added).flatMap(([key, value]) => {
    if (!(key in published)) return [];
    if (isTable(published[key]) && isTable(value)) return replaced(published[key], value, [...path, key]);
    return [[...path, key].join('.')];
  });

// A provider that answers the chain id and nothing else.
const providerOn = (chainId) => ({ getNetwork: async () => ({ chainId: BigInt(chainId) }) });

// A runner constructed with `address` and `chainId` whose wallet is on
// `walletChain`, its network resolved as a run resolves it. Its events are
// discarded and its image registry is bound without the read of the enclave's
// details.
const runnerOn = async (address, chainId, walletChain) => {
  const runner = new EthernityCloudRunner(address, { provider: providerOn(walletChain) }, chainId);
  runner.dispatchECEvent = () => {};
  runner.getEnclaveDetails = async () => {};
  await runner.resolveNetworkContext();
  return runner;
};

test('no entry release 0.6.36 adds replaces a published one', () => {
  for (const [table, added] of Object.entries(ADDED)) {
    assert.deepEqual(replaced(PUBLISHED[table], added), [], table);
  }
});

test('every table holds its published entries with their published values, and the added entries beside them', () => {
  for (const [table, published] of Object.entries(PUBLISHED)) {
    assert.deepEqual(enums[table], withAdded(published, ADDED[table] || {}), table);
  }
  // The descriptor tables of the published networks take no addition.
  assert.equal(ADDED.ECNetworkConfig, undefined);
  assert.equal(ADDED.ECEcldTestnetConfig, undefined);
  assert.deepEqual(Object.keys(enums.ECNetworkConfig), [BLOXBERG_TESTNET, BLOXBERG_MAINNET, POLYGON_MAINNET, AMOY]);
  assert.equal(enums.ECLD_SHARED_TESTNET_TOKEN, SHARED);
  assert.equal(enums.UNSAFE_NETWORK_SUFFIX, '_UNSAFE');
  assert.equal(enums.UNSAFE_TRUSTEDZONE_SUFFIX, '-unsafe');
});

test('the PoX 1.0 testnet networks are the one new table, with the values of their contracts and a type per network', () => {
  assert.deepEqual(enums.ECPox10TestnetConfig, POX10_TESTNETS);
  assert.equal(enums.ECPox10TestnetConfig.BLOXBERG.networkType, 'TESTNET_POX10');
  assert.equal(enums.ECPox10TestnetConfig.POLYGON.networkType, 'AMOY_POX10');
  // No constant names one type for both networks, and POLYGON carries no
  // TESTNET_POX10 identifier.
  assert.equal(enums.POX10_TESTNET_TYPE, undefined);
  assert.equal(enums.ECNetwork.POLYGON.TESTNET_POX10, undefined);
  assert.equal(enums.ECNetworkByChainId.POLYGON.TESTNET_POX10, undefined);
  assert.equal(enums.ECRunner.POLYGON.PYNITHY_RUNNER_TESTNET_POX10, undefined);
  assert.equal(enums.ECRunner.POLYGON.NODENITHY_RUNNER_TESTNET_POX10, undefined);
  assert.equal(enums.ECAddress.POLYGON.TESTNET_POX10_PROTOCOL_ADDRESS, undefined);
  assert.equal(enums.ECAddress.POLYGON.IMAGE_REGISTRY.PYNITHY.TESTNET_POX10_ADDRESS, undefined);
  assert.equal(enums.ECAddress.POLYGON.IMAGE_REGISTRY.NODENITHY.TESTNET_POX10_ADDRESS, undefined);
});

test('a published constructor address, with its chain id, resolves to its published descriptor, whatever published type is named', () => {
  for (const [label, address, chainId, , descriptor] of PUBLISHED_CONSTRUCTIONS) {
    for (const type of [undefined, 'TESTNET', 'TESTNET_UNSAFE', 'MAINNET']) {
      assert.deepEqual(enums.resolveNetworkConfig(address, chainId, type), descriptor, `${label} ${type}`);
    }
  }
  // The shared token without a chain id, and an address no network is paid with.
  assert.deepEqual(enums.resolveNetworkConfig(SHARED), PROVISIONAL);
  assert.equal(enums.resolveNetworkConfig('0x0000000000000000000000000000000000000001'), undefined);
  assert.equal(enums.resolveNetworkConfig(undefined), undefined);
});

test('a runner constructed the published way is on the published network: its token, PoX, image registry, kind and default trustedzone', async () => {
  for (const [label, address, chainId, walletChain, descriptor] of PUBLISHED_CONSTRUCTIONS) {
    const runner = await runnerOn(address, chainId, walletChain);
    assert.deepEqual(runner.networkConfig, descriptor, label);
    assert.equal(runner.tokenContract.contractAddress(), address, label);
    assert.equal(runner.tokenContract.tokenName, descriptor.tokenName, label);
    assert.equal(runner.protocolContract.getContract().target, descriptor.protocolAddress, label);
    assert.equal(runner.isMainnet(), descriptor.isMainnet, label);
    const kind = descriptor.isMainnet ? 'PYNITHY_RUNNER' : 'PYNITHY_RUNNER_TESTNET';
    assert.equal(runner.resolveTrustedZoneImage(), PUBLISHED.ECRunner[descriptor.networkKey][kind], label);
    await runner.initializeImageRegistry('a-securelock');
    assert.equal(runner.imageRegistryContract.getContract().target, descriptor.imageRegistry.PYNITHY, label);
  }
  // With no address the runner is on the Bloxberg testnet.
  const byDefault = await runnerOn(undefined, undefined, 8995);
  assert.equal(byDefault.networkAddress, BLOXBERG_TESTNET);
  assert.deepEqual(byDefault.networkConfig, PUBLISHED.ECNetworkConfig[BLOXBERG_TESTNET]);
  // The shared token without a chain id takes the network of the wallet's chain.
  const litvm = await runnerOn(SHARED, undefined, 4441);
  assert.deepEqual(litvm.networkConfig, PUBLISHED.ECEcldTestnetConfig[4441]);
});

test('a published (network, type) name is taken on its construction: the network stays, the trustedzone is the name\'s', async () => {
  for (const [address, chainId, walletChain, network, type, trustedZone] of PUBLISHED_NAMES) {
    const runner = await runnerOn(address, chainId, walletChain);
    const descriptor = runner.networkConfig;
    const protocol = runner.protocolContract;
    await runner.setNetwork(network, type);
    assert.equal(runner.networkConfig, descriptor, `${network} ${type}`);
    assert.equal(runner.protocolContract, protocol, `${network} ${type}`);
    assert.equal(runner.resolveTrustedZoneImage(), trustedZone, `${network} ${type}`);
    assert.equal(runner.isUnsafe(), type.endsWith('_UNSAFE'), `${network} ${type}`);
    // The network resolution a run starts with keeps the runner on it.
    await runner.resolveNetworkContext();
    assert.equal(runner.networkConfig, descriptor, `${network} ${type}`);
    assert.equal(runner.protocolContract, protocol, `${network} ${type}`);
  }
});

test('a name of another chain is refused with the chain of the runner\'s address, and a name the runner does not know with that', async () => {
  const testnet = await runnerOn(BLOXBERG_TESTNET, undefined, 8995);
  await assert.rejects(testnet.setNetwork('BLOXBERG', 'MAINNET'), {
    message: "setNetwork: BLOXBERG MAINNET is not on the chain of this runner's address (BLOXBERG TESTNET)"
  });
  await assert.rejects(testnet.setNetwork('POLYGON', 'TESTNET'), {
    message: "setNetwork: POLYGON TESTNET is not on the chain of this runner's address (BLOXBERG TESTNET)"
  });
  const mainnet = await runnerOn(POLYGON_MAINNET, undefined, 137);
  await assert.rejects(mainnet.setNetwork('POLYGON', 'TESTNET'), {
    message: "setNetwork: POLYGON TESTNET is not on the chain of this runner's address (POLYGON MAINNET)"
  });
  await assert.rejects(testnet.setNetwork('BLOXBERG', 'DEVNET'), {
    message: 'setNetwork: BLOXBERG DEVNET is not a network this runner knows'
  });
  await assert.rejects(testnet.setNetwork('IOTEX', 'TESTNET_UNSAFE'), {
    message: 'setNetwork: IOTEX TESTNET_UNSAFE is not a network this runner knows'
  });
  // Each PoX 1.0 testnet network has the type of its own key and no other:
  // ('POLYGON', 'TESTNET_POX10') and ('BLOXBERG', 'AMOY_POX10') name nothing.
  const amoy = await runnerOn(AMOY, undefined, 80002);
  await assert.rejects(amoy.setNetwork('POLYGON', 'TESTNET_POX10'), {
    message: 'setNetwork: POLYGON TESTNET_POX10 is not a network this runner knows'
  });
  assert.deepEqual(amoy.networkConfig, PUBLISHED.ECNetworkConfig[AMOY]);
  assert.equal(amoy.resolveTrustedZoneImage(), 'ecld-pynithy-amoy');
  const pox10 = await runnerOn(BLOXBERG_TESTNET_POX10, undefined, 8995);
  await assert.rejects(pox10.setNetwork('BLOXBERG', 'AMOY_POX10'), {
    message: 'setNetwork: BLOXBERG AMOY_POX10 is not a network this runner knows'
  });
  assert.equal(enums.resolveNetworkConfig(AMOY, 80002, 'TESTNET_POX10'), undefined);
  assert.equal(enums.resolveNetworkConfig(BLOXBERG_TESTNET_POX10, 8995, 'AMOY_POX10'), undefined);
});

test('the raw-key path binds each published address to its published RPC, and the bloxberg PoX 1.0 token to the bloxberg RPC', () => {
  const key = ethers.Wallet.createRandom().privateKey;
  for (const [address, url] of [
    [BLOXBERG_TESTNET, 'https://bloxberg.ethernity.cloud'],
    [BLOXBERG_MAINNET, 'https://bloxberg.ethernity.cloud'],
    [POLYGON_MAINNET, 'https://polygon-bor-rpc.publicnode.com'],
    [AMOY, 'https://polygon-amoy-bor-rpc.publicnode.com'],
    [SEPOLIA, 'https://ethereum-sepolia-rpc.publicnode.com'],
    [SHARED, 'https://bloxberg.ethernity.cloud'],
    [BLOXBERG_TESTNET_POX10, 'https://bloxberg.ethernity.cloud']
  ]) {
    const context = resolveWalletContext(address, { privateKey: key });
    assert.equal(context.provider._getConnection().url, url, address);
    context.provider.destroy();
  }
});

test('the two PoX 1.0 testnet networks as a user names them', async () => {
  // Bloxberg testnet, PoX 1.0: the network's own token address.
  const bloxberg = await runnerOn(enums.ECAddress.BLOXBERG.TESTNET_POX10_ADDRESS, undefined, 8995);
  assert.deepEqual(bloxberg.networkConfig, POX10_TESTNETS.BLOXBERG);
  await bloxberg.setNetwork('BLOXBERG', 'TESTNET_POX10');
  assert.deepEqual(bloxberg.networkConfig, POX10_TESTNETS.BLOXBERG);
  assert.equal(enums.ECNetworkByChainId.BLOXBERG.TESTNET_POX10, 8995);
  // Polygon Amoy, PoX 1.0: the Amoy token address and the network's name.
  const amoy = await runnerOn(enums.ECAddress.POLYGON.TESTNET_ADDRESS, undefined, 80002);
  await amoy.setNetwork('POLYGON', 'AMOY_POX10');
  assert.deepEqual(amoy.networkConfig, POX10_TESTNETS.POLYGON);
  assert.equal(enums.ECNetworkByChainId.POLYGON.AMOY_POX10, 80002);
});

test('a constructor address that is undefined is the constructor\'s default, the Bloxberg testnet', async () => {
  // ECAddress.POLYGON carries no address for the Amoy PoX 1.0 network: its
  // token is ECAddress.POLYGON.TESTNET_ADDRESS.
  assert.equal(enums.ECAddress.POLYGON.AMOY_POX10_ADDRESS, undefined);
  assert.equal(enums.ECAddress.POLYGON.TESTNET_POX10_ADDRESS, undefined);
  const runner = await runnerOn(enums.ECAddress.POLYGON.AMOY_POX10_ADDRESS, undefined, 8995);
  assert.equal(runner.networkAddress, BLOXBERG_TESTNET);
  assert.deepEqual(runner.networkConfig, PUBLISHED.ECNetworkConfig[BLOXBERG_TESTNET]);
  // The Amoy PoX 1.0 name and its trustedzones are refused on that runner.
  await assert.rejects(runner.setNetwork('POLYGON', 'AMOY_POX10'), {
    message: "setNetwork: POLYGON AMOY_POX10 is not on the chain of this runner's address (BLOXBERG TESTNET)"
  });
  assert.throws(() => runner.selectTrustedZone('ecld-pynithy-amoy-pox10'), {
    message: `ecld-pynithy-amoy-pox10 is a trustedzone of the PoX 1.0 network POLYGON AMOY_POX10: construct the runner with that network's token ${AMOY} and name the network with setNetwork('POLYGON', 'AMOY_POX10')`
  });
});
