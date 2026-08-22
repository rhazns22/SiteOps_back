import { Router } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import prisma from '../lib/prisma';
import { authenticateToken } from '../middleware/authMiddleware';
import { asyncHandler } from '../middleware/asyncHandler';
import { loginLimiter } from '../middleware/rateLimit';
import { loginBodySchema } from '../validators/authValidators';
import { parseOrThrow } from '../utils/validators';
import { requiredEnv } from '../config/env';
import { unauthorized } from '../utils/errors';
import { toUserDto } from '../utils/serializers';
import type { AuthenticatedRequest } from '../types/http';

export const authRouter = Router();

authRouter.post(
  '/login',
  loginLimiter,
  asyncHandler(async (req, res) => {
    const { email, password } = parseOrThrow(loginBodySchema, req.body);
    const user = await prisma.user.findUnique({
      where: { email }
    });

    if (!user || !user.passwordHash) {
      throw unauthorized('이메일 또는 비밀번호가 올바르지 않습니다.');
    }

    const passwordMatches = await bcrypt.compare(password, user.passwordHash);
    if (!passwordMatches) {
      throw unauthorized('이메일 또는 비밀번호가 올바르지 않습니다.');
    }

    const accessToken = jwt.sign(
      {
        sub: user.id,
        role: user.role,
        sv: user.sessionVersion
      },
      requiredEnv('JWT_SECRET'),
      { expiresIn: '7d' }
    );

    res.json({
      accessToken,
      user: toUserDto(user)
    });
  })
);

authRouter.get(
  '/me',
  authenticateToken,
  asyncHandler(async (req, res) => {
    res.json({
      user: toUserDto((req as AuthenticatedRequest).user)
    });
  })
);
