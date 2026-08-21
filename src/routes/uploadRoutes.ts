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
import { badRequest, conflict, forbidden, notFound } from '../utils/errors';
import { toRequestDto } from '../utils/serializers';
import type { AuthenticatedRequest, CurrentUser } from '../types/http';

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
  if (!file.buffer || file.size === 0) {
    throw badRequest('빈 파일은 업로드할 수 없습니다.');
  }

  const ext = path.extname(file.originalname).toLowerCase();
  const allowedMimes = allowedMimeByExt.get(ext);

  if (!allowedMimes || !allowedMimes.includes(file.mimetype)) {
    throw badRequest('허용되지 않는 파일 형식입니다.', {
      allowedExtensions: Array.from(allowedMimeByExt.keys())
    });
  }

  const buf = file.buffer;
  if (ext === '.png') {
    if (buf.length < 8 || buf[0] !== 0x89 || buf[1] !== 0x50 || buf[2] !== 0x4e || buf[3] !== 0x47) {
      throw badRequest('올바른 PNG 파일 형식이 아닙니다 (Magic Bytes 검증 실패).');
    }
  } else if (ext === '.jpg' || ext === '.jpeg') {
    if (buf.length < 3 || buf[0] !== 0xff || buf[1] !== 0xd8 || buf[2] !== 0xff) {
      throw badRequest('올바른 JPEG 파일 형식이 아닙니다 (Magic Bytes 검증 실패).');
    }
  } else if (ext === '.pdf') {
    if (buf.length < 4 || buf[0] !== 0x25 || buf[1] !== 0x50 || buf[2] !== 0x44 || buf[3] !== 0x46) {
      throw badRequest('올바른 PDF 파일 형식이 아닙니다 (Magic Bytes 검증 실패).');
    }
  } else if (ext === '.webp') {
    if (buf.length < 12 || buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WEBP') {
      throw badRequest('올바른 WEBP 파일 형식이 아닙니다 (Magic Bytes 검증 실패).');
    }
  }
};

const safeFileName = (name: string) => path.basename(name).replace(/[^a-zA-Z0-9._-]/g, '_');

const assertCanUploadAttachment = async (user: CurrentUser, requestId: string, kind: string) => {
  const request = await assertRequestAccess(user, requestId);

  if (request.status === 'COMPLETED') {
    throw conflict('완료된 요청에는 추가 첨부파일을 업로드할 수 없습니다.');
  }

  if (kind === 'before') {
    if (!(user.role === 'CLIENT' && request.requesterId === user.id && request.project.clientId === user.clientId)) {
      throw forbidden('요청을 생성한 고객만 사전(before) 이미지를 업로드할 수 있습니다.');
    }
  } else if (kind === 'after') {
    if (!(user.role === 'WORKER' && request.assigneeId === user.id)) {
      throw forbidden('담당 작업자만 결과(after) 이미지를 업로드할 수 있습니다.');
    }
  } else if (kind === 'attachment') {
    // Already asserted request access
  } else {
    throw badRequest('유효하지 않은 첨부파일 종류(kind)입니다.');
  }

  return request;
};

export const uploadRouter = Router();

uploadRouter.use(authenticateToken);

uploadRouter.post(
  '/request-attachments',
  (req, res, next) => {
    upload.single('file')(req, res, (err) => {
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return next(badRequest('파일 크기가 최대 제한(10MB)을 초과했습니다.'));
        }
        return next(badRequest(`파일 업로드 오류: ${err.message}`));
      }
      if (err) {
        return next(err);
      }
      next();
    });
  },
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

    await assertCanUploadAttachment(user, requestId, kind);

    const storagePath = `${requestId}/${Date.now()}-${safeFileName(file.originalname)}`;
    const supabase = getSupabase();
    const { error } = await supabase.storage.from(env.supabaseBucket).upload(storagePath, file.buffer, {
      contentType: file.mimetype,
      upsert: false
    });

    if (error) {
      throw badRequest('파일 업로드에 실패했습니다.', { reason: error.message });
    }

    try {
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
    } catch (err) {
      await supabase.storage.from(env.supabaseBucket).remove([storagePath]).catch(() => {});
      throw err;
    }
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
