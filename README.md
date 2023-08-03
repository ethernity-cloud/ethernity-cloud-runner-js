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

Currently, there are two networks for using Ethernity Cloud. Please set up your wallet for the desired network following
one of the articles below:

- OpenBeta Network on bloxberg
- TestNet Network on bloxberg
- MainNet Network on Polygon

### 4. Code execution

To execute a new task using the Ethernity Cloud Runner, follow the straightforward template provided below. Simply
insert your desired code into the designated section, and the runner will handle the rest, interacting with the IPFS
network and processing the task accordingly.

```javascript
import EthernityCloudRunner from "@ethernity-cloud/runner";
import {ECRunner, ECStatus, ECEvent} from "@ethernity-cloud/runner/enums";

const executeTask = async () => {
    const ipfsAddress = 'https://ipfs.ethernity.cloud:5001';
    const code = `___etny_result___("Hello, World!")`;

    const onTaskProgress = (e) => {
        if (e.detail.status === ECStatus.ERROR) {
            console.error(e.detail.message);
        } else {
            console.log(e.detail.message);
        }
    };

    const onTaskCompleted = (e) => {
        console.log(`Task Result: ${e.detail.message.result}`);
    }

    const runner = new EthernityCloudRunner();
    runner.initializeStorage(ipfsAddress);

    runner.addEventListener(ECEvent.TASK_PROGRESS, onTaskProgress);
    runner.addEventListener(ECEvent.TASK_COMPLETED, onTaskCompleted);

    // this will execute a new task using Python template and will run the code provided above 
    // the code will run on the TESTNET network
    await runner.run(ECRunner.PYNITHY_RUNNER_TESTNET, code);
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

   In the Ethernity Cloud Runner integration, events play a crucial role in providing real-time feedback and updates
   during the execution of tasks. By subscribing to these events, developers can monitor the progress and completion
   status of their tasks.

   **1. Task Progress Event (`ECEvent.TASK_PROGRESS`):**

   The `ECEvent.TASK_PROGRESS` event is triggered when there is progress in the execution of a task. To capture and
   handle this event, developers can define a function, such as `onTaskProgress`, to process the event data. The event
   object, `e`, provides access to the event detail, which contains information about the task's current status.

   In the example code provided:

   ```javascript
   const onTaskProgress = (e) => {
       if (e.detail.status === ECStatus.ERROR) {
           console.error(e.detail.message);
       } else {
           console.log(e.detail.message);
       }
   };
   
   runner.addEventListener(ECEvent.TASK_PROGRESS, onTaskProgress);
   ```

   The `onTaskProgress` function receives the event object `e`, and it checks the `e.detail.status` to determine if the
   task encountered an error or if it is progressing successfully. If an error is detected, the function logs the error
   message to the console using `console.error`, otherwise, it logs the progress message using `console.log`.

   **2. Task Completed Event (`ECEvent.TASK_COMPLETED`):**

   The `ECEvent.TASK_COMPLETED` event is triggered when a task is successfully completed. Similar to the previous event,
   developers can define a function, such as `onTaskCompleted`, to handle the event and access the task result.

   In the example code provided:

   ```javascript
   const onTaskCompleted = (e) => {
       console.log(`Task Result: ${e.detail.message.result}`);
   }
   
   runner.addEventListener(ECEvent.TASK_COMPLETED, onTaskCompleted);
   ```

   The `onTaskCompleted` function receives the event object `e`, and it accesses the task result
   from `e.detail.message.result`. The function then logs the result to the console, providing developers with the
   outcome of the completed task.

   By subscribing to these events, developers can stay informed about the execution progress and results of tasks,
   enabling them to monitor and respond to task executions effectively. The Ethernity Cloud Runner's event system
   enhances the developer experience, allowing for seamless integration and handling of task-related events in
   real-time.
