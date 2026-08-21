import path from 'path';
import dotenv from 'dotenv';
import { configurationError } from '../utils/errors';

const serverRoot = path.resolve(__dirname, '..', '..');
const workspaceRoot = path.resolve(serverRoot, '..');

dotenv.config({ path: path.join(workspaceRoot, '.env') });
dotenv.config({ path: path.join(serverRoot, '.env'), override: true });

export const env = {
  corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:5173',
  nodeEnv: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT || 3000),
  supabaseBucket: 'siteops-attachments'
};

export const requiredEnv = (key: string): string => {
  const value = process.env[key];
  if (!value) {
    throw configurationError(`${key} 환경변수가 설정되지 않았습니다.`);
  }
  return value;
};
