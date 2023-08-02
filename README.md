<p align="center">
  <a href="https://ethernity.cloud" title="Ethernity Cloud">
    <img src="https://ethernity.cloud/images/dark_gradient_logo.svg" alt="Ethernity Cloud logo" width="244" />
  </a>
</p>

<h3 align="center">The JavaScript implementation of the Ethernity CLOUD protocol</h3>

### Installation

To begin developing with the Ethernity Cloud Runner, you can easily set up your environment by installing the package using npm:

```console
$ npm install @ethernity-cloud/runner --save
```

This command will install the Ethernity Cloud Runner package and save it as a dependency in your project. With the package installed, you're ready to start utilizing the Ethernity Cloud Runner functionality and explore its capabilities for your application development.

Executing a new task is as simple as using the template below:

```javascript
import EthernityCloudRunner from "@ethernity-cloud/runner";
import {ECRunner} from "@ethernity-cloud/runner/enums";

const ipfsAddress = 'https://ipfs.ethernity.cloud:5001';
// please make sure that for python code you have to preserve indentation
const pythonCode = `
def sum(a, b):
    return a + b        
a=1
b=10        
___etny_result___(str(sum(a, b)))`;
const runner = new EthernityCloudRunner();
runner.initializeStorage(ipfsAddress);
// this will execute a new task using Python template and will run the code provided in pythonCode 
// the code will run on the TESTNET network
await runner.run(ECRunner.PYNITHY_RUNNER_TESTNET, pythonCode);
```

## 1. Developer Guide for Ethernity CLOUD

Welcome to the Developer Guide section, where we provide you with essential steps and preparations to create an optimal working environment for unlocking the full potential of Ethernity Cloud and Web3. Our comprehensive and user-friendly tutorial will smoothly walk you through the entire process of sending tasks for execution on the powerful Ethernity Cloud ecosystem. Get ready to embark on an exciting journey of exploration and innovation!

### 1.1 Environment Prerequisites

#### 1.1.1 IDE
For a streamlined development process, we recommend using Visual Studio Code—a powerful and versatile code editor that offers a seamless experience for developers. You can download Visual Studio Code from the official [website](https://code.visualstudio.com/.).

After running the IDE, a new workspace will be created, where you can start developing the framework and code.

#### 1.1.2 Framework
Using a Terminal within the IDE workspace, follow these steps to set up your framework of choice.

**Node.js:**
Node.js is an open-source, server-side JavaScript runtime environment that allows developers to execute JavaScript code outside of a web browser. It uses an event-driven, non-blocking I/O model, making it highly efficient and suitable for building scalable and real-time applications.

Install Node.js on your local machine by following the instructions provided here: [Node.js Download](https://nodejs.dev/en/download/).

**React:**
React is an open-source JavaScript library for building user interfaces, particularly for creating interactive and dynamic web applications.

With its popularity and strong ecosystem, React has become a widely adopted choice for front-end development, empowering developers to create modern, scalable, and responsive web applications.

For more details and a how to start guide please check their official [website](https://react.dev/)

#### 1.1.3 Wallet Setup
A wallet is a crucial tool within the Ethernity Cloud ecosystem, empowering users to securely store and transfer their data for processing. As a developer, having a Web3 dApp testing wallet is necessary.

The wallet setup process with Metamask is detailed here: [Getting started with MetaMask](https://support.metamask.io/hc/en-us/articles/360015489531-Getting-started-with-MetaMask).

Currently, there are two networks for using Ethernity Cloud. Please set up your wallet for the desired network following one of the articles below:
- OpenBeta Network on bloxberg
- TestNet Network on bloxberg
- MainNet Network on Polygon

#### 1.1.4 Web3 Development Libraries
To unleash the full potential of dApps utilizing Ethernity CLOUD smart contracts, a set of essential libraries is required. These libraries play a crucial role in ensuring that input data is appropriately formatted, encrypted, signed, and seamlessly sent to the protocol. Additionally, they enable the decryption and verification of signatures for the protocol results.

Until an SDK becomes available, we recommend integrating these powerful libraries into your development process to have the necessary tools to interact with Ethernity CLOUD smart contracts efficiently and securely. These libraries serve as the backbone of your dApp, facilitating seamless communication with the protocol and ensuring the integrity of the exchanged data.

**EthersJS:**
EthersJS is a popular JavaScript library for interacting with the Ethereum blockchain. It provides a powerful set of tools and utilities to handle Ethereum transactions, smart contracts, and wallet management, making it easier for developers to build decentralized applications (dApps) and work with the Ethereum network.

Link: [EthersJS Documentation](https://docs.ethers.org/v5/)
Install: `npm install ethers --save`

**Node-forge:**
Node-forge is a JavaScript library that provides cryptographic functionalities in Node.js and web browsers. It offers a wide range of cryptographic tools, including encryption, decryption, digital signatures, hashing, and more, making it useful for securely handling data and implementing secure communication protocols in web applications and server-side environments.

Link: [Node-forge on npm](https://www.npmjs.com/package/node-forge)
Install: `npm install node-forge --save`

**jsrsasign:**
jsrsasign is an npm package for Node.js and web browsers that provides a comprehensive set of tools for working with JSON Web Tokens (JWT) and various cryptographic operations, such as RSA, ECDSA, and hashing algorithms or working with certificates like X509. It offers an easy-to-use API for generating, signing, verifying, and parsing JWTs, making it a valuable library for implementing secure authentication and data integrity mechanisms in web applications and server-side environments.

Link: [jsrsasign on npm](https://www.npmjs.com/package/jsrsasign)
Install: `npm install jsrsasign --save`

**elliptic:**
Elliptic is an npm package for Node.js and web browsers that provides a straightforward and efficient API for performing elliptic curve cryptography operations. It allows developers to work with cryptographic primitives like generating key pairs, signing messages, and verifying signatures using elliptic curve algorithms. This library is commonly used in blockchain applications, digital signatures, and other cryptographic systems that benefit from the security and performance advantages of elliptic curve cryptography.

Link: [elliptic on npm](https://www.npmjs.com/package/elliptic)
Install: `npm install elliptic --save`

**js-sha256:**
js-sha256 is an npm package for Node.js and web browsers that provides a simple and efficient API for generating SHA-256 cryptographic hashes. It allows developers to compute SHA-256 hashes of data, such as strings or binary data, making it useful for securely storing and verifying data integrity in various applications, including blockchain, password hashing, and digital signatures.

Link: [js-sha256 on npm](https://www.npmjs.com/package/js-sha256)
Install: `npm install js-sha256 --save`

**ipfs-http-client:**
ipfs-http-client is an npm package that provides a JavaScript API for interacting with the IPFS (InterPlanetary File System) network over HTTP. It allows developers to upload, download, and manage files on the IPFS network, enabling decentralized and distributed file storage and retrieval. With ipfs-http-client, developers can easily integrate IPFS functionality into their web applications and server-side projects, leveraging the benefits of a peer-to-peer, content-addressable file system.

Link: [ipfs-http-client on npm](https://www.npmjs.com/package/ipfs-http-client)
Install: `npm install ipfs-http-client --save`

### 1.2 Step by step guide
**1.2.1. Project Setup**

To initiate the creation of a new React app using `npx create-react-app`, follow these steps:

1. Ensure that you have Node.js and npm (Node Package Manager) installed on your system.

2. Open your terminal or command prompt.

3. Execute the following command:
```
npx create-react-app my-app
```
Replace "my-app" with your desired name for the React app. This command will establish a new directory named "my-app" and configure a basic React application structure within it.

4. After the process completes, navigate to the newly created directory:
```
cd my-app
```

5. Launch the development server:
```
npm start
```
This action will start the development server and automatically open your React app in a web browser. You can now commence building your React application by making changes to the files within the "src" directory.

Utilizing `npx create-react-app` presents a swift and straightforward method for initializing a new React project with all the essential configurations and dependencies, freeing you to concentrate on developing your app without concerning yourself with the initial setup.

**1.2.2. Libraries Inclusion**

The Ethernity Cloud Runner relies on several libraries to interact with the blockchain, decentralized storage, and perform cryptographic operations. Ensure you include the following libraries in your project:

- `buffer`: This library provides a buffer object used for working with binary data.
- `node-forge`: The node-forge library is used for AES-GCM encryption.
- `elliptic`: The elliptic library is utilized for elliptic curve cryptography.
- `js-sha256`: The js-sha256 library is used for SHA-256 hashing.
- `jsrsasign`: The jsrsasign library is used for X.509 certificate handling.
- `ascii`: This is a custom module to handle ASCII encoding.
- `ipfs-http-client`: This library is used for interacting with the IPFS decentralized storage system.

In order to install them you can use the following command:
```shell
npm install buffer node-forge elliptic js-sha256 jsrsasign ipfs-http-client --save
```

**1.2.3. Connecting to Blockchain**

The Ethernity Cloud Runner needs to connect to the blockchain to interact with smart contracts. It uses the EtnyContract class to initialize the provider and obtain access to the smart contract functionalities. The Ethernity Cloud smart contract provides methods to manage the execution and approval of tasks within the Ethernity Cloud Runner platform.To connect to the blockchain:

- Call `etnyContract.initialize()` to set up the blockchain provider.
- Use `connectToMetaMaskAndSign()` to connect to MetaMask, enabling the Runner to sign transactions and interact with the blockchain.

**1.2.4. Connecting to Decentralized Storage**

The IPFS client is initialized with the `ipfs-http-client` library in the constructor of the `EthernityCloudRunner` class. This allows the runner to interact with the IPFS network to store and retrieve data.
In order to instantiate the IPFS the following code can be used:
```javascript
const initialize = () => {
  ipfs = window.IpfsHttpClient.create(ipfsAddress);
};
```

**1.2.5. Defining Code to be Executed**

The Ethernity Cloud Runner allows users to execute tasks using different programming languages and frameworks. Currently, the runner supports two main templates: Python and Node.js. Users can define the code to be executed within these templates to perform specific tasks on the Ethernity Cloud platform.

#### Python Template:

In the Python template, users can write their code in Python programming language. Python is known for its simplicity and readability, making it a popular choice for various use cases. Users can utilize the Python template to execute tasks that require data processing, scientific computing, artificial intelligence, and more. The Python template provides a flexible and versatile environment to build sophisticated applications within the Ethernity Cloud ecosystem.

Below there is an example of Python code that demonstrates a program used to compute PI number:

```python
import time
from decimal import Decimal, getcontext
          
def compute(n):
  getcontext().prec = n
  res = Decimal(0)
  for i in range(n):
    a = Decimal(1)/(16**i)
    b = Decimal(4)/(8*i+1)
    c = Decimal(2)/(8*i+4)
    d = Decimal(1)/(8*i+5)
    e = Decimal(1)/(8*i+6)
    r = a*(b-c-d-e)
    res += r
  return res
          
t1 = time.time()
res = compute(2000)
dt = time.time()-t1
              
print(res)
___etny_result___(str(res))
```


#### Node.js Template:

For those who prefer JavaScript, the Node.js template offers a powerful option. Node.js allows users to leverage JavaScript both on the client and server-side, making it suitable for web-based applications and server-side scripting. With the Node.js template, users can execute tasks on the Ethernity Cloud Runner using JavaScript, taking advantage of its asynchronous, event-driven nature and extensive library support.

Below there is an example of Node.js code that computes the sum of two numbers:

```javascript
function add(a, b) {
  return a + b;
}
___etny_result___(add(1, 10).toString());
```

To use either template, users need to provide the code in the corresponding programming language that defines the specific task they want to execute. This code will be packaged and executed within the Ethernity Cloud environment, leveraging the capabilities of the blockchain and distributed computing to complete the task securely and efficiently.

It's important to note that as the Ethernity Cloud platform evolves, additional templates and language support may be introduced, providing even more flexibility for users to define and execute a wide range of tasks on the Ethernity Cloud Runner. For now, users can take advantage of the Python and Node.js templates to harness the power of blockchain and distributed computing for their applications and tasks.

**1.2.6. Formatting Input Data and Metadata**

Before submitting the task, the input data and metadata need to be properly formatted. The Runner generates and formats the required metadata for the task:

In the v3 format, the image metadata represents essential information about an image that is used in the Ethernity Cloud Runner for task execution. The metadata follows a specific structure with the following fields:

***Binary Image Metadata (SGX)***

Format: `v3:image_ipfs_hash:image_name:docker_compose_ipfs_hash:client_challenge_ipfs_hash:public_key`

1. `v3`: This indicates the version of the metadata format. In this case, it is "v3."

2. `image_ipfs_hash`: This field contains the IPFS hash of the image. IPFS (InterPlanetary File System) is a decentralized protocol used for storing and sharing content. The image IPFS hash uniquely identifies the image stored on the IPFS network.

3. `image_name`: This field specifies the name or identifier of the image. It can be used to provide additional information about the image being used in the task execution.

4. `docker_compose_ipfs_hash`: This field holds the IPFS hash of the Docker Compose file related to the image. The Docker Compose file defines how multiple containers work together to form a service.

5. `client_challenge_ipfs_hash`: This field contains the IPFS hash of the client challenge. The client challenge is used for encryption and authentication purposes during the task execution.

6. `public_key`: This field represents the public key associated with the task execution. Public-key cryptography is used for secure communication and validation.

```javascript
async getV3ImageMetadata(challengeHash) {
   // generating encrypted base64 hash of the challenge
   const base64EncryptedChallenge = await encryptWithCertificate(challengeHash, this.enclavePublicKey);

   // uploading to IPFS the base64 encrypted challenge
   const challengeIPFSHash = await ipfsClient.uploadToIPFS(base64EncryptedChallenge);

   const publicKey = await this.getCurrentWalletPublicKey();
   // image metadata for v3 format v3:image_ipfs_hash:image_name:docker_compose_ipfs_hash:client_challenge_ipfs_hash:public_key
   return `${VERSION}:${this.enclaveImageIPFSHash}:${this.runnerType}:${this.enclaveDockerComposeIPFSHash}:${challengeIPFSHash}:${publicKey}`;
}
```

***Code Metadata***

Format: `v3:code_ipfs_hash:code_checksum`

1. `v3`: This indicates the version of the metadata format. In this case, it is "v3."

2. `code_ipfs_hash`: This field contains the IPFS hash of the code. IPFS (InterPlanetary File System) is a decentralized protocol used for storing and sharing content. The code IPFS hash uniquely identifies the code stored on the IPFS network.

3. `code_checksum`: This field represents the checksum of the code. A checksum is a value derived from the code's content, and it serves as a unique identifier for the code's integrity. It ensures that the code has not been tampered with or corrupted.

```javascript
async getV3CodeMetadata(code) {
   // extracting code from all the code cells
   let scriptChecksum = sha256(code);
   // uploading all node js code to IPFS and received hash of transaction
   const base64EncryptedScript = await encryptWithCertificate(code, this.enclavePublicKey);
   this.__scriptHash = await ipfsClient.uploadToIPFS(base64EncryptedScript);

   scriptChecksum = await this.etnyContract.signMessage(scriptChecksum);
   // v3:code_ipfs_hash:code_checksum
   return `${VERSION}:${this.__scriptHash}:${scriptChecksum}`;
}
```

***Fileset Metadata***

Format: `v3::fileset_checksum`

1. `v3`: This indicates the version of the metadata format. In this case, it is "v3."

2. (No specific field name): After the version indicator, there is no specific field name. Instead, the field is represented by two colons "::", because we are not passing any input paramaters for the code.

3. `fileset_checksum`: This field contains the checksum of the file set used as input data for the task. A checksum is a value derived from the file set's content, serving as a unique identifier for its integrity. It ensures that the input data has not been tampered with or corrupted.

```javascript
async getV3InputMedata() {
   const fileSetChecksum = await this.etnyContract.signMessage(ZERO_CHECKSUM);
   // v3::filesetchecksum
   return `${VERSION}::${fileSetChecksum}`;
}
```

The v3 code metadata format ensures that all the necessary information related to the code's location and integrity is properly structured and accessible during the execution of tasks on the Ethernity Cloud Runner. This metadata format facilitates a secure and organized way of handling code-related data on the platform, providing essential verification and security measures for the code execution process.

- Generate the challenge hash with `generateRandomHexOfSize(size)`.
- Create image metadata using `getV3ImageMetadata(challengeHash)`.
- Create code metadata using `getV3CodeMetadata(code)`.
- Create input metadata using `getV3InputMetadata()`.

**1.2.7. Encrypting Input**

The Ethernity Cloud platform prioritizes the security and privacy of user data and sensitive information. To ensure confidentiality, all input data and metadata submitted by users undergo encryption using industry-standard cryptographic algorithms.

To encrypt input data, users can take advantage of the provided encryption functions within the platform's cryptographic libraries. The platform offers easy-to-use functions to encrypt data using ECC public keys for small-sized input and AES-GCM for larger payloads. This encryption process ensures that the data remains secure while being processed by the Ethernity Cloud Runner and during transmission across the network.

It's important to note that the platform does not store the user's private keys, enhancing the overall security of the system. Users retain full control over their encryption keys, allowing them to securely encrypt and decrypt their data without exposing sensitive information to the platform or any third parties.

The input data needs to be encrypted to maintain security. The Runner uses the `crypto` library provided by us to encrypt the code and input data with the enclave's public key.

```javascript
const encrypt_ecc = async (msg, publicKey) => {
   const cipherTextPrivateKey = generateRandomBytes(32);
   const sharedEccKey = publicKey.getPublic().mul(cipherTextPrivateKey);
   const secretKey = await ecc_point_to_256_bit_key(sharedEccKey);
   const encrypted = encryptMsg(msg, secretKey);
   const cipherTextPublicKey = curve.g.mul(cipherTextPrivateKey);
   return {
      ciphertext: encrypted.ciphertext,
      secretKey,
      nonce: encrypted.iv,
      authTag: encrypted.authTag,
      cipherTextPublicKey: cipherTextPublicKey.encode('hex')
   };
};

const encrypt = async (pubKey, message) => {
   const publicKeyPoint = curve.keyFromPublic(pubKey, 'hex');
   const encryptedMessage = await encrypt_ecc(message, publicKeyPoint);
   return encryptedDataToBase64Json(encryptedMessage);
};
```
**1.2.8. Uploading Input**

After encrypting the data, the Runner uploads the encrypted code and input metadata to IPFS using `ipfsClient.uploadToIPFS()`.

```javascript
uploadToIPFS = async (code) => {
  try {
    console.log('Uploading payload to IPFS...');
    const response = await ipfs.add(code);

    return response.path;
  } catch (e) {
    console.log(e);
  }
};
```

**1.2.9. Executing Task**

The Runner prepares the code and metadata to be executed and creates a new DO request using `createDORequest(imageMetadata, codeMetadata, inputMetadata, nodeAddress)`.

```javascript
async createDORequest(imageMetadata, codeMetadata, inputMetadata) {
    this.dispatchECEvent(`Submitting transaction for DO request on ${formatDate()}`);
    // add here call to SC(smart contract)
    const tx = await this.etnyContract.addDORequest(imageMetadata, codeMetadata, inputMetadata, this.nodeAddress);
    const transactionHash = tx.hash;
    this.__doHash = transactionHash;

    this.dispatchECEvent(`Waiting for transaction ${transactionHash} to be processed...`);
    const isProcessed = await this.waitForTransactionToBeProcessed(transactionHash);
    if (!isProcessed) {
        this.dispatchECEvent('Unable to create request, please check connectivity with Bloxberg node');
        return;
    }
    this.dispatchECEvent(`Transaction ${transactionHash} was confirmed`);
}
```
**1.2.10. Managing Order Approval**

The Runner provides a mechanism for managing order approvals on the blockchain. When executing a task, the user has the option to either manually approve the order or let the Runner automatically approve it.

1. Automatic Order Approval:
   If a node address is provided as a parameter when running the task, the Runner will automatically approve the order on the blockchain. This is a convenient option for users who want to streamline the task execution process and are willing to trust the Runner to handle the order approval automatically.

2. Manual Order Approval:
   On the other hand, if no node address is provided as a parameter, the Runner will randomly select the best fitted node and will  wait for manual approval by the user. In this case, the user needs to explicitly approve the order on the blockchain before the task can proceed. This allows for greater control over the order approval process and ensures that the task is executed only when the user is ready.

```javascript
const _orderApproved = async () => {
      _orderPlacedEVPassed = true;
      contract.off('_orderPlacedEV', _orderPlacedEV);

      // approve order in case we are not providing a node address as metadata4 parameter
      if (!this.nodeAddress) {
        await this.approveOrder(this.__orderNumber);
      }

      this.dispatchECEvent(`Order ${this.__orderNumber} was placed and approved.`);
      this.interval = setInterval(messageInterval, 1000);
    };
```
By offering both manual and automatic approval options, the Runner caters to different user preferences and use cases. Users can choose the approach that best suits their needs and level of involvement in the order approval process.

**1.2.11. Checking Task Progress**

Once you've submitted an order and initiated the task execution, it becomes crucial to monitor the progress and verify that the task has been effectively processed by the node, with its result securely written onto the blockchain. The blockchain emits the `_orderClosedEv` event as confirmation that the order has undergone processing, and the outcome has been successfully recorded on the blockchain. As a Runner user, you can subscribe to this event, enabling you to stay informed about your task's progress and receive timely updates when the order concludes its execution.

```javascript
const _orderClosedEV = async (orderNumber) => {
   if (this.__orderNumber === orderNumber.toNumber() && !_orderClosedEVPassed && this.__orderNumber !== -1) {
      clearInterval(this.interval);
      _orderClosedEVPassed = true;
      contract.off('_orderClosedEV', _orderClosedEV);

      // get processed result from the order and create a certificate
      const parsedOrderResult = await this.getResultFromOrder(orderNumber);
      console.log(parsedOrderResult);
      if (parsedOrderResult.success === false) {
         this.dispatchECEvent(parsedOrderResult.message, ECStatus.ERROR);
      }
   }
};
```

**1.2.12. Validating Results**

After processing, the Runner fetches the encrypted result from IPFS and decrypts it using the user's private key. It then validates the integrity of the result by comparing its checksum against the transaction's checksum. The Runner also verifies that the signer's wallet address matches the expected address.

Upon successful validation, the Runner provides detailed information about the execution, including the contract address, input and output transaction hashes, order ID, image hash, script hash, file set hash, public timestamp, result hash, result task code, result value, and result timestamp.

In case of any errors during the process, the Runner retries the validation with a delay to ensure accurate results. Overall, this flow ensures the secure and reliable execution of tasks and the integrity of results in the EtnyRunner application.

**1.2.13. Decrypting Result Data**

The Runner decrypts the result data using the user's private key, validates its integrity, and presents the final result to the user. If any validation fails, appropriate error messages are displayed.

```javascript
const decryptWithPrivateKey = async (encryptMsg, account) => {
   try {
      const data = Buffer.from(encryptMsg, 'hex');

      const structuredData = {
         version: 'x25519-xsalsa20-poly1305',
         ephemPublicKey: data.slice(0, 32).toString('base64'),
         nonce: data.slice(32, 56).toString('base64'),
         ciphertext: data.slice(56).toString('base64')
      };
      const ct = `0x${Buffer.from(JSON.stringify(structuredData), 'utf8').toString('hex')}`;
      const decryptedMessage = await window.ethereum.request({ method: 'eth_decrypt', params: [ct, account] });
      const decodedMessage = ascii.decode(decryptedMessage).toString();
      console.log('The decrypted message is:', decodedMessage);
      return { success: true, data: decodedMessage };
   } catch (error) {
      console.log(error.message);
      return { success: false };
   }
};
```
By following these steps, users can effectively utilize the Ethernity Cloud Runner to execute tasks, monitor their progress, and securely retrieve results from the blockchain and decentralized storage.
By following these steps with the updated cryptographic library and IPFS integration, users can effectively utilize the Ethernity Cloud Runner to execute tasks, monitor their progress, and securely retrieve results from the blockchain and decentralized IPFS storage.
