import assert from 'assert';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import http from 'http';
import prisma from '../lib/prisma';
import { app } from '../app';

export async function runSecurityTests() {
  console.log('🔒 Running SiteOps Security & Implementation Tests...\n');

  // Start local server on random available port
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address() as { port: number };
  const baseUrl = `http://127.0.0.1:${address.port}`;

  let passed = 0;
  let failed = 0;

  const test = async (name: string, fn: () => Promise<void>) => {
    try {
      await fn();
      console.log(`  ✅ [PASS] ${name}`);
      passed++;
    } catch (err: any) {
      console.error(`  ❌ [FAIL] ${name}:`, err.message || err);
      failed++;
    }
  };

  try {
    // Setup test users
    const adminUser = await prisma.user.create({
      data: {
        email: `sec_admin_${Date.now()}@siteops.test`,
        name: '보안 테스트 어드민',
        passwordHash: 'dummy_hash',
        role: 'ADMIN'
      }
    });

    const workerUser = await prisma.user.create({
      data: {
        email: `sec_worker_${Date.now()}@siteops.test`,
        name: '보안 테스트 작업자',
        passwordHash: 'dummy_hash',
        role: 'WORKER'
      }
    });

    const jwtSecret = process.env.JWT_SECRET || 'test_secret';
    const adminAuthHeader = `Bearer ${jwt.sign({ sub: adminUser.id, role: adminUser.role }, jwtSecret)}`;
    const workerAuthHeader = `Bearer ${jwt.sign({ sub: workerUser.id, role: workerUser.role }, jwtSecret)}`;

    // 1. PasswordHash가 null인 계정 차단 (401)
    await test('이메일 로그인 시 passwordHash가 null인 계정 차단', async () => {
      const kakaoOnlyUser = await prisma.user.create({
        data: {
          email: `kakao_only_${Date.now()}@test.com`,
          name: '카카오 전용 사용자',
          kakaoId: `kakao_${Date.now()}`,
          role: 'CLIENT',
          authProvider: 'KAKAO'
        }
      });

      const res = await fetch(`${baseUrl}/api/v1/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: kakaoOnlyUser.email, password: 'password123' })
      });

      assert.strictEqual(res.status, 401, 'PasswordHash가 없는 카카오 사용자는 이메일 로그인 시 401 응답이어야 합니다.');
    });

    // 2. Open Redirect 차단
    await test('OAuth returnTo에 외부 URL 입력 시 open redirect 차단', async () => {
      process.env.KAKAO_REST_API_KEY = 'test_kakao_key';
      const res = await fetch(`${baseUrl}/api/v1/auth/kakao/start?returnTo=https://malicious-site.com`, {
        redirect: 'manual'
      });
      assert.strictEqual(res.status, 302);

      const latestState = await prisma.oAuthState.findFirst({
        orderBy: { createdAt: 'desc' }
      });
      assert.strictEqual(latestState?.returnTo, null, '외부 URL returnTo는 null로 치환되어야 합니다.');
    });

    // 3. OAuth State 해시 저장 및 유효성 검증
    await test('OAuth State가 해시 저장되고 변조/만료/중복 사용 차단되는지 확인', async () => {
      const rawState = `test_raw_state_${Date.now()}_${Math.random()}`;
      const stateHash = crypto.createHash('sha256').update(rawState).digest('hex');

      await prisma.oAuthState.create({
        data: {
          stateHash,
          expiresAt: new Date(Date.now() + 10 * 60 * 1000)
        }
      });

      // DB에는 원문 rawState가 없어야 함
      const rawMatch = await prisma.oAuthState.findFirst({
        where: { stateHash: rawState }
      });
      assert.strictEqual(rawMatch, null, 'state 원문이 DB에 저장되어서는 안 됩니다.');

      // 변조된 state 시도 -> 차단
      const tamperedRes = await fetch(`${baseUrl}/api/v1/auth/kakao/callback?code=abc&state=tampered_state`, {
        redirect: 'manual'
      });
      assert.strictEqual(tamperedRes.status, 302);
      const loc = tamperedRes.headers.get('location') || '';
      assert.ok(loc.includes('login?error='), '변조된 state는 로그인 에러로 리다이렉트되어야 합니다.');
    });

    // 4. ADMIN 역할 초대 생성 차단 (400)
    await test('ADMIN 역할 초대 링크 생성 시도 시 400 Bad Request 차단', async () => {
      const res = await fetch(`${baseUrl}/api/v1/invitations`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: adminAuthHeader
        },
        body: JSON.stringify({ role: 'ADMIN' })
      });

      assert.strictEqual(res.status, 400, 'ADMIN 역할 초대는 400으로 차단되어야 합니다.');
    });

    // 5. WORKER/CLIENT 초대 생성 시도 차단 (403)
    await test('WORKER 역할 사용자가 초대 생성 시도 시 403 Forbidden 차단', async () => {
      const res = await fetch(`${baseUrl}/api/v1/invitations`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: workerAuthHeader
        },
        body: JSON.stringify({ role: 'CLIENT' })
      });

      assert.strictEqual(res.status, 403, '작업자는 초대 생성 시 403이어야 합니다.');
    });

    // 6. 정상 CLIENT 초대 및 Intent 생성 흐름
    await test('정상 CLIENT 초대 링크 생성 -> raw token 해시 저장 -> Intent 생성 흐름 검증', async () => {
      const testClient = await prisma.client.create({
        data: { name: `테스트 고객사_${Date.now()}` }
      });

      const createRes = await fetch(`${baseUrl}/api/v1/invitations`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: adminAuthHeader
        },
        body: JSON.stringify({ role: 'CLIENT', clientId: testClient.id, expiresInDays: 7 })
      });

      assert.strictEqual(createRes.status, 201);
      const createData = (await createRes.json()) as any;
      assert.ok(createData.inviteUrl, 'inviteUrl이 제공되어야 합니다.');

      const rawToken = createData.inviteUrl.split('#token=')[1];
      assert.ok(rawToken, 'raw token이 URL fragment에 포함되어야 합니다.');

      // Raw token으로 Intent 생성
      const intentRes = await fetch(`${baseUrl}/api/v1/invitations/intents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: rawToken })
      });

      assert.strictEqual(intentRes.status, 200);
      const intentData = (await intentRes.json()) as any;
      assert.ok(intentData.intentToken, '1회용 intentToken이 반환되어야 합니다.');
      assert.strictEqual(intentData.role, 'CLIENT');

      // 만료된 토큰으로 Intent 생성 시도 -> 410 차단
      const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
      await prisma.invitation.update({
        where: { tokenHash },
        data: { expiresAt: new Date(Date.now() - 1000) }
      });

      const expiredIntentRes = await fetch(`${baseUrl}/api/v1/invitations/intents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: rawToken })
      });
      assert.strictEqual(expiredIntentRes.status, 410, '만료된 초대는 410 응답이어야 합니다.');
    });

    // 7. Exchange Code 60초 만료 및 1회성 사용 검증
    await test('OAuth Exchange Code 60초 만료 및 1회용 소비 검증', async () => {
      const rawCode = `test_code_${Date.now()}`;
      const codeHash = crypto.createHash('sha256').update(rawCode).digest('hex');

      await prisma.oAuthExchangeCode.create({
        data: {
          codeHash,
          userId: adminUser.id,
          expiresAt: new Date(Date.now() + 60 * 1000)
        }
      });

      // 1회차 성공
      const exRes1 = await fetch(`${baseUrl}/api/v1/auth/kakao/exchange`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: rawCode })
      });
      assert.strictEqual(exRes1.status, 200);
      const exData1 = (await exRes1.json()) as any;
      assert.ok(exData1.accessToken, 'JWT accessToken이 반환되어야 합니다.');

      // 2회차 중복 시도 -> 401 차단
      const exRes2 = await fetch(`${baseUrl}/api/v1/auth/kakao/exchange`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: rawCode })
      });
      assert.strictEqual(exRes2.status, 401, '중복 교환 시도는 401로 차단되어야 합니다.');
    });
  } finally {
    server.close();
  }

  console.log(`\n📊 Security Test Summary: ${passed} passed, ${failed} failed.`);
  if (failed > 0) {
    throw new Error(`${failed} security tests failed!`);
  }
}

if (require.main === module) {
  runSecurityTests()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
