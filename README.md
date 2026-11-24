<p align="center">
  <a href="https://ethernity.cloud" title="Ethernity Cloud">
    <img src="https://ethernity.cloud/images/dark_gradient_logo.svg" alt="Ethernity Cloud logo" width="244" />
  </a>
</p>

<h3 align="center">The JavaScript implementation of the Ethernity CLOUD protocol</h3>

### Installation

To begin developing with the Ethernity Cloud Runner, you can easily set up your environment by installing the package
using npm:

```console
$ npm install @ethernity-cloud/runner --save
```

This command will install the Ethernity Cloud Runner package and save it as a dependency in your project. With the
package installed, you're ready to start utilizing the Ethernity Cloud Runner functionality and explore its capabilities
for your application development.

### Environment Prerequisites

#### 1. IDE

For a streamlined development process, we recommend using Visual Studio Code—a powerful and versatile code editor that
offers a seamless experience for developers. You can download Visual Studio Code from the
official [website](https://code.visualstudio.com/.).

After running the IDE, a new workspace will be created, where you can start developing the framework and code.

#### 2. Framework

Using a Terminal within the IDE workspace, follow these steps to set up your framework of choice.

**Node.js:**
Node.js is an open-source, server-side JavaScript runtime environment that allows developers to execute JavaScript code
outside of a web browser. It uses an event-driven, non-blocking I/O model, making it highly efficient and suitable for
building scalable and real-time applications.

Install Node.js on your local machine by following the instructions provided
here: [Node.js Download](https://nodejs.dev/en/download/).

#### 3. Wallet Setup

A wallet is a crucial tool within the Ethernity Cloud ecosystem, empowering users to securely store and transfer their
data for processing. As a developer, having a Web3 dApp testing wallet is necessary.

The wallet setup process with Metamask is detailed
here: [Getting started with MetaMask](https://support.metamask.io/hc/en-us/articles/360015489531-Getting-started-with-MetaMask).

Ethernity Cloud runs on several networks. Set up your wallet for the network you intend to use (see the **Networks** section below for the full list and chain IDs):

- Bloxberg (mainnet and testnet)
- Polygon (mainnet) and Polygon Amoy (testnet)
- IoTeX Testnet, Ethereum Sepolia, and LitVM LiteForge (testnets)

### 4. Code execution

To execute a new task using the Ethernity Cloud Runner, follow the straightforward template provided below. Simply
insert your desired code into the designated section, and the runner will handle the rest, interacting with the IPFS
network and processing the task accordingly.

```javascript
import EthernityCloudRunner from "@ethernity-cloud/runner";
import { ECRunner, ECStatus, ECAddress } from "@ethernity-cloud/runner/enums";

const executeTask = async () => {
    const code = `___etny_result___("Hello, World!")`;

    // Progress updates (encrypting, submitting, matching, downloading, ...).
    const onProgress = (e) => {
        console.log(`[${e.detail.progress}] ${e.detail.message}`);
    };

    // Fired once the task completes; fetch the result from the runner.
    const onSuccess = async () => {
        const result = await runner.getResult();
        console.log(`Task Result: ${result}`);
    };

    const onError = (e) => {
        console.error(e.detail.message);
    };

    // No network address -> Bloxberg testnet + the browser wallet.
    // To target another network pass its token address, e.g.
    //   new EthernityCloudRunner(ECAddress.POLYGON.TESTNET_ADDRESS);
    const runner = new EthernityCloudRunner();
    // On the Bloxberg testnet the task's artefacts are delivered through the
    // bootnode's payload intake: no storage call is needed. Every other network
    // needs your own Kubo RPC API, which also replaces the intake here:
    //   runner.initializeStorage('http://127.0.0.1:5001');

    // Events are dispatched named by task status (the ECStatus values).
    runner.addEventListener(ECStatus.DEFAULT, onProgress); // "Running" updates
    runner.addEventListener(ECStatus.SUCCESS, onSuccess);
    runner.addEventListener(ECStatus.ERROR, onError);

    const resources = { taskPrice: 10, cpu: 1, memory: 1, storage: 40, bandwidth: 1, duration: 1, validators: 1 };
    // Execute a task with the Python testnet enclave on Bloxberg.
    // Signature: run(resources, secureLockEnclave, code, nodeAddress = '', trustedZoneEnclave)
    await runner.run(resources, ECRunner.BLOXBERG.PYNITHY_RUNNER_TESTNET, code);
}

await executeTask();
```

### Choosing the trustedzone

`run()` and `runSession()` take `trustedZoneEnclave`, the trustedzone the securelock was built against. It defaults to the one `setNetwork()` chose, else the network's pynithy trustedzone (`etny-pynithy-testnet` on the bloxberg testnet); a nodenithy dApp passes `etny-nodenithy-testnet`.

A securelock published without a CAS (`<project>-unsafe`) runs on an `-unsafe` network, which you choose by name with `await runner.setNetwork('BLOXBERG', 'TESTNET_UNSAFE')` (or `('LITVM', 'TESTNET_UNSAFE')`). An `-unsafe` network has the chain and contracts of the network it is named after; its trustedzone is `etny-pynithy-testnet-unsafe` (`ecld-pynithy-litvm-testnet-unsafe` on LitVM), and a nodenithy dApp passes `ECRunner.BLOXBERG.NODENITHY_RUNNER_TESTNET_UNSAFE`. The runner runs an `-unsafe` trustedzone only on an `-unsafe` network and runs nothing else there, so a task that runs without a CAS always says so in the network it names.

### Closing a session

`session.close(wait = true, timeoutMs = 900000)` writes the session's close row. With `wait` true it then waits until the order has closed and returns the order's result, the session summary. The answers to the session's inputs are output rows and arrive before the close; the order closes after the trustedzone has found those rows on chain and the node has sent the result, which takes at least one more block. An application that does not read the summary calls `session.close(false)`, which returns once the close row is mined.

The runner accepts a result only when the transaction the enclave signed is `_addResultToOrder` for this order, addressed to this network's protocol contract and signed for this chain, and its signer is the wallet derived from the task's challenge. Task codes 37, 39 and 40 (`OPERATOR_FAULT_CODES`) are node-side faults the validator refunds; the runner resubmits such a task as a new request.
### `___etny_result___` function
The `___etny_result___` function is a special function used in Ethernity Cloud Runner tasks. When executing a task, this
function allows the task code to send the result back from the Ethernity Cloud platform.

In the context of the Ethernity Cloud Runner, tasks are executed in a decentralized and distributed manner.
The `___etny_result___` function acts as a communication channel between the task code and the Ethernity Cloud platform.
When the function is called with the result data as its argument, it sends the result back to the platform, where it can
be processed and stored.

This special function plays a crucial role in ensuring that the results of executed tasks are properly recorded and
accessible. It enables seamless interaction with the Ethernity Cloud platform, making it a key component of the
Ethernity Cloud Runner's functionality.

### Events subscription

The runner extends `EventTarget` and, as a task moves through its lifecycle, dispatches `CustomEvent`s **named by the task status**. You therefore subscribe using the `ECStatus` values, not a separate event-name enum:

| Event name (`ECStatus`) | Value | When it fires |
| --- | --- | --- |
| `ECStatus.DEFAULT` | `"Running"` | Progress updates while the task is encrypting, being submitted, matched, processed, and the result downloaded. |
| `ECStatus.SUCCESS` | `"Success"` | The task finished successfully and a result is available. |
| `ECStatus.ERROR` | `"Error"` | The task failed (e.g. no matching node, insufficient balance, checksum error). |

Every event's `detail` is `{ message, status, progress }`:

- `message` — a human-readable message for the current step.
- `status` — the `ECStatus` value (same as the event name).
- `progress` — a phase label from `ECEvent` (e.g. `"Encrypting task"`, `"In Progress"`, `"Downloading result"`, `"Finished"`), useful for driving a progress UI.

```javascript
// Progress: use e.detail.progress for the phase and e.detail.message for detail.
const onProgress = (e) => {
    console.log(`[${e.detail.progress}] ${e.detail.message}`);
};

// Success: the result is available on the runner once this fires.
const onSuccess = async () => {
    const result = await runner.getResult();
    console.log(`Task Result: ${result}`);
};

// Error: something went wrong; e.detail.message explains what.
const onError = (e) => {
    console.error(e.detail.message);
};

runner.addEventListener(ECStatus.DEFAULT, onProgress);
runner.addEventListener(ECStatus.SUCCESS, onSuccess);
runner.addEventListener(ECStatus.ERROR, onError);
```

After `ECStatus.SUCCESS`, call `await runner.getResult()` to obtain the decrypted task result.

A task the enclave reports with a non-zero task code, such as `BASE_EXCEPTION` for an exception raised in the dApp, ends in `ECStatus.ERROR`: `runner.getLastError()` names the code, `runner.getResultTaskCode()` returns `{ code, name }`, and `await runner.getResult()` still returns the result, whose value is the enclave's error report (for an exception, its traceback).

### Input dataset

`run(resources, secureLockEnclave, code, nodeAddress, trustedZoneEnclave, { inputData })` sends a string to the task as its input dataset, read in the payload as `___etny_data_set___` (`ecld.input`). It is encrypted for the trustedzone and stored like the code, and the request carries its sha256, which the trustedzone verifies before the securelock receives it. An interactive session takes its inputs through `sendInput` instead.

Every artefact (challenge, code, input) is stored as an IPFS node with its default settings stores a file added with `--cid-version=1 --raw-leaves`: in blocks of 256 KiB, a single block as it is, several under a UnixFS tree. The runner computes that CID itself, so an artefact of any size is named in the request before it is uploaded, and the bootnode's payload intake takes it up to its 100 MiB body cap.

### Task resources

```javascript
 const resources = { taskPrice: 10, cpu: 1, memory: 1, storage: 40, bandwidth: 1, duration: 1, validators: 1 };
```
The `resources` parameter is the **first** argument to the `run` method and is an object that defines the resource requirements for executing a new task using the Python/Node.js template. It specifies the amount of various resources needed for the task to be processed on the EthernityCloud network. The `resources` object contains the following properties:

1. `taskPrice`: the most the user pays per hour of the task, in whole tokens (tETNY on bloxberg). A node takes the order when this covers its own price plus the fees the network adds to it: 5% for Ethernity, 2% for the validator, and the publishers' fees of the two images the task runs with (the trustedzone template's, 10% unless its publisher set another, and the securelock's, 0 unless its publisher set one), so a node asking 1 token is taken from a price of 2 with the default fees.

2. `cpu`: This specifies the amount of CPU (Central Processing Unit) resources required for the task. It indicates the computational power needed to execute the task's code.

3. `memory`: This indicates the amount of RAM memory required for the task's execution. It represents the storage space in RAM memory needed to run the task.

4. `storage`: This property represents the storage space needed for the task's execution. It indicates the amount of disk space required for the task.

5. `bandwidth`: This defines the amount of network bandwidth required for the task's execution. It represents the data transfer capacity needed to perform the task.

6. `duration`: This specifies the time duration or the maximum time allowed for the task's execution. It sets a time limit for how long the task can run.

7. `validators`: This property determines the number of validators required for the task. Validators are nodes on the network responsible for processing and validating tasks.

By providing these resource requirements in the `resources` object, the task execution engine (EthernityCloudRunner) can use this information to allocate the necessary resources and process the task accordingly on the selected network.

When no node places an order on the request within `options.orderWaitSeconds` (the sixth argument of `run`, default 1800), the runner cancels the request, which returns its escrow, and the task fails with `ECError.NO_NODE`. If a node booked the request just before the cancel, the cancel is refused by the contract and the task goes on with that node's order.

### Networks

The network is chosen by passing the network's token contract address (from `ECAddress`) as the first argument to the constructor. With no argument, the runner targets the **Bloxberg testnet**.

| Network | Type | Chain ID | Constructor address |
| --- | --- | --- | --- |
| Bloxberg | mainnet | 8995 | `ECAddress.BLOXBERG.MAINNET_ADDRESS` |
| Bloxberg | testnet | 8995 | `ECAddress.BLOXBERG.TESTNET_ADDRESS` |
| Polygon | mainnet | 137 | `ECAddress.POLYGON.MAINNET_ADDRESS` |
| Polygon Amoy | testnet | 80002 | `ECAddress.POLYGON.TESTNET_ADDRESS` |
| IoTeX | testnet | 4690 | `ECAddress.IOTEX.TESTNET_ADDRESS` |
| Ethereum Sepolia | testnet | 11155111 | `ECAddress.SEPOLIA.TESTNET_ADDRESS` |
| LitVM LiteForge | testnet | 4441 | `ECAddress.LITVM.TESTNET_ADDRESS` |

The constructor address is the token; the PoX contract the requests are posted to is the network's protocol address (`ECNetworkConfig[address].protocolAddress`). On Bloxberg mainnet the two are one proxy, so a request takes its escrow in the same transaction. On every other network, the Bloxberg testnet included since its PoX 2.0 of 2026-11-14 (`ECAddress.BLOXBERG.TESTNET_PROTOCOL_ADDRESS`, apart from the tETNY token), the PoX pulls the escrow with `transferFrom`, so a run first raises the wallet's allowance for it on the token when that is below the request's escrow, one approval transaction more. That step is the same code on every such network (`contract/operation/tokenAllowance.js`, called by the ETNY and the ECLD token contracts alike), chosen by the protocol address differing from the token address and never by the network's name, and approves exactly the escrow the PoX pulls: task price x validators x duration tokens for a legacy request (`contract/operation/requestTerms.js`, the defaults of the request's own arguments), the escrow of the terms for a request with `options.v2`. A resubmission after an operator fault raises the allowance to the escrow again. The runner reports the allowance it read, the approval it sends and its mining as events.

A testnet that has an ethernity-cas validator set -- Bloxberg testnet, LitVM LiteForge and Ethereum Sepolia -- comes in two kinds. The table's entry runs the securelock in an enclave the set attests, on nodes whose platform it can attest (DCAP), and the set validates the order in full, as on mainnet. Beside each is an `-unsafe` network, chosen by name with `await runner.setNetwork('BLOXBERG', 'TESTNET_UNSAFE')`, `('LITVM', 'TESTNET_UNSAFE')` or `('SEPOLIA', 'TESTNET_UNSAFE')`: the same chain and contracts, for hardware SGX platforms the CAS cannot attest (EPID-only, SGX1); its enclaves are debug-signed and self-signed from their measurement, so a result proves which image ran, not that an enclave ran it, and the validators judge such an order without the challenge-derived signer check. Its enclaves are the `*_TESTNET_UNSAFE` entries of `ECRunner` (see "Choosing the trustedzone"). Mainnet has no `-unsafe` network.

```javascript
import { ECAddress, ECRunner } from "@ethernity-cloud/runner/enums";

// Run on Polygon Amoy
const runner = new EthernityCloudRunner(ECAddress.POLYGON.TESTNET_ADDRESS);
// ...
await runner.run(resources, ECRunner.POLYGON.PYNITHY_RUNNER_TESTNET, code);
```

The `ECRunner` enclave-image enum is keyed by network, so use the entry matching the network you constructed the runner with (e.g. `ECRunner.IOTEX.PYNITHY_RUNNER_TESTNET`). Mainnet variants drop the `_TESTNET` suffix.

The IoTeX and LitVM testnets share a single ECLD token address, so the runner reads the chain ID from your wallet/provider to distinguish them — automatic with a browser wallet or an injected `provider`. Ethereum Sepolia has a token of its own, so the runner selects its RPC (`https://ethereum-sepolia-rpc.publicnode.com`) without an `rpcUrl`. On the raw-private-key path for IoTeX and LitVM, pass the chain ID as the **third** constructor argument and an `rpcUrl` in the wallet options:

```javascript
const runner = new EthernityCloudRunner(
    ECAddress.IOTEX.TESTNET_ADDRESS,
    { privateKey: "0x…", rpcUrl: "https://babel-api.testnet.iotex.io" },
    4690 // IoTeX Testnet chain ID
);
```

In this release the bootnode's payload intake serves the Bloxberg testnet, Polygon Amoy, LitVM LiteForge and Ethereum Sepolia (each with its -unsafe twin). On every other network in the table (Bloxberg mainnet, Polygon mainnet and IoTeX) a run needs `runner.initializeStorage(<your own Kubo RPC URL>)` before `run()` (see **Storage and the result read**); without it `run()` fails before any transaction is sent, with an error that says so.

### Requests served by claims (PoX 2.0 matching)

Before each request, and before anything of it is approved, the runner reads the network's PoX: its `VERSION()`, and its pricing's `matching()` (`pricingAddress()`, then the pricing's `matching()`), on every network whose PoX is apart from its token; on the bloxberg mainnet PoX, the token's own proxy, it reads nothing of them. A network whose PoX answers `VERSION()` "2.0" and whose pricing names a PoxMatching serves its requests by claims while PoxMatching's `claimsOn()` answers true (on a PoX answering another version the request is served without claims, which is told), and the runner reads the PoxMatchReader's address from PoxMatching's `reader()`; no descriptor names a PoxMatching. On every other network, the PoX 1.0 networks among them, and while claims are off, a request is added and approved as described above: with V2 terms when `options.v2` gives them with an `escrowWei` (`addDORequestV2` in the form `VERSION()` names: "2.0" with the minimum EPC, "1.2" without; refused on a PoX that answers neither), without terms when it gives no `escrowWei` (which is told) or no `options.v2`. On a network with PoxMatching a request pinned to a node that is banned is refused before it is sent, with the end of the ban, and the stored result of an order is read by the grammar of `spec/matching.md` section 17: one outside it carries no enclave transaction and is the operator's fault.

`options.v2` holds `maxPricePerCuHourWei`, the bid (1 to 2^128 - 1, required), `maxGflops` (the GFLOPS ceiling, 0), `relaysPerHour` (0) and `gasLevel` (1e18; 1e18 to 2^128 - 1) of the chain fee, and `escrowWei`, the escrow `addDORequestV2` pulls, on the claims path the most it may pull, the escrow itself being the reader's `escrowFor` at the request's terms; a request with V2 terms takes one instance (`validators` 1, more refused under claims), each of `cpu`, `memory`, `storage` and `bandwidth` 1 to 255 when given (left out, it takes its default) and a `duration` of 1 hour or more; on a PoX answering "2.0" the duration is at most the pricing's `maxOrderHours` and the GFLOPS ceiling at most its `gflopsMax`, both read before the request. Every term the PoX would refuse is refused before anything is sent, naming the PoX's revert string (`spec/matching.md` section 4); a metadata string of more than 2,048 bytes is refused after the approval and before the add. A request served by claims takes besides:

| Option | Meaning | Default |
|---|---|---|
| `options.v2.requiredGflops` | the GFLOPS the request requires, stated beside the ceiling `maxGflops` (one CU is 100 GFLOPS), at most a stated ceiling | 0, one CU |
| `options.v2.epcMiB` | the client's EPC figure in MiB, rounded up to units of 64 MiB; the request states the largest of one unit, the image's recorded need (`imageEpcUnits`) and this (also on a request with V2 terms while claims are off) | 0 |
| `options.v2.maxBidPerCuHourWei` | the bid ceiling a raise of the bid stays within, 1 to 2^128 - 1 | none: a raise is reported, not sent |
| `options.minNodeScore` | the minimum node score, in points (0.50); 0 switches the test off | see below |
| `options.recentFailureSlots` | a claimer whose last failed order is fewer slots ago is approved only when no other claim stands | 14 |
| `options.allowMarkedImage` | send a request for an image marked likely broken | false |
| `options.expireUnstarted`, `options.noteRefund`, `options.noteAmbiguous` | end an order not started 900 s after its approval; record an expired order against its node; send `noteAmbiguous` an hour after a result the validators have not noted | true |

Before the add the runner reads the trustedzone template's record, the image's health (a marked image is refused unless `allowMarkedImage` is set), the image's records in the image registry (`ECImageRegistryV4.imageRecords`: its kind, a default release and which, native Python or a custom securelock, whether its network is on, its enclave memory and its minimum operator score, all told to the client; an image its session name's newest version is not bound to is refused, naming the dApp's current image), the request's memory need (the larger of `memory` and the image's enclave memory) and minimum EPC, both told to the client, the quote at the request's terms (`bidQuoteFor`) and the escrow the add pulls (`escrowFor`), against which it checks the balance and raises the allowance; an escrow above `options.v2.escrowWei` is refused, as is an image registry that does not answer the EPC need's read and a metadata string of more than 2,048 bytes. After the add it reads the request once a block (the descriptor's `blockSeconds`; `runner.claimsPollMs` overrides it) on the parameter set `requestInfo` names while the request takes claims (its set has claims on, the storage holds it AVAILABLE and it is at most `maxRequestAgeSeconds` old: a request past its age is cancelled, and one whose set has claims off is waited for and approved as described above), waits for each of its transactions with the runner's receipt poll (a receipt of a status other than 1 is no success), approves a claim by the design's rule (3.10), the node mandated for the step first, an in-time claim before a late one, a mandated node that can no longer claim (`canClaimOf`) passed over at once, and raises the bid to the quote's lowest matching bid within `maxBidPerCuHourWei` when no claim it would approve can come. The minimum score is `minNodeScore` when set; else the dApp's minimum operator score its records hold, 0 switching the test off; else, for a dApp of the default class, 0.50 once the network's first node reached 1.00 (`minimumOn()`); else the top tier of the request's round (`tierScore`). The runner passes over the nodes of its local list (two of its orders of the dApp on the node ended in 20, 62, a 33 before its time, 59 or 63 within 7 days; PoxMatching's `early33` judges a 33) and, for a paid class, those the image's counted failures of the last 7 days name. What it tells the client is dispatched as events and kept in `runner.matchingNotices`; a code 20, 62, 44, 47, 59 or 63, or a 33 before its time (settled as a 62), is reported by the class the result states, in `getLastError()`. An expiry the PoX does not admit yet and a `noteAmbiguous` due later are kept in `runner.matchingPending` and sent by `await runner.settleMatching()`, which a later request served by claims calls before its add.

### Wallet options

The second constructor argument chooses the wallet: `{ privateKey, rpcUrl }` signs with a raw key on the network's RPC (or `rpcUrl`); `{ signer }` and/or `{ provider }` use a wallet you already hold; with neither, the runner uses the browser wallet at `window.ethereum`. `encryptionPublicKey` (hex) supplies the key results are encrypted to when the wallet cannot answer `eth_getEncryptionPublicKey`. The runner is built on ethers 6, so a `signer` or `provider` you pass must be an ethers 6 object; with a provider alone, the runner asks it for its account the first time it needs one.

### Storage and the result read

A task's artefacts (the encrypted challenge and code, and a session's inputs) are delivered through the bootnode's payload intake by default: the runner computes their CIDs locally and, once the DO request is on chain, POSTs the bytes to `https://ipfs.ethernity.cloud/payload/<network>/<doRequestId>/<cid>`, which takes no token. The intake serves the networks the bootnode's agent runs, and the runner routes to it the Bloxberg testnet and LitVM LiteForge, each with its -unsafe twin: on every other network (Bloxberg mainnet, Polygon mainnet, Polygon Amoy, IoTeX and Sepolia) `run()` fails before any transaction is sent, until a storage is configured. On the Bloxberg testnet, `runner.initializePublicIntake(baseUrl)` selects the intake explicitly, at another base URL when needed.

`initializeStorage` delivers through an IPFS API of your own instead, as a URL or as host, protocol and port, and takes precedence over the intake:

```javascript
// Your own Kubo RPC API.
runner.initializeStorage('http://127.0.0.1:5001');
// The same, by host.
runner.initializeStorage('127.0.0.1', 'http', 5001);
// The public API, which answers add and pin with 403 without a writer token.
// The token is sent as given in the Authorization header of every request.
runner.initializeStorage('https://ipfs.ethernity.cloud', undefined, undefined, writerToken);
```

A result is read from the configured endpoint first and from the public gateway `https://ipfs.io` second, without credentials; each request is abandoned after 60 seconds, and the read is repeated until the order's deadline (its duration plus 15 minutes, and at least two minutes after it closed) before the task is reported as `IPFS download result error`.
