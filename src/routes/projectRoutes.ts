import { Router } from 'express';
import prisma from '../lib/prisma';
import { authenticateToken, requireRole } from '../middleware/authMiddleware';
import { asyncHandler } from '../middleware/asyncHandler';
import { accessibleProjectWhere, assertProjectAccess } from '../services/accessService';
import {
  createProjectBodySchema,
  projectParamsSchema,
  updateProjectBodySchema
} from '../validators/projectValidators';
import { parseOrThrow } from '../utils/validators';
import { toProjectDto } from '../utils/serializers';
import type { AuthenticatedRequest } from '../types/http';

export const projectRouter = Router();

projectRouter.use(authenticateToken);

projectRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const user = (req as AuthenticatedRequest).user;
    const projects = await prisma.project.findMany({
      where: accessibleProjectWhere(user),
      include: {
        client: { include: { users: { select: { name: true } } } },
        maintenanceRequests: { where: { deletedAt: null }, select: { status: true, dueDate: true } }
      },
      orderBy: { createdAt: 'desc' }
    });

    res.json(projects.map((project) => toProjectDto({ ...project, users: project.client.users })));
  })
);

projectRouter.get(
  '/:projectId',
  asyncHandler(async (req, res) => {
    const user = (req as AuthenticatedRequest).user;
    const { projectId } = parseOrThrow(projectParamsSchema, req.params);
    await assertProjectAccess(user, projectId);

    const project = await prisma.project.findUniqueOrThrow({
      where: { id: projectId },
      include: {
        client: { include: { users: { select: { name: true } } } },
        maintenanceRequests: { where: { deletedAt: null }, select: { status: true, dueDate: true } }
      }
    });

    res.json(toProjectDto({ ...project, users: project.client.users }));
  })
);

projectRouter.post(
  '/',
  requireRole(['ADMIN']),
  asyncHandler(async (req, res) => {
    const body = parseOrThrow(createProjectBodySchema, req.body);
    const project = await prisma.project.create({
      data: {
        clientId: body.clientId,
        name: body.name,
        websiteUrl: body.websiteUrl,
        description: body.description ?? null
      },
      include: {
        client: { include: { users: { select: { name: true } } } },
        maintenanceRequests: { where: { deletedAt: null }, select: { status: true, dueDate: true } }
      }
    });

    res.status(201).json(toProjectDto({ ...project, users: project.client.users }));
  })
);

projectRouter.patch(
  '/:projectId',
  requireRole(['ADMIN']),
  asyncHandler(async (req, res) => {
    const { projectId } = parseOrThrow(projectParamsSchema, req.params);
    const body = parseOrThrow(updateProjectBodySchema, req.body);
    const project = await prisma.project.update({
      where: { id: projectId },
      data: {
        name: body.name,
        websiteUrl: body.websiteUrl,
        description: body.description
      },
      include: {
        client: { include: { users: { select: { name: true } } } },
        maintenanceRequests: { where: { deletedAt: null }, select: { status: true, dueDate: true } }
      }
    });

    res.json(toProjectDto({ ...project, users: project.client.users }));
  })
);
