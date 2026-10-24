import { randomUUID } from "node:crypto";
import { CloudError, transaction, type PrivateObjects, type SqlPool } from "../../../manager/cloud/postgres-store";
import { personalFrom, validPhotoPath, type CloudProfile } from "../protocol";
import { MAX_ACCOUNTS } from "../protocol";

export function portraitBytes(base64: unknown, mime: unknown) {
  if (typeof base64 !== "string" || base64.length > 1_400_000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) throw new CloudError("Dữ liệu ảnh không hợp lệ.");
  const bytes = Buffer.from(base64, "base64");
  if (bytes.toString("base64") !== base64 || bytes.length <= 15 * 1024 || bytes.length >= 1024 * 1024) throw new CloudError("Chọn ảnh JPG/PNG lớn hơn 15 KB và nhỏ hơn 1 MB.");
  const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8;
  const png = bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
  if (!(mime === "image/jpeg" && jpeg || mime === "image/png" && png)) throw new CloudError("Nội dung ảnh không đúng định dạng JPG/PNG.");
  return bytes;
}

export class ChineseTestProfiles {
  constructor(private pool: SqlPool, private objects: PrivateObjects) {}
  async check() {
    try { await this.pool.query("SELECT photo_key,revision FROM chinesetest.profiles LIMIT 0"); }
    catch { throw new CloudError("Thiếu bảng hồ sơ ChineseTest. Chạy migration supabase/migrations/202610240001_chinesetest_profiles.sql trước khi cập nhật server.",503); }
  }
  private view(row: any): CloudProfile | null {
    return row ? { personal: personalFrom(row.personal), revision: row.revision, photoKey: row.photo_key,
      photoVersion: row.photo_version, photoMime: row.photo_mime, syncedPhotoVersion: row.synced_photo_version,
      chineseTestPhoto: row.chinesetest_photo, status: row.status, updatedAt: new Date(row.updated_at).toISOString() } : null;
  }
  async route(owner: string, path: string, method: string, body: () => Promise<any>) {
    const match = path.match(/^\/api\/chinesetest\/profiles\/([0-9a-f-]{36})\/([a-zA-Z0-9-]{1,100})(?:\/(photo|synced)(?:\/([a-f0-9-]{36}))?)?$/);
    if (!match) throw new CloudError("Không tìm thấy hồ sơ ChineseTest.",404);
    const [,device,account,action,version] = match, params = [owner,device,account];
    if (version && (action !== "photo" || method !== "GET")) throw new CloudError("Đường dẫn ảnh không hợp lệ.",404);
    const runner = await this.pool.query("SELECT id FROM chinesetest.runners WHERE owner=$1 AND id=$2",[owner,device]);
    if (!runner.rows.length) throw new CloudError("Không tìm thấy máy chạy.",404);
    const read = () => this.pool.query("SELECT * FROM chinesetest.profiles WHERE owner=$1 AND runner_id=$2 AND account_id=$3",params);
    if (method === "GET") {
      const row = (await read()).rows[0];
      if (!action) return this.view(row);
      if (action !== "photo" || !row?.photo_key) throw new CloudError("Chưa có ảnh đã lưu.",404);
      if (version && version !== row.photo_version) throw new CloudError("Ảnh đã thay đổi. Mở lại hồ sơ để xem phiên bản mới.",409);
      try { return { photoBytes: await this.objects.get(row.photo_key), contentType: row.photo_mime }; }
      catch { throw new CloudError("Chưa đọc được ảnh trên Supabase. Bản nháp vẫn được giữ; thử lại khi có kết nối.",503); }
    }
    if (method !== "POST") throw new CloudError("Method không hợp lệ.",405);
    const b = await body();
    if (!Number.isSafeInteger(b.revision) || b.revision < 0) throw new CloudError("Đọc lại hồ sơ trước khi lưu.",409);
    const current = (await read()).rows[0];
    if ((current?.revision || 0) !== b.revision) throw new CloudError("Hồ sơ vừa thay đổi ở cửa sổ khác. Mở lại hồ sơ trước khi lưu.",409);
    let newKey: string | undefined;
    if (action === "photo") {
      const bytes = portraitBytes(b.base64,b.mimeType);
      newKey = `chinesetest/${owner}/${device}/${account}/${randomUUID()}`;
      try { await this.objects.put(newKey,bytes); } catch { throw new CloudError("Không lưu được ảnh lên Supabase. Ảnh cũ vẫn được giữ; thử lại khi có kết nối.",503); }
    }
    try {
      const result = await transaction(this.pool,async db => {
        // Lock the owning runner too, including the first insert and unlink race.
        const owned = await db.query("SELECT id FROM chinesetest.runners WHERE owner=$1 AND id=$2 FOR UPDATE",[owner,device]);
        if (!owned.rows.length) throw new CloudError("Máy chạy đã được gỡ liên kết.",409);
        const row = (await db.query("SELECT * FROM chinesetest.profiles WHERE owner=$1 AND runner_id=$2 AND account_id=$3 FOR UPDATE",params)).rows[0];
        if ((row?.revision || 0) !== b.revision) throw new CloudError("Hồ sơ vừa thay đổi ở cửa sổ khác. Mở lại hồ sơ trước khi lưu.",409);
        if (action === "synced") {
          if (!row || b.photoVersion !== row.photo_version || !validPhotoPath(b.chineseTestPhoto)) throw new CloudError("Ảnh đã thay đổi hoặc chưa đồng bộ. Lưu lại hồ sơ.",409);
          return (await db.query("UPDATE chinesetest.profiles SET personal=jsonb_set(personal,'{photo}',to_jsonb($4::text)),chinesetest_photo=$4,synced_photo_version=photo_version,status='synced',revision=revision+1,updated_at=now() WHERE owner=$1 AND runner_id=$2 AND account_id=$3 RETURNING *",[...params,b.chineseTestPhoto])).rows[0];
        }
        if (!b.personal || typeof b.personal !== "object" || Array.isArray(b.personal) || JSON.stringify(b.personal).length > 32768) throw new CloudError("Thông tin hồ sơ không hợp lệ.");
        if (!row && Number((await db.query("SELECT count(*) AS n FROM chinesetest.profiles WHERE owner=$1 AND runner_id=$2",[owner,device])).rows[0].n) >= MAX_ACCOUNTS) throw new CloudError("Máy này đã có đủ 20 hồ sơ lưu trên hệ thống.",409);
        const personal = personalFrom(b.personal);
        // The ChineseTest path is managed by synchronization, never by a stale draft.
        personal.photo = row?.chinesetest_photo || "";
        const key = newKey || row?.photo_key || null;
        const version = newKey ? randomUUID() : row?.photo_version || null;
        const mime = newKey ? b.mimeType : row?.photo_mime || null;
        return (await db.query(`INSERT INTO chinesetest.profiles(owner,runner_id,account_id,personal,photo_key,photo_version,photo_mime,revision)
          VALUES($1,$2,$3,$4,$5,$6,$7,1) ON CONFLICT(owner,runner_id,account_id) DO UPDATE SET personal=excluded.personal,photo_key=excluded.photo_key,photo_version=excluded.photo_version,photo_mime=excluded.photo_mime,status='draft',revision=chinesetest.profiles.revision+1,updated_at=now() RETURNING *`,[...params,JSON.stringify(personal),key,version,mime])).rows[0];
      });
      if (newKey && current?.photo_key) await this.objects.remove?.(current.photo_key).catch(()=>{});
      return this.view(result);
    } catch(e) { if (newKey) await this.objects.remove?.(newKey).catch(()=>{}); throw e; }
  }
}
