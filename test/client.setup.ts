import '@testing-library/jest-dom/vitest';

if (typeof Range !== 'undefined') {
  if (!Range.prototype.getClientRects) {
    Object.defineProperty(Range.prototype, 'getClientRects', {
      configurable: true,
      value: () => [],
    });
  }

  if (!Range.prototype.getBoundingClientRect) {
    Object.defineProperty(Range.prototype, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({
        bottom: 0,
        height: 0,
        left: 0,
        right: 0,
        top: 0,
        width: 0,
        x: 0,
        y: 0,
      }),
    });
  }
}
