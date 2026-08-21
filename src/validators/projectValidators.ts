import { z } from 'zod';

export const projectParamsSchema = z.object({
  projectId: z.string().min(1)
});

export const createProjectBodySchema = z.object({
  clientId: z.string().min(1),
  name: z.string().min(1),
  websiteUrl: z.string().url(),
  description: z.string().optional().nullable()
});

export const updateProjectBodySchema = createProjectBodySchema
  .omit({ clientId: true })
  .partial()
  .refine((value) => Object.keys(value).length > 0, {
    message: '수정할 값이 필요합니다.'
  });
