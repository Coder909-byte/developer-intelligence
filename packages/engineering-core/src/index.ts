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
// Developer 2: deterministic evidence-based rules; unavailable tools cannot produce successful jobs.
