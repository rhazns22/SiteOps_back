import { Prisma } from '@prisma/client';
import { Router } from 'express';
import { z } from 'zod';
import prisma from '../lib/prisma';
import { authenticateToken, requireRole } from '../middleware/authMiddleware';
import { asyncHandler } from '../middleware/asyncHandler';
import { requestInclude } from '../services/requestService';
import { badRequest, forbidden, notFound } from '../utils/errors';
import { toProjectDto, toRequestDto, toUserDto } from '../utils/serializers';
import { optionalPositiveInt, parseOrThrow } from '../utils/validators';
import type { AuthenticatedRequest, CurrentUser } from '../types/http';

export const clientRouter = Router();

const clientParamsSchema = z.object({
  clientId: z.string().min(1)
});

const listClientsQuerySchema = z.object({
  page: optionalPositiveInt(1),
  limit: optionalPositiveInt(20).pipe(z.number().max(100)),
  q: z.string().trim().optional(),
  status: z.enum(['all', 'active', 'inactive']).default('active'),
  managerId: z.string().trim().optional(),
  sortBy: z.enum(['name', 'projectCount', 'progressCount', 'reviewCount', 'recentRequestAt']).default('name'),
  sortDir: z.enum(['asc', 'desc']).default('asc')
});

const clientBodySchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    contactName: z.string().trim().max(120).optional().nullable(),
    contactEmail: z.string().trim().email().optional().nullable(),
    contactPhone: z.string().trim().max(50).optional().nullable(),
    memo: z.string().trim().max(2000).optional().nullable(),
    managerId: z.string().trim().optional().nullable()
  })
  .strict();

const updateClientBodySchema = clientBodySchema.partial().refine((value) => Object.keys(value).length > 0, {
  message: '수정할 값이 필요합니다.'
});

const updateClientStatusBodySchema = z
  .object({
    isActive: z.boolean()
  })
  .strict();

const clientWhereForUser = (user: CurrentUser): Prisma.ClientWhereInput => {
  if (user.role === 'ADMIN') return {};
  if (user.role === 'CLIENT') return { id: user.clientId ?? '__missing_client__' };
  return {
    projects: {
      some: {
        maintenanceRequests: {
          some: {
            assigneeId: user.id,
            deletedAt: null
          }
        }
      }
    }
  };
};

const clientInclude = {
  manager: { select: { id: true, name: true, email: true } },
  users: { select: { id: true, email: true, name: true, role: true, clientId: true, phone: true, avatarPath: true } },
  projects: {
    include: {
      client: true,
      maintenanceRequests: {
        where: { deletedAt: null },
        select: { id: true, status: true, dueDate: true, createdAt: true }
      }
    }
  }
};

const toClientDto = (client: Prisma.ClientGetPayload<{ include: typeof clientInclude }>) => {
  const requests = client.projects.flatMap((project) => project.maintenanceRequests);
  const recentRequestAt = requests.reduce<Date | null>((latest, request) => {
    if (!latest || request.createdAt > latest) return request.createdAt;
    return latest;
  }, null);

  return {
    id: client.id,
    name: client.name,
    contactName: client.contactName,
    contactEmail: client.contactEmail,
    contactPhone: client.contactPhone,
    memo: client.memo,
    isActive: client.isActive,
    archivedAt: client.archivedAt?.toISOString() ?? null,
    managerId: client.managerId,
    managerName: client.manager?.name ?? null,
    managerEmail: client.manager?.email ?? null,
    projectCount: client.projects.length,
    userCount: client.users.length,
    progressCount: requests.filter((request) => request.status === 'IN_PROGRESS').length,
    reviewCount: requests.filter((request) => request.status === 'REVIEW_REQUESTED').length,
    recentRequestAt: recentRequestAt?.toISOString() ?? null,
    createdAt: client.createdAt.toISOString(),
    updatedAt: client.updatedAt.toISOString()
  };
};

const assertClientAccess = async (user: CurrentUser, clientId: string) => {
  const client = await prisma.client.findFirst({
    where: {
      AND: [{ id: clientId }, clientWhereForUser(user)]
    },
    include: clientInclude
  });

  if (!client) {
    throw notFound('클라이언트를 찾을 수 없습니다.');
  }

  return client;
};

const assertAdminManager = async (managerId?: string | null) => {
  if (!managerId) return;
  const manager = await prisma.user.findFirst({
    where: { id: managerId, role: 'ADMIN' },
    select: { id: true }
  });
  if (!manager) {
    throw badRequest('담당 관리자는 ADMIN 사용자만 지정할 수 있습니다.');
  }
};

clientRouter.use(authenticateToken);

clientRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const user = (req as AuthenticatedRequest).user;
    const query = parseOrThrow(listClientsQuerySchema, req.query);
    const where: Prisma.ClientWhereInput = {
      AND: [
        clientWhereForUser(user),
        query.status === 'active' ? { isActive: true } : query.status === 'inactive' ? { isActive: false } : {},
        query.managerId && user.role === 'ADMIN' ? { managerId: query.managerId } : {},
        query.q
          ? {
              OR: [
                { name: { contains: query.q, mode: 'insensitive' } },
                { contactName: { contains: query.q, mode: 'insensitive' } },
                { contactEmail: { contains: query.q, mode: 'insensitive' } },
                { contactPhone: { contains: query.q, mode: 'insensitive' } }
              ]
            }
          : {}
      ]
    };

    const clients = await prisma.client.findMany({
      where,
      include: clientInclude
    });

    const sorted = clients
      .map(toClientDto)
      .sort((left, right) => {
        const dir = query.sortDir === 'asc' ? 1 : -1;
        const leftValue = left[query.sortBy] ?? '';
        const rightValue = right[query.sortBy] ?? '';
        if (leftValue < rightValue) return -1 * dir;
        if (leftValue > rightValue) return 1 * dir;
        return left.name.localeCompare(right.name, 'ko-KR');
      });

    const total = sorted.length;
    const start = (query.page - 1) * query.limit;

    res.json({
      items: sorted.slice(start, start + query.limit),
      pagination: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages: Math.ceil(total / query.limit)
      }
    });
  })
);

clientRouter.post(
  '/',
  requireRole(['ADMIN']),
  asyncHandler(async (req, res) => {
    const body = parseOrThrow(clientBodySchema, req.body);
    await assertAdminManager(body.managerId);

    const client = await prisma.client.create({
      data: {
        name: body.name,
        contactName: body.contactName ?? null,
        contactEmail: body.contactEmail ?? null,
        contactPhone: body.contactPhone ?? null,
        memo: body.memo ?? null,
        managerId: body.managerId ?? null
      },
      include: clientInclude
    });

    res.status(201).json(toClientDto(client));
  })
);

clientRouter.get(
  '/:clientId',
  asyncHandler(async (req, res) => {
    const user = (req as AuthenticatedRequest).user;
    const { clientId } = parseOrThrow(clientParamsSchema, req.params);
    const client = await assertClientAccess(user, clientId);

    const recentRequests = await prisma.maintenanceRequest.findMany({
      where: {
        deletedAt: null,
        project: { clientId }
      },
      include: requestInclude,
      orderBy: { updatedAt: 'desc' },
      take: 8
    });

    const activities = await prisma.requestActivity.findMany({
      where: {
        request: {
          deletedAt: null,
          project: { clientId }
        }
      },
      include: { actor: { select: { id: true, name: true, role: true } } },
      orderBy: { createdAt: 'desc' },
      take: 10
    });

    res.json({
      ...toClientDto(client),
      projects: client.projects.map((project) => toProjectDto({ ...project, users: client.users })),
      users: client.users.map(toUserDto),
      recentRequests: recentRequests.map(toRequestDto),
      activities: activities.map((activity) => ({
        id: activity.id,
        user: activity.actor?.name ?? '시스템',
        role: activity.actor?.role ?? 'SYSTEM',
        type: activity.type,
        createdAt: activity.createdAt.toISOString()
      }))
    });
  })
);

clientRouter.patch(
  '/:clientId',
  requireRole(['ADMIN']),
  asyncHandler(async (req, res) => {
    const { clientId } = parseOrThrow(clientParamsSchema, req.params);
    const body = parseOrThrow(updateClientBodySchema, req.body);
    await assertAdminManager(body.managerId);

    const client = await prisma.client.update({
      where: { id: clientId },
      data: {
        name: body.name,
        contactName: body.contactName,
        contactEmail: body.contactEmail,
        contactPhone: body.contactPhone,
        memo: body.memo,
        managerId: body.managerId
      },
      include: clientInclude
    });

    res.json(toClientDto(client));
  })
);

clientRouter.patch(
  '/:clientId/status',
  requireRole(['ADMIN']),
  asyncHandler(async (req, res) => {
    const { clientId } = parseOrThrow(clientParamsSchema, req.params);
    const body = parseOrThrow(updateClientStatusBodySchema, req.body);

    const client = await prisma.client.update({
      where: { id: clientId },
      data: {
        isActive: body.isActive,
        archivedAt: body.isActive ? null : new Date()
      },
      include: clientInclude
    });

    res.json(toClientDto(client));
  })
);

clientRouter.get(
  '/:clientId/projects',
  asyncHandler(async (req, res) => {
    const user = (req as AuthenticatedRequest).user;
    const { clientId } = parseOrThrow(clientParamsSchema, req.params);
    const client = await assertClientAccess(user, clientId);
    res.json({ items: client.projects.map((project) => toProjectDto({ ...project, users: client.users })) });
  })
);

clientRouter.get(
  '/:clientId/users',
  asyncHandler(async (req, res) => {
    const user = (req as AuthenticatedRequest).user;
    const { clientId } = parseOrThrow(clientParamsSchema, req.params);
    const client = await assertClientAccess(user, clientId);
    res.json({ items: client.users.map(toUserDto) });
  })
);

clientRouter.get(
  '/:clientId/requests',
  asyncHandler(async (req, res) => {
    const user = (req as AuthenticatedRequest).user;
    const { clientId } = parseOrThrow(clientParamsSchema, req.params);
    await assertClientAccess(user, clientId);

    const requests = await prisma.maintenanceRequest.findMany({
      where: {
        deletedAt: null,
        project: { clientId }
      },
      include: requestInclude,
      orderBy: { updatedAt: 'desc' },
      take: 50
    });

    if (user.role === 'CLIENT' && user.clientId !== clientId) {
      throw forbidden();
    }

    res.json({ items: requests.map(toRequestDto) });
  })
);
