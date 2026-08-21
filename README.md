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

## 💡 개발자 꿀팁 & 패턴 장단점 (Developer Pro-Tips & Trade-offs)

### 1. Express `asyncHandler` 라우터 에러 래퍼 (`src/middleware/asyncHandler.ts`)
- **장점**: 반복적인 `try-catch` 제거 및 전역 에러 핸들러 자동 예외 위임.
- **단점/고려사항**: 컨트롤러 내부 부분 에러 복구(Fallback) 필요 시 직접 처리 주의.

### 2. Zod 기반 스키마 파서 (`parseOrThrow`) (`src/utils/validators.ts`)
- **장점**: TypeScript 타입 추론과 런타임 값 유효성 검증 동시 달성, 입구 단 완전 차단.
- **단점/고려사항**: 스키마 작성 공수 발생 및 에러 메시지 포맷팅 정제 필요.

### 3. Prisma Client 싱글톤 패턴 (`src/lib/prisma.ts`)
- **장점**: Hot Reloading 시 데이터베이스 커넥션 중복 생성 및 커넥션 풀 고갈 완전 방지.
- **단점/고려사항**: Serverless 환경 적용 시 별도 Connection Pooler(PgBouncer) 설정 필요.

### 4. Supabase Private Storage & Signed URL (`src/lib/supabase.ts`)
- **장점**: 버킷 비공개 유지로 직접 URL 무단 접근 및 유출 차단.
- **단점/고려사항**: 서명 URL 유효 기간 만료 관리 및 발급 API 비동기 오버헤드.

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
