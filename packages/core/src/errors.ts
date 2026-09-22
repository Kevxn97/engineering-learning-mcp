export type ErrorCode = 'INVALID_INPUT' | 'NOT_AVAILABLE' | 'PROJECT_NOT_RESOLVED' | 'VERSION_CONFLICT' | 'CONTENT_REJECTED' | 'RATE_LIMITED' | 'DEPENDENCY_UNAVAILABLE' | 'INTEGRITY_ERROR' | 'UNAUTHENTICATED' | 'FORBIDDEN';
export class DomainError extends Error {
  constructor(public readonly code: ErrorCode, public readonly field?: string) {
    super(code); this.name = 'DomainError';
  }
}
export function fail(code: ErrorCode, field?: string): never { throw new DomainError(code, field); }
export function safeError(error: unknown): { code: ErrorCode; field?: string } {
  return error instanceof DomainError ? { code: error.code, ...(error.field ? { field: error.field } : {}) } : { code: 'DEPENDENCY_UNAVAILABLE' };
}
export function httpStatus(error: unknown): number {
  if(typeof error==='object'&&error!==null&&'code' in error&&error.code==='FST_ERR_CTP_BODY_TOO_LARGE')return 413;
  const code = safeError(error).code;
  return ({ UNAUTHENTICATED: 401, FORBIDDEN: 403, NOT_AVAILABLE: 404, PROJECT_NOT_RESOLVED: 404, VERSION_CONFLICT: 409, INVALID_INPUT: 400, CONTENT_REJECTED: 422, RATE_LIMITED: 429, DEPENDENCY_UNAVAILABLE: 503, INTEGRITY_ERROR: 503 } as const)[code];
}
