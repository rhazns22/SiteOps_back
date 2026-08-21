export class ApiError extends Error {
  status: number;
  code: string;
  details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (message: string, details?: unknown) =>
  new ApiError(400, 'VALIDATION_ERROR', message, details);

export const unauthorized = (message = '로그인이 필요합니다.') =>
  new ApiError(401, 'UNAUTHORIZED', message);

export const forbidden = (message = '요청하신 작업에 대한 권한이 없습니다.') =>
  new ApiError(403, 'FORBIDDEN', message);

export const notFound = (message = '요청한 리소스를 찾을 수 없습니다.') =>
  new ApiError(404, 'NOT_FOUND', message);

export const conflict = (message: string, details?: unknown) =>
  new ApiError(409, 'CONFLICT', message, details);

export const configurationError = (message: string) =>
  new ApiError(500, 'CONFIGURATION_ERROR', message);
