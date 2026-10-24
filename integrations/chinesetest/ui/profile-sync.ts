import type {Command,Personal,Portrait,ProfileSyncPhase,ProfileSyncStatus,Row} from "../protocol";
const progress:Record<ProfileSyncPhase,string>={
  queued:"Máy đã nhận hồ sơ, đang chờ lượt đồng bộ…",
  "checking-session":"Đang kiểm tra kết nối và phiên đăng nhập ChineseTest…",
  uploading:"Đang tải ảnh lên ChineseTest, vui lòng chờ phản hồi…",
  "reading-photo":"Đang đọc lại ảnh từ ChineseTest để kiểm tra…",
  saving:"Đang lưu hồ sơ đã đồng bộ trên máy chạy…",
  done:"Đang xác nhận hồ sơ đã đồng bộ…",
  failed:"Đồng bộ chưa hoàn tất.",
};
export async function synchronizeProfile(request:(command:Command,args?:Row)=>Promise<any>,args:Row,update:(message:string)=>void,alive=()=>true,start: "start-profile-sync"|"start-photo-upload"|"start-photo-read"="start-profile-sync"):Promise<{personal:Personal;photoVersion:string|null;image?:Portrait}>{
  const job=await request(start,args);
  if(typeof job?.id!=="string")throw new Error("Runner chưa hỗ trợ theo dõi đồng bộ ảnh. Cập nhật ChineseTest Runner rồi mở lại hồ sơ.");
  const deadline=Date.now()+5*60000;
  while(alive()){
    const status=await request("profile-sync-status",{accountId:args.accountId,id:job.id}) as ProfileSyncStatus;
    if(status.phase==="failed")throw new Error(status.error || "ChineseTest chưa xác nhận đồng bộ ảnh.");
    update(progress[status.phase] || "Máy đang đồng bộ hồ sơ…");
    if(status.phase==="done"){
      if(!status.result?.personal)throw new Error("Chưa nhận được hồ sơ đã đồng bộ từ runner.");
      return status.result;
    }
    if(Date.now()>=deadline)throw new Error("Máy vẫn đang xử lý. Mở lại hồ sơ để đọc lại ảnh và xem kết quả trước khi thử tải ảnh lần nữa.");
    await new Promise(resolve=>setTimeout(resolve,1500));
  }
  throw new Error("Đã rời màn hồ sơ. Máy tiếp tục xử lý; mở lại hồ sơ để xem kết quả.");
}
