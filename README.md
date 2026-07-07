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
    const ipfsAddress = 'https://ipfs.ethernity.cloud';
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
    runner.initializeStorage(ipfsAddress);

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

### Task resources

```javascript
 const resources = { taskPrice: 10, cpu: 1, memory: 1, storage: 40, bandwidth: 1, duration: 1, validators: 1 };
```
The `resources` parameter is the **first** argument to the `run` method and is an object that defines the resource requirements for executing a new task using the Python/Node.js template. It specifies the amount of various resources needed for the task to be processed on the EthernityCloud network. The `resources` object contains the following properties:

1. `taskPrice`: This represents the price in tETNY that a user is willing to pay for the task execution. It determines the priority and readiness of the task for processing.

2. `cpu`: This specifies the amount of CPU (Central Processing Unit) resources required for the task. It indicates the computational power needed to execute the task's code.

3. `memory`: This indicates the amount of RAM memory required for the task's execution. It represents the storage space in RAM memory needed to run the task.

4. `storage`: This property represents the storage space needed for the task's execution. It indicates the amount of disk space required for the task.

5. `bandwidth`: This defines the amount of network bandwidth required for the task's execution. It represents the data transfer capacity needed to perform the task.

6. `duration`: This specifies the time duration or the maximum time allowed for the task's execution. It sets a time limit for how long the task can run.

7. `validators`: This property determines the number of validators required for the task. Validators are nodes on the network responsible for processing and validating tasks.

By providing these resource requirements in the `resources` object, the task execution engine (EthernityCloudRunner) can use this information to allocate the necessary resources and process the task accordingly on the selected network.

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

```javascript
import { ECAddress, ECRunner } from "@ethernity-cloud/runner/enums";

// Run on Polygon Amoy
const runner = new EthernityCloudRunner(ECAddress.POLYGON.TESTNET_ADDRESS);
// ...
await runner.run(resources, ECRunner.POLYGON.PYNITHY_RUNNER_TESTNET, code);
```

The `ECRunner` enclave-image enum is keyed by network, so use the entry matching the network you constructed the runner with (e.g. `ECRunner.IOTEX.PYNITHY_RUNNER_TESTNET`). Mainnet variants drop the `_TESTNET` suffix.

The IoTeX, Sepolia, and LitVM testnets share a single ECLD token address, so the runner reads the chain ID from your wallet/provider to distinguish them — automatic with a browser wallet or an injected `provider`. On the raw-private-key path, pass the chain ID as the **third** constructor argument and an `rpcUrl` in the wallet options:

```javascript
const runner = new EthernityCloudRunner(
    ECAddress.IOTEX.TESTNET_ADDRESS,
    { privateKey: "0x…", rpcUrl: "https://babel-api.testnet.iotex.io" },
    4690 // IoTeX Testnet chain ID
);
```
