import { z } from 'zod';
import { badRequest } from './errors';

export const parseOrThrow = <T extends z.ZodTypeAny>(schema: T, value: unknown): z.infer<T> => {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw badRequest('입력값을 확인해 주세요.', parsed.error.flatten());
  }

  return parsed.data;
};

export const optionalDate = z.preprocess((value) => {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  if (value instanceof Date) {
    return value;
  }

  const str = String(value).trim();
  const normalized = str.includes('.') && !str.includes('T') ? str.replaceAll('.', '-') : str;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? value : date;
}, z.date().nullable());

export const optionalPositiveInt = (fallback: number) =>
  z.preprocess((value) => {
    if (value === undefined || value === null || value === '') {
      return fallback;
    }

    return Number(value);
  }, z.number().int().positive());
