import { ActivityType, NotificationType, Priority, RequestStatus, ReviewDecision, Role } from '@prisma/client';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';

const prisma = new PrismaClient();

const seedPassword = async () => bcrypt.hash('demo1234', 10);

const daysFromNow = (days: number) => {
  const date = new Date();
  date.setDate(date.getDate() + days);
  date.setHours(17, 0, 0, 0);
  return date;
};

async function upsertUser(data: {
  id: string;
  email: string;
  name: string;
  role: Role;
  clientId?: string | null;
  passwordHash: string;
}) {
  return prisma.user.upsert({
    where: { email: data.email },
    update: {
      name: data.name,
      role: data.role,
      clientId: data.clientId ?? null,
      passwordHash: data.passwordHash
    },
    create: data
  });
}

async function upsertRequest(data: {
  id: string;
  projectId: string;
  requesterId: string;
  assigneeId?: string | null;
  title: string;
  description: string;
  pageUrl: string;
  status: RequestStatus;
  priority: Priority;
  dueDate: Date | null;
  beforeImagePath?: string | null;
  afterImagePath?: string | null;
  reviewRequestedAt?: Date | null;
  completedAt?: Date | null;
}) {
  return prisma.maintenanceRequest.upsert({
    where: { id: data.id },
    update: data,
    create: data
  });
}

async function upsertActivity(data: {
  id: string;
  requestId: string;
  actorId?: string | null;
  type: ActivityType;
  metadata?: Record<string, string>;
}) {
  return prisma.requestActivity.upsert({
    where: { id: data.id },
    update: data,
    create: data
  });
}

async function main() {
  const passwordHash = await seedPassword();

  const ourtable = await prisma.client.upsert({
    where: { name: '아워테이블 주식회사' },
    update: { name: '아워테이블 주식회사' },
    create: { id: 'seed-client-ourtable', name: '아워테이블 주식회사' }
  });

  const monoshop = await prisma.client.upsert({
    where: { name: '모노샵' },
    update: { name: '모노샵' },
    create: { id: 'seed-client-monoshop', name: '모노샵' }
  });

  const nexa = await prisma.client.upsert({
    where: { name: 'NEXA Labs' },
    update: { name: 'NEXA Labs' },
    create: { id: 'seed-client-nexa', name: 'NEXA Labs' }
  });

  const admin = await upsertUser({
    id: 'seed-admin',
    email: 'admin@siteops.demo',
    name: '이준호',
    role: 'ADMIN',
    passwordHash
  });

  await upsertUser({
    id: 'seed-admin-alias1',
    email: 'admin@admin.com',
    name: '어드민',
    role: 'ADMIN',
    passwordHash
  });

  await upsertUser({
    id: 'seed-admin-alias2',
    email: 'admin@siteops.com',
    name: '어드민',
    role: 'ADMIN',
    passwordHash
  });

  const worker = await upsertUser({
    id: 'seed-worker',
    email: 'worker@siteops.demo',
    name: '박상우',
    role: 'WORKER',
    passwordHash
  });

  const workerTwo = await upsertUser({
    id: 'seed-worker-2',
    email: 'designer@siteops.demo',
    name: '최민지',
    role: 'WORKER',
    passwordHash
  });

  const clientUser = await upsertUser({
    id: 'seed-client-user',
    email: 'client@siteops.demo',
    name: '김지은',
    role: 'CLIENT',
    clientId: ourtable.id,
    passwordHash
  });

  const monoClientUser = await upsertUser({
    id: 'seed-client-monoshop-user',
    email: 'client.monoshop@siteops.demo',
    name: '정다은',
    role: 'CLIENT',
    clientId: monoshop.id,
    passwordHash
  });

  const nexaClientUser = await upsertUser({
    id: 'seed-client-nexa-user',
    email: 'client.nexa@siteops.demo',
    name: '오세린',
    role: 'CLIENT',
    clientId: nexa.id,
    passwordHash
  });

  const projectOurtable = await prisma.project.upsert({
    where: { name: '아워테이블' },
    update: {
      clientId: ourtable.id,
      websiteUrl: 'https://ourtable.com',
      description: '레스토랑 예약 및 프로모션 사이트'
    },
    create: {
      id: 'seed-project-ourtable',
      clientId: ourtable.id,
      name: '아워테이블',
      websiteUrl: 'https://ourtable.com',
      description: '레스토랑 예약 및 프로모션 사이트'
    }
  });

  const projectMono = await prisma.project.upsert({
    where: { name: '모노샵' },
    update: {
      clientId: monoshop.id,
      websiteUrl: 'https://monoshop.com',
      description: '커머스 운영 사이트'
    },
    create: {
      id: 'seed-project-monoshop',
      clientId: monoshop.id,
      name: '모노샵',
      websiteUrl: 'https://monoshop.com',
      description: '커머스 운영 사이트'
    }
  });

  const projectNexa = await prisma.project.upsert({
    where: { name: 'NEXA' },
    update: {
      clientId: nexa.id,
      websiteUrl: 'https://nexa.io',
      description: 'B2B SaaS 브랜드 사이트'
    },
    create: {
      id: 'seed-project-nexa',
      clientId: nexa.id,
      name: 'NEXA',
      websiteUrl: 'https://nexa.io',
      description: 'B2B SaaS 브랜드 사이트'
    }
  });

  const projectLife = await prisma.project.upsert({
    where: { name: '라이프스튜디오' },
    update: {
      clientId: ourtable.id,
      websiteUrl: 'https://lifestudio.co.kr',
      description: '라이프스타일 캠페인 사이트'
    },
    create: {
      id: 'seed-project-lifestudio',
      clientId: ourtable.id,
      name: '라이프스튜디오',
      websiteUrl: 'https://lifestudio.co.kr',
      description: '라이프스타일 캠페인 사이트'
    }
  });

  const requests = [
    {
      id: 'seed-req-01',
      projectId: projectOurtable.id,
      requesterId: clientUser.id,
      assigneeId: worker.id,
      title: '메인 배너 프로모션 문구 교체',
      description: '메인 배너의 프로모션 문구를 "특별한 순간을 예약하세요"로 변경해 주세요.',
      pageUrl: 'https://ourtable.com',
      status: 'IN_PROGRESS' as RequestStatus,
      priority: 'NORMAL' as Priority,
      dueDate: daysFromNow(0)
    },
    {
      id: 'seed-req-02',
      projectId: projectOurtable.id,
      requesterId: clientUser.id,
      assigneeId: null,
      title: '푸터 회사 정보 업데이트',
      description: '사업자등록번호 변경에 따른 회사 정보 푸터 업데이트가 필요합니다.',
      pageUrl: 'https://ourtable.com/company',
      status: 'RECEIVED' as RequestStatus,
      priority: 'LOW' as Priority,
      dueDate: daysFromNow(3)
    },
    {
      id: 'seed-req-03',
      projectId: projectOurtable.id,
      requesterId: clientUser.id,
      assigneeId: worker.id,
      title: '서비스 소개 섹션 이미지 교체',
      description: '서비스 소개 섹션의 일러스트 이미지를 신규 파일로 교체해 주세요.',
      pageUrl: 'https://ourtable.com/service',
      status: 'REVIEW_REQUESTED' as RequestStatus,
      priority: 'NORMAL' as Priority,
      dueDate: daysFromNow(1),
      beforeImagePath: 'seed/ourtable/service-before.png',
      afterImagePath: 'seed/ourtable/service-after.png',
      reviewRequestedAt: daysFromNow(-1)
    },
    {
      id: 'seed-req-04',
      projectId: projectOurtable.id,
      requesterId: clientUser.id,
      assigneeId: workerTwo.id,
      title: '모바일 메뉴 간격 조정',
      description: '모바일 메뉴 항목들의 세로 간격이 너무 좁습니다.',
      pageUrl: 'https://ourtable.com',
      status: 'REJECTED' as RequestStatus,
      priority: 'HIGH' as Priority,
      dueDate: daysFromNow(-1),
      reviewRequestedAt: daysFromNow(-2)
    },
    {
      id: 'seed-req-05',
      projectId: projectMono.id,
      requesterId: monoClientUser.id,
      assigneeId: worker.id,
      title: 'FAQ 텍스트 수정',
      description: 'FAQ 페이지의 세 번째 답변에 있는 오탈자를 수정해 주세요.',
      pageUrl: 'https://monoshop.com/faq',
      status: 'RECEIVED' as RequestStatus,
      priority: 'LOW' as Priority,
      dueDate: daysFromNow(6)
    },
    {
      id: 'seed-req-06',
      projectId: projectMono.id,
      requesterId: monoClientUser.id,
      assigneeId: worker.id,
      title: '블로그 목록 레이아웃 개선',
      description: '블로그 리스트 카드 썸네일 비율을 16:9로 변경해 주세요.',
      pageUrl: 'https://monoshop.com/blog',
      status: 'IN_PROGRESS' as RequestStatus,
      priority: 'NORMAL' as Priority,
      dueDate: daysFromNow(4)
    },
    {
      id: 'seed-req-07',
      projectId: projectMono.id,
      requesterId: monoClientUser.id,
      assigneeId: workerTwo.id,
      title: '이미지 최적화 및 ALT 태그 추가',
      description: '메인 및 서브페이지 이미지 용량을 줄이고 ALT 태그를 추가해 주세요.',
      pageUrl: 'https://monoshop.com',
      status: 'COMPLETED' as RequestStatus,
      priority: 'LOW' as Priority,
      dueDate: daysFromNow(-2),
      completedAt: daysFromNow(-1)
    },
    {
      id: 'seed-req-08',
      projectId: projectNexa.id,
      requesterId: nexaClientUser.id,
      assigneeId: worker.id,
      title: '문의 폼 유효성 검증 추가',
      description: '이메일 형식 체크와 전화번호 필수 조건 검증이 필요합니다.',
      pageUrl: 'https://nexa.io/contact',
      status: 'REVIEW_REQUESTED' as RequestStatus,
      priority: 'HIGH' as Priority,
      dueDate: daysFromNow(0),
      reviewRequestedAt: daysFromNow(-1),
      afterImagePath: 'seed/nexa/contact-after.png'
    },
    {
      id: 'seed-req-09',
      projectId: projectNexa.id,
      requesterId: nexaClientUser.id,
      assigneeId: null,
      title: '가격표 CTA 링크 수정',
      description: '요금제 카드의 CTA가 잘못된 앵커로 이동합니다.',
      pageUrl: 'https://nexa.io/pricing',
      status: 'RECEIVED' as RequestStatus,
      priority: 'URGENT' as Priority,
      dueDate: daysFromNow(0)
    },
    {
      id: 'seed-req-10',
      projectId: projectLife.id,
      requesterId: clientUser.id,
      assigneeId: workerTwo.id,
      title: '캠페인 상세 이미지 교체',
      description: '봄 캠페인 상세 페이지의 상단 이미지를 여름 버전으로 변경해 주세요.',
      pageUrl: 'https://lifestudio.co.kr/campaign',
      status: 'IN_PROGRESS' as RequestStatus,
      priority: 'NORMAL' as Priority,
      dueDate: daysFromNow(5)
    },
    {
      id: 'seed-req-11',
      projectId: projectLife.id,
      requesterId: clientUser.id,
      assigneeId: worker.id,
      title: '예약 버튼 색상 대비 개선',
      description: '모바일 화면에서 예약 버튼 대비가 낮아 접근성 개선이 필요합니다.',
      pageUrl: 'https://lifestudio.co.kr/reserve',
      status: 'REJECTED' as RequestStatus,
      priority: 'HIGH' as Priority,
      dueDate: daysFromNow(2),
      reviewRequestedAt: daysFromNow(-1)
    },
    {
      id: 'seed-req-12',
      projectId: projectOurtable.id,
      requesterId: admin.id,
      assigneeId: worker.id,
      title: '운영 공지 팝업 종료',
      description: '지난 프로모션 종료에 따라 운영 공지 팝업을 내립니다.',
      pageUrl: 'https://ourtable.com',
      status: 'COMPLETED' as RequestStatus,
      priority: 'LOW' as Priority,
      dueDate: daysFromNow(-3),
      completedAt: daysFromNow(-2)
    }
  ];

  for (const request of requests) {
    await upsertRequest(request);
  }

  const pins = [
    { id: 'seed-pin-01', requestId: 'seed-req-01', xPercent: 75, yPercent: 52, content: '메인 배너 중앙 텍스트 영역', sortOrder: 0 },
    { id: 'seed-pin-02', requestId: 'seed-req-02', xPercent: 50, yPercent: 90, content: '하단 푸터 회사 정보', sortOrder: 0 },
    { id: 'seed-pin-03', requestId: 'seed-req-03', xPercent: 30, yPercent: 40, content: '소개 섹션 좌측 이미지', sortOrder: 0 },
    { id: 'seed-pin-04', requestId: 'seed-req-04', xPercent: 90, yPercent: 15, content: '우측 상단 모바일 메뉴', sortOrder: 0 },
    { id: 'seed-pin-05', requestId: 'seed-req-08', xPercent: 62, yPercent: 71, content: '문의 폼 전화번호 입력 영역', sortOrder: 0 }
  ];

  for (const pin of pins) {
    await prisma.requestPin.upsert({
      where: { id: pin.id },
      update: pin,
      create: pin
    });
  }

  const attachments = [
    {
      id: 'seed-attachment-01',
      requestId: 'seed-req-03',
      storagePath: 'seed/ourtable/service-after.png',
      originalName: 'service-after.png',
      mimeType: 'image/png',
      size: 182_000,
      kind: 'after'
    },
    {
      id: 'seed-attachment-02',
      requestId: 'seed-req-08',
      storagePath: 'seed/nexa/contact-after.png',
      originalName: 'contact-after.png',
      mimeType: 'image/png',
      size: 141_000,
      kind: 'after'
    }
  ];

  for (const attachment of attachments) {
    await prisma.requestAttachment.upsert({
      where: { id: attachment.id },
      update: attachment,
      create: attachment
    });
  }

  const comments = [
    { id: 'seed-comment-01', requestId: 'seed-req-01', authorId: worker.id, content: '작업을 시작합니다. 모바일 문구도 함께 확인하겠습니다.' },
    { id: 'seed-comment-02', requestId: 'seed-req-03', authorId: worker.id, content: '이미지 교체 후 검수 요청을 등록했습니다.' },
    { id: 'seed-comment-03', requestId: 'seed-req-04', authorId: clientUser.id, content: '메뉴가 아직 겹쳐 보여 재수정 요청드립니다.' },
    { id: 'seed-comment-04', requestId: 'seed-req-08', authorId: worker.id, content: '문의 폼 검증 로직 반영이 완료되었습니다.' }
  ];

  for (const comment of comments) {
    await prisma.requestComment.upsert({
      where: { id: comment.id },
      update: comment,
      create: comment
    });
  }

  const activities = [
    ['seed-act-01', 'seed-req-01', clientUser.id, 'REQUEST_CREATED', '요청이 접수되었습니다.'],
    ['seed-act-02', 'seed-req-01', admin.id, 'ASSIGNEE_CHANGED', '담당자가 배정되었습니다.'],
    ['seed-act-03', 'seed-req-01', worker.id, 'STATUS_CHANGED', '작업을 시작합니다.'],
    ['seed-act-04', 'seed-req-03', worker.id, 'REVIEW_REQUESTED', '작업 완료 후 검수 요청을 보냈습니다.'],
    ['seed-act-05', 'seed-req-04', clientUser.id, 'REVIEW_REJECTED', '반려 및 재수정 요청이 등록되었습니다.'],
    ['seed-act-06', 'seed-req-07', monoClientUser.id, 'REVIEW_APPROVED', '승인 및 완료 처리되었습니다.'],
    ['seed-act-07', 'seed-req-08', worker.id, 'REVIEW_REQUESTED', '검수 요청이 등록되었습니다.'],
    ['seed-act-08', 'seed-req-12', admin.id, 'REVIEW_APPROVED', '운영 공지 팝업 종료가 완료되었습니다.']
  ] as const;

  for (const [id, requestId, actorId, type, message] of activities) {
    await upsertActivity({
      id,
      requestId,
      actorId,
      type: type as ActivityType,
      metadata: { message }
    });
  }

  const reviews = [
    { id: 'seed-review-01', requestId: 'seed-req-04', reviewerId: clientUser.id, decision: 'REJECTED' as ReviewDecision, comment: '모바일 메뉴 간격을 조금 더 넓혀 주세요.' },
    { id: 'seed-review-02', requestId: 'seed-req-07', reviewerId: monoClientUser.id, decision: 'APPROVED' as ReviewDecision, comment: '확인했습니다.' },
    { id: 'seed-review-03', requestId: 'seed-req-12', reviewerId: admin.id, decision: 'APPROVED' as ReviewDecision, comment: '운영 반영 완료.' }
  ];

  for (const review of reviews) {
    await prisma.requestReview.upsert({
      where: { id: review.id },
      update: review,
      create: review
    });
  }

  const notifications = [
    { id: 'seed-notification-01', userId: worker.id, requestId: 'seed-req-01', type: 'ASSIGNED' as NotificationType, title: '담당자 배정', message: '[메인 배너 프로모션 문구 교체] 요청의 담당자로 배정되었습니다.', isRead: false },
    { id: 'seed-notification-02', userId: clientUser.id, requestId: 'seed-req-03', type: 'REVIEW_REQUESTED' as NotificationType, title: '검수 요청', message: '[서비스 소개 섹션 이미지 교체] 요청에 대한 검수가 등록되었습니다.', isRead: false },
    { id: 'seed-notification-03', userId: workerTwo.id, requestId: 'seed-req-04', type: 'REJECTED' as NotificationType, title: '요청 반려', message: '[모바일 메뉴 간격 조정] 요청이 반려되었습니다.', isRead: false },
    { id: 'seed-notification-04', userId: monoClientUser.id, requestId: 'seed-req-07', type: 'APPROVED' as NotificationType, title: '요청 완료', message: '[이미지 최적화 및 ALT 태그 추가] 건이 최종 승인되었습니다.', isRead: true },
    { id: 'seed-notification-05', userId: admin.id, requestId: 'seed-req-09', type: 'DUE_SOON' as NotificationType, title: '마감 임박 알림', message: '[가격표 CTA 링크 수정] 건의 마감일이 임박했습니다.', isRead: false }
  ];

  for (const notification of notifications) {
    await prisma.notification.upsert({
      where: { id: notification.id },
      update: notification,
      create: notification
    });
  }

  console.log('Seed database succeeded.');
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : 'Seed database failed.');
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
