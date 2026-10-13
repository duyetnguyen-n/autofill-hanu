import { createClient } from '@supabase/supabase-js';
import type { PrivateObjects } from './postgres-store';
import { CloudError } from './postgres-store';

export function supabaseObjects(url: string, secret: string): PrivateObjects {
  const storage = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } }).storage.from('hanu-private');
  return {
    async put(path, bytes) {
      const { error } = await storage.upload(path, bytes, { contentType: 'application/octet-stream', upsert: true, cacheControl: '0' });
      if (error) throw new CloudError('Không lưu được ảnh lên Supabase Storage. Kiểm tra bucket và dung lượng.', 503);
    },
    async get(path) {
      const { data, error } = await storage.download(path);
      if (error || !data) throw new CloudError('Không đọc được ảnh trên Supabase Storage.', 503);
      return Buffer.from(await data.arrayBuffer());
    }
  };
}
