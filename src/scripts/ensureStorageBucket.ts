import '../config/env';
import { env } from '../config/env';
import { getSupabase } from '../lib/supabase';

async function main() {
  const supabase = getSupabase();
  const { data: buckets, error: listError } = await supabase.storage.listBuckets();

  if (listError) {
    throw new Error(`Storage bucket list failed: ${listError.message}`);
  }

  const existing = buckets?.find((bucket) => bucket.name === env.supabaseBucket);
  if (existing) {
    if (existing.public) {
      const { error } = await supabase.storage.updateBucket(env.supabaseBucket, { public: false });
      if (error) {
        throw new Error(`Storage bucket privacy update failed: ${error.message}`);
      }
    }

    console.log(`Storage bucket ready: ${env.supabaseBucket} (private)`);
    return;
  }

  const { error } = await supabase.storage.createBucket(env.supabaseBucket, {
    public: false,
    fileSizeLimit: 10 * 1024 * 1024,
    allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
  });

  if (error) {
    throw new Error(`Storage bucket create failed: ${error.message}`);
  }

  console.log(`Storage bucket created: ${env.supabaseBucket} (private)`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Storage bucket setup failed.');
  process.exit(1);
});
