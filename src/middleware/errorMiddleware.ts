import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';
import { ApiError } from '../utils/errors';

export const notFoundHandler: RequestHandler = (_req, _res, next) => {
  next(new ApiError(404, 'NOT_FOUND', '요청한 API 경로를 찾을 수 없습니다.'));
};

export const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  if (error instanceof ZodError) {
    res.status(400).json({
      code: 'VALIDATION_ERROR',
      message: '입력값을 확인해 주세요.',
      details: error.flatten()
    });
    return;
  }

  if (error instanceof ApiError) {
    res.status(error.status).json({
      code: error.code,
      message: error.message,
      details: error.details ?? {}
    });
    return;
  }

  res.status(500).json({
    code: 'INTERNAL_ERROR',
    message: '서버 에러가 발생했습니다.',
    details: {}
  });
};
