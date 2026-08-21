import { Router } from 'express';
import prisma from '../lib/prisma';
import { asyncHandler } from '../middleware/asyncHandler';

export const healthRouter = Router();

healthRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    let database = 'unavailable';

    try {
      await prisma.$queryRaw`SELECT 1`;
      database = 'ok';
    } catch {
      database = 'unavailable';
    }

    res.json({
      status: 'ok',
      database,
      timestamp: new Date().toISOString()
    });
  })
);
