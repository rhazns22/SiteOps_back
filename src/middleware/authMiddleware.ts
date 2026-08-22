import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import prisma from '../lib/prisma';
import { requiredEnv } from '../config/env';
import { forbidden, unauthorized } from '../utils/errors';
import type { AuthenticatedRequest, CurrentUser } from '../types/http';

interface JwtPayload {
  sub: string;
  sv?: number;
}

export const authenticateToken = async (req: Request, _res: Response, next: NextFunction) => {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;

    if (!token) {
      throw unauthorized('인증 토큰이 누락되었습니다.');
    }

    const decoded = jwt.verify(token, requiredEnv('JWT_SECRET')) as JwtPayload;
    const user = await prisma.user.findUnique({
      where: { id: decoded.sub },
      select: {
        id: true,
        email: true,
        name: true,
        phone: true,
        avatarPath: true,
        sessionVersion: true,
        role: true,
        clientId: true
      }
    });

    if (!user) {
      throw unauthorized('인증 사용자를 찾을 수 없습니다.');
    }

    if ((decoded.sv ?? 0) !== user.sessionVersion) {
      throw unauthorized('인증 세션이 만료되었습니다. 다시 로그인해 주세요.');
    }

    (req as AuthenticatedRequest).user = user;
    next();
  } catch (error) {
    next(error instanceof jwt.JsonWebTokenError ? unauthorized('인증 토큰이 유효하지 않습니다.') : error);
  }
};

export const requireRole = (roles: CurrentUser['role'][]) => {
  return (req: Request, _res: Response, next: NextFunction) => {
    const user = (req as AuthenticatedRequest).user;
    if (!user || !roles.includes(user.role)) {
      next(forbidden());
      return;
    }

    next();
  };
};
