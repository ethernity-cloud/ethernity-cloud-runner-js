const contract = {
  address:
    process.env.REACT_APP_ETNY_POLYGON_IMAGE_REGISTRY_CONTRACT_ADDRESS || '0x689f3806874d3c8A973f419a4eB24e6fBA7E830F',
  abi: [
    { inputs: [], stateMutability: 'nonpayable', type: 'constructor' },
    {
      anonymous: false,
      inputs: [{ indexed: true, internalType: 'address', name: 'wallet', type: 'address' }],
      name: 'AllowedWalletAdded',
      type: 'event'
    },
    {
      anonymous: false,
      inputs: [{ indexed: true, internalType: 'address', name: 'wallet', type: 'address' }],
      name: 'AllowedWalletRemoved',
      type: 'event'
    },
    {
      anonymous: false,
      inputs: [
        { indexed: false, internalType: 'string', name: 'ipfsHash', type: 'string' },
        { indexed: false, internalType: 'string', name: 'publicKey', type: 'string' },
        { indexed: false, internalType: 'string', name: 'version', type: 'string' }
      ],
      name: 'ImageAdded',
      type: 'event'
    },
    {
      anonymous: false,
      inputs: [{ indexed: false, internalType: 'string', name: 'ipfsHash', type: 'string' }],
      name: 'ImagePublished',
      type: 'event'
    },
    {
      anonymous: false,
      inputs: [{ indexed: false, internalType: 'string', name: 'ipfsHash', type: 'string' }],
      name: 'ImageRemoved',
      type: 'event'
    },
    {
      anonymous: false,
      inputs: [{ indexed: false, internalType: 'string', name: 'ipfsHash', type: 'string' }],
      name: 'ImageValidated',
      type: 'event'
    },
    {
      anonymous: false,
      inputs: [
        { indexed: true, internalType: 'address', name: 'previousOwner', type: 'address' },
        { indexed: true, internalType: 'address', name: 'newOwner', type: 'address' }
      ],
      name: 'OwnerChanged',
      type: 'event'
    },
    {
      anonymous: false,
      inputs: [{ indexed: false, internalType: 'string', name: 'ipfsHash', type: 'string' }],
      name: 'TrustedZoneImageAdded',
      type: 'event'
    },
    {
      anonymous: false,
      inputs: [{ indexed: false, internalType: 'string', name: 'ipfsHash', type: 'string' }],
      name: 'TrustedZoneImageRemoved',
      type: 'event'
    },
    {
      inputs: [{ internalType: 'address', name: 'wallet', type: 'address' }],
      name: 'addAllowedWallet',
      outputs: [],
      stateMutability: 'nonpayable',
      type: 'function'
    },
    {
      inputs: [
        { internalType: 'string', name: 'ipfsHash', type: 'string' },
        { internalType: 'string', name: 'certPublicKey', type: 'string' },
        { internalType: 'string', name: 'version', type: 'string' },
        { internalType: 'string', name: 'imageName', type: 'string' },
        { internalType: 'string', name: 'dockerComposeHash', type: 'string' },
        { internalType: 'string', name: 'session', type: 'string' },
        { internalType: 'uint8', name: 'fee', type: 'uint8' }
      ],
      name: 'addImage',
      outputs: [],
      stateMutability: 'nonpayable',
      type: 'function'
    },
    {
      inputs: [
        { internalType: 'string', name: 'ipfsHash', type: 'string' },
        { internalType: 'string', name: 'certPublicKey', type: 'string' },
        { internalType: 'string', name: 'version', type: 'string' },
        { internalType: 'string', name: 'imageName', type: 'string' },
        { internalType: 'string', name: 'dockerComposeHash', type: 'string' },
        { internalType: 'string', name: 'session', type: 'string' },
        { internalType: 'uint8', name: 'fee', type: 'uint8' }
      ],
      name: 'addTrustedZoneImage',
      outputs: [],
      stateMutability: 'nonpayable',
      type: 'function'
    },
    {
      inputs: [{ internalType: 'address', name: '', type: 'address' }],
      name: 'allowedWallets',
      outputs: [{ internalType: 'bool', name: '', type: 'bool' }],
      stateMutability: 'view',
      type: 'function'
    },
    {
      inputs: [
        { internalType: 'string', name: 'ipfsHash', type: 'string' },
        { internalType: 'address', name: 'newRewardAddress', type: 'address' }
      ],
      name: 'changeImageRewardAddress',
      outputs: [],
      stateMutability: 'nonpayable',
      type: 'function'
    },
    {
      inputs: [{ internalType: 'address', name: 'newOwner', type: 'address' }],
      name: 'changeOwner',
      outputs: [],
      stateMutability: 'nonpayable',
      type: 'function'
    },
    {
      inputs: [
        { internalType: 'string', name: 'ipfsHash', type: 'string' },
        { internalType: 'address', name: 'newRewardAddress', type: 'address' }
      ],
      name: 'changeTrustedZoneImageRewardAddress',
      outputs: [],
      stateMutability: 'nonpayable',
      type: 'function'
    },
    {
      inputs: [{ internalType: 'string', name: 'ipfsHash', type: 'string' }],
      name: 'getImageCertPublicKey',
      outputs: [{ internalType: 'string', name: '', type: 'string' }],
      stateMutability: 'view',
      type: 'function'
    },
    {
      inputs: [{ internalType: 'string', name: 'ipfsHash', type: 'string' }],
      name: 'getImageSession',
      outputs: [{ internalType: 'string', name: '', type: 'string' }],
      stateMutability: 'view',
      type: 'function'
    },
    {
      inputs: [
        { internalType: 'string', name: 'imageName', type: 'string' },
        { internalType: 'string', name: 'version', type: 'string' }
      ],
      name: 'getLatestImageVersionPublicKey',
      outputs: [
        { internalType: 'string', name: '', type: 'string' },
        { internalType: 'string', name: '', type: 'string' },
        { internalType: 'string', name: '', type: 'string' }
      ],
      stateMutability: 'view',
      type: 'function'
    },
    {
      inputs: [
        { internalType: 'string', name: 'imageName', type: 'string' },
        { internalType: 'string', name: 'version', type: 'string' }
      ],
      name: 'getLatestTrustedZoneImageCertPublicKey',
      outputs: [
        { internalType: 'string', name: '', type: 'string' },
        { internalType: 'string', name: '', type: 'string' },
        { internalType: 'string', name: '', type: 'string' }
      ],
      stateMutability: 'view',
      type: 'function'
    },
    {
      inputs: [{ internalType: 'string', name: 'ipfsHash', type: 'string' }],
      name: 'getRewardAddress',
      outputs: [{ internalType: 'address', name: '', type: 'address' }],
      stateMutability: 'view',
      type: 'function'
    },
    {
      inputs: [{ internalType: 'string', name: 'ipfsHash', type: 'string' }],
      name: 'getTrustedZoneImageCertPublicKey',
      outputs: [{ internalType: 'string', name: '', type: 'string' }],
      stateMutability: 'view',
      type: 'function'
    },
    {
      inputs: [{ internalType: 'string', name: 'ipfsHash', type: 'string' }],
      name: 'getTrustedZoneImageSession',
      outputs: [{ internalType: 'string', name: '', type: 'string' }],
      stateMutability: 'view',
      type: 'function'
    },
    {
      inputs: [{ internalType: 'string', name: 'ipfsHash', type: 'string' }],
      name: 'getTrustedZoneRewardAddress',
      outputs: [{ internalType: 'address', name: '', type: 'address' }],
      stateMutability: 'view',
      type: 'function'
    },
    {
      inputs: [{ internalType: 'string', name: '', type: 'string' }],
      name: 'imageDetails',
      outputs: [
        { internalType: 'address', name: 'owner', type: 'address' },
        { internalType: 'string', name: 'ipfsHash', type: 'string' },
        { internalType: 'string', name: 'version', type: 'string' },
        { internalType: 'string', name: 'session', type: 'string' },
        { internalType: 'uint8', name: 'fee', type: 'uint8' },
        { internalType: 'address', name: 'rewardAddress', type: 'address' },
        { internalType: 'bool', name: 'validated', type: 'bool' },
        { internalType: 'bool', name: 'published', type: 'bool' },
        { internalType: 'string', name: 'certPublicKey', type: 'string' },
        { internalType: 'string', name: 'dockerComposeHash', type: 'string' },
        { internalType: 'string', name: 'name', type: 'string' }
      ],
      stateMutability: 'view',
      type: 'function'
    },
    {
      inputs: [
        { internalType: 'string', name: '', type: 'string' },
        { internalType: 'uint256', name: '', type: 'uint256' }
      ],
      name: 'imageVersions',
      outputs: [{ internalType: 'string', name: '', type: 'string' }],
      stateMutability: 'view',
      type: 'function'
    },
    {
      inputs: [
        { internalType: 'string', name: '', type: 'string' },
        { internalType: 'string', name: '', type: 'string' },
        { internalType: 'uint256', name: '', type: 'uint256' }
      ],
      name: 'imageVersionsHash',
      outputs: [{ internalType: 'string', name: '', type: 'string' }],
      stateMutability: 'view',
      type: 'function'
    },
    {
      inputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
      name: 'images',
      outputs: [{ internalType: 'string', name: '', type: 'string' }],
      stateMutability: 'view',
      type: 'function'
    },
    {
      inputs: [],
      name: 'owner',
      outputs: [{ internalType: 'address', name: '', type: 'address' }],
      stateMutability: 'view',
      type: 'function'
    },
    {
      inputs: [{ internalType: 'string', name: 'ipfsHash', type: 'string' }],
      name: 'publishImage',
      outputs: [],
      stateMutability: 'nonpayable',
      type: 'function'
    },
    {
      inputs: [{ internalType: 'address', name: 'wallet', type: 'address' }],
      name: 'removeAllowedWallet',
      outputs: [],
      stateMutability: 'nonpayable',
      type: 'function'
    },
    {
      inputs: [{ internalType: 'string', name: '', type: 'string' }],
      name: 'trustedZoneImageDetails',
      outputs: [
        { internalType: 'address', name: 'owner', type: 'address' },
        { internalType: 'string', name: 'ipfsHash', type: 'string' },
        { internalType: 'string', name: 'version', type: 'string' },
        { internalType: 'string', name: 'session', type: 'string' },
        { internalType: 'uint8', name: 'fee', type: 'uint8' },
        { internalType: 'address', name: 'rewardAddress', type: 'address' },
        { internalType: 'bool', name: 'validated', type: 'bool' },
        { internalType: 'bool', name: 'published', type: 'bool' },
        { internalType: 'string', name: 'certPublicKey', type: 'string' },
        { internalType: 'string', name: 'dockerComposeHash', type: 'string' },
        { internalType: 'string', name: 'name', type: 'string' }
      ],
      stateMutability: 'view',
      type: 'function'
    },
    {
      inputs: [
        { internalType: 'string', name: '', type: 'string' },
        { internalType: 'uint256', name: '', type: 'uint256' }
      ],
      name: 'trustedZoneImageVersions',
      outputs: [{ internalType: 'string', name: '', type: 'string' }],
      stateMutability: 'view',
      type: 'function'
    },
    {
      inputs: [
        { internalType: 'string', name: '', type: 'string' },
        { internalType: 'string', name: '', type: 'string' },
        { internalType: 'uint256', name: '', type: 'uint256' }
      ],
      name: 'trustedZoneVersionsHash',
      outputs: [{ internalType: 'string', name: '', type: 'string' }],
      stateMutability: 'view',
      type: 'function'
    },
    {
      inputs: [{ internalType: 'string', name: 'ipfsHash', type: 'string' }],
      name: 'validateImage',
      outputs: [],
      stateMutability: 'nonpayable',
      type: 'function'
    }
  ]
};

export default contract;
