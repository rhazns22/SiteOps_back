import type { ActivityType, Prisma, Priority, RequestStatus } from '@prisma/client';
import prisma from '../lib/prisma';
import type { CurrentUser } from '../types/http';
import { conflict, forbidden } from '../utils/errors';
import {
  canEditRequest,
  canReviewRequest,
  canWorkOnRequest,
  getRequestForAccess
} from './accessService';

const allowedTransitions: Record<RequestStatus, RequestStatus[]> = {
  RECEIVED: ['IN_PROGRESS'],
  IN_PROGRESS: ['REVIEW_REQUESTED'],
  REVIEW_REQUESTED: ['COMPLETED', 'REJECTED'],
  REJECTED: ['IN_PROGRESS'],
  COMPLETED: []
};

export const requestInclude = {
  project: { include: { client: true } },
  requester: { select: { id: true, name: true, role: true } },
  assignee: { select: { id: true, name: true, role: true } },
  pins: { orderBy: { sortOrder: 'asc' as const } },
  attachments: { orderBy: { createdAt: 'desc' as const } },
  comments: {
    include: { author: { select: { id: true, name: true, role: true } } },
    orderBy: { createdAt: 'asc' as const }
  },
  activities: {
    include: { actor: { select: { id: true, name: true, role: true } } },
    orderBy: { createdAt: 'desc' as const }
  },
  reviews: {
    include: { reviewer: { select: { id: true, name: true, role: true } } },
    orderBy: { createdAt: 'desc' as const }
  }
};

export const buildListWhere = (
  user: CurrentUser,
  filters: {
    q?: string;
    status?: RequestStatus;
    priority?: Priority;
    projectId?: string;
    assigneeId?: string;
    dueFrom?: Date | null;
    dueTo?: Date | null;
  }
): Prisma.MaintenanceRequestWhereInput => {
  const where: Prisma.MaintenanceRequestWhereInput = {};

  if (filters.q) {
    where.OR = [
      { title: { contains: filters.q, mode: 'insensitive' } },
      { description: { contains: filters.q, mode: 'insensitive' } },
      { pageUrl: { contains: filters.q, mode: 'insensitive' } }
    ];
  }

  if (filters.status) where.status = filters.status;
  if (filters.priority) where.priority = filters.priority;
  if (filters.projectId) where.projectId = filters.projectId;
  if (filters.assigneeId) where.assigneeId = filters.assigneeId;

  if (filters.dueFrom || filters.dueTo) {
    where.dueDate = {
      ...(filters.dueFrom ? { gte: filters.dueFrom } : {}),
      ...(filters.dueTo ? { lte: filters.dueTo } : {})
    };
  }

  if (user.role === 'CLIENT') {
    where.project = { clientId: user.clientId ?? '__missing_client__' };
  }

  if (user.role === 'WORKER') {
    where.assigneeId = user.id;
  }

  return where;
};

export const createActivity = (
  tx: Prisma.TransactionClient,
  data: {
    requestId: string;
    actorId?: string | null;
    type: ActivityType;
    metadata?: Prisma.InputJsonValue;
  }
) =>
  tx.requestActivity.create({
    data: {
      requestId: data.requestId,
      actorId: data.actorId ?? null,
      type: data.type,
      metadata: data.metadata ?? undefined
    }
  });

const notifyUsers = (
  tx: Prisma.TransactionClient,
  notifications: {
    userId: string | null | undefined;
    requestId: string;
    type: 'ASSIGNED' | 'COMMENT' | 'REVIEW_REQUESTED' | 'APPROVED' | 'REJECTED' | 'DUE_SOON';
    title: string;
    message: string;
  }[]
) =>
  Promise.all(
    notifications
      .filter(
        (
          notification
        ): notification is {
          userId: string;
          requestId: string;
          type: 'ASSIGNED' | 'COMMENT' | 'REVIEW_REQUESTED' | 'APPROVED' | 'REJECTED' | 'DUE_SOON';
          title: string;
          message: string;
        } => Boolean(notification.userId)
      )
      .map((notification) =>
        tx.notification.create({
          data: {
            userId: notification.userId,
            requestId: notification.requestId,
            type: notification.type,
            title: notification.title,
            message: notification.message
          }
        })
      )
  );

export const updateRequestStatus = async (
  user: CurrentUser,
  requestId: string,
  targetStatus: RequestStatus,
  options: {
    comment?: string;
    beforeImagePath?: string | null;
    afterImagePath?: string | null;
  } = {}
) => {
  const request = await getRequestForAccess(requestId);
  const allowedTargets =
    user.role === 'ADMIN' && request.status === 'COMPLETED'
      ? ['IN_PROGRESS']
      : allowedTransitions[request.status];

  if (!allowedTargets.includes(targetStatus)) {
    throw conflict('허용되지 않은 상태 전환입니다.', {
      from: request.status,
      to: targetStatus
    });
  }

  if (targetStatus === 'IN_PROGRESS' || targetStatus === 'REVIEW_REQUESTED') {
    if (!canWorkOnRequest(user, request)) {
      throw forbidden();
    }
  }

  if (targetStatus === 'COMPLETED' || targetStatus === 'REJECTED') {
    if (!canReviewRequest(user, request)) {
      throw forbidden();
    }
  }

  const activityType: ActivityType =
    targetStatus === 'REVIEW_REQUESTED'
      ? 'REVIEW_REQUESTED'
      : targetStatus === 'COMPLETED'
        ? 'REVIEW_APPROVED'
        : targetStatus === 'REJECTED'
          ? 'REVIEW_REJECTED'
          : 'STATUS_CHANGED';

  return prisma.$transaction(async (tx) => {
    const updated = await tx.maintenanceRequest.update({
      where: { id: requestId },
      data: {
        status: targetStatus,
        reviewRequestedAt: targetStatus === 'REVIEW_REQUESTED' ? new Date() : request.reviewRequestedAt,
        completedAt: targetStatus === 'COMPLETED' ? new Date() : targetStatus === 'IN_PROGRESS' ? null : request.completedAt,
        beforeImagePath: options.beforeImagePath ?? undefined,
        afterImagePath: options.afterImagePath ?? undefined
      },
      include: requestInclude
    });

    await createActivity(tx, {
      requestId,
      actorId: user.id,
      type: activityType,
      metadata: {
        from: request.status,
        to: targetStatus,
        message: options.comment
      }
    });

    if (targetStatus === 'REVIEW_REQUESTED') {
      await notifyUsers(tx, [
        {
          userId: updated.requesterId,
          requestId,
          type: 'REVIEW_REQUESTED',
          title: '검수 요청',
          message: `[${updated.title}] 요청의 검수가 등록되었습니다.`
        }
      ]);
    }

    if (targetStatus === 'COMPLETED' || targetStatus === 'REJECTED') {
      await notifyUsers(tx, [
        {
          userId: updated.assigneeId,
          requestId,
          type: targetStatus === 'COMPLETED' ? 'APPROVED' : 'REJECTED',
          title: targetStatus === 'COMPLETED' ? '요청 승인' : '요청 반려',
          message:
            targetStatus === 'COMPLETED'
              ? `[${updated.title}] 요청이 승인 완료되었습니다.`
              : `[${updated.title}] 요청이 반려되었습니다.`
        }
      ]);
    }

    return updated;
  });
};

export const assertCanEditRequest = async (user: CurrentUser, requestId: string) => {
  const request = await getRequestForAccess(requestId);
  if (!canEditRequest(user, request)) {
    throw forbidden();
  }
  return request;
};

export const notifyRequestAssignee = notifyUsers;
