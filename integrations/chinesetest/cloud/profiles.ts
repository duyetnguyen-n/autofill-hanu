import { CloudError, transaction, type PrivateObjects, type SqlPool } from "../../../manager/cloud/postgres-store";
import { validPhotoPath, MAX_ACCOUNTS, type CloudPhoto } from "../protocol";

/** ChineseTest owns portrait bytes. This table contains only its reference. */
export class ChineseTestProfiles {
  constructor(private pool: SqlPool, private objects: PrivateObjects) {}
  async check() {
    try { await this.pool.query("SELECT photo_key,revision FROM chinesetest.profiles LIMIT 0"); }
    catch { throw new CloudError("Thiếu bảng hồ sơ ChineseTest. Chạy migration supabase/migrations/202610240001_chinesetest_profiles.sql trước khi cập nhật server.",503); }
  }
  private view(row:any):CloudPhoto|null {
    return row ? {revision:row.revision,photoVersion:row.synced_photo_version,photoMime:row.photo_mime,chineseTestPhoto:row.chinesetest_photo,needsMigration:Boolean(row.photo_key)||Object.keys(row.personal || {}).length>0,updatedAt:new Date(row.updated_at).toISOString()} : null;
  }
  async route(owner:string,path:string,method:string,body:()=>Promise<any>) {
    const match=path.match(/^\/api\/chinesetest\/profiles\/([0-9a-f-]{36})\/([a-zA-Z0-9-]{1,100})(?:\/(photo-metadata|photo|synced)(?:\/([a-f0-9-]{36}))?)?$/);
    if(!match)throw new CloudError("Không tìm thấy hồ sơ ChineseTest.",404);
    const [,device,account,action,version]=match,params=[owner,device,account];
    const runner=await this.pool.query("SELECT id FROM chinesetest.runners WHERE owner=$1 AND id=$2",[owner,device]);
    if(!runner.rows.length)throw new CloudError("Không tìm thấy máy chạy.",404);
    if(version || action==="photo" || action==="synced" || method==="POST"&&!action)throw new CloudError("Luồng lưu ảnh/bản nháp trên Supabase đã dừng. Tải lại trang và cập nhật ChineseTest Runner để dùng ảnh trên ChineseTest.",410);
    if(method==="GET"&&!action)return this.view((await this.pool.query("SELECT * FROM chinesetest.profiles WHERE owner=$1 AND runner_id=$2 AND account_id=$3",params)).rows[0]);
    if(method!=="POST"||action!=="photo-metadata")throw new CloudError("Method không hợp lệ.",405);
    const b=await body();
    if(!b || typeof b!=="object" || Array.isArray(b))throw new CloudError("Metadata ảnh không hợp lệ.");
    if(Object.keys(b).some(k=>!["revision","photoVersion","mimeType","chineseTestPhoto"].includes(k)))throw new CloudError("Chỉ lưu đường dẫn ảnh và metadata ChineseTest; không nhận ảnh gốc hoặc bản nháp.");
    if(!Number.isSafeInteger(b.revision)||b.revision<0)throw new CloudError("Đọc lại metadata ảnh trước khi lưu.",409);
    if(!/^[a-f0-9-]{36}$/.test(b.photoVersion || "")||!["image/jpeg","image/png"].includes(b.mimeType)||!validPhotoPath(b.chineseTestPhoto)||b.chineseTestPhoto.length>2048)throw new CloudError("Metadata ảnh ChineseTest không hợp lệ.");
    const row=await transaction(this.pool,async db=>{
      const owned=await db.query("SELECT id FROM chinesetest.runners WHERE owner=$1 AND id=$2 FOR UPDATE",[owner,device]);
      if(!owned.rows.length)throw new CloudError("Máy chạy đã được gỡ liên kết.",409);
      const current=(await db.query("SELECT * FROM chinesetest.profiles WHERE owner=$1 AND runner_id=$2 AND account_id=$3 FOR UPDATE",params)).rows[0];
      if((current?.revision || 0)!==b.revision)throw new CloudError("Metadata ảnh vừa thay đổi ở cửa sổ khác. Mở lại hồ sơ trước khi lưu.",409);
      if(!current&&Number((await db.query("SELECT count(*) AS n FROM chinesetest.profiles WHERE owner=$1 AND runner_id=$2",[owner,device])).rows[0].n)>=MAX_ACCOUNTS)throw new CloudError("Máy này đã có đủ 20 metadata hồ sơ.",409);
      // Cleanup only when a verified ChineseTest portrait replaces a legacy original.
      // Retain its key on failure, so a subsequent metadata save can retry cleanup.
      if(current?.photo_key){
        if(!this.objects.remove)throw new CloudError("Chưa dọn được ảnh Supabase cũ. Metadata mới chưa lưu; thử lại sau.",503);
        try{await this.objects.remove(current.photo_key);}catch{throw new CloudError("Chưa dọn được ảnh Supabase cũ. Metadata mới chưa lưu; thử lại sau.",503);}
      }
      return (await db.query(`INSERT INTO chinesetest.profiles(owner,runner_id,account_id,personal,photo_key,photo_version,photo_mime,synced_photo_version,chinesetest_photo,status,revision)
        VALUES($1,$2,$3,'{}',NULL,$4,$5,$4,$6,'synced',1)
        ON CONFLICT(owner,runner_id,account_id) DO UPDATE SET personal='{}',photo_key=NULL,photo_version=excluded.photo_version,photo_mime=excluded.photo_mime,synced_photo_version=excluded.synced_photo_version,chinesetest_photo=excluded.chinesetest_photo,status='synced',revision=chinesetest.profiles.revision+1,updated_at=now() RETURNING *`,[...params,b.photoVersion,b.mimeType,b.chineseTestPhoto])).rows[0];
    });
    return this.view(row);
  }
}
