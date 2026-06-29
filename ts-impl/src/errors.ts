export const EXIT = {
  SUCCESS: 0,
  RUNNER_ERROR: 1,
  USAGE_ERROR: 2,
  VALIDATION_ERROR: 3,
  BLOCKED: 4,
  REJECTION_CAP: 5,
  TIMEOUT: 6,
  QUALITY_GATE_FAILED: 7,
} as const;

export class RalphError extends Error {
  constructor(
    message: string,
    readonly exitCode: number = EXIT.RUNNER_ERROR,
  ) {
    super(message);
    this.name = "RalphError";
  }
}
