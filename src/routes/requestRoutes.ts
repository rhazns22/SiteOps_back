import { Router } from 'express';
import prisma from '../lib/prisma';
import { authenticateToken, requireRole } from '../middleware/authMiddleware';
import { asyncHandler } from '../middleware/asyncHandler';
import { assertProjectAccess, assertRequestAccess, canReviewRequest } from '../services/accessService';
import {
  assertCanEditRequest,
  buildListWhere,
  createActivity,
  notifyRequestAssignee,
  requestInclude,
  updateRequestStatus
} from '../services/requestService';
import {
  assignRequestBodySchema,
  createCommentBodySchema,
  createPinSchema,
  createRequestBodySchema,
  listRequestsQuerySchema,
  pinParamsSchema,
  requestParamsSchema,
  reviewRequestBodySchema,
  updatePinSchema,
  updateRequestBodySchema,
  updateStatusBodySchema
} from '../validators/requestValidators';
import { parseOrThrow } from '../utils/validators';
import { conflict, forbidden, notFound } from '../utils/errors';
import { toRequestDto } from '../utils/serializers';
import type { AuthenticatedRequest } from '../types/http';

export const requestRouter = Router();

requestRouter.use(authenticateToken);

requestRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const user = (req as AuthenticatedRequest).user;
    const query = parseOrThrow(listRequestsQuerySchema, req.query);
    const where = buildListWhere(user, query);
    const skip = (query.page - 1) * query.limit;

    const [items, total] = await Promise.all([
      prisma.maintenanceRequest.findMany({
        where,
        skip,
        take: query.limit,
        include: requestInclude,
        orderBy: { createdAt: 'desc' }
      }),
      prisma.maintenanceRequest.count({ where })
    ]);

    res.json({
      items: items.map((item) => toRequestDto(item)),
      pagination: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages: Math.ceil(total / query.limit)
      }
    });
  })
);

requestRouter.post(
  '/',
  requireRole(['CLIENT', 'ADMIN']),
  asyncHandler(async (req, res) => {
    const user = (req as AuthenticatedRequest).user;
    const body = parseOrThrow(createRequestBodySchema, req.body);
    const project = await assertProjectAccess(user, body.projectId);

    if (user.role === 'CLIENT' && project.clientId !== user.clientId) {
      throw forbidden();
    }

    const request = await prisma.$transaction(async (tx) => {
      const created = await tx.maintenanceRequest.create({
        data: {
          projectId: body.projectId,
          requesterId: user.id,
          title: body.title,
          description: body.description,
          pageUrl: body.pageUrl,
          priority: body.priority,
          dueDate: body.dueDate ?? null,
          pins: body.pins
            ? {
                create: body.pins.map((pin, index) => ({
                  xPercent: pin.xPercent,
                  yPercent: pin.yPercent,
                  content: pin.content,
                  sortOrder: pin.sortOrder ?? index
                }))
              }
            : undefined
        }
      });

      await createActivity(tx, {
        requestId: created.id,
        actorId: user.id,
        type: 'REQUEST_CREATED',
        metadata: { title: created.title }
      });

      const admins = await tx.user.findMany({
        where: { role: 'ADMIN' },
        select: { id: true }
      });

      await notifyRequestAssignee(
        tx,
        admins.map((admin) => ({
          userId: admin.id,
          requestId: created.id,
          type: 'COMMENT',
          title: '신규 요청 접수',
          message: `[${created.title}] 요청이 접수되었습니다.`
        }))
      );

      return tx.maintenanceRequest.findUniqueOrThrow({
        where: { id: created.id },
        include: requestInclude
      });
    });

    res.status(201).json(toRequestDto(request));
  })
);

requestRouter.get(
  '/:requestId',
  asyncHandler(async (req, res) => {
    const user = (req as AuthenticatedRequest).user;
    const { requestId } = parseOrThrow(requestParamsSchema, req.params);
    await assertRequestAccess(user, requestId);

    const request = await prisma.maintenanceRequest.findUniqueOrThrow({
      where: { id: requestId },
      include: requestInclude
    });

    res.json(toRequestDto(request));
  })
);

requestRouter.patch(
  '/:requestId',
  asyncHandler(async (req, res) => {
    const user = (req as AuthenticatedRequest).user;
    const { requestId } = parseOrThrow(requestParamsSchema, req.params);
    const body = parseOrThrow(updateRequestBodySchema, req.body);
    await assertCanEditRequest(user, requestId);

    const request = await prisma.$transaction(async (tx) => {
      const updated = await tx.maintenanceRequest.update({
        where: { id: requestId },
        data: {
          title: body.title,
          description: body.description,
          pageUrl: body.pageUrl,
          priority: body.priority,
          dueDate: body.dueDate === undefined ? undefined : body.dueDate
        },
        include: requestInclude
      });

      await createActivity(tx, {
        requestId,
        actorId: user.id,
        type: 'REQUEST_UPDATED'
      });

      return updated;
    });

    res.json(toRequestDto(request));
  })
);

requestRouter.delete(
  '/:requestId',
  asyncHandler(async (req, res) => {
    const user = (req as AuthenticatedRequest).user;
    const { requestId } = parseOrThrow(requestParamsSchema, req.params);
    await assertCanEditRequest(user, requestId);
    await prisma.maintenanceRequest.delete({ where: { id: requestId } });
    res.status(204).send();
  })
);

requestRouter.patch(
  '/:requestId/assignee',
  requireRole(['ADMIN']),
  asyncHandler(async (req, res) => {
    const user = (req as AuthenticatedRequest).user;
    const { requestId } = parseOrThrow(requestParamsSchema, req.params);
    const { assigneeId } = parseOrThrow(assignRequestBodySchema, req.body);
    await assertRequestAccess(user, requestId);

    if (assigneeId) {
      const worker = await prisma.user.findFirst({
        where: {
          id: assigneeId,
          role: 'WORKER'
        }
      });

      if (!worker) {
        throw notFound('담당 작업자를 찾을 수 없습니다.');
      }
    }

    const request = await prisma.$transaction(async (tx) => {
      const updated = await tx.maintenanceRequest.update({
        where: { id: requestId },
        data: { assigneeId },
        include: requestInclude
      });

      await createActivity(tx, {
        requestId,
        actorId: user.id,
        type: 'ASSIGNEE_CHANGED',
        metadata: { assigneeId }
      });

      if (assigneeId) {
        await notifyRequestAssignee(tx, [
          {
            userId: assigneeId,
            requestId,
            type: 'ASSIGNED',
            title: '담당자 배정',
            message: `[${updated.title}] 요청의 담당자로 배정되었습니다.`
          }
        ]);
      }

      return updated;
    });

    res.json(toRequestDto(request));
  })
);

requestRouter.patch(
  '/:requestId/status',
  asyncHandler(async (req, res) => {
    const user = (req as AuthenticatedRequest).user;
    const { requestId } = parseOrThrow(requestParamsSchema, req.params);
    const body = parseOrThrow(updateStatusBodySchema, req.body);
    const request = await updateRequestStatus(user, requestId, body.status, body);
    res.json(toRequestDto(request));
  })
);

requestRouter.get(
  '/:requestId/comments',
  asyncHandler(async (req, res) => {
    const user = (req as AuthenticatedRequest).user;
    const { requestId } = parseOrThrow(requestParamsSchema, req.params);
    await assertRequestAccess(user, requestId);

    const comments = await prisma.requestComment.findMany({
      where: { requestId },
      include: { author: { select: { id: true, name: true, role: true } } },
      orderBy: { createdAt: 'asc' }
    });

    res.json({
      items: comments.map((comment) => ({
        id: comment.id,
        authorId: comment.authorId,
        author: comment.author.name,
        authorRole: comment.author.role,
        content: comment.content,
        createdAt: comment.createdAt.toISOString()
      }))
    });
  })
);

requestRouter.post(
  '/:requestId/comments',
  asyncHandler(async (req, res) => {
    const user = (req as AuthenticatedRequest).user;
    const { requestId } = parseOrThrow(requestParamsSchema, req.params);
    const body = parseOrThrow(createCommentBodySchema, req.body);
    const requestAccess = await assertRequestAccess(user, requestId);

    const request = await prisma.$transaction(async (tx) => {
      await tx.requestComment.create({
        data: {
          requestId,
          authorId: user.id,
          content: body.content
        }
      });

      await createActivity(tx, {
        requestId,
        actorId: user.id,
        type: 'COMMENT_CREATED',
        metadata: { message: body.content }
      });

      const recipients = [requestAccess.requesterId, requestAccess.assigneeId].filter(
        (id): id is string => Boolean(id) && id !== user.id
      );

      await notifyRequestAssignee(
        tx,
        recipients.map((recipientId) => ({
          userId: recipientId,
          requestId,
          type: 'COMMENT',
          title: '새로운 댓글',
          message: `[${requestAccess.title}] 요청에 댓글이 등록되었습니다.`
        }))
      );

      return tx.maintenanceRequest.findUniqueOrThrow({
        where: { id: requestId },
        include: requestInclude
      });
    });

    res.status(201).json(toRequestDto(request));
  })
);

requestRouter.get(
  '/:requestId/pins',
  asyncHandler(async (req, res) => {
    const user = (req as AuthenticatedRequest).user;
    const { requestId } = parseOrThrow(requestParamsSchema, req.params);
    await assertRequestAccess(user, requestId);

    const pins = await prisma.requestPin.findMany({
      where: { requestId },
      orderBy: { sortOrder: 'asc' }
    });

    res.json({ items: pins });
  })
);

requestRouter.post(
  '/:requestId/pins',
  asyncHandler(async (req, res) => {
    const user = (req as AuthenticatedRequest).user;
    const { requestId } = parseOrThrow(requestParamsSchema, req.params);
    const body = parseOrThrow(createPinSchema, req.body);
    const requestRecord = await assertRequestAccess(user, requestId);

    if (requestRecord.status === 'COMPLETED') {
      throw conflict('완료된 요청의 수정 위치(핀)는 변경할 수 없습니다.');
    }

    const request = await prisma.$transaction(async (tx) => {
      const nextOrder =
        body.sortOrder ??
        (await tx.requestPin.count({
          where: { requestId }
        }));

      await tx.requestPin.create({
        data: {
          requestId,
          xPercent: body.xPercent,
          yPercent: body.yPercent,
          content: body.content,
          sortOrder: nextOrder
        }
      });

      await createActivity(tx, {
        requestId,
        actorId: user.id,
        type: 'PIN_CREATED',
        metadata: { message: body.content }
      });

      return tx.maintenanceRequest.findUniqueOrThrow({
        where: { id: requestId },
        include: requestInclude
      });
    });

    res.status(201).json(toRequestDto(request));
  })
);

requestRouter.patch(
  '/:requestId/pins/:pinId',
  asyncHandler(async (req, res) => {
    const user = (req as AuthenticatedRequest).user;
    const { requestId, pinId } = parseOrThrow(pinParamsSchema, req.params);
    const body = parseOrThrow(updatePinSchema, req.body);
    const requestRecord = await assertRequestAccess(user, requestId);

    if (requestRecord.status === 'COMPLETED') {
      throw conflict('완료된 요청의 수정 위치(핀)는 변경할 수 없습니다.');
    }

    const pin = await prisma.requestPin.findFirst({
      where: { id: pinId, requestId }
    });

    if (!pin) {
      throw notFound('핀을 찾을 수 없습니다.');
    }

    const coordsChanged =
      (body.xPercent !== undefined && body.xPercent !== pin.xPercent) ||
      (body.yPercent !== undefined && body.yPercent !== pin.yPercent);
    const contentChanged = body.content !== undefined && body.content !== pin.content;

    const updatedPin = await prisma.$transaction(async (tx) => {
      const updated = await tx.requestPin.update({
        where: { id: pinId },
        data: {
          xPercent: body.xPercent ?? undefined,
          yPercent: body.yPercent ?? undefined,
          content: body.content ?? undefined
        }
      });

      await createActivity(tx, {
        requestId,
        actorId: user.id,
        type: 'PIN_UPDATED',
        metadata: {
          pinId,
          coordsChanged,
          contentChanged
        }
      });

      return updated;
    });

    res.json({
      id: updatedPin.id,
      requestId: updatedPin.requestId,
      xPercent: updatedPin.xPercent,
      yPercent: updatedPin.yPercent,
      content: updatedPin.content,
      sortOrder: updatedPin.sortOrder,
      createdAt: updatedPin.createdAt.toISOString()
    });
  })
);

requestRouter.delete(
  '/:requestId/pins/:pinId',
  asyncHandler(async (req, res) => {
    const user = (req as AuthenticatedRequest).user;
    const { requestId, pinId } = parseOrThrow(pinParamsSchema, req.params);
    const requestRecord = await assertRequestAccess(user, requestId);

    if (requestRecord.status === 'COMPLETED') {
      throw conflict('완료된 요청의 수정 위치(핀)는 변경할 수 없습니다.');
    }

    const pin = await prisma.requestPin.findFirst({
      where: { id: pinId, requestId }
    });

    if (!pin) {
      throw notFound('핀을 찾을 수 없습니다.');
    }

    await prisma.$transaction(async (tx) => {
      await tx.requestPin.delete({ where: { id: pinId } });
      await createActivity(tx, {
        requestId,
        actorId: user.id,
        type: 'PIN_DELETED',
        metadata: { pinId }
      });
    });

    res.status(204).send();
  })
);

requestRouter.post(
  '/:requestId/review',
  asyncHandler(async (req, res) => {
    const user = (req as AuthenticatedRequest).user;
    const { requestId } = parseOrThrow(requestParamsSchema, req.params);
    const body = parseOrThrow(reviewRequestBodySchema, req.body);
    const accessRecord = await assertRequestAccess(user, requestId);

    if (!canReviewRequest(user, accessRecord)) {
      throw forbidden();
    }

    await updateRequestStatus(user, requestId, body.decision === 'APPROVED' ? 'COMPLETED' : 'REJECTED', {
      comment: body.comment
    });

    await prisma.requestReview.create({
      data: {
        requestId,
        reviewerId: user.id,
        decision: body.decision,
        comment: body.comment
      }
    });

    const request = await prisma.maintenanceRequest.findUniqueOrThrow({
      where: { id: requestId },
      include: requestInclude
    });

    res.status(201).json(toRequestDto(request));
  })
);
