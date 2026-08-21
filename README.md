# ⚡ SiteOps Backend API Server (SiteOps_back)

> **웹사이트 유지보수 플랫폼 SiteOps의 백엔드 RESTful API 서버**

Node.js, Express, TypeScript, Prisma ORM, PostgreSQL(Supabase)을 기반으로 구축된 보안 중심의 백엔드 서비스입니다.

---

## 🛠 기술 스택 (Tech Stack)

- **Runtime & Language**: Node.js, TypeScript
- **Framework**: Express.js
- **Database & ORM**: PostgreSQL, Prisma ORM v5
- **Authentication & Security**: JWT (JSON Web Tokens), Bcrypt password hashing, Helmet, Express Rate Limit
- **Validation**: Zod
- **Cloud Storage**: Supabase Storage (Private Bucket + Signed URLs)

---

## 🔒 데이터베이스 구조 & 모델 (Data Models)

- **User**: 시스템 사용자 (ADMIN, WORKER, CLIENT 역할 분리)
- **Client**: 고객사 정보
- **Project**: 웹사이트 유지보수 프로젝트
- **MaintenanceRequest**: 유지보수 요청 사항 (상태: RECEIVED, IN_PROGRESS, REVIEW_REQUESTED, COMPLETED, REJECTED)
- **RequestActivity**: 요청 건별 히스토리 및 활동 로그
- **RequestReview**: 검토 요청 및 승인/거절 내역
- **Notification**: 사용자별 알림

---

## 💡 개발자를 위한 꿀팁 & 아키텍처 패턴 (Developer Pro-Tips)

### 1. `asyncHandler` 라우터 래퍼를 통한 비동기 에러 핸들링 단축
모든 Express 비동기 컨트롤러에서 반복되는 `try-catch` 블록 대신 `asyncHandler` 고차 함수를 사용하여 간결하고 안전하게 글로벌 에러 핸들러로 예외를 위임합니다.

```typescript
// src/middleware/asyncHandler.ts
export const asyncHandler = (fn: RequestHandler): RequestHandler => 
  (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
```

### 2. Zod 스키마 기반 요청 검증 파서 (`parseOrThrow`)
요청 Body/Params/Query 검증 시 Zod 스키마를 단 한 줄로 파싱하고, 실시간으로 유효하지 않은 데이터에 대한 커스텀 `BadRequestError`를 생성합니다.

```typescript
// src/utils/validators.ts
export const parseOrThrow = <T>(schema: ZodSchema<T>, data: unknown): T => {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw badRequest('입력 값이 올바르지 않습니다.', result.error.flatten());
  }
  return result.data;
};
```

### 3. Supabase Private Storage & Signed URL 발급 패턴
보안을 위해 비공개 Storage 버킷을 유지하고, 클라이언트에게 유효 기간이 지정된 서명 URL(Signed URL)을 발급하여 무단 파일 접근을 방지합니다.

```typescript
// src/lib/supabase.ts
export const createSignedUrl = async (path: string, expiresIn = 3600) => {
  const { data, error } = await supabase.storage
    .from('siteops-attachments')
    .createSignedUrl(path, expiresIn);

  if (error) throw error;
  return data.signedUrl;
};
```

### 4. Prisma Client 싱글톤(Singleton) 연결 관리
개발 환경에서의 Hot Reloading 시 여러 개의 데이터베이스 커넥션이 중복 수립되어 커넥션 풀이 고갈되는 현상을 예방하기 위한 글로벌 싱글톤 패턴입니다.

```typescript
// src/lib/prisma.ts
import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

export const prisma = globalForPrisma.prisma || new PrismaClient();

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;

export default prisma;
```

---

## ⚙️ 환경 변수 설정 (Environment Setup)

보안을 위해 비밀키 및 DB URL은 `.env` 파일에 보관하며, 저장소에는 템플릿인 `.env.example`만 포함됩니다.

설정 항목 (`.env`):

```env
DATABASE_URL="postgresql://<user>:<password>@<host>:5432/postgres?sslmode=require"
DIRECT_URL="postgresql://<user>:<password>@<host>:5432/postgres?sslmode=require"
SUPABASE_URL="https://<project-id>.supabase.co"
SUPABASE_SECRET_KEY="your-supabase-secret-key"
JWT_SECRET="your-jwt-secret-key"
CORS_ORIGIN="http://localhost:5173"
PORT=3000
```

---

## 🚀 시작하기 (Quick Start)

### 1. 의존성 패키지 설치

```bash
cd server
npm install
```

### 2. Prisma 클라이언트 생성 & 마이그레이션

```bash
# Prisma 클라이언트 코드 생성
npm run prisma:generate

# 데이터베이스 마이그레이션 적용
npm run prisma:migrate
```

### 3. 초기 시드 데이터 구축 (어드민 & 테스트 계정 포함)

```bash
npm run seed
```

### 4. 개발 서버 실행

```bash
npm run dev
```
서버 실행 주소: `http://localhost:3000`

---

## 🔑 초기 시드 데모 계정

| 역할 | 이메일 | 비밀번호 |
| :--- | :--- | :--- |
| **어드민** | `admin@siteops.demo` / `admin@admin.com` | `demo1234` |
| **작업자** | `worker@siteops.demo` | `demo1234` |
| **고객사** | `client@siteops.demo` | `demo1234` |

---

## 📡 주요 API 엔드포인트 (`/api/v1`)

- `POST /api/v1/auth/login`: 로그인 및 JWT 토큰 발급
- `GET /api/v1/auth/me`: 현재 로그인 유저 정보 조회
- `GET /api/v1/projects`: 프로젝트 목록 및 관련 요청 현황
- `GET /api/v1/requests`: 유지보수 요청 목록 조회 (필터링 및 검색)
- `POST /api/v1/requests`: 신규 유지보수 요청 등록
- `PATCH /api/v1/requests/:id`: 요청 상태 및 담당자 업데이트
- `POST /api/v1/uploads`: 파일 및 이미지 업로드 (Signed URL)
- `GET /api/v1/dashboard/stats`: 대시보드 요약 통계 데이터
- `GET /api/v1/notifications`: 사용자 알림 목록

---

## 🔗 관련 저장소

- 프론트엔드 저장소: [SiteOps_Front](https://github.com/rhazns22/SiteOps_Front)
