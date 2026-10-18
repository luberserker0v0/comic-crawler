import '@testing-library/jest-dom';
import { TextDecoder, TextEncoder } from 'node:util';

if (typeof globalThis.TextEncoder === 'undefined') {
  Object.defineProperty(globalThis, 'TextEncoder', { value: TextEncoder });
}

if (typeof globalThis.TextDecoder === 'undefined') {
  Object.defineProperty(globalThis, 'TextDecoder', { value: TextDecoder });
}
