const { Buffer } = require('buffer/');
const forge = require('node-forge');
const elliptic = require('elliptic');
const jsSHA256 = require('js-sha256');
const jsrsasign = require('jsrsasign');
const ascii = require('./ascii');
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
export const ecc_point_to_256_bit_key = async (point) => {
  const value = point.getX().toString() + point.getY().toString();
  const buffer = new TextEncoder().encode(value);
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(hashBuffer));
};

export const generateRandomBytes = (length) => {
  const array = new Uint16Array(length);
  crypto.getRandomValues(array);
  return array;
};

export const encryptMsg = (msg, secretKey) => {
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

export const encryptedDataToBase64Json = (encryptedMsg) => {
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
export const encrypt_ecc = async (msg, publicKey) => {
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

export const encrypt = async (pubKey, message) => {
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

export const decryptWithPrivateKey = async (encryptedMessage, account) => {
  try {
    const data = Buffer.from(encryptedMessage, 'hex');

    const structuredData = {
      version: 'x25519-xsalsa20-poly1305',
      ephemPublicKey: data.slice(0, 32).toString('base64'),
      nonce: data.slice(32, 56).toString('base64'),
      ciphertext: data.slice(56).toString('base64')
    };
    const ct = `0x${Buffer.from(JSON.stringify(structuredData), 'utf8').toString('hex')}`;
    const decryptedMessage = await window.ethereum.request({ method: 'eth_decrypt', params: [ct, account] });
    const decodedMessage = ascii.decode(decryptedMessage).toString();
    return { success: true, data: decodedMessage };
  } catch (error) {
    console.log(error.message);
    return { success: false };
  }
};
