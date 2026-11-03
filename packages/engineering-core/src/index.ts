import type { ValidationRequest, ValidationFinding, Job } from '@udi/contracts';
import type { ToolRunner } from '@udi/tool-runners';

export interface ValidationResult {
  job: Job;
  findings: ValidationFinding[];
}

export interface EngineeringValidator {
  validate(request: ValidationRequest, signal?: AbortSignal): Promise<ValidationResult>;
}

export interface EngineeringDependencies {
  runner: ToolRunner;
  resolveWorkspace(projectId: string): Promise<string>;
}

export * from './types.js';
export * from './pin-normalizer.js';
export * from './kicad-parser.js';
export * from './firmware-parser.js';
export * from './pin-validator.js';
export * from './platformio-adapter.js';
export * from './rtl-adapter.js';
export * from './iot-adapter.js';
export * from './validator.js';
export * from './correction.js';
