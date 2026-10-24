import type { CloudProfile, Personal } from "../protocol";

export const profilePath = (deviceId: string, accountId: string) => `/api/chinesetest/profiles/${encodeURIComponent(deviceId)}/${encodeURIComponent(accountId)}`;
export async function profileApi<T>(path: string, value?: unknown): Promise<T> {
  const response = await fetch(path,{method:value===undefined?"GET":"POST",cache:"no-store",headers:{"Content-Type":"application/json"},body:value===undefined?undefined:JSON.stringify(value),signal:AbortSignal.timeout(45000)});
  const data=await response.json();
  if (!response.ok) throw new Error(data.error || "Không lưu được hồ sơ. Thử lại khi kết nối ổn định.");
  return data;
}
export async function imageBase64(bytes: ArrayBuffer) {
  const data=new Uint8Array(bytes); let binary="";
  for(let i=0;i<data.length;i+=8192)binary+=String.fromCharCode(...data.subarray(i,i+8192));
  return btoa(binary);
}
export async function savedPhoto(path: string, version: string) {
  const response=await fetch(path+"/photo/"+encodeURIComponent(version),{cache:"no-store",signal:AbortSignal.timeout(45000)});
  if(!response.ok)throw new Error("Không đọc được ảnh đã lưu. Ảnh và bản nháp vẫn được giữ; thử lại khi có mạng.");
  return imageBase64(await response.arrayBuffer());
}
export const saveDraft = (path: string, profile: CloudProfile | null, personal: Personal) => profileApi<CloudProfile>(path,{revision:profile?.revision || 0,personal});
export async function assertProfileSynced(device: string, account: string) {
  const p=await profileApi<CloudProfile | null>(profilePath(device,account));
  if(p && (p.status!=="synced" || p.photoVersion!==p.syncedPhotoVersion)) throw new Error("Hồ sơ / ảnh còn bản nháp chưa đồng bộ. Mở Hồ sơ / ảnh và bấm Lưu hồ sơ trước khi chuẩn bị.");
}
