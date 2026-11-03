import { describe, expect, it } from 'vitest';
import {
  ProjectCreateSchema,
  ProjectUpdateSchema,
  ActivityEventSchema,
  IdSchema,
  ValidationRequestSchema,
} from './index.js';
describe('shared contracts', () => {
  it('normalizes project input and rejects unknown fields', () => {
    expect(ProjectCreateSchema.parse({ name: ' Rover ', rootPath: '/tmp' })).toEqual({
      name: 'Rover',
      rootPath: '/tmp',
      description: '',
    });
    expect(ProjectCreateSchema.safeParse({ name: '', rootPath: '/tmp' }).success).toBe(false);
    expect(
      ProjectCreateSchema.safeParse({ name: 'a', rootPath: '/tmp', token: 'secret' }).success,
    ).toBe(false);
  });
  it('rejects empty patches and does not default omitted fields', () => {
    expect(ProjectUpdateSchema.safeParse({}).success).toBe(false);
    expect(ProjectUpdateSchema.safeParse({ name: undefined }).success).toBe(false);
    expect(ProjectUpdateSchema.parse({ name: 'New name' })).toEqual({ name: 'New name' });
    expect(ProjectUpdateSchema.parse({ name: 'New name', description: undefined })).toEqual({
      name: 'New name',
    });
  });
  it('requires UUID scope and provenance on activity and validation', () => {
    expect(IdSchema.safeParse('evt_001').success).toBe(false);
    expect(ActivityEventSchema.safeParse({}).success).toBe(false);
    expect(
      ValidationRequestSchema.safeParse({
        kind: 'pin_consistency',
        artifactPaths: ['a'],
        requestedBy: 'user',
      }).success,
    ).toBe(false);
  });
});
