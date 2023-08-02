import { create } from 'ipfs-http-client';
import { delay } from './utils';

let ipfs = null;

export const initialize = (host, protocol, port, token) => {
  if (host.search('http') !== -1) {
    ipfs = create(host);
  } else if (token === '') {
    ipfs = create({
      host,
      protocol,
      port
    });
  } else {
    // example of authorization headers
    // headers: {
    //     authorization: 'Bearer ' + TOKEN
    //   }
    // const auth =
    //     'Basic ' + Buffer.from(INFURA_ID + ':' + INFURA_SECRET_KEY).toString('base64');
    ipfs = create({
      host,
      protocol,
      port,
      headers: { authorization: token }
    });
  }
};

export const uploadToIPFS = async (code) => {
  try {
    const response = await ipfs.add(code);
    return response.path;
  } catch (e) {
    console.log(e);
    return null;
  }
};

export const getFromIPFS = async (hash) => {
  let res = '';
  try {
    // eslint-disable-next-line no-restricted-syntax
    for await (const file of ipfs.cat(hash)) {
      res += new TextDecoder().decode(file.buffer);
    }

    return res;
  } catch (error) {
    console.error(error.message);
    await delay(2000);
    return getFromIPFS(hash);
  }
};
