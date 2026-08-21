import { Priority, RequestStatus, ReviewDecision } from '@prisma/client';
import { z } from 'zod';
import { optionalDate, optionalPositiveInt } from '../utils/validators';

export const requestParamsSchema = z.object({
  requestId: z.string().min(1)
});

export const pinParamsSchema = requestParamsSchema.extend({
  pinId: z.string().min(1)
});

export const listRequestsQuerySchema = z.object({
  page: optionalPositiveInt(1),
  limit: optionalPositiveInt(10).pipe(z.number().max(100)),
  q: z.string().trim().optional(),
  status: z.nativeEnum(RequestStatus).optional(),
  priority: z.nativeEnum(Priority).optional(),
  projectId: z.string().trim().optional(),
  assigneeId: z.string().trim().optional(),
  dueFrom: optionalDate.optional(),
  dueTo: optionalDate.optional()
});

export const createPinSchema = z.object({
  xPercent: z.number().min(0).max(100),
  yPercent: z.number().min(0).max(100),
  content: z.string().min(1),
  sortOrder: z.number().int().min(0).optional()
});

export const createRequestBodySchema = z.object({
  projectId: z.string().min(1),
  title: z.string().min(1),
  description: z.string().min(1),
  pageUrl: z.string().url(),
  priority: z.nativeEnum(Priority).default('NORMAL'),
  dueDate: optionalDate.optional(),
  pins: z.array(createPinSchema).optional()
});

export const updateRequestBodySchema = z
  .object({
    title: z.string().min(1).optional(),
    description: z.string().min(1).optional(),
    pageUrl: z.string().url().optional(),
    priority: z.nativeEnum(Priority).optional(),
    dueDate: optionalDate.optional()
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: '수정할 값이 필요합니다.'
  });

export const assignRequestBodySchema = z.object({
  assigneeId: z.string().min(1).nullable()
});

export const updateStatusBodySchema = z.object({
  status: z.nativeEnum(RequestStatus),
  comment: z.string().trim().optional(),
  beforeImagePath: z.string().trim().optional().nullable(),
  afterImagePath: z.string().trim().optional().nullable()
});

export const createCommentBodySchema = z.object({
  content: z.string().min(1)
});

export const reviewRequestBodySchema = z
  .object({
    decision: z.nativeEnum(ReviewDecision),
    comment: z.string().trim().optional()
  })
  .refine(
    (data) => {
      if (data.decision === 'REJECTED') {
        return Boolean(data.comment && data.comment.trim().length > 0);
      }
      return true;
    },
    {
      message: '반려 사유를 입력해 주세요.',
      path: ['comment']
    }
  );
