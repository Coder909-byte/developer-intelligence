import { describe, it, expect } from 'vitest';
import { relativeArtifactPaths } from './ValidationRun.js';
describe('validation path entry', () => {
  it('accepts relative paths without resolving or reading artifacts in the frontend', () => {
    expect(relativeArtifactPaths('rover.net\nsrc/pins.h')).toEqual(['rover.net', 'src/pins.h']);
  });
  it('rejects parent traversal and absolute paths before submission', () => {
    for (const input of ['../pins.h', 'C:/pins.h', '/etc/private', 'src/../../pins.h'])
      expect(() => relativeArtifactPaths(input)).toThrow('relative workspace');
  });
});
