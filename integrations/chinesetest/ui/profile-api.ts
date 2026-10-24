
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
