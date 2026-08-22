import type { Request, Response, NextFunction } from 'express';
import type { Role } from '@prisma/client';

export interface CurrentUser {
  id: string;
  email: string | null;
  name: string;
  role: Role;
  clientId: string | null;
}

export interface AuthenticatedRequest extends Request {
  user: CurrentUser;
}

export type AsyncHandler<TRequest extends Request = Request> = (
  req: TRequest,
  res: Response,
  next: NextFunction
) => Promise<void>;
