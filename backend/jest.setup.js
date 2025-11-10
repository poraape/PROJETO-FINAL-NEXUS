// jest.setup.js
// Polyfills necessários para o pdf-parse (pdf.js) em ambiente Node durante os testes.
global.DOMMatrix = global.DOMMatrix || class DOMMatrix {};
global.DOMPoint = global.DOMPoint || class DOMPoint {};
global.DOMRect = global.DOMRect || class DOMRect {};
global.DOMStringList = global.DOMStringList || class DOMStringList {};

// Mock da biblioteca sharp para evitar dependências nativas durante testes.
jest.mock('sharp', () => {
  return jest.fn((buffer) => {
    return {
      greyscale() { return this; },
      sharpen() { return this; },
      toFormat() { return this; },
      toBuffer() { return Promise.resolve(buffer); },
    };
  });
});

// Neutraliza a escuta real do servidor para evitar blocos de rede nos testes.
const http = require('http');
http.Server.prototype.listen = function (...args) {
  const portOption = args.find(arg => typeof arg === 'number');
  const port = typeof portOption === 'number' ? portOption : 0;
  this._fakeAddress = { port, address: '127.0.0.1', family: 'IPv4' };
  const callback = args.find(arg => typeof arg === 'function');
  if (callback) {
    process.nextTick(callback);
  }
  return this;
};

http.Server.prototype.address = function () {
  return this._fakeAddress || { port: 0, address: '127.0.0.1', family: 'IPv4' };
};

http.Server.prototype.close = function (callback) {
  if (typeof callback === 'function') {
    process.nextTick(callback);
  }
  return this;
};
