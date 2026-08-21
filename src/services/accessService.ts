import type { MaintenanceRequest, Project } from '@prisma/client';
import prisma from '../lib/prisma';
import type { CurrentUser } from '../types/http';
import { forbidden, notFound } from '../utils/errors';

type RequestAccessRecord = MaintenanceRequest & {
  project: Project;
};

export const accessibleRequestWhere = (user: CurrentUser) => {
  if (user.role === 'ADMIN') {
    return {};
  }

  if (user.role === 'CLIENT') {
    return {
      project: {
        clientId: user.clientId ?? '__missing_client__'
      }
    };
  }

  return {
    assigneeId: user.id
  };
};

export const accessibleProjectWhere = (user: CurrentUser) => {
  if (user.role === 'ADMIN') {
    return {};
  }

  if (user.role === 'CLIENT') {
    return {
      clientId: user.clientId ?? '__missing_client__'
    };
  }

  return {
    maintenanceRequests: {
      some: {
        assigneeId: user.id
      }
    }
  };
};

export const canAccessRequest = (user: CurrentUser, request: RequestAccessRecord) => {
  if (user.role === 'ADMIN') return true;
  if (user.role === 'CLIENT') return request.project.clientId === user.clientId;
  return request.assigneeId === user.id;
};

export const canReviewRequest = (user: CurrentUser, request: RequestAccessRecord) => {
  return user.role === 'CLIENT' && request.project.clientId === user.clientId;
};

export const canWorkOnRequest = (user: CurrentUser, request: RequestAccessRecord) => {
  if (user.role === 'ADMIN') return true;
  return user.role === 'WORKER' && request.assigneeId === user.id;
};

export const canEditRequest = (user: CurrentUser, request: RequestAccessRecord) => {
  if (user.role === 'ADMIN') return true;
  return (
    user.role === 'CLIENT' &&
    request.requesterId === user.id &&
    request.project.clientId === user.clientId &&
    request.status === 'RECEIVED'
  );
};

export const getRequestForAccess = async (requestId: string) => {
  const request = await prisma.maintenanceRequest.findUnique({
    where: { id: requestId },
    include: {
      project: true
    }
  });

  if (!request) {
    throw notFound('요청을 찾을 수 없습니다.');
  }

  return request;
};

export const assertRequestAccess = async (user: CurrentUser, requestId: string) => {
  const request = await getRequestForAccess(requestId);

  if (!canAccessRequest(user, request)) {
    throw forbidden();
  }

  return request;
};

export const assertProjectAccess = async (user: CurrentUser, projectId: string) => {
  const project = await prisma.project.findUnique({
    where: { id: projectId }
  });

  if (!project) {
    throw notFound('프로젝트를 찾을 수 없습니다.');
  }

  if (user.role === 'ADMIN') {
    return project;
  }

  if (user.role === 'CLIENT' && project.clientId === user.clientId) {
    return project;
  }

  if (user.role === 'WORKER') {
    const assigned = await prisma.maintenanceRequest.count({
      where: {
        projectId,
        assigneeId: user.id
      }
    });

    if (assigned > 0) {
      return project;
    }
  }

  throw forbidden();
};
