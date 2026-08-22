import { Priority } from '@prisma/client';
import bcrypt from 'bcrypt';
import { Router } from 'express';
import { z } from 'zod';
import prisma from '../lib/prisma';
import { authenticateToken, requireRole } from '../middleware/authMiddleware';
import { asyncHandler } from '../middleware/asyncHandler';
import { conflict, unauthorized } from '../utils/errors';
import { parseOrThrow } from '../utils/validators';
import type { AuthenticatedRequest } from '../types/http';

export const settingsRouter = Router();

const profileBodySchema = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    phone: z.string().trim().max(50).optional().nullable(),
    avatarPath: z.string().trim().max(500).optional().nullable()
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: '수정할 값이 필요합니다.'
  });

const notificationPreferenceSchema = z
  .object({
    assignedNotification: z.boolean().optional(),
    commentNotification: z.boolean().optional(),
    reviewNotification: z.boolean().optional(),
    approvedNotification: z.boolean().optional(),
    rejectedNotification: z.boolean().optional(),
    deadlineNotification: z.boolean().optional(),
    emailNotification: z.boolean().optional(),
    appNotification: z.boolean().optional()
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: '수정할 알림 설정이 필요합니다.'
  });

const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1),
    newPassword: z
      .string()
      .min(8)
      .max(100)
      .regex(/[A-Za-z]/, '새 비밀번호에는 영문자가 포함되어야 합니다.')
      .regex(/[0-9]/, '새 비밀번호에는 숫자가 포함되어야 합니다.')
  })
  .strict();

const workspaceBodySchema = z
  .object({
    serviceName: z.string().trim().min(1).max(80).optional(),
    defaultDueDays: z.number().int().min(1).max(90).optional(),
    defaultPriority: z.nativeEnum(Priority).optional(),
    inviteExpiresInDays: z.number().int().min(1).max(30).optional()
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: '수정할 워크스페이스 설정이 필요합니다.'
  });

const preferenceSelect = {
  assignedNotification: true,
  commentNotification: true,
  reviewNotification: true,
  approvedNotification: true,
  rejectedNotification: true,
  deadlineNotification: true,
  emailNotification: true,
  appNotification: true,
  updatedAt: true
};

const ensurePreference = (userId: string) =>
  prisma.userPreference.upsert({
    where: { userId },
    update: {},
    create: { userId },
    select: preferenceSelect
  });

const ensureWorkspace = () =>
  prisma.workspaceSetting.upsert({
    where: { id: 'workspace' },
    update: {},
    create: { id: 'workspace' }
  });

settingsRouter.use(authenticateToken);

settingsRouter.get(
  '/me',
  asyncHandler(async (req, res) => {
    const currentUser = (req as AuthenticatedRequest).user;
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: currentUser.id },
      select: {
        id: true,
        email: true,
        name: true,
        phone: true,
        avatarPath: true,
        role: true,
        authProvider: true,
        kakaoId: true,
        passwordHash: true,
        clientId: true,
        client: { select: { id: true, name: true } },
        createdAt: true,
        updatedAt: true
      }
    });

    res.json({
      id: user.id,
      email: user.email,
      name: user.name,
      phone: user.phone,
      avatarPath: user.avatarPath,
      role: user.role,
      clientId: user.clientId,
      clientName: user.client?.name ?? null,
      authProvider: user.authProvider,
      kakaoLinked: Boolean(user.kakaoId),
      hasPassword: Boolean(user.passwordHash),
      createdAt: user.createdAt.toISOString(),
      updatedAt: user.updatedAt.toISOString()
    });
  })
);

settingsRouter.patch(
  '/profile',
  asyncHandler(async (req, res) => {
    const currentUser = (req as AuthenticatedRequest).user;
    const body = parseOrThrow(profileBodySchema, req.body);

    const user = await prisma.user.update({
      where: { id: currentUser.id },
      data: {
        name: body.name,
        phone: body.phone,
        avatarPath: body.avatarPath
      },
      select: {
        id: true,
        email: true,
        name: true,
        phone: true,
        avatarPath: true,
        role: true,
        clientId: true,
        updatedAt: true
      }
    });

    res.json(user);
  })
);

settingsRouter.get(
  '/notifications',
  asyncHandler(async (req, res) => {
    const currentUser = (req as AuthenticatedRequest).user;
    const preference = await ensurePreference(currentUser.id);
    res.json(preference);
  })
);

settingsRouter.patch(
  '/notifications',
  asyncHandler(async (req, res) => {
    const currentUser = (req as AuthenticatedRequest).user;
    const body = parseOrThrow(notificationPreferenceSchema, req.body);
    await ensurePreference(currentUser.id);

    const preference = await prisma.userPreference.update({
      where: { userId: currentUser.id },
      data: body,
      select: preferenceSelect
    });

    res.json(preference);
  })
);

settingsRouter.post(
  '/change-password',
  asyncHandler(async (req, res) => {
    const currentUser = (req as AuthenticatedRequest).user;
    const body = parseOrThrow(changePasswordSchema, req.body);
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: currentUser.id },
      select: { passwordHash: true }
    });

    if (!user.passwordHash) {
      throw conflict('카카오 전용 계정은 비밀번호를 변경할 수 없습니다.');
    }

    const ok = await bcrypt.compare(body.currentPassword, user.passwordHash);
    if (!ok) {
      throw unauthorized('현재 비밀번호가 올바르지 않습니다.');
    }

    const nextHash = await bcrypt.hash(body.newPassword, 10);
    await prisma.user.update({
      where: { id: currentUser.id },
      data: {
        passwordHash: nextHash,
        sessionVersion: { increment: 1 }
      }
    });

    res.status(204).send();
  })
);

settingsRouter.post(
  '/revoke-sessions',
  asyncHandler(async (req, res) => {
    const currentUser = (req as AuthenticatedRequest).user;
    await prisma.user.update({
      where: { id: currentUser.id },
      data: { sessionVersion: { increment: 1 } }
    });

    res.json({ success: true });
  })
);

settingsRouter.get(
  '/workspace',
  asyncHandler(async (_req, res) => {
    const workspace = await ensureWorkspace();
    res.json(workspace);
  })
);

settingsRouter.patch(
  '/workspace',
  requireRole(['ADMIN']),
  asyncHandler(async (req, res) => {
    const body = parseOrThrow(workspaceBodySchema, req.body);
    await ensureWorkspace();

    const workspace = await prisma.workspaceSetting.update({
      where: { id: 'workspace' },
      data: body
    });

    res.json(workspace);
  })
);
