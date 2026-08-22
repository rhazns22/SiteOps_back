import { Router } from 'express';
import crypto from 'crypto';
import { Role } from '@prisma/client';
import prisma from '../lib/prisma';
import { authenticateToken, requireRole } from '../middleware/authMiddleware';
import { asyncHandler } from '../middleware/asyncHandler';
import { badRequest, forbidden, notFound } from '../utils/errors';
import type { AuthenticatedRequest } from '../types/http';

export const invitationRouter = Router();

// 1. POST /api/v1/invitations/preview (Public - preview before accepting)
invitationRouter.post(
  '/preview',
  asyncHandler(async (req, res) => {
    const { token } = req.body;
    if (!token || typeof token !== 'string') {
      throw badRequest('초대 토큰이 필요합니다.');
    }

    const tokenHash = crypto.createHash('sha256').update(token.trim()).digest('hex');
    const invitation = await prisma.invitation.findUnique({
      where: { tokenHash },
      include: {
        client: { select: { id: true, name: true } },
        project: { select: { id: true, name: true } }
      }
    });

    if (!invitation) {
      res.status(410).json({ message: '유효하지 않거나 존재하지 않는 초대 링크입니다.' });
      return;
    }

    if (invitation.usedAt) {
      res.status(410).json({ message: '이미 사용 완료된 초대 링크입니다.' });
      return;
    }

    if (invitation.revokedAt) {
      res.status(410).json({ message: '취소된 초대 링크입니다.' });
      return;
    }

    if (invitation.expiresAt < new Date()) {
      res.status(410).json({ message: '만료된 초대 링크입니다.' });
      return;
    }

    res.json({
      valid: true,
      role: invitation.role,
      clientId: invitation.clientId,
      clientName: invitation.client?.name || null,
      projectId: invitation.projectId,
      projectName: invitation.project?.name || null,
      invitedEmail: invitation.invitedEmail || null,
      expiresAt: invitation.expiresAt
    });
  })
);

// 2. POST /api/v1/invitations/intents (Create invitation intent token)
invitationRouter.post(
  '/intents',
  asyncHandler(async (req, res) => {
    const { token } = req.body;
    if (!token || typeof token !== 'string') {
      throw badRequest('초대 토큰이 필요합니다.');
    }

    const tokenHash = crypto.createHash('sha256').update(token.trim()).digest('hex');
    const invitation = await prisma.invitation.findUnique({
      where: { tokenHash },
      include: {
        client: { select: { name: true } },
        project: { select: { name: true } }
      }
    });

    if (!invitation || invitation.usedAt || invitation.revokedAt || invitation.expiresAt < new Date()) {
      res.status(410).json({ message: '유효하지 않거나 만료/사용/취소된 초대 링크입니다.' });
      return;
    }

    // Generate 10-minute 1-time intent token
    const rawIntentToken = crypto.randomBytes(32).toString('base64url');
    const intentHash = crypto.createHash('sha256').update(rawIntentToken).digest('hex');
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    await prisma.invitationIntent.create({
      data: {
        invitationId: invitation.id,
        intentHash,
        expiresAt
      }
    });

    res.json({
      intentToken: rawIntentToken,
      role: invitation.role,
      clientName: invitation.client?.name || null,
      projectName: invitation.project?.name || null,
      invitedEmail: invitation.invitedEmail || null,
      expiresAt: invitation.expiresAt
    });
  })
);

// Authenticated ADMIN endpoints
invitationRouter.use(authenticateToken);
invitationRouter.use(requireRole(['ADMIN']));

// 3. POST /api/v1/invitations (Create Invitation)
invitationRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const currentUser = (req as AuthenticatedRequest).user;

    if (currentUser.role !== 'ADMIN') {
      throw forbidden('초대 권한이 없습니다.');
    }

    const { role, clientId, projectId, invitedEmail, expiresInDays } = req.body;

    if (!role || !Object.values(Role).includes(role as Role)) {
      throw badRequest('유효한 역할을 지정해야 합니다 (ADMIN, WORKER, CLIENT).');
    }

    if (role === Role.ADMIN) {
      throw badRequest('어드민(ADMIN) 역할은 초대 링크로 생성할 수 없습니다.');
    }

    if (role === Role.CLIENT && !clientId) {
      throw badRequest('고객사(CLIENT) 역할 초대는 클라이언트 지정이 필수입니다.');
    }

    const rawToken = crypto.randomBytes(32).toString('base64url');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

    const days = typeof expiresInDays === 'number' && expiresInDays > 0 ? expiresInDays : 7;
    const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);

    const invitation = await prisma.invitation.create({
      data: {
        tokenHash,
        role: role as Role,
        clientId: clientId || null,
        projectId: projectId || null,
        invitedEmail: typeof invitedEmail === 'string' && invitedEmail.trim() ? invitedEmail.trim() : null,
        createdById: currentUser.id,
        expiresAt
      },
      include: {
        client: { select: { id: true, name: true } },
        project: { select: { id: true, name: true } },
        createdBy: { select: { id: true, name: true } }
      }
    });

    const frontendUrl = process.env.FRONTEND_URL || 'https://site-ops-front.vercel.app';
    const inviteUrl = `${frontendUrl}/invite#token=${rawToken}`;

    res.status(201).json({
      invitation: {
        id: invitation.id,
        role: invitation.role,
        clientId: invitation.clientId,
        clientName: invitation.client?.name || null,
        projectId: invitation.projectId,
        projectName: invitation.project?.name || null,
        invitedEmail: invitation.invitedEmail,
        createdByName: invitation.createdBy.name,
        expiresAt: invitation.expiresAt,
        createdAt: invitation.createdAt
      },
      inviteUrl
    });
  })
);

// 4. GET /api/v1/invitations (List Invitations)
invitationRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const invitations = await prisma.invitation.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        client: { select: { id: true, name: true } },
        project: { select: { id: true, name: true } },
        createdBy: { select: { id: true, name: true } }
      }
    });

    const now = new Date();
    const result = invitations.map((inv) => {
      let status: 'PENDING' | 'USED' | 'EXPIRED' | 'REVOKED' = 'PENDING';
      if (inv.usedAt) {
        status = 'USED';
      } else if (inv.revokedAt) {
        status = 'REVOKED';
      } else if (inv.expiresAt < now) {
        status = 'EXPIRED';
      }

      return {
        id: inv.id,
        role: inv.role,
        clientId: inv.clientId,
        clientName: inv.client?.name || null,
        projectId: inv.projectId,
        projectName: inv.project?.name || null,
        invitedEmail: inv.invitedEmail,
        createdByName: inv.createdBy.name,
        status,
        expiresAt: inv.expiresAt,
        usedAt: inv.usedAt,
        revokedAt: inv.revokedAt,
        createdAt: inv.createdAt
      };
    });

    res.json({ invitations: result });
  })
);

// 5. POST /api/v1/invitations/:invitationId/revoke (Revoke Invitation)
invitationRouter.post(
  '/:invitationId/revoke',
  asyncHandler(async (req, res) => {
    const { invitationId } = req.params;
    const invitation = await prisma.invitation.findUnique({
      where: { id: invitationId }
    });

    if (!invitation) {
      throw notFound('초대 건을 찾을 수 없습니다.');
    }

    if (invitation.usedAt) {
      throw badRequest('이미 사용된 초대는 취소할 수 없습니다.');
    }

    const updated = await prisma.invitation.update({
      where: { id: invitationId },
      data: { revokedAt: new Date() }
    });

    res.json({ success: true, id: updated.id, revokedAt: updated.revokedAt });
  })
);
