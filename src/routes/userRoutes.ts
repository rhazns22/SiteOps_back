import { Role } from '@prisma/client';
import { Router } from 'express';
import { z } from 'zod';
import prisma from '../lib/prisma';
import { authenticateToken, requireRole } from '../middleware/authMiddleware';
import { asyncHandler } from '../middleware/asyncHandler';
import { parseOrThrow } from '../utils/validators';
import { toUserDto } from '../utils/serializers';

const listUsersQuerySchema = z.object({
  role: z.nativeEnum(Role).optional()
});

export const userRouter = Router();

userRouter.use(authenticateToken);
userRouter.use(requireRole(['ADMIN']));

userRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const query = parseOrThrow(listUsersQuerySchema, req.query);
    const users = await prisma.user.findMany({
      where: query.role ? { role: query.role } : undefined,
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        clientId: true
      },
      orderBy: { name: 'asc' }
    });

    res.json({ items: users.map(toUserDto) });
  })
);
