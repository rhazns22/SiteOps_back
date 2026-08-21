import { Router } from 'express';
import type { Prisma, RequestStatus } from '@prisma/client';
import prisma from '../lib/prisma';
import { authenticateToken } from '../middleware/authMiddleware';
import { asyncHandler } from '../middleware/asyncHandler';
import { accessibleRequestWhere } from '../services/accessService';
import { requestInclude } from '../services/requestService';
import { toRequestDto } from '../utils/serializers';
import type { AuthenticatedRequest } from '../types/http';

export const dashboardRouter = Router();

dashboardRouter.use(authenticateToken);

const statusLabel: Record<RequestStatus, string> = {
  RECEIVED: '접수',
  IN_PROGRESS: '진행 중',
  REVIEW_REQUESTED: '고객 검수 대기',
  COMPLETED: '완료',
  REJECTED: '반려'
};

dashboardRouter.get(
  '/summary',
  asyncHandler(async (req, res) => {
    const user = (req as AuthenticatedRequest).user;
    const baseWhere = accessibleRequestWhere(user);
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);

    const [progress, review, dueToday, overdue, unreadNotifications] = await Promise.all([
      prisma.maintenanceRequest.count({ where: { ...baseWhere, status: 'IN_PROGRESS' } }),
      prisma.maintenanceRequest.count({ where: { ...baseWhere, status: 'REVIEW_REQUESTED' } }),
      prisma.maintenanceRequest.count({
        where: {
          ...baseWhere,
          dueDate: { lte: todayEnd, gte: new Date(new Date().setHours(0, 0, 0, 0)) },
          status: { not: 'COMPLETED' }
        }
      }),
      prisma.maintenanceRequest.count({
        where: {
          ...baseWhere,
          dueDate: { lt: new Date(new Date().setHours(0, 0, 0, 0)) },
          status: { not: 'COMPLETED' }
        }
      }),
      prisma.notification.count({
        where: {
          userId: user.id,
          isRead: false
        }
      })
    ]);

    res.json({
      progress,
      review,
      dueToday,
      overdue,
      unreadNotifications
    });
  })
);

dashboardRouter.get(
  '/urgent-requests',
  asyncHandler(async (req, res) => {
    const user = (req as AuthenticatedRequest).user;
    const where = accessibleRequestWhere(user);
    const items = await prisma.maintenanceRequest.findMany({
      where: {
        ...where,
        status: { not: 'COMPLETED' },
        dueDate: { not: null }
      },
      take: 8,
      include: requestInclude,
      orderBy: [{ dueDate: 'asc' }, { priority: 'desc' }]
    });

    res.json({ items: items.map(toRequestDto) });
  })
);

dashboardRouter.get(
  '/bottlenecks',
  asyncHandler(async (req, res) => {
    const user = (req as AuthenticatedRequest).user;
    const baseWhere = accessibleRequestWhere(user);
    const statuses: RequestStatus[] = ['RECEIVED', 'IN_PROGRESS', 'REVIEW_REQUESTED', 'REJECTED'];
    const items = await Promise.all(
      statuses.map(async (status) => {
        const where: Prisma.MaintenanceRequestWhereInput = { ...baseWhere, status };
        const [count, oldest] = await Promise.all([
          prisma.maintenanceRequest.count({ where }),
          prisma.maintenanceRequest.findFirst({
            where,
            orderBy: { createdAt: 'asc' },
            select: { title: true, createdAt: true }
          })
        ]);

        const avgDays = oldest ? Math.max(0.1, (Date.now() - oldest.createdAt.getTime()) / 86_400_000) : 0;

        return {
          status,
          label: statusLabel[status],
          count,
          averageDays: Number(avgDays.toFixed(1)),
          oldestRequest: oldest?.title ?? null
        };
      })
    );

    res.json({ items });
  })
);
