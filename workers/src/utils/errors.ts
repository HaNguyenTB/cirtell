/**
 * Centralized error helpers
 */

export class AppError extends Error {
  constructor(
    public readonly userMessage: string,
    public readonly statusCode: number = 500,
    public readonly errorCode?: string,
  ) {
    super(userMessage);
    this.name = 'AppError';
  }
}

export const ErrorCodes = {
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  NOT_FOUND: 'NOT_FOUND',
  ALREADY_EXISTS: 'ALREADY_EXISTS',
  AUTH_FAILED: 'AUTH_FAILED',
  ACCESS_DENIED: 'ACCESS_DENIED',
  RATE_LIMITED: 'RATE_LIMITED',
} as const;
