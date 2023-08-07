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

    const onTaskCreated = (e) => {
        console.log('Task published.');
    };

    const onTaskOrderPlaced = () => {
        console.log('Task order placed and approved, started processing.');
    };

    const onTaskProgress = (e) => {
        if (e.detail.status === ECStatus.ERROR) {
            console.error(e.detail.message);
        } else {
            console.log(e.detail.message);
        }
    };

    const onTaskNotProcessed = (e) => {
        console.log('Task processing failed due to unavailability of nodes. The network is currently busy. Please consider increasing the task price.');
    };

    const onTaskCompleted = (e) => {
        console.log(`Task Result: ${e.detail.message.result}; Task code: ${e.detail.message.resultTaskCode}`);
    }

    const runner = new EthernityCloudRunner();
    runner.initializeStorage(ipfsAddress);

    runner.addEventListener(ECEvent.TASK_CREATED, onTaskCreated);
    runner.addEventListener(ECEvent.TASK_ORDER_PLACED, onTaskOrderPlaced);
    runner.addEventListener(ECEvent.TASK_PROGRESS, onTaskProgress);
    runner.addEventListener(ECEvent.TASK_NOT_PROCESSED, onTaskNotProcessed);
    runner.addEventListener(ECEvent.TASK_COMPLETED, onTaskCompleted);

    const resources = { taskPrice: 10, cpu: 1, memory: 1, storage: 40, bandwidth: 1, duration: 1, validators: 1 };
    // this will execute a new task using Python template and will run the code provided above 
    // the code will run on the TESTNET network
    await runner.run(ECRunner.PYNITHY_RUNNER_TESTNET, code, '', resources);
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

   **1. Task Created Event (`ECEvent.TASK_CREATED`):**
   
   The `ECEvent.TASK_CREATED` event is triggered when a new task is successfully created and published on the network. This event signifies that the task has been registered and is ready for processing. Developers can define a function, such as `onTaskCreated`, to handle this event and execute any actions required upon task creation.
   
   In the provided example code:
   
   ```javascript
   const onTaskCreated = (e) => {
       console.log('Task published.');
   };
   
   runner.addEventListener(ECEvent.TASK_CREATED, onTaskCreated);
   ```
   
   The `onTaskCreated` function simply logs the message "Task published." to the console, indicating that the task has been successfully created and registered on the EthernityCloud network.
   
   **2. Task Order Placed Event (`ECEvent.TASK_ORDER_PLACED`):**
   
   The `ECEvent.TASK_ORDER_PLACED` event is triggered when an order for task processing is placed and approved by the network. This event indicates that the task execution is about to begin. Developers can define a function, such as `onTaskOrderPlaced`, to handle this event and perform any necessary actions when the task order is placed.
   
   In the provided example code:
   
   ```javascript
   const onTaskOrderPlaced = () => {
       console.log('Task order placed and approved, started processing.');
   };
   
   runner.addEventListener(ECEvent.TASK_ORDER_PLACED, onTaskOrderPlaced);
   ```
   
   The `onTaskOrderPlaced` function logs the message "Task order placed and approved, started processing." to the console, signaling that the task execution process has commenced.
   
   **3. Task Not Processed Event (`ECEvent.TASK_NOT_PROCESSED`):**
   
   The `ECEvent.TASK_NOT_PROCESSED` event is triggered when a task fails to be processed due to unavailability of nodes or when the network is currently busy or when the resource requirements are not met. This event indicates that the task execution encountered an issue and could not proceed. Developers can define a function, such as `onTaskNotProcessed`, to handle this event and respond appropriately to the failed task processing.
   
   In the provided example code:
   
   ```javascript
   const onTaskNotProcessed = (e) => {
       console.log('Task processing failed due to unavailability of nodes. The network is currently busy. Please consider increasing the task price.');
   };
   
   runner.addEventListener(ECEvent.TASK_NOT_PROCESSED, onTaskNotProcessed);
   ```
   
   The `onTaskNotProcessed` function logs the error message "Task processing failed due to unavailability of nodes. The network is currently busy. Please consider increasing the task price." to the console, providing information about the reason for the task processing failure. This message can be used to inform the user or perform any necessary error handling.
   
   **4. Task Progress Event (`ECEvent.TASK_PROGRESS`):**

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

   **5. Task Completed Event (`ECEvent.TASK_COMPLETED`):**

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

### Task resources

```javascript
 const resources = { taskPrice: 10, cpu: 1, memory: 1, storage: 40, bandwidth: 1, duration: 1, validators: 1 };
```
The `resources` parameter provided in the `run` method as the last parameter is an object that defines the resource requirements for executing a new task using the Python/Node.js template. It specifies the amount of various resources needed for the task to be processed on the EthernityCloud network. The `resources` object contains the following properties:

1. `taskPrice`: This represents the price in tETNY that a user is willing to pay for the task execution. It determines the priority and readiness of the task for processing.

2. `cpu`: This specifies the amount of CPU (Central Processing Unit) resources required for the task. It indicates the computational power needed to execute the task's code.

3. `memory`: This indicates the amount of RAM memory required for the task's execution. It represents the storage space in RAM memory needed to run the task.

4. `storage`: This property represents the storage space needed for the task's execution. It indicates the amount of disk space required for the task.

5. `bandwidth`: This defines the amount of network bandwidth required for the task's execution. It represents the data transfer capacity needed to perform the task.

6. `duration`: This specifies the time duration or the maximum time allowed for the task's execution. It sets a time limit for how long the task can run.

7. `validators`: This property determines the number of validators required for the task. Validators are nodes on the network responsible for processing and validating tasks.

By providing these resource requirements in the `resources` object, the task execution engine (EthernityCloudRunner) can use this information to allocate the necessary resources and process the task accordingly on the specified TESTNET network.
