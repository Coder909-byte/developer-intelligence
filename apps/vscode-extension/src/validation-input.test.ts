import { describe, it, expect } from 'vitest';
import { pinValidationInput } from './validation-input.js';
describe('native validation request input', () => {
  it('uses the frozen body schema and workspace-relative artifact list', () => {
    expect(pinValidationInput('rover.net; src/pins.h')).toEqual({
      kind: 'pin_consistency',
      artifactPaths: ['rover.net', 'src/pins.h'],
      requestedBy: 'vscode-user',
    });
  });
  it('rejects escape paths instead of passing them to execution', () => {
    expect(() => pinValidationInput('../outside.h')).toThrow();
    expect(() => pinValidationInput('C:/outside.h')).toThrow();
    expect(() => pinValidationInput('')).toThrow();
  });
});
