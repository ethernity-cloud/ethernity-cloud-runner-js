// eslint-disable-next-line no-promise-executor-return
export const delay = (ms) => new Promise((res) => setTimeout(res, ms));
export const getCurrentTime = () => {
  const today = new Date();
  const dd = String(today.getDate()).padStart(2, '0');
  const mm = String(today.getMonth() + 1).padStart(2, '0'); // January is 0!
  const yyyy = today.getFullYear();

  return `${mm}/${dd}/${yyyy}`;
};

export const formatDate = (dt) => {
  // eslint-disable-next-line no-param-reassign
  if (!dt) dt = new Date();
  // eslint-disable-next-line no-unused-vars
  const padL = (nr, len = 2, chr = '0') => `${nr}`.padStart(2, chr);

  return `${padL(dt.getDate())}/${padL(dt.getMonth() + 1)}/${dt.getFullYear()} ${padL(dt.getHours())}:${padL(
    dt.getMinutes()
  )}:${padL(dt.getSeconds())}`;
};

export const generateRandomDigitsHexOfSize = (size) =>
  [...Array(size)].map(() => Math.floor(Math.random() * 16).toString(16)).join('');
export const generateRandomHexOfSize = (size) => {
  let result = '';
  // eslint-disable-next-line no-plusplus
  for (let i = 0; i < size; i++) {
    const randomNumber = Math.floor(Math.random() * 16);
    if (randomNumber < 10) {
      result += randomNumber;
    } else {
      result += String.fromCharCode(randomNumber + 87);
    }
  }
  return result;
};
