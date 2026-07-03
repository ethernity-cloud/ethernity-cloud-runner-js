import { Buffer } from 'buffer';
import forge from 'node-forge';
import elliptic from 'elliptic';
import jsSHA256 from 'js-sha256';
import jsrsasign from 'jsrsasign';
import { decrypt as ethSigUtilDecrypt } from '@metamask/eth-sig-util';
import ascii from './ascii.js';
// eslint-disable-next-line new-cap
const curve = new elliptic.ec('p384');

export const sha256 = (value, asHex = false) => {
  const buffer = new TextEncoder().encode(value);
  const sha = jsSHA256.sha256(buffer);
  if (asHex) {
    return sha.toString('hex');
  }
  return sha.toString();
};

// eslint-disable-next-line camelcase
const ecc_point_to_256_bit_key = async (point) => {
  const value = point.getX().toString() + point.getY().toString();
  const buffer = new TextEncoder().encode(value);
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(hashBuffer));
};

const generateRandomBytes = (length) => {
  const array = new Uint16Array(length);
  crypto.getRandomValues(array);
  return array;
};

const encryptMsg = (msg, secretKey) => {
  if (secretKey.length !== 32) {
    throw new Error('Secret key must be 32 bytes (256 bits) long');
  }

  const iv = generateRandomBytes(16);
  // encrypt some bytes using GCM mode
  const cipher = forge.cipher.createCipher('AES-GCM', secretKey);
  cipher.start({ iv });
  cipher.update(forge.util.createBuffer(msg));
  cipher.finish();
  const encrypted = cipher.output;
  const { tag } = cipher.mode;

  // outputs encrypted hex
  return {
    ciphertext: forge.util.bytesToHex(encrypted.data),
    iv: forge.util.bytesToHex(iv),
    authTag: forge.util.bytesToHex(tag.data)
  };
};

const encryptedDataToBase64Json = (encryptedMsg) => {
  const key = curve.keyFromPublic(encryptedMsg.cipherTextPublicKey, 'hex');
  const jsonObj = {
    ciphertext: encryptedMsg.ciphertext,
    nonce: encryptedMsg.nonce,
    authTag: encryptedMsg.authTag,
    x: key.getPublic().getX().toString(16),
    y: key.getPublic().getY().toString(16)
  };
  const jsonString = JSON.stringify(jsonObj);
  return btoa(jsonString);
};

// eslint-disable-next-line camelcase
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

const loadCertificate = (certificate) => {
  const c = new jsrsasign.X509();
  c.readCertPEM(certificate);
  return c.getPublicKey().pubKeyHex;
};

export const encryptWithCertificate = async (message, certificate) => {
  const pubKey = loadCertificate(certificate);
  return encrypt(pubKey, message);
};

// Decrypts an enclave result (x25519-xsalsa20-poly1305 / NaCl box).
//   encryptedMessage - hex string: ephemPublicKey(32) | nonce(24) | ciphertext
//   account          - wallet address (used for the MetaMask eth_decrypt path)
//   privateKey       - optional raw private key ('0x...'); when provided we
//                      decrypt locally with @metamask/eth-sig-util (the exact
//                      reference implementation MetaMask's eth_decrypt uses), so
//                      Web3Auth / raw-key / WalletConnect wallets work without
//                      window.ethereum. Falls back to eth_decrypt otherwise.
export const decryptWithPrivateKey = async (encryptedMessage, account, privateKey = null) => {
  try {
    const data = Buffer.from(encryptedMessage, 'hex');

    const structuredData = {
      version: 'x25519-xsalsa20-poly1305',
      ephemPublicKey: data.slice(0, 32).toString('base64'),
      nonce: data.slice(32, 56).toString('base64'),
      ciphertext: data.slice(56).toString('base64')
    };

    if (privateKey) {
      const pkHex = privateKey.startsWith('0x') ? privateKey.slice(2) : privateKey;
      const decryptedMessage = ethSigUtilDecrypt({ encryptedData: structuredData, privateKey: pkHex });
      const decodedMessage = ascii.decode(decryptedMessage).toString();
      return { success: true, data: decodedMessage };
    }

    const ct = `0x${Buffer.from(JSON.stringify(structuredData), 'utf8').toString('hex')}`;
    const decryptedMessage = await window.ethereum.request({ method: 'eth_decrypt', params: [ct, account] });
    const decodedMessage = ascii.decode(decryptedMessage).toString();
    return { success: true, data: decodedMessage };
  } catch (error) {
    console.log(error.message);
    return { success: false };
  }
};
