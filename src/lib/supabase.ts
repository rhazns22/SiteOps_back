import { createClient } from '@supabase/supabase-js';
import { requiredEnv } from '../config/env';

let client: ReturnType<typeof createClient> | null = null;

export const getSupabase = () => {
  if (!client) {
    client = createClient(requiredEnv('SUPABASE_URL'), requiredEnv('SUPABASE_SECRET_KEY'), {
      auth: {
        persistSession: false,
        autoRefreshToken: false
      }
    });
  }

  return client;
};
