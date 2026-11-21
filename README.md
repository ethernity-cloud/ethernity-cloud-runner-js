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
    // bootnode's payload intake: no storage call is needed. A network the
    // intake does not serve (see "Storage and the result read") needs your
    // own Kubo RPC API, which also replaces the intake here:
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
| Bloxberg, PoX 1.0 | testnet | 8995 | `ECAddress.BLOXBERG.TESTNET_POX10_ADDRESS` |
| Polygon | mainnet | 137 | `ECAddress.POLYGON.MAINNET_ADDRESS` |
| Polygon Amoy | testnet | 80002 | `ECAddress.POLYGON.TESTNET_ADDRESS` |
| Polygon Amoy, PoX 1.0 | testnet | 80002 | `ECAddress.POLYGON.TESTNET_ADDRESS`, then `setNetwork('POLYGON', 'AMOY_POX10')` |
| IoTeX | testnet | 4690 | `ECAddress.IOTEX.TESTNET_ADDRESS` |
| Ethereum Sepolia | testnet | 11155111 | `ECAddress.SEPOLIA.TESTNET_ADDRESS` |
| LitVM LiteForge | testnet | 4441 | `ECAddress.LITVM.TESTNET_ADDRESS` |

The constructor address is the token; the PoX contract the requests are posted to is the network's protocol address (`ECNetworkConfig[address].protocolAddress`). On Bloxberg mainnet, and on the Bloxberg testnet's PoX 1.0 network, the two are one proxy, so a request takes its escrow in the same transaction. On every other network, the Bloxberg testnet included since its PoX 2.0 of 2026-11-14 (`ECAddress.BLOXBERG.TESTNET_PROTOCOL_ADDRESS`, apart from the tETNY token), the PoX pulls the escrow with `transferFrom`, so a run first raises the wallet's allowance for it on the token when that is below the request's escrow, one approval transaction more. That step is the same code on every such network (`contract/operation/tokenAllowance.js`, called by the ETNY and the ECLD token contracts alike), chosen by the protocol address differing from the token address and never by the network's name, and approves exactly the escrow the PoX pulls: task price x validators x duration tokens for a legacy request (`contract/operation/requestTerms.js`, the defaults of the request's own arguments), the escrow of the terms for a request with `options.v2`. A resubmission after an operator fault raises the allowance to the escrow again. The runner reports the allowance it read, the approval it sends and its mining as events.

A testnet that has an ethernity-cas validator set -- Bloxberg testnet, LitVM LiteForge and Ethereum Sepolia -- comes in two kinds. The table's entry runs the securelock in an enclave the set attests, on nodes whose platform it can attest (DCAP), and the set validates the order in full, as on mainnet. Beside each is an `-unsafe` network, chosen by name with `await runner.setNetwork('BLOXBERG', 'TESTNET_UNSAFE')`, `('LITVM', 'TESTNET_UNSAFE')` or `('SEPOLIA', 'TESTNET_UNSAFE')`: the same chain and contracts, for hardware SGX platforms the CAS cannot attest (EPID-only, SGX1); its enclaves are debug-signed and self-signed from their measurement, so a result proves which image ran, not that an enclave ran it, and the validators judge such an order without the challenge-derived signer check. Its enclaves are the `*_TESTNET_UNSAFE` entries of `ECRunner` (see "Choosing the trustedzone"). Mainnet has no `-unsafe` network.

The Bloxberg testnet and Polygon Amoy each have a PoX 1.0 network beside the testnet of the table: a copy of the mainnet's PoX 1.0 contracts on the testnet's chain (`ECPox10TestnetConfig`), which the runner uses as it uses that mainnet. The network's type, in `setNetwork()` and in the entries of `ECNetwork`, `ECNetworkByChainId`, `ECAddress` and `ECRunner`, is `TESTNET_POX10` under `BLOXBERG` and `AMOY_POX10` under `POLYGON`. Its enclaves are the `*_RUNNER_TESTNET_POX10` entries of `ECRunner.BLOXBERG` (`etny-pynithy-testnet-pox10`, `etny-nodenithy-testnet-pox10`) and the `*_RUNNER_AMOY_POX10` entries of `ECRunner.POLYGON` (`ecld-pynithy-amoy-pox10`, `ecld-nodenithy-amoy-pox10`); the runner runs them on their PoX 1.0 network and nowhere else, and runs no other trustedzone there.

- Bloxberg's PoX 1.0 network is paid in a token of its own, tE10, which is also its PoX, as ETNY is on Bloxberg mainnet. The token address names the network: `new EthernityCloudRunner(ECAddress.BLOXBERG.TESTNET_POX10_ADDRESS)`. tE10 has no faucet: a wallet receives it by a transfer from the owner of the network's contracts, and a run from a wallet short of the request's escrow ends, before any transaction, with the amount the wallet lacks.
- Polygon Amoy's PoX 1.0 network is paid in the test ECLD the Amoy testnet of the table is paid in, on the same chain, so the token address alone names the table's testnet. Construct the runner with `ECAddress.POLYGON.TESTNET_ADDRESS` and name the network: `await runner.setNetwork('POLYGON', 'AMOY_POX10')`. `setNetwork('POLYGON', 'TESTNET')` puts the runner back on the table's testnet. A run from a wallet that is short of the request's escrow and holds less than 100 tECLD draws the token's faucet (1000 tECLD) first, one transaction more.

These two addresses are the only ones a runner on a PoX 1.0 network is constructed with. `ECAddress.POLYGON` holds no token address for Amoy's PoX 1.0 network: `ECAddress.POLYGON.AMOY_POX10_PROTOCOL_ADDRESS` is its PoX, which the runner selects itself, and `('POLYGON', 'TESTNET_POX10')` is not a name `setNetwork()` takes. The constructor takes an address that is `undefined`, such as an `ECAddress` entry that does not exist, as no argument: the runner is then on the Bloxberg testnet.

`setNetwork('BLOXBERG', 'TESTNET_POX10')` is taken on a runner constructed with `ECAddress.BLOXBERG.TESTNET_POX10_ADDRESS` and changes nothing there. Neither PoX 1.0 network has an intake route: a run needs `runner.initializeStorage(<your own Kubo RPC URL>)` before `run()`. The storage is shared by every runner of the process (the page, the Node process), and the intake a run on the table's testnet takes by default does not serve the PoX 1.0 network: a run there is refused before any transaction until `initializeStorage()` sets an IPFS API, which serves both. A PoX 1.0 network takes legacy requests alone: a run with `options.v2` is refused before any transaction. Each is on one chain (8995, 80002): a run from a wallet on another chain is refused with both chain ids.

A runner has one queue of operations. `setNetwork()` called while a run, a session start, an attach or the task of `esrRead()` is queued or in flight on the runner takes its turn in that queue: the operations called before it run to their end on the network they started on, the ones called after it run on the network it names, and its promise resolves, or rejects with the refusal, when its turn has come. With nothing queued or in flight it applies in the call.

A request is never made with the enclave details of another network or of another trustedzone. A run, a session start and an attach read the securelock's image and the trustedzone's certificate from the image registry of the network in effect; when that registry does not answer, a runner that holds details it read on another network ends the operation, before the allowance and the request (on Polygon Amoy's PoX 1.0 network the balance check that precedes the registry read may have drawn the faucet). A run and a session start then go on with the details the runner holds when it read them on this network for the trustedzone in effect. When it read them for another trustedzone of the network (the -unsafe twin `setNetwork()` names on the same network descriptor, a run that names the other service type), whose certificate is not the one the request's trustedzone decrypts with, or holds none, they end at the same point. An attach goes on, and its handle takes the certificate the runner read on the session's network for the session's trustedzone (below). The task of `esrRead()` is prepared the same way, with the securelock, the node and the trustedzone of the runner's last request: the trustedzone is judged for the network, the enclave details are read again from its image registry, the node is verified on it when it was verified on another network, and the allowance is raised for its PoX. A registry that does not answer is passed over when the details the runner holds were read on this network for this trustedzone; otherwise, and when the runner has made no request, the read ends before any transaction.

A session handle keeps the network it was opened on, its PoX and its trustedzone's certificate, whatever network the runner is named onto afterwards. The certificate is one the runner read on the session's network for the session's trustedzone: the handle takes it when it is made or, when the runner has read none by then (a handle attached without the securelock), the first time it needs it after the runner has, whatever the runner has read for another network or trustedzone in between. Until then the handle sends no input and delivers no output; the runner reads it by `attachSession(orderId, secureLockEnclave)` or by a run with the session's securelock, and the outputs written meanwhile are delivered then. A handle made without its trustedzone, `new EthernityCloudSession(runner, orderId)` or `EthernityCloudSession.create(runner, orderId)`, is a handle of the trustedzone the runner's enclave details were last read for on the handle's network, taken with that read's certificate when the handle is made or, when the runner has read none there by then, the first time the handle needs its certificate after the runner has; until then it holds neither, and waits as above.

```javascript
import { ECAddress, ECRunner } from "@ethernity-cloud/runner/enums";

// Run on Polygon Amoy
const runner = new EthernityCloudRunner(ECAddress.POLYGON.TESTNET_ADDRESS);
// ...
await runner.run(resources, ECRunner.POLYGON.PYNITHY_RUNNER_TESTNET, code);

// Run on Polygon Amoy's PoX 1.0 network: the securelock published there
// (securelock), against the trustedzone it was built with.
const runner10 = new EthernityCloudRunner(ECAddress.POLYGON.TESTNET_ADDRESS);
await runner10.setNetwork('POLYGON', 'AMOY_POX10');
runner10.initializeStorage('http://127.0.0.1:5001');
// ...
await runner10.run(resources, securelock, code, '', ECRunner.POLYGON.PYNITHY_RUNNER_AMOY_POX10);
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

In this release the bootnode's payload intake serves the Bloxberg testnet, Polygon Amoy, LitVM LiteForge and Ethereum Sepolia (each with its -unsafe twin). On every other network in the table (Bloxberg mainnet, Polygon mainnet, IoTeX and the two PoX 1.0 testnet networks) a run needs `runner.initializeStorage(<your own Kubo RPC URL>)` before `run()` (see **Storage and the result read**); without it `run()` fails before any transaction is sent, with an error that says so, also when the storage in effect is the intake a run on another network took.

### Wallet options

The second constructor argument chooses the wallet: `{ privateKey, rpcUrl }` signs with a raw key on the network's RPC (or `rpcUrl`); `{ signer }` and/or `{ provider }` use a wallet you already hold; with neither, the runner uses the browser wallet at `window.ethereum`. `encryptionPublicKey` (hex) supplies the key results are encrypted to when the wallet cannot answer `eth_getEncryptionPublicKey`. The runner is built on ethers 6, so a `signer` or `provider` you pass must be an ethers 6 object; with a provider alone, the runner asks it for its account the first time it needs one.

### Storage and the result read

A task's artefacts (the encrypted challenge and code, and a session's inputs) are delivered through the bootnode's payload intake by default: the runner computes their CIDs locally and, once the DO request is on chain, POSTs the bytes to `https://ipfs.ethernity.cloud/payload/<network>/<doRequestId>/<cid>`, which takes no token. The intake serves the networks the bootnode's agent runs, and the runner routes to it the Bloxberg testnet, Polygon Amoy, LitVM LiteForge and Ethereum Sepolia, each with its -unsafe twin: on every other network (Bloxberg mainnet, Polygon mainnet, IoTeX and the two PoX 1.0 testnet networks) `run()` fails before any transaction is sent, until `initializeStorage` sets an IPFS API.

The storage is one per process (the page, the Node process), shared by every runner in it. The first run that finds none takes the public intake, which stays the storage from then on. `<network>` in the POST is the route of the run's own network, whichever run or runner set the intake: runners on several routed networks deliver through the one intake, each under its own network's route, also when they run at once, and a session's inputs go under the route of the session's network. `runner.initializePublicIntake(baseUrl)`, taken on a routed network, makes the intake at `baseUrl` the storage of the process: every run on a routed network then delivers to it under its own route. A storage call, `initializePublicIntake()` or `initializeStorage()`, by any runner at any time drops nothing: the artefacts a run has sealed and not yet delivered go to the intake they were sealed for, and those a run added to an IPFS API stay there, nothing of them going to an intake set after them, so an application may call either before every run.

`initializeStorage` delivers through an IPFS API of your own instead, as a URL or as host, protocol and port. It takes precedence over the intake and serves every network, for every runner of the process:

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
