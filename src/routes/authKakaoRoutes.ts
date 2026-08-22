import { Router } from 'express';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import prisma from '../lib/prisma';
import { asyncHandler } from '../middleware/asyncHandler';
import { requiredEnv } from '../config/env';
import { unauthorized, badRequest } from '../utils/errors';
import { toUserDto } from '../utils/serializers';

export const authKakaoRouter = Router();

const getFrontendUrl = () => {
  return process.env.FRONTEND_URL || 'https://site-ops-front.vercel.app';
};

const getBackendRedirectUri = () => {
  return (
    process.env.KAKAO_REDIRECT_URI ||
    'https://siteops-backend-production.up.railway.app/api/v1/auth/kakao/callback'
  );
};

// 1. GET /api/v1/auth/kakao/start
authKakaoRouter.get(
  '/start',
  asyncHandler(async (req, res) => {
    const { intentToken, returnTo } = req.query;

    const restApiKey = process.env.KAKAO_REST_API_KEY;
    if (!restApiKey) {
      throw badRequest('카카오 REST API 키가 서버에 설정되어 있지 않습니다.');
    }

    let validReturnTo: string | null = null;
    if (
      typeof returnTo === 'string' &&
      returnTo.startsWith('/') &&
      !returnTo.startsWith('//') &&
      !returnTo.includes('\\') &&
      !returnTo.includes(':')
    ) {
      validReturnTo = returnTo;
    }

    const rawState = crypto.randomBytes(24).toString('hex');
    const stateHash = crypto.createHash('sha256').update(rawState).digest('hex');

    let intentHash: string | null = null;
    if (typeof intentToken === 'string' && intentToken.trim().length > 0) {
      intentHash = crypto
        .createHash('sha256')
        .update(intentToken.trim())
        .digest('hex');
    }

    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    await prisma.oAuthState.create({
      data: {
        stateHash,
        intentHash,
        returnTo: validReturnTo,
        expiresAt
      }
    });

    const redirectUri = getBackendRedirectUri();
    const kakaoAuthUrl = `https://kauth.kakao.com/oauth/authorize?client_id=${encodeURIComponent(
      restApiKey
    )}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&state=${encodeURIComponent(
      rawState
    )}`;

    res.redirect(kakaoAuthUrl);
  })
);

// 2. GET /api/v1/auth/kakao/callback
authKakaoRouter.get(
  '/callback',
  asyncHandler(async (req, res) => {
    const { code, state, error, error_description } = req.query;
    const frontendUrl = getFrontendUrl();

    if (error || !code || typeof code !== 'string') {
      const msg =
        typeof error_description === 'string'
          ? error_description
          : '카카오 로그인이 취소되었거나 오류가 발생했습니다.';
      res.redirect(`${frontendUrl}/login?error=${encodeURIComponent(msg)}`);
      return;
    }

    if (!state || typeof state !== 'string') {
      res.redirect(
        `${frontendUrl}/login?error=${encodeURIComponent('보안 상태(state) 파라미터가 누락되었습니다.')}`
      );
      return;
    }

    const stateHash = crypto.createHash('sha256').update(state).digest('hex');
    const oauthState = await prisma.oAuthState.findUnique({
      where: { stateHash }
    });

    if (!oauthState || oauthState.expiresAt < new Date()) {
      if (oauthState) {
        await prisma.oAuthState.delete({ where: { id: oauthState.id } });
      }
      res.redirect(
        `${frontendUrl}/login?error=${encodeURIComponent(
          'OAuth 상태(state)가 유효하지 않거나 만료되었습니다. 다시 시도해 주세요.'
        )}`
      );
      return;
    }

    // Delete state record to make it 1-time use
    await prisma.oAuthState.delete({ where: { id: oauthState.id } });

    // Clean up old expired states silently
    prisma.oAuthState.deleteMany({ where: { expiresAt: { lt: new Date() } } }).catch(() => {});

    const restApiKey = process.env.KAKAO_REST_API_KEY || '';
    const clientSecret = process.env.KAKAO_CLIENT_SECRET || '';
    const redirectUri = getBackendRedirectUri();

    // 1) Exchange code for Kakao Access Token
    const tokenParams = new URLSearchParams();
    tokenParams.append('grant_type', 'authorization_code');
    tokenParams.append('client_id', restApiKey);
    tokenParams.append('redirect_uri', redirectUri);
    tokenParams.append('code', code);
    if (clientSecret) {
      tokenParams.append('client_secret', clientSecret);
    }

    const tokenRes = await fetch('https://kauth.kakao.com/oauth/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8'
      },
      body: tokenParams.toString()
    });

    if (!tokenRes.ok) {
      res.redirect(
        `${frontendUrl}/login?error=${encodeURIComponent(
          '카카오 토큰 교환에 실패했습니다. 카카오 개발자 설정을 확인해 주세요.'
        )}`
      );
      return;
    }

    const tokenData = (await tokenRes.json()) as { access_token?: string };
    if (!tokenData.access_token) {
      res.redirect(
        `${frontendUrl}/login?error=${encodeURIComponent('카카오 access token을 수신하지 못했습니다.')}`
      );
      return;
    }

    // 2) Get Kakao user info
    const userRes = await fetch('https://kapi.kakao.com/v2/user/me', {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${tokenData.access_token}`
      }
    });

    if (!userRes.ok) {
      res.redirect(
        `${frontendUrl}/login?error=${encodeURIComponent('카카오 사용자 정보를 가져오는 데 실패했습니다.')}`
      );
      return;
    }

    const kakaoUser = (await userRes.json()) as {
      id: number | string;
      kakao_account?: {
        email?: string;
        is_email_valid?: boolean;
        is_email_verified?: boolean;
        profile?: {
          nickname?: string;
        };
      };
      properties?: {
        nickname?: string;
      };
    };

    const kakaoId = String(kakaoUser.id);
    const kakaoEmail = kakaoUser.kakao_account?.email || null;
    const kakaoNickname =
      kakaoUser.kakao_account?.profile?.nickname ||
      kakaoUser.properties?.nickname ||
      '카카오 사용자';

    let user = await prisma.user.findUnique({
      where: { kakaoId }
    });

    if (!user && kakaoEmail) {
      const canLinkByEmail =
        kakaoUser.kakao_account?.is_email_valid !== false &&
        kakaoUser.kakao_account?.is_email_verified !== false;

      if (canLinkByEmail) {
        const existingUser = await prisma.user.findFirst({
          where: {
            email: {
              equals: kakaoEmail,
              mode: 'insensitive'
            }
          }
        });

        if (existingUser?.kakaoId === kakaoId) {
          user = existingUser;
        } else if (existingUser && !existingUser.kakaoId) {
          user = await prisma.user.update({
            where: { id: existingUser.id },
            data: {
              kakaoId,
              authProvider: 'KAKAO'
            }
          });
        }
      }
    }

    if (!user) {
      // Check if invitation intent hash was attached
      if (oauthState.intentHash) {
        const intent = await prisma.invitationIntent.findUnique({
          where: { intentHash: oauthState.intentHash },
          include: { invitation: true }
        });

        const invitation = intent?.invitation;
        const isExpired = invitation ? invitation.expiresAt < new Date() : true;
        const isIntentExpired = intent ? intent.expiresAt < new Date() : true;

        if (
          !intent ||
          !invitation ||
          intent.consumedAt ||
          invitation.usedAt ||
          invitation.revokedAt ||
          isExpired ||
          isIntentExpired
        ) {
          res.redirect(
            `${frontendUrl}/login?error=${encodeURIComponent(
              '초대 링크가 유효하지 않거나 이미 사용되었습니다.'
            )}`
          );
          return;
        }

        if (
          invitation.invitedEmail &&
          kakaoEmail &&
          invitation.invitedEmail.toLowerCase() !== kakaoEmail.toLowerCase()
        ) {
          res.redirect(
            `${frontendUrl}/login?error=${encodeURIComponent(
              `이 초대는 ${invitation.invitedEmail} 전용입니다. 로그인된 카카오 계정 이메일과 일치하지 않습니다.`
            )}`
          );
          return;
        }

        // Create User & consume Invitation & Intent atomically in transaction
        try {
          user = await prisma.$transaction(async (tx) => {
            // Lock and check invitation state atomically
            const currentInv = await tx.invitation.findUnique({
              where: { id: invitation.id }
            });

            if (!currentInv || currentInv.usedAt || currentInv.revokedAt) {
              throw new Error('이미 사용 또는 취소된 초대입니다.');
            }

            const newUser = await tx.user.create({
              data: {
                kakaoId,
                email: invitation.invitedEmail || kakaoEmail || null,
                name: kakaoNickname,
                role: invitation.role,
                clientId: invitation.clientId || null,
                authProvider: 'KAKAO'
              }
            });

            await tx.invitationIntent.update({
              where: { id: intent.id },
              data: { consumedAt: new Date() }
            });

            await tx.invitation.update({
              where: { id: invitation.id },
              data: { usedAt: new Date() }
            });

            return newUser;
          });
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : '초대 처리 중 오류가 발생했습니다.';
          res.redirect(`${frontendUrl}/login?error=${encodeURIComponent(msg)}`);
          return;
        }
      } else {
        // No invitation attached and user account does not exist
        res.redirect(
          `${frontendUrl}/login?error=${encodeURIComponent(
            '등록된 계정이 없습니다. 관리자에게 초대 링크를 요청해 주세요.'
          )}`
        );
        return;
      }
    }

    // Generate 1-time exchange code
    const rawCode = crypto.randomBytes(32).toString('hex');
    const codeHash = crypto.createHash('sha256').update(rawCode).digest('hex');
    const expiresAt = new Date(Date.now() + 60 * 1000); // 60 seconds

    await prisma.oAuthExchangeCode.create({
      data: {
        codeHash,
        userId: user.id,
        expiresAt
      }
    });

    const returnPath = oauthState.returnTo || '/requests';
    res.redirect(`${frontendUrl}/auth/kakao/callback?code=${rawCode}&returnTo=${encodeURIComponent(returnPath)}`);
  })
);

// 3. POST /api/v1/auth/kakao/exchange
authKakaoRouter.post(
  '/exchange',
  asyncHandler(async (req, res) => {
    const { code } = req.body;
    if (!code || typeof code !== 'string') {
      throw badRequest('교환 코드가 필요합니다.');
    }

    const codeHash = crypto.createHash('sha256').update(code).digest('hex');
    const exchangeRecord = await prisma.oAuthExchangeCode.findUnique({
      where: { codeHash }
    });

    if (!exchangeRecord || exchangeRecord.expiresAt < new Date()) {
      if (exchangeRecord) {
        await prisma.oAuthExchangeCode.deleteMany({ where: { id: exchangeRecord.id } });
      }
      throw unauthorized('유효하지 않거나 만료된 교환 코드입니다.');
    }

    const consumed = await prisma.oAuthExchangeCode.deleteMany({
      where: {
        id: exchangeRecord.id,
        codeHash
      }
    });

    if (consumed.count !== 1) {
      throw unauthorized('유효하지 않거나 만료된 교환 코드입니다.');
    }

    const user = await prisma.user.findUnique({
      where: { id: exchangeRecord.userId }
    });

    if (!user) {
      throw unauthorized('사용자를 찾을 수 없습니다.');
    }

    const accessToken = jwt.sign(
      {
        sub: user.id,
        role: user.role
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
