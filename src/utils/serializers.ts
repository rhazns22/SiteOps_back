import type {
  ActivityType,
  MaintenanceRequest,
  Notification,
  Priority,
  Project,
  RequestActivity,
  RequestAttachment,
  RequestComment,
  RequestPin,
  RequestReview,
  RequestStatus,
  Role,
  User,
  Client
} from '@prisma/client';

type ProjectWithClient = Project & {
  client: Client;
  maintenanceRequests?: Pick<MaintenanceRequest, 'status' | 'dueDate'>[];
  users?: Pick<User, 'name'>[];
};

type RequestWithRelations = MaintenanceRequest & {
  project: Project & { client?: Client };
  requester: Pick<User, 'id' | 'name' | 'role'>;
  assignee?: Pick<User, 'id' | 'name' | 'role'> | null;
  pins?: RequestPin[];
  attachments?: RequestAttachment[];
  comments?: (RequestComment & { author: Pick<User, 'id' | 'name' | 'role'> })[];
  activities?: (RequestActivity & { actor?: Pick<User, 'id' | 'name' | 'role'> | null })[];
  reviews?: (RequestReview & { reviewer: Pick<User, 'id' | 'name' | 'role'> })[];
};

type NotificationWithRequest = Notification & {
  request?: (MaintenanceRequest & { project: Project }) | null;
};

const activityMessage: Record<ActivityType, string> = {
  REQUEST_CREATED: '요청이 접수되었습니다.',
  REQUEST_UPDATED: '요청 내용이 수정되었습니다.',
  ASSIGNEE_CHANGED: '담당자가 변경되었습니다.',
  STATUS_CHANGED: '요청 상태가 변경되었습니다.',
  COMMENT_CREATED: '댓글이 등록되었습니다.',
  PIN_CREATED: '수정 위치가 추가되었습니다.',
  PIN_UPDATED: '수정 위치가 변경되었습니다.',
  PIN_DELETED: '수정 위치가 삭제되었습니다.',
  REVIEW_REQUESTED: '작업 완료 후 검수 요청을 보냈습니다.',
  REVIEW_APPROVED: '승인 및 완료 처리되었습니다.',
  REVIEW_REJECTED: '반려 및 재수정 요청이 등록되었습니다.',
  ATTACHMENT_ADDED: '첨부파일이 등록되었습니다.'
};

const activityStatus = (type: ActivityType): RequestStatus => {
  if (type === 'REVIEW_REQUESTED') return 'REVIEW_REQUESTED';
  if (type === 'REVIEW_APPROVED') return 'COMPLETED';
  if (type === 'REVIEW_REJECTED') return 'REJECTED';
  if (type === 'REQUEST_CREATED') return 'RECEIVED';
  return 'IN_PROGRESS';
};

export const toUserDto = (user: { id: string; email: string | null; name: string; role: Role; clientId: string | null }) => ({
  id: user.id,
  email: user.email,
  name: user.name,
  role: user.role,
  clientId: user.clientId
});

export const toProjectDto = (project: ProjectWithClient) => {
  const requests = project.maintenanceRequests ?? [];
  const dueSoon = requests.filter((request) => {
    if (!request.dueDate || request.status === 'COMPLETED') return false;
    const diff = request.dueDate.getTime() - Date.now();
    return diff <= 1000 * 60 * 60 * 24 * 2;
  }).length;

  return {
    id: project.id,
    name: project.name,
    websiteUrl: project.websiteUrl,
    url: project.websiteUrl,
    description: project.description,
    clientId: project.clientId,
    client: project.client.name,
    members: project.users?.map((user) => user.name) ?? [],
    activeCounts: {
      progress: requests.filter((request) => request.status === 'IN_PROGRESS').length,
      review: requests.filter((request) => request.status === 'REVIEW_REQUESTED').length,
      danger: dueSoon
    },
    createdAt: project.createdAt.toISOString(),
    updatedAt: project.updatedAt.toISOString()
  };
};

export const toRequestDto = (request: RequestWithRelations) => ({
  id: request.id,
  projectId: request.projectId,
  project: request.project.name,
  projectName: request.project.name,
  client: request.project.client?.name,
  requesterId: request.requesterId,
  requester: request.requester.name,
  requesterRole: request.requester.role,
  assigneeId: request.assigneeId,
  assignee: request.assignee?.name ?? null,
  title: request.title,
  description: request.description,
  pageUrl: request.pageUrl,
  url: request.pageUrl,
  status: request.status,
  priority: request.priority,
  dueDate: request.dueDate?.toISOString() ?? null,
  beforeImagePath: request.beforeImagePath,
  afterImagePath: request.afterImagePath,
  reviewRequestedAt: request.reviewRequestedAt?.toISOString() ?? null,
  completedAt: request.completedAt?.toISOString() ?? null,
  createdAt: request.createdAt.toISOString(),
  updatedAt: request.updatedAt.toISOString(),
  pins:
    request.pins?.map((pin) => ({
      id: pin.id,
      xPercent: pin.xPercent,
      yPercent: pin.yPercent,
      content: pin.content,
      sortOrder: pin.sortOrder,
      createdAt: pin.createdAt.toISOString()
    })) ?? [],
  attachments:
    request.attachments?.map((attachment) => ({
      id: attachment.id,
      storagePath: attachment.storagePath,
      originalName: attachment.originalName,
      mimeType: attachment.mimeType,
      size: attachment.size,
      kind: attachment.kind,
      createdAt: attachment.createdAt.toISOString()
    })) ?? [],
  comments:
    request.comments?.map((comment) => ({
      id: comment.id,
      authorId: comment.authorId,
      author: comment.author.name,
      authorRole: comment.author.role,
      content: comment.content,
      createdAt: comment.createdAt.toISOString()
    })) ?? [],
  activities:
    request.activities?.map((activity) => ({
      id: activity.id,
      user: activity.actor?.name ?? '시스템',
      role: activity.actor?.role ?? 'SYSTEM',
      type: activity.type,
      status: activityStatus(activity.type),
      message:
        typeof activity.metadata === 'object' &&
        activity.metadata &&
        'message' in activity.metadata &&
        typeof activity.metadata.message === 'string'
          ? activity.metadata.message
          : activityMessage[activity.type],
      timestamp: activity.createdAt.toISOString(),
      metadata: activity.metadata
    })) ?? [],
  reviews:
    request.reviews?.map((review) => ({
      id: review.id,
      reviewerId: review.reviewerId,
      reviewer: review.reviewer.name,
      reviewerRole: review.reviewer.role,
      decision: review.decision,
      comment: review.comment,
      createdAt: review.createdAt.toISOString()
    })) ?? []
});

export const toNotificationDto = (notification: NotificationWithRequest) => ({
  id: notification.id,
  type: notification.type,
  project: notification.request?.project.name ?? 'SiteOps',
  requestId: notification.requestId,
  title: notification.title,
  message: notification.message,
  user: '시스템',
  time: notification.createdAt.toISOString(),
  isRead: notification.isRead,
  createdAt: notification.createdAt.toISOString()
});

export const priorityWeight = (priority: Priority) => {
  if (priority === 'URGENT') return 4;
  if (priority === 'HIGH') return 3;
  if (priority === 'NORMAL') return 2;
  return 1;
};

export const roleLabel = (role: Role) => {
  if (role === 'ADMIN') return '관리자';
  if (role === 'WORKER') return '작업자';
  return '고객';
};
