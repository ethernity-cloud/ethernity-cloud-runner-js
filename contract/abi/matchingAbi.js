// The ABI entries the runner calls on a PoX 2.0 deployment, each equal to its
// entry in pox-smart-contract-litvm at 52e36e0:
// abi/EthernityImplementationV2_2_0.json (pox, every selector of the
// implementation and its two extensions answering at the PoX's address),
// abi/IPoxPricing.json (pricing), abi/IPoxMatching.json (matching),
// abi/IPoxMatchReader.json (reader), abi/IECImageRegistryV4.json
// (imageRegistry) and PoxMatchingState.sol's IMatchingSessionRegistry
// (sessionRegistry), the SessionRegistry's views PoxMatching reads at a
// request's add. pox12 is the V2 add of a PoX that answers VERSION() "1.2",
// maxGflops uint32: the entry of abi/EthernityImplementationV2_2_0.json at
// 7611a81.
export const pox = [
  'function addDORequestV2(uint8 cpu, uint8 mem, uint8 storageGB, uint8 bw, uint16 duration, uint8 instances, uint256 maxPricePerCuHourWei, uint48 maxGflops, uint16 relaysPerHour, uint256 gasLevel, string metadata1, string metadata2, string metadata3, string metadata4) returns (uint256 requestId)',
  'function VERSION() view returns (string)',
  'function pricingAddress() view returns (address)',
  'function _getDORequest(uint256 _requestListItem) view returns (address downer, uint8 cpuRequest, uint8 memoryRequest, uint8 storageRequest, uint8 bandwidthRequest, uint16 duration, uint8 maxPrice, uint256 status)',
  'function _placeOrder(uint256 _doRequestItem, uint256 _dpRequestItem) returns (uint256 _orderNumber)',
  'function increaseBid(uint256 doRequestId, uint256 maxPricePerCuHourWei)',
  'function expireUnstarted(uint256 orderId)',
  'function expireOrder(uint256 orderId)',
  'function orderApprovedAt(uint256 orderId) view returns (uint64)',
  'function orderStartedAt(uint256 orderId) view returns (uint64)',
  'function orderResultAt(uint256 orderId) view returns (uint64 at, uint64 blockNumber)',
  'event _orderPlacedEV(uint256 _orderNumber, uint256 _doRequestId, uint256 _dpRequestId)'
];

export const pox12 = [
  'function addDORequestV2(uint8 cpu, uint8 mem, uint8 storageGB, uint8 bw, uint16 duration, uint8 instances, uint256 maxPricePerCuHourWei, uint32 maxGflops, uint16 relaysPerHour, uint256 gasLevel, string metadata1, string metadata2, string metadata3, string metadata4) returns (uint256 requestId)'
];

export const pricing = [
  'function matching() view returns (address)'
];

export const matching = [
  'function claimsOn() view returns (bool)',
  'function minimumOn() view returns (bool)',
  'function nodeStanding(address node) view returns (uint16 score, uint32 beatAgeSlots, uint32 bannedUntil)',
  'function recordOf(address node) view returns (uint24 beats, uint24 claims, uint24 lates, uint24 misses, uint24 failures, uint24 pending, uint32 lastFailureSlot)',
  'function imageHealth(bytes31 image) view returns (uint16 s7, uint16 f7, uint8 nodes, uint8 owners, bool marked)',
  'function healthOf(bytes31 image) view returns (uint256[] words)',
  'function templateOf(bytes32 nameHash) view returns (uint256 word, string provider)',
  'function parameterSet(uint256 index) view returns (tuple(uint32 effectAt, bool claims, uint8 fitPercent, uint8 maxSteps, uint8 maxRounds, uint8 fullBlockPercent, uint8 settleMax, uint8 pendingMax, uint8 correctionMaxEntries, uint16 stepBlocks, uint16 leadBlocks, uint16 banSlots, uint16 gain, uint16 missUnits, uint16 lateUnits, uint16 bandWidth, uint32 minListedSeconds, uint32 maxRequestAgeSeconds, uint32 startTimeoutSeconds, uint32 minPauseSeconds, uint32 servingGraceSeconds, uint32 correctionWindowSeconds, uint32 correctionAskSeconds, uint32 fullWindowSeconds, uint32 fetchTrySeconds, uint32 heldMarginSeconds, uint64 nodeFaultCodes, uint64 defaultFaultCodes, uint64 ambiguousCodes, uint64 runBilledCodes))',
  'function slotSeconds() view returns (uint32)',
  'function imageRegistry() view returns (address)',
  'function reader() view returns (address)',
  'function early33(uint256 orderId) view returns (bool)',
  'function noteRefund(uint256 orderId)',
  'function noteAmbiguous(uint256 orderId, uint256[] hints)',
  'function ambiguousOf(uint256 orderId) view returns (uint256 word)'
];

export const reader = [
  'function requestInfo(uint256 doRequestId) view returns (bool claims, bool ranked, bool imageMarked, bool settled, bool isFinal, uint8 round, bytes32 roundStamp, bytes32 seed, uint48 roundBlock, uint32 roundTime, uint32 createdAt, uint32 rollSlot, uint256 bidWei, uint256 baseWei, uint32 stepNow, uint32 closedStep, uint8 lastOpenStep, uint8 filledStep, uint16 claimCount, bool claimedInRound, uint16 parameterSet)',
  'function escrowFor(uint16 hoursWanted, uint256 maxPricePerCuHourWei, uint48 maxGflops, uint16 relaysPerHour, uint256 gasLevel, string metadata1) view returns (uint256 escrowWei, uint256 workWei, uint256 chainFeeWei, uint16 escrowGflops, uint8 trustedZoneFee, uint8 secureLockFee)',
  'function canClaimOf(uint256 doRequestId, address[] nodes) view returns (bytes32 roundStamp, bool[] canClaim)',
  'function candidates(uint256 doRequestId, uint8 round, uint8 fromBand, uint256 from, uint256 count, bytes32 h, uint8 matchFound, bool beyond) view returns (bytes32 roundStamp, uint256[] eligible, uint256[] tips, uint40[] places, bytes32 hOut, uint8 matchFoundOut, uint8 nextBand, uint256 nextFrom, bool done, bool settled)',
  'function claimersOf(uint256 doRequestId, uint256 from, uint256 count) view returns (address[] nodes, uint256[] claims, bool[] approvable)',
  'function bidQuote(uint256 doRequestId, uint16 minScore, uint8 fromBand, uint256 from, uint256 count, uint256 carry) view returns (bytes32 roundStamp, uint32 counted, uint32 canClaimNow, uint256 minBidWei, uint256 baseNowWei, uint256 bidWei, uint256 addedEscrowWei, uint8 nextBand, uint256 nextFrom, bool done)',
  'function bidQuoteFor(uint8 cpu, uint8 memGB, uint8 storageGB, uint8 bandwidth, uint16 hoursWanted, uint16 needGflops, uint16 ceilGflops, uint16 epcUnits, bytes32 templateHash, uint16 minScore, uint8 fromBand, uint256 from, uint256 count, uint256 carry) view returns (uint32 counted, uint256 minBidWei, uint256 baseNowWei, uint8 nextBand, uint256 nextFrom, bool done)',
  'function tierScore(uint256 doRequestId, uint8 fromBand, uint256 from, uint256 count, uint256[7] carry) view returns (uint16 score, uint256[7] carryOut, uint8 nextBand, uint256 nextFrom, bool done)'
];

export const imageRegistry = [
  'function imageRecords(string ipfsHash) view returns (tuple(uint8 kind, uint32 release, bool networkOn, uint8 enclaveMemoryGiB, bool minScoreSet, uint16 minScore, bytes32 bundleCiphertextSha256, bytes32 bundlePlaintextSha256))',
  'function defaultRelease(uint256 index) view returns (tuple(uint8 language, string trustedZoneImage, bytes32 trustedZoneMrenclave, bytes32 securelockMrenclave, bytes32 trustedZoneTemplate, bytes32 securelockTemplate, bytes32 executorTemplate, bytes32 probeTemplate))',
  'function sessionRegistry() view returns (address)',
  'function imageEpcUnits(string ipfsHash) view returns (uint16)',
  'function getImageSession(string ipfsHash) view returns (string)'
];

export const sessionRegistry = [
  'function sessionOfImage(string imageCid) view returns (bytes32)',
  'function record(bytes32 id) view returns (bytes32 sessionHash, address creator, string enclaveName, uint32 version, string bodyCid, string imageCid, uint8 hashAlgo, uint64 registeredAt, bool exists)',
  'function latest(string name) view returns (bytes32)'
];
