import { Router } from 'express';
import prisma from '../lib/prisma';
import { authenticateToken } from '../middleware/authMiddleware';
import { asyncHandler } from '../middleware/asyncHandler';
import { notFound } from '../utils/errors';
import { toNotificationDto } from '../utils/serializers';
import { parseOrThrow } from '../utils/validators';
import type { AuthenticatedRequest } from '../types/http';
import { z } from 'zod';

const notificationParamsSchema = z.object({
  notificationId: z.string().min(1)
});

export const notificationRouter = Router();

notificationRouter.use(authenticateToken);

notificationRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const user = (req as AuthenticatedRequest).user;
    const notifications = await prisma.notification.findMany({
      where: { userId: user.id },
      include: { request: { include: { project: true } } },
      orderBy: { createdAt: 'desc' },
      take: 50
    });

    res.json({ items: notifications.map(toNotificationDto) });
  })
);

notificationRouter.patch(
  '/read-all',
  asyncHandler(async (req, res) => {
    const user = (req as AuthenticatedRequest).user;
    await prisma.notification.updateMany({
      where: { userId: user.id, isRead: false },
      data: { isRead: true }
    });

    res.json({ success: true });
  })
);

notificationRouter.patch(
  '/:notificationId/read',
  asyncHandler(async (req, res) => {
    const user = (req as AuthenticatedRequest).user;
    const { notificationId } = parseOrThrow(notificationParamsSchema, req.params);
    const notification = await prisma.notification.findFirst({
      where: { id: notificationId, userId: user.id }
    });

    if (!notification) {
      throw notFound('알림을 찾을 수 없습니다.');
    }

    const updated = await prisma.notification.update({
      where: { id: notificationId },
      data: { isRead: true },
      include: { request: { include: { project: true } } }
    });

    res.json(toNotificationDto(updated));
  })
);
