// jest.setup.js
// Polyfills mínimos exigidos pelas bibliotecas de extração que podem ser carregadas em testes.
global.DOMMatrix = global.DOMMatrix || class DOMMatrix {};
global.DOMPoint = global.DOMPoint || class DOMPoint {};
global.DOMRect = global.DOMRect || class DOMRect {};
global.Path2D = global.Path2D || class Path2D {};
global.ImageData = global.ImageData || class ImageData {
  constructor(width = 0, height = 0) {
    this.width = width;
    this.height = height;
  }
};
