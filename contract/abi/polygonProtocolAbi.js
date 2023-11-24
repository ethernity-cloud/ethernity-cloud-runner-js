const contract = {
  address: process.env.REACT_APP_POLYGON_PROTOCOL_CONTRACT_ADDRESS || '0x439945BE73fD86fcC172179021991E96Beff3Cc4',
  abi: [
    {
      anonymous: false,
      inputs: [
        { indexed: true, internalType: 'address', name: '_from', type: 'address' },
        { indexed: true, internalType: 'address', name: '_to', type: 'address' }
      ],
      name: 'OwnershipTransferred',
      type: 'event'
    },
    {
      anonymous: false,
      inputs: [
        { indexed: true, internalType: 'address', name: '_from', type: 'address' },
        { indexed: false, internalType: 'uint256', name: '_rowNumber', type: 'uint256' }
      ],
      name: '_addDORequestEV',
      type: 'event'
    },
    {
      anonymous: false,
      inputs: [
        { indexed: true, internalType: 'address', name: '_from', type: 'address' },
        { indexed: false, internalType: 'uint256', name: '_rowNumber', type: 'uint256' }
      ],
      name: '_addDPRequestEV',
      type: 'event'
    },
    {
      anonymous: false,
      inputs: [
        { indexed: true, internalType: 'address', name: '_downer', type: 'address' },
        { indexed: false, internalType: 'address', name: '_dproc', type: 'address' },
        { indexed: false, internalType: 'uint256', name: '_orderNumber', type: 'uint256' }
      ],
      name: '_orderApprovedEV',
      type: 'event'
    },
    {
      anonymous: false,
      inputs: [{ indexed: false, internalType: 'uint256', name: '_orderNumber', type: 'uint256' }],
      name: '_orderClosedEV',
      type: 'event'
    },
    {
      anonymous: false,
      inputs: [{ indexed: false, internalType: 'uint256', name: '_orderNumber', type: 'uint256' }],
      name: '_orderInvalidatedEV',
      type: 'event'
    },
    {
      anonymous: false,
      inputs: [
        { indexed: false, internalType: 'uint256', name: '_orderNumber', type: 'uint256' },
        { indexed: false, internalType: 'uint256', name: '_doRequestId', type: 'uint256' },
        { indexed: false, internalType: 'uint256', name: '_dpRequestId', type: 'uint256' }
      ],
      name: '_orderPlacedEV',
      type: 'event'
    },
    {
      anonymous: false,
      inputs: [{ indexed: false, internalType: 'uint256', name: '_orderNumber', type: 'uint256' }],
      name: '_orderValidatedEV',
      type: 'event'
    },
    {
      anonymous: false,
      inputs: [
        { indexed: true, internalType: 'address', name: '_from', type: 'address' },
        { indexed: false, internalType: 'uint256', name: '_orderNumber', type: 'uint256' }
      ],
      name: '_placeOrderEV',
      type: 'event'
    },
    {
      constant: false,
      inputs: [
        { internalType: 'uint8', name: '_cpuRequest', type: 'uint8' },
        { internalType: 'uint8', name: '_memRequest', type: 'uint8' },
        { internalType: 'uint8', name: '_storageRequest', type: 'uint8' },
        { internalType: 'uint8', name: '_bandwidthRequest', type: 'uint8' },
        { internalType: 'uint16', name: '_duration', type: 'uint16' },
        { internalType: 'uint8', name: '_instances', type: 'uint8' },
        { internalType: 'uint8', name: '_maxPrice', type: 'uint8' },
        { internalType: 'string', name: '_metadata1', type: 'string' },
        { internalType: 'string', name: '_metadata2', type: 'string' },
        { internalType: 'string', name: '_metadata3', type: 'string' },
        { internalType: 'string', name: '_metadata4', type: 'string' }
      ],
      name: '_addDORequest',
      outputs: [{ internalType: 'uint256', name: '_rowNumber', type: 'uint256' }],
      payable: false,
      stateMutability: 'nonpayable',
      type: 'function'
    },
    {
      constant: false,
      inputs: [
        { internalType: 'uint8', name: '_cpuRequest', type: 'uint8' },
        { internalType: 'uint8', name: '_memRequest', type: 'uint8' },
        { internalType: 'uint8', name: '_storageRequest', type: 'uint8' },
        { internalType: 'uint8', name: '_bandwidthRequest', type: 'uint8' },
        { internalType: 'uint16', name: '_duration', type: 'uint16' },
        { internalType: 'uint8', name: '_minPrice', type: 'uint8' },
        { internalType: 'string', name: '_metadata1', type: 'string' },
        { internalType: 'string', name: '_metadata2', type: 'string' },
        { internalType: 'string', name: '_metadata3', type: 'string' },
        { internalType: 'string', name: '_metadata4', type: 'string' }
      ],
      name: '_addDPRequest',
      outputs: [{ internalType: 'uint256', name: '_rowNumber', type: 'uint256' }],
      payable: false,
      stateMutability: 'nonpayable',
      type: 'function'
    },
    {
      constant: false,
      inputs: [
        { internalType: 'uint256', name: '_requestListItem', type: 'uint256' },
        { internalType: 'string', name: '_key', type: 'string' },
        { internalType: 'string', name: '_value', type: 'string' }
      ],
      name: '_addMetadataToDPRequest',
      outputs: [{ internalType: 'uint256', name: '_rowNumber', type: 'uint256' }],
      payable: false,
      stateMutability: 'nonpayable',
      type: 'function'
    },
    {
      constant: false,
      inputs: [
        { internalType: 'uint256', name: '_requestListItem', type: 'uint256' },
        { internalType: 'string', name: '_key', type: 'string' },
        { internalType: 'string', name: '_value', type: 'string' }
      ],
      name: '_addMetadataToRequest',
      outputs: [{ internalType: 'uint256', name: '_rowNumber', type: 'uint256' }],
      payable: false,
      stateMutability: 'nonpayable',
      type: 'function'
    },
    {
      constant: false,
      inputs: [
        { internalType: 'uint256', name: '_orderItem', type: 'uint256' },
        { internalType: 'address', name: 'processor', type: 'address' }
      ],
      name: '_addProcessorToOrder',
      outputs: [{ internalType: 'bool', name: 'success', type: 'bool' }],
      payable: false,
      stateMutability: 'nonpayable',
      type: 'function'
    },
    {
      constant: false,
      inputs: [
        { internalType: 'uint256', name: '_orderItem', type: 'uint256' },
        { internalType: 'string', name: '_result', type: 'string' }
      ],
      name: '_addResultToOrder',
      outputs: [{ internalType: 'bool', name: 'success', type: 'bool' }],
      payable: false,
      stateMutability: 'nonpayable',
      type: 'function'
    },
    {
      constant: false,
      inputs: [{ internalType: 'uint256', name: '_orderItem', type: 'uint256' }],
      name: '_approveOrder',
      outputs: [{ internalType: 'bool', name: 'success', type: 'bool' }],
      payable: false,
      stateMutability: 'nonpayable',
      type: 'function'
    },
    {
      constant: false,
      inputs: [{ internalType: 'uint256', name: '_requestListItem', type: 'uint256' }],
      name: '_cancelDORequest',
      outputs: [],
      payable: false,
      stateMutability: 'nonpayable',
      type: 'function'
    },
    {
      constant: false,
      inputs: [{ internalType: 'uint256', name: '_requestListItem', type: 'uint256' }],
      name: '_cancelDPRequest',
      outputs: [],
      payable: false,
      stateMutability: 'nonpayable',
      type: 'function'
    },
    {
      constant: true,
      inputs: [{ internalType: 'uint256', name: '_requestListItem', type: 'uint256' }],
      name: '_getDORequest',
      outputs: [
        { internalType: 'address', name: 'downer', type: 'address' },
        { internalType: 'uint8', name: 'cpuRequest', type: 'uint8' },
        { internalType: 'uint8', name: 'memoryRequest', type: 'uint8' },
        { internalType: 'uint8', name: 'storageRequest', type: 'uint8' },
        { internalType: 'uint8', name: 'bandwidthRequest', type: 'uint8' },
        { internalType: 'uint16', name: 'duration', type: 'uint16' },
        { internalType: 'uint8', name: 'maxPrice', type: 'uint8' },
        { internalType: 'uint256', name: 'status', type: 'uint256' }
      ],
      payable: false,
      stateMutability: 'view',
      type: 'function'
    },
    {
      constant: true,
      inputs: [{ internalType: 'uint256', name: '_requestListItem', type: 'uint256' }],
      name: '_getDORequestMetadata',
      outputs: [
        { internalType: 'address', name: 'downer', type: 'address' },
        { internalType: 'string', name: 'metadata1', type: 'string' },
        { internalType: 'string', name: 'metadata2', type: 'string' },
        { internalType: 'string', name: 'metadata3', type: 'string' },
        { internalType: 'string', name: 'metadata4', type: 'string' }
      ],
      payable: false,
      stateMutability: 'view',
      type: 'function'
    },
    {
      constant: true,
      inputs: [],
      name: '_getDORequestsCount',
      outputs: [{ internalType: 'uint256', name: '_length', type: 'uint256' }],
      payable: false,
      stateMutability: 'view',
      type: 'function'
    },
    {
      constant: true,
      inputs: [{ internalType: 'uint256', name: '_requestListItem', type: 'uint256' }],
      name: '_getDPRequest',
      outputs: [
        { internalType: 'address', name: 'dproc', type: 'address' },
        { internalType: 'uint8', name: 'cpuRequest', type: 'uint8' },
        { internalType: 'uint8', name: 'memoryRequest', type: 'uint8' },
        { internalType: 'uint8', name: 'storageRequest', type: 'uint8' },
        { internalType: 'uint8', name: 'bandwidthRequest', type: 'uint8' },
        { internalType: 'uint16', name: 'duration', type: 'uint16' },
        { internalType: 'uint8', name: 'minPrice', type: 'uint8' },
        { internalType: 'uint256', name: 'status', type: 'uint256' }
      ],
      payable: false,
      stateMutability: 'view',
      type: 'function'
    },
    {
      constant: true,
      inputs: [{ internalType: 'uint256', name: '_requestListItem', type: 'uint256' }],
      name: '_getDPRequestMetadata',
      outputs: [
        { internalType: 'address', name: 'dproc', type: 'address' },
        { internalType: 'string', name: 'metadata1', type: 'string' },
        { internalType: 'string', name: 'metadata2', type: 'string' },
        { internalType: 'string', name: 'metadata3', type: 'string' },
        { internalType: 'string', name: 'metadata4', type: 'string' }
      ],
      payable: false,
      stateMutability: 'view',
      type: 'function'
    },
    {
      constant: true,
      inputs: [{ internalType: 'uint256', name: '_requestListItem', type: 'uint256' }],
      name: '_getDPRequestWithCreationDate',
      outputs: [
        { internalType: 'address', name: 'dproc', type: 'address' },
        { internalType: 'uint8', name: 'cpuRequest', type: 'uint8' },
        { internalType: 'uint8', name: 'memoryRequest', type: 'uint8' },
        { internalType: 'uint8', name: 'storageRequest', type: 'uint8' },
        { internalType: 'uint8', name: 'bandwidthRequest', type: 'uint8' },
        { internalType: 'uint16', name: 'duration', type: 'uint16' },
        { internalType: 'uint8', name: 'minPrice', type: 'uint8' },
        { internalType: 'uint256', name: 'status', type: 'uint256' },
        { internalType: 'uint32', name: 'createdAt', type: 'uint32' }
      ],
      payable: false,
      stateMutability: 'view',
      type: 'function'
    },
    {
      constant: true,
      inputs: [],
      name: '_getDPRequestsCount',
      outputs: [{ internalType: 'uint256', name: '_length', type: 'uint256' }],
      payable: false,
      stateMutability: 'view',
      type: 'function'
    },
    {
      constant: true,
      inputs: [{ internalType: 'uint256', name: '_requestListItem', type: 'uint256' }],
      name: '_getMetadataCountForDPRequest',
      outputs: [{ internalType: 'uint256', name: '_length', type: 'uint256' }],
      payable: false,
      stateMutability: 'view',
      type: 'function'
    },
    {
      constant: true,
      inputs: [{ internalType: 'uint256', name: '_requestListItem', type: 'uint256' }],
      name: '_getMetadataCountForRequest',
      outputs: [{ internalType: 'uint256', name: '_length', type: 'uint256' }],
      payable: false,
      stateMutability: 'view',
      type: 'function'
    },
    {
      constant: true,
      inputs: [
        { internalType: 'uint256', name: '_requestListItem', type: 'uint256' },
        { internalType: 'uint256', name: '_metadataItem', type: 'uint256' }
      ],
      name: '_getMetadataValueForDPRequest',
      outputs: [
        { internalType: 'string', name: 'key', type: 'string' },
        { internalType: 'string', name: 'value', type: 'string' }
      ],
      payable: false,
      stateMutability: 'view',
      type: 'function'
    },
    {
      constant: true,
      inputs: [
        { internalType: 'uint256', name: '_requestListItem', type: 'uint256' },
        { internalType: 'uint256', name: '_metadataItem', type: 'uint256' }
      ],
      name: '_getMetadataValueForRequest',
      outputs: [
        { internalType: 'string', name: 'key', type: 'string' },
        { internalType: 'string', name: 'value', type: 'string' }
      ],
      payable: false,
      stateMutability: 'view',
      type: 'function'
    },
    {
      constant: true,
      inputs: [],
      name: '_getMyDOOrders',
      outputs: [{ internalType: 'uint256[]', name: 'req', type: 'uint256[]' }],
      payable: false,
      stateMutability: 'view',
      type: 'function'
    },
    {
      constant: true,
      inputs: [],
      name: '_getMyDORequests',
      outputs: [{ internalType: 'uint256[]', name: 'req', type: 'uint256[]' }],
      payable: false,
      stateMutability: 'view',
      type: 'function'
    },
    {
      constant: true,
      inputs: [],
      name: '_getMyDPRequests',
      outputs: [{ internalType: 'uint256[]', name: 'req', type: 'uint256[]' }],
      payable: false,
      stateMutability: 'view',
      type: 'function'
    },
    {
      constant: true,
      inputs: [{ internalType: 'uint256', name: '_orderItem', type: 'uint256' }],
      name: '_getOrder',
      outputs: [
        { internalType: 'address', name: 'downer', type: 'address' },
        { internalType: 'address', name: 'dproc', type: 'address' },
        { internalType: 'uint256', name: 'doRequest', type: 'uint256' },
        { internalType: 'uint256', name: 'dpRequest', type: 'uint256' },
        { internalType: 'uint256', name: 'status', type: 'uint256' }
      ],
      payable: false,
      stateMutability: 'view',
      type: 'function'
    },
    {
      constant: true,
      inputs: [],
      name: '_getOrdersCount',
      outputs: [{ internalType: 'uint256', name: '_length', type: 'uint256' }],
      payable: false,
      stateMutability: 'view',
      type: 'function'
    },
    {
      constant: true,
      inputs: [{ internalType: 'uint256', name: '_orderItem', type: 'uint256' }],
      name: '_getRequiredValidators',
      outputs: [{ internalType: 'uint256', name: '_Result', type: 'uint256' }],
      payable: false,
      stateMutability: 'view',
      type: 'function'
    },
    {
      constant: true,
      inputs: [{ internalType: 'uint256', name: '_orderItem', type: 'uint256' }],
      name: '_getResultFromOrder',
      outputs: [{ internalType: 'string', name: '_Result', type: 'string' }],
      payable: false,
      stateMutability: 'view',
      type: 'function'
    },
    {
      constant: false,
      inputs: [
        { internalType: 'uint256', name: '_doRequestItem', type: 'uint256' },
        { internalType: 'uint256', name: '_dpRequestItem', type: 'uint256' }
      ],
      name: '_placeOrder',
      outputs: [{ internalType: 'uint256', name: '_orderNumber', type: 'uint256' }],
      payable: false,
      stateMutability: 'nonpayable',
      type: 'function'
    },
    {
      constant: false,
      inputs: [],
      name: 'acceptOwnership',
      outputs: [],
      payable: false,
      stateMutability: 'nonpayable',
      type: 'function'
    },
    {
      constant: true,
      inputs: [],
      name: 'devAddress',
      outputs: [{ internalType: 'address payable', name: '', type: 'address' }],
      payable: false,
      stateMutability: 'view',
      type: 'function'
    },
    {
      constant: true,
      inputs: [],
      name: 'ecAddress',
      outputs: [{ internalType: 'address payable', name: '', type: 'address' }],
      payable: false,
      stateMutability: 'view',
      type: 'function'
    },
    {
      constant: true,
      inputs: [],
      name: 'erc20Address',
      outputs: [{ internalType: 'address', name: '', type: 'address' }],
      payable: false,
      stateMutability: 'view',
      type: 'function'
    },
    {
      constant: true,
      inputs: [],
      name: 'ethStorageAddress',
      outputs: [{ internalType: 'address', name: '', type: 'address' }],
      payable: false,
      stateMutability: 'view',
      type: 'function'
    },
    {
      constant: false,
      inputs: [{ internalType: 'uint256', name: '_orderItem', type: 'uint256' }],
      name: 'invalidate',
      outputs: [{ internalType: 'bool', name: 'success', type: 'bool' }],
      payable: false,
      stateMutability: 'nonpayable',
      type: 'function'
    },
    {
      constant: true,
      inputs: [],
      name: 'newOwner',
      outputs: [{ internalType: 'address', name: '', type: 'address' }],
      payable: false,
      stateMutability: 'view',
      type: 'function'
    },
    {
      constant: true,
      inputs: [],
      name: 'owner',
      outputs: [{ internalType: 'address', name: '', type: 'address' }],
      payable: false,
      stateMutability: 'view',
      type: 'function'
    },
    {
      constant: false,
      inputs: [{ internalType: 'address payable', name: 'newDevAddress', type: 'address' }],
      name: 'setDevAddress',
      outputs: [],
      payable: false,
      stateMutability: 'nonpayable',
      type: 'function'
    },
    {
      constant: false,
      inputs: [{ internalType: 'address payable', name: 'newEcAddress', type: 'address' }],
      name: 'setEcAddress',
      outputs: [],
      payable: false,
      stateMutability: 'nonpayable',
      type: 'function'
    },
    {
      constant: false,
      inputs: [{ internalType: 'address', name: 'newErc20Address', type: 'address' }],
      name: 'setEthernityCloudERC20Address',
      outputs: [],
      payable: false,
      stateMutability: 'nonpayable',
      type: 'function'
    },
    {
      constant: false,
      inputs: [{ internalType: 'address', name: 'newEthStorageAddress', type: 'address' }],
      name: 'setEthernityCloudStorageAddress',
      outputs: [],
      payable: false,
      stateMutability: 'nonpayable',
      type: 'function'
    },
    {
      constant: false,
      inputs: [{ internalType: 'address', name: 'newValidatorRegistryAddress', type: 'address' }],
      name: 'setValidatorRegistryAddress',
      outputs: [],
      payable: false,
      stateMutability: 'nonpayable',
      type: 'function'
    },
    {
      constant: false,
      inputs: [{ internalType: 'address', name: '_newOwner', type: 'address' }],
      name: 'transferOwnership',
      outputs: [],
      payable: false,
      stateMutability: 'nonpayable',
      type: 'function'
    },
    {
      constant: false,
      inputs: [{ internalType: 'uint256', name: '_orderItem', type: 'uint256' }],
      name: 'validate',
      outputs: [{ internalType: 'bool', name: 'success', type: 'bool' }],
      payable: false,
      stateMutability: 'nonpayable',
      type: 'function'
    },
    {
      constant: true,
      inputs: [],
      name: 'validatorRegistryAddress',
      outputs: [{ internalType: 'address', name: '', type: 'address' }],
      payable: false,
      stateMutability: 'view',
      type: 'function'
    }
  ]
};

export default contract;
