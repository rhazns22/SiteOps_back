import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import prisma from '../lib/prisma';
import { getSupabase } from '../lib/supabase';
import { authenticateToken } from '../middleware/authMiddleware';
import { asyncHandler } from '../middleware/asyncHandler';
import { env } from '../config/env';
import { assertRequestAccess } from '../services/accessService';
import { createActivity, requestInclude } from '../services/requestService';
import { badRequest, forbidden, notFound } from '../utils/errors';
import { toRequestDto } from '../utils/serializers';
import type { AuthenticatedRequest } from '../types/http';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024
  }
});

const allowedMimeByExt = new Map<string, string[]>([
  ['.jpg', ['image/jpeg']],
  ['.jpeg', ['image/jpeg']],
  ['.png', ['image/png']],
  ['.webp', ['image/webp']],
  ['.pdf', ['application/pdf']]
]);

const validateUploadFile = (file: Express.Multer.File) => {
  const ext = path.extname(file.originalname).toLowerCase();
  const allowedMimes = allowedMimeByExt.get(ext);

  if (!allowedMimes || !allowedMimes.includes(file.mimetype)) {
    throw badRequest('허용되지 않는 파일 형식입니다.', {
      allowedExtensions: Array.from(allowedMimeByExt.keys())
    });
  }
};

const safeFileName = (name: string) => name.replace(/[^a-zA-Z0-9._-]/g, '_');

export const uploadRouter = Router();

uploadRouter.use(authenticateToken);

uploadRouter.post(
  '/request-attachments',
  upload.single('file'),
  asyncHandler(async (req, res) => {
    const user = (req as AuthenticatedRequest).user;
    const file = req.file;

    if (!file) {
      throw badRequest('업로드할 파일이 필요합니다.');
    }

    validateUploadFile(file);

    const requestId = String(req.body.requestId ?? '');
    const kind = String(req.body.kind ?? 'attachment');

    if (!requestId) {
      throw badRequest('requestId가 필요합니다.');
    }

    await assertRequestAccess(user, requestId);

    const storagePath = `${requestId}/${Date.now()}-${safeFileName(file.originalname)}`;
    const supabase = getSupabase();
    const { error } = await supabase.storage.from(env.supabaseBucket).upload(storagePath, file.buffer, {
      contentType: file.mimetype,
      upsert: false
    });

    if (error) {
      throw badRequest('파일 업로드에 실패했습니다.', { reason: error.message });
    }

    const request = await prisma.$transaction(async (tx) => {
      await tx.requestAttachment.create({
        data: {
          requestId,
          storagePath,
          originalName: file.originalname,
          mimeType: file.mimetype,
          size: file.size,
          kind
        }
      });

      await tx.maintenanceRequest.update({
        where: { id: requestId },
        data: {
          beforeImagePath: kind === 'before' ? storagePath : undefined,
          afterImagePath: kind === 'after' ? storagePath : undefined
        }
      });

      await createActivity(tx, {
        requestId,
        actorId: user.id,
        type: 'ATTACHMENT_ADDED',
        metadata: { fileName: file.originalname, kind }
      });

      return tx.maintenanceRequest.findUniqueOrThrow({
        where: { id: requestId },
        include: requestInclude
      });
    });

    res.status(201).json(toRequestDto(request));
  })
);

uploadRouter.get(
  '/signed-url',
  asyncHandler(async (req, res) => {
    const user = (req as AuthenticatedRequest).user;
    const storagePath = typeof req.query.path === 'string' ? req.query.path : '';

    if (!storagePath) {
      throw badRequest('path query가 필요합니다.');
    }

    const request = await prisma.maintenanceRequest.findFirst({
      where: {
        OR: [
          { beforeImagePath: storagePath },
          { afterImagePath: storagePath },
          { attachments: { some: { storagePath } } }
        ]
      },
      include: { project: true }
    });

    if (!request) {
      throw notFound('파일을 찾을 수 없습니다.');
    }

    const accessRecord = await assertRequestAccess(user, request.id);
    if (accessRecord.id !== request.id) {
      throw forbidden();
    }

    const { data, error } = await getSupabase()
      .storage
      .from(env.supabaseBucket)
      .createSignedUrl(storagePath, 60 * 5);

    if (error || !data?.signedUrl) {
      throw badRequest('서명 URL 발급에 실패했습니다.', { reason: error?.message });
    }

    res.json({ signedUrl: data.signedUrl, expiresIn: 300 });
  })
);
