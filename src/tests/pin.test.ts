import assert from 'assert';
import http from 'http';
import jwt from 'jsonwebtoken';
import prisma from '../lib/prisma';
import { app } from '../app';

export async function runPinApiTests() {
  console.log('📌 Running SiteOps Pin API Dedicated Tests...\n');

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
    const timestamp = Date.now();
    const jwtSecret = process.env.JWT_SECRET || 'test_secret';

    // 1. Create Clients & Projects
    const clientA = await prisma.client.create({ data: { name: `고객사 A_${timestamp}` } });
    const clientB = await prisma.client.create({ data: { name: `고객사 B_${timestamp}` } });

    const projectA = await prisma.project.create({
      data: { name: `프로젝트 A_${timestamp}`, websiteUrl: 'https://projecta.com', clientId: clientA.id }
    });
    const projectB = await prisma.project.create({
      data: { name: `프로젝트 B_${timestamp}`, websiteUrl: 'https://projectb.com', clientId: clientB.id }
    });

    // 2. Create Users
    const userClientA = await prisma.user.create({
      data: { email: `client_a_${timestamp}@test.com`, name: '고객사 A 담당자', passwordHash: 'hash', role: 'CLIENT', clientId: clientA.id }
    });

    const userClientB = await prisma.user.create({
      data: { email: `client_b_${timestamp}@test.com`, name: '고객사 B 담당자', passwordHash: 'hash', role: 'CLIENT', clientId: clientB.id }
    });

    const unassignedWorker = await prisma.user.create({
      data: { email: `worker_${timestamp}@test.com`, name: '비담당 작업자', passwordHash: 'hash', role: 'WORKER' }
    });

    const authClientA = `Bearer ${jwt.sign({ sub: userClientA.id, role: userClientA.role }, jwtSecret)}`;
    const authClientB = `Bearer ${jwt.sign({ sub: userClientB.id, role: userClientB.role }, jwtSecret)}`;
    const authWorker = `Bearer ${jwt.sign({ sub: unassignedWorker.id, role: unassignedWorker.role }, jwtSecret)}`;

    // 3. Create Maintenance Request for Client A
    const reqA = await prisma.maintenanceRequest.create({
      data: {
        projectId: projectA.id,
        requesterId: userClientA.id,
        title: '핀 테스트 요청',
        description: '핀 API 검증용 테스트 요청입니다.',
        pageUrl: 'https://projecta.com/main',
        priority: 'NORMAL',
        status: 'RECEIVED'
      }
    });

    // Create Attachment for reqA
    const attachment = await prisma.requestAttachment.create({
      data: {
        requestId: reqA.id,
        kind: 'before',
        originalName: 'test.png',
        mimeType: 'image/png',
        size: 1024,
        storagePath: `requests/test_${timestamp}.png`
      }
    });

    let createdPinId = '';

    // --- TEST CASES ---

    // 1. 미인증 요청 -> 401
    await test('미인증 핀 생성 요청 시 401 Unauthorized 차단', async () => {
      const res = await fetch(`${baseUrl}/api/v1/requests/${reqA.id}/pins`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ xPercent: 20, yPercent: 30, content: '미인증 핀' })
      });
      assert.strictEqual(res.status, 401);
    });

    // 2. 정상 핀 생성 -> 201
    await test('정상 핀 생성 -> 201 Created 응답 및 핀 정보 반환', async () => {
      const res = await fetch(`${baseUrl}/api/v1/requests/${reqA.id}/pins`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: authClientA },
        body: JSON.stringify({ xPercent: 25.5, yPercent: 45.2, content: '배너 타이틀 수정' })
      });
      assert.strictEqual(res.status, 201);
      const data = (await res.json()) as any;
      assert.ok(data.pins && data.pins.length > 0);
      createdPinId = data.pins[0].id;
      assert.strictEqual(data.pins[0].content, '배너 타이틀 수정');
    });

    // 3. 좌표 검증 실패 -> 400
    await test('xPercent < 0 좌표 입력 시 400 Bad Request 차단', async () => {
      const res = await fetch(`${baseUrl}/api/v1/requests/${reqA.id}/pins`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: authClientA },
        body: JSON.stringify({ xPercent: -5, yPercent: 40, content: '잘못된 좌표' })
      });
      assert.strictEqual(res.status, 400);
    });

    await test('xPercent > 100 좌표 입력 시 400 Bad Request 차단', async () => {
      const res = await fetch(`${baseUrl}/api/v1/requests/${reqA.id}/pins/${createdPinId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: authClientA },
        body: JSON.stringify({ xPercent: 105 })
      });
      assert.strictEqual(res.status, 400);
    });

    await test('yPercent < 0 좌표 입력 시 400 Bad Request 차단', async () => {
      const res = await fetch(`${baseUrl}/api/v1/requests/${reqA.id}/pins/${createdPinId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: authClientA },
        body: JSON.stringify({ yPercent: -10 })
      });
      assert.strictEqual(res.status, 400);
    });

    await test('yPercent > 100 좌표 입력 시 400 Bad Request 차단', async () => {
      const res = await fetch(`${baseUrl}/api/v1/requests/${reqA.id}/pins/${createdPinId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: authClientA },
        body: JSON.stringify({ yPercent: 150 })
      });
      assert.strictEqual(res.status, 400);
    });

    // 4. 내용 검증 실패 -> 400
    await test('빈 content 입력 시 400 Bad Request 차단', async () => {
      const res = await fetch(`${baseUrl}/api/v1/requests/${reqA.id}/pins/${createdPinId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: authClientA },
        body: JSON.stringify({ content: '   ' })
      });
      assert.strictEqual(res.status, 400);
    });

    await test('201자 초과 content 입력 시 400 Bad Request 차단', async () => {
      const longContent = 'A'.repeat(201);
      const res = await fetch(`${baseUrl}/api/v1/requests/${reqA.id}/pins/${createdPinId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: authClientA },
        body: JSON.stringify({ content: longContent })
      });
      assert.strictEqual(res.status, 400);
    });

    // 5. 권한 없는 접근 차단 -> 403
    await test('타 고객사(Client B)가 Client A의 핀 수정 시도 시 403 Forbidden 차단', async () => {
      const res = await fetch(`${baseUrl}/api/v1/requests/${reqA.id}/pins/${createdPinId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: authClientB },
        body: JSON.stringify({ content: '해킹 시도' })
      });
      assert.strictEqual(res.status, 403);
    });

    await test('비담당 작업자(Worker)가 핀 삭제 시도 시 403 Forbidden 차단', async () => {
      const res = await fetch(`${baseUrl}/api/v1/requests/${reqA.id}/pins/${createdPinId}`, {
        method: 'DELETE',
        headers: { Authorization: authWorker }
      });
      assert.strictEqual(res.status, 403);
    });

    // 6. 정상 좌표 및 내용 수정 -> 200 & PIN_UPDATED Activity 기록
    await test('정상 좌표 수정 -> 200 OK', async () => {
      const res = await fetch(`${baseUrl}/api/v1/requests/${reqA.id}/pins/${createdPinId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: authClientA },
        body: JSON.stringify({ xPercent: 30.0, yPercent: 50.0 })
      });
      assert.strictEqual(res.status, 200);
      const data = (await res.json()) as any;
      assert.strictEqual(data.xPercent, 30.0);
      assert.strictEqual(data.yPercent, 50.0);
    });

    await test('정상 내용 수정 -> 200 OK 및 PIN_UPDATED Activity 생성 확인', async () => {
      const res = await fetch(`${baseUrl}/api/v1/requests/${reqA.id}/pins/${createdPinId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: authClientA },
        body: JSON.stringify({ content: '수정된 배너 문구' })
      });
      assert.strictEqual(res.status, 200);
      const data = (await res.json()) as any;
      assert.strictEqual(data.content, '수정된 배너 문구');

      // Verify PIN_UPDATED activity in DB
      const activity = await prisma.requestActivity.findFirst({
        where: { requestId: reqA.id, type: 'PIN_UPDATED' }
      });
      assert.ok(activity, 'PIN_UPDATED Activity가 생성되어야 합니다.');
    });

    // 7. 존재하지 않거나 잘못된 pinId -> 404
    await test('존재하지 않는 pinId 수정 시 404 Not Found', async () => {
      const res = await fetch(`${baseUrl}/api/v1/requests/${reqA.id}/pins/non_existent_pin_id`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: authClientA },
        body: JSON.stringify({ content: '테스트' })
      });
      assert.strictEqual(res.status, 404);
    });

    // Create separate request to test cross-request pinId 404
    const reqB = await prisma.maintenanceRequest.create({
      data: {
        projectId: projectB.id,
        requesterId: userClientB.id,
        title: '요청 B',
        description: '설명 B',
        pageUrl: 'https://projectb.com',
        priority: 'NORMAL'
      }
    });

    await test('다른 requestId에 속한 pinId 수정 시 404 Not Found', async () => {
      const res = await fetch(`${baseUrl}/api/v1/requests/${reqB.id}/pins/${createdPinId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: authClientB },
        body: JSON.stringify({ content: '타 요청 핀 수정 시도' })
      });
      assert.strictEqual(res.status, 404);
    });

    // 8. 정상 삭제 -> 204 & 상세 미노출 & PIN_DELETED Activity 생성 & Attachment 유지
    await test('정상 핀 삭제 -> 204 No Content, PIN_DELETED Activity 생성, Attachment 유지 확인', async () => {
      const res = await fetch(`${baseUrl}/api/v1/requests/${reqA.id}/pins/${createdPinId}`, {
        method: 'DELETE',
        headers: { Authorization: authClientA }
      });
      assert.strictEqual(res.status, 204);

      // Verify pin is missing in detail API
      const detailRes = await fetch(`${baseUrl}/api/v1/requests/${reqA.id}`, {
        headers: { Authorization: authClientA }
      });
      const detailData = (await detailRes.json()) as any;
      const foundPin = detailData.pins.find((p: any) => p.id === createdPinId);
      assert.strictEqual(foundPin, undefined, '삭제된 핀은 상세 조회에서 미노출되어야 합니다.');

      // Verify PIN_DELETED Activity
      const deletedActivity = await prisma.requestActivity.findFirst({
        where: { requestId: reqA.id, type: 'PIN_DELETED' }
      });
      assert.ok(deletedActivity, 'PIN_DELETED Activity가 생성되어야 합니다.');

      // Verify Image Attachment remains
      const currentAttachment = await prisma.requestAttachment.findUnique({
        where: { id: attachment.id }
      });
      assert.ok(currentAttachment, '핀 삭제 후에도 이미지 Attachment는 유지되어야 합니다.');
    });

    // 9. 완료된 요청에 대한 핀 수정/삭제 차단 -> 409 Conflict
    await test('완료(COMPLETED) 상태 요청의 핀 수정/삭제 시 409 Conflict 차단', async () => {
      // Create pin on reqA
      const pinRes = await fetch(`${baseUrl}/api/v1/requests/${reqA.id}/pins`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: authClientA },
        body: JSON.stringify({ xPercent: 50, yPercent: 50, content: '완료 테스트용 핀' })
      });
      const pinData = (await pinRes.json()) as any;
      const completedTestPinId = pinData.pins[pinData.pins.length - 1].id;

      // Update reqA status to COMPLETED
      await prisma.maintenanceRequest.update({
        where: { id: reqA.id },
        data: { status: 'COMPLETED' }
      });

      // Try PATCH on completed request
      const patchRes = await fetch(`${baseUrl}/api/v1/requests/${reqA.id}/pins/${completedTestPinId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: authClientA },
        body: JSON.stringify({ content: '완료 후 수정 시도' })
      });
      assert.strictEqual(patchRes.status, 409, '완료된 요청의 핀 PATCH는 409여야 합니다.');

      // Try DELETE on completed request
      const deleteRes = await fetch(`${baseUrl}/api/v1/requests/${reqA.id}/pins/${completedTestPinId}`, {
        method: 'DELETE',
        headers: { Authorization: authClientA }
      });
      assert.strictEqual(deleteRes.status, 409, '완료된 요청의 핀 DELETE는 409여야 합니다.');
    });
  } finally {
    server.close();
  }

  console.log(`\n📊 Pin API Test Summary: ${passed} passed, ${failed} failed.`);
  if (failed > 0) {
    throw new Error(`${failed} Pin API tests failed!`);
  }
}

if (require.main === module) {
  runPinApiTests()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
