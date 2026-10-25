import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {FacebookWatcher,facebookAccessStatus} from '../src/facebook-watch';

let updated:Function,removed:Function,connected=true;let data:Record<string,any>;let api:any;
const config={scheduleId:'schedule',token:'token',postUrl:'https://www.facebook.com/story.php?story_fbid=123&id=456',watchAt:new Date(100000).toISOString(),expiresAt:new Date(400000).toISOString()};
beforeEach(()=>{vi.useFakeTimers();vi.setSystemTime(90000);data={};connected=true;api={permissions:{contains:vi.fn(async()=>true)},scripting:{getRegisteredContentScripts:vi.fn(async()=>[]),registerContentScripts:vi.fn(async()=>{})},storage:{local:{get:vi.fn(async()=>structuredClone(data)),set:vi.fn(async(v:any)=>Object.assign(data,v)),remove:vi.fn(async(k:string)=>{delete data[k];})}},windows:{create:vi.fn(async()=>({id:9,tabs:[{id:17,windowId:9}]})),update:vi.fn(async()=>({})),remove:vi.fn(async()=>{})},tabs:{onUpdated:{addListener:(f:Function)=>{updated=f;}},onRemoved:{addListener:(f:Function)=>{removed=f;}},create:vi.fn(async()=>({id:17})),update:vi.fn(async()=>({id:17})),get:vi.fn(async()=>({id:17,windowId:9,url:config.postUrl})),reload:vi.fn(async()=>{})}};vi.stubGlobal('chrome',api);});
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();});
it('starts the short polling phase before the hour, never overlaps a loading request',async()=>{
  const watcher=new FacebookWatcher(()=>connected,vi.fn(async()=>{}));await watcher.command(config);updated(17,{status:'complete'});
  await vi.advanceTimersByTimeAsync(20000);expect(api.tabs.reload).toHaveBeenCalledTimes(1);updated(17,{status:'complete'});
  await watcher.observation({tab:{id:17},frameId:0,url:config.postUrl} as any,{...config,postKey:'456:123',text:'HSK 4: https://forms.gle/Four'});
  await vi.advanceTimersByTimeAsync(1600);expect(api.tabs.reload).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(2000);expect(api.tabs.reload).toHaveBeenCalledTimes(2);watcher.stop();
});
it('accepts only the matching top-frame tab and rejects stale tokens',async()=>{
  const report=vi.fn(async()=>({accepted:true})),watcher=new FacebookWatcher(()=>connected,report);await watcher.command(config);
  const sender={tab:{id:17},frameId:0,url:config.postUrl} as chrome.runtime.MessageSender;
  const payload={...config,postKey:'456:123',text:'HSK 4: https://forms.gle/Four'};
  await watcher.observation(sender,payload);expect(report).toHaveBeenCalledTimes(1);
  await expect(watcher.observation({...sender,frameId:1},payload)).rejects.toThrow('không thuộc');
  await expect(watcher.observation({...sender,tab:{id:18} as any},payload)).rejects.toThrow('không thuộc');
  await expect(watcher.observation(sender,{...payload,token:'old'})).rejects.toThrow('không thuộc');watcher.stop();
});
it('does not request extra permissions or open a tab without the user grant',async()=>{
  api.permissions.contains.mockResolvedValue(false);const watcher=new FacebookWatcher(()=>connected,vi.fn());
  await expect(watcher.command(config)).rejects.toThrow('Cho phép');expect(api.windows.create).not.toHaveBeenCalled();
});
it('stops on lost coordinator / expired lease / closed watcher tab',async()=>{
  const watcher=new FacebookWatcher(()=>connected,vi.fn());await watcher.command(config);connected=false;await vi.advanceTimersByTimeAsync(200);const n=api.tabs.reload.mock.calls.length;
  await vi.advanceTimersByTimeAsync(30000);expect(api.tabs.reload).toHaveBeenCalledTimes(n);
  connected=true;await watcher.command({...config,token:'new'});removed(17);await vi.advanceTimersByTimeAsync(10000);expect(api.tabs.reload).toHaveBeenCalledTimes(n);
});
it('a Stop fences a WATCH still waiting for permission lookup',async()=>{
  let release!:(v:boolean)=>void;api.permissions.contains.mockImplementation(()=>new Promise<boolean>(r=>{release=r;}));
  const watcher=new FacebookWatcher(()=>connected,vi.fn()),opening=watcher.command(config);
  await watcher.command({stop:true,token:'token'});release(true);await expect(opening).rejects.toThrow('thay đổi');expect(api.tabs.create).not.toHaveBeenCalled();
  await expect(watcher.command(config)).rejects.toThrow('đã dừng');
});
it('opens one small separate window and focuses only its matching schedule on request',async()=>{
  const watcher=new FacebookWatcher(()=>connected,vi.fn());await watcher.command(config);await watcher.command(config);
  expect(api.windows.create).toHaveBeenCalledExactlyOnceWith({url:'about:blank',type:'popup',width:520,height:720,focused:false});
  expect(api.tabs.create).not.toHaveBeenCalled();expect(api.windows.update).not.toHaveBeenCalled();
  await expect(watcher.command({focus:true,token:'old',scheduleId:config.scheduleId})).rejects.toThrow('đổi lịch');
  await watcher.command({focus:true,token:config.token,scheduleId:config.scheduleId});
  expect(api.windows.update).toHaveBeenCalledWith(9,{focused:true,state:'normal'});
  expect(api.tabs.update).toHaveBeenCalledWith(17,{active:true});watcher.stop();
});
it('closes only its newly-created blank window when cancellation overtakes window creation',async()=>{
  let release!:(v:any)=>void;api.windows.create.mockImplementation(()=>new Promise(r=>release=r));
  const watcher=new FacebookWatcher(()=>connected,vi.fn()),opening=watcher.command(config);
  await vi.advanceTimersByTimeAsync(0);expect(api.windows.create).toHaveBeenCalledOnce();
  await watcher.command({stop:true,token:config.token});release({id:9,tabs:[{id:17,windowId:9}]});
  await expect(opening).rejects.toThrow('đã hủy');expect(api.windows.remove).toHaveBeenCalledWith(9);expect(api.tabs.update).not.toHaveBeenCalled();
});
it('reuses its saved post window after worker restart and never focuses another page',async()=>{
  data.facebookWatch={...config,tabId:17,leaseUntil:115000};
  const watcher=new FacebookWatcher(()=>connected,vi.fn());await watcher.command({...config,token:'renewed'});
  expect(api.windows.create).not.toHaveBeenCalled();api.tabs.get.mockResolvedValue({id:17,windowId:9,url:'https://www.facebook.com/'});
  await expect(watcher.command({focus:true,token:'renewed',scheduleId:config.scheduleId})).rejects.toThrow('đã chọn');
  expect(api.windows.update).not.toHaveBeenCalled();watcher.stop();
});
it('does not mistake HTTP complete for readable SPA content and starve it with rapid reloads',async()=>{
  vi.setSystemTime(100000);const watcher=new FacebookWatcher(()=>connected,vi.fn(async()=>({accepted:true})));
  await watcher.command(config);updated(17,{status:'complete'});
  await vi.advanceTimersByTimeAsync(2000);expect(api.tabs.reload).not.toHaveBeenCalled();
  await watcher.observation({tab:{id:17},frameId:0,url:config.postUrl} as any,{...config,postKey:'456:123',text:'',error:'loading'});
  await vi.advanceTimersByTimeAsync(17600);expect(api.tabs.reload).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(400);expect(api.tabs.reload).toHaveBeenCalledTimes(1);
  await watcher.observation({tab:{id:17},frameId:0,url:config.postUrl} as any,{...config,postKey:'456:123',text:'HSK 4: https://forms.gle/Four'});
  await vi.advanceTimersByTimeAsync(1600);expect(api.tabs.reload).toHaveBeenCalledTimes(2);watcher.stop();
});
it('lets a slow public story render after twelve seconds, then returns to fast polling',async()=>{
  vi.setSystemTime(100000);const watcher=new FacebookWatcher(()=>connected,vi.fn(async()=>({accepted:true})));
  await watcher.command(config);updated(17,{status:'complete'});
  await vi.advanceTimersByTimeAsync(12000);expect(api.tabs.reload).not.toHaveBeenCalled();
  await watcher.observation({tab:{id:17},frameId:0,url:config.postUrl} as any,{...config,postKey:'456:123',text:'HSK 4: https://forms.gle/Four'});
  await vi.advanceTimersByTimeAsync(200);expect(api.tabs.reload).toHaveBeenCalledTimes(1);watcher.stop();
});
it('reuses its owned post window across schedules instead of opening more login windows',async()=>{
  const watcher=new FacebookWatcher(()=>connected,vi.fn());await watcher.command(config);watcher.stop();
  await watcher.command({...config,token:'new-token',scheduleId:'next-schedule'});
  expect(api.windows.create).toHaveBeenCalledTimes(1);expect(data.facebookWatch.scheduleId).toBe('next-schedule');watcher.stop();
});
it('pauses network reloads immediately on the accepted-link reply while keeping its window available',async()=>{
  const watcher=new FacebookWatcher(()=>connected,vi.fn(async()=>({accepted:true,pauseReload:true})));await watcher.command(config);
  await watcher.observation({tab:{id:17},frameId:0,url:config.postUrl} as any,{...config,postKey:'456:123',text:'HSK 4: https://forms.gle/Four'});
  await vi.advanceTimersByTimeAsync(12000);expect(api.tabs.reload).not.toHaveBeenCalled();
  await watcher.command({...config,pauseReload:true});
  await watcher.command({focus:true,scheduleId:config.scheduleId,token:config.token});expect(api.windows.update).toHaveBeenCalled();
  await watcher.command({...config,pauseReload:false});await vi.advanceTimersByTimeAsync(1600);expect(api.tabs.reload).toHaveBeenCalled();watcher.stop();
});
it('ignores a lease renewal sent before the link was captured, but allows a newer source revision to resume polling',async()=>{
 const watcher=new FacebookWatcher(()=>connected,vi.fn(async()=>({pauseReload:true,watchRevision:2})));await watcher.command({...config,watchRevision:1});
 await watcher.observation({tab:{id:17},frameId:0,url:config.postUrl} as any,{...config,postKey:'456:123',text:'HSK 4: https://forms.gle/Four'});
 await watcher.command({...config,watchRevision:1,pauseReload:false});await vi.advanceTimersByTimeAsync(12000);expect(api.tabs.reload).not.toHaveBeenCalled();
 await watcher.command({...config,watchRevision:3,pauseReload:false});await vi.advanceTimersByTimeAsync(1600);expect(api.tabs.reload).toHaveBeenCalled();watcher.stop();
});

it('distinguishes granted permission from missing reader registration and repairs only an existing grant',async()=>{
  api.permissions.contains.mockResolvedValue(false);expect(await facebookAccessStatus(true)).toEqual({permission:'missing',reader:'missing'});expect(api.scripting.registerContentScripts).not.toHaveBeenCalled();
  api.permissions.contains.mockResolvedValue(true);expect(await facebookAccessStatus()).toEqual({permission:'granted',reader:'missing'});
  api.scripting.registerContentScripts.mockImplementation(async()=>{api.scripting.getRegisteredContentScripts.mockResolvedValue([{id:'hanu-facebook-message'}]);});
  expect(await facebookAccessStatus(true)).toEqual({permission:'granted',reader:'ready'});
  api.scripting.getRegisteredContentScripts.mockRejectedValue(new Error('script failed'));expect(await facebookAccessStatus()).toMatchObject({permission:'granted',reader:'error',error:'script failed'});
});

it('protects an expansion that begins after a readable post from the fast reload cadence',async()=>{
  vi.setSystemTime(100000);const watcher=new FacebookWatcher(()=>connected,vi.fn(async()=>({accepted:true})));await watcher.command(config);
  const sender={tab:{id:17},frameId:0,url:config.postUrl} as any;
  await watcher.observation(sender,{...config,postKey:'456:123',text:'Bản xem trước'});
  await vi.advanceTimersByTimeAsync(1400);
  await watcher.observation(sender,{...config,postKey:'456:123',text:'',error:'Đang chờ mở nội dung',postState:'expanding'});
  await vi.advanceTimersByTimeAsync(10000);expect(api.tabs.reload).not.toHaveBeenCalled();
  await watcher.observation(sender,{...config,postKey:'456:123',text:'',error:'Chưa mở hết nội dung bài',postState:'collapsed'});
  await vi.advanceTimersByTimeAsync(200);expect(api.tabs.reload).toHaveBeenCalledTimes(1);watcher.stop();
});
it('gives a late SPA expansion its own bounded window without extending it on repeated reports',async()=>{
  vi.setSystemTime(100000);const watcher=new FacebookWatcher(()=>connected,vi.fn(async()=>({accepted:true})));await watcher.command(config);
  await vi.advanceTimersByTimeAsync(18000);await watcher.command(config);
  const sender={tab:{id:17},frameId:0,url:config.postUrl} as any,payload={...config,postKey:'456:123',text:'',error:'Đang chờ mở nội dung',postState:'expanding'};
  await watcher.observation(sender,payload);
  for(let n=0;n<11;n++){await vi.advanceTimersByTimeAsync(1000);await watcher.observation(sender,payload);}
  expect(api.tabs.reload).not.toHaveBeenCalled();await vi.advanceTimersByTimeAsync(1200);expect(api.tabs.reload).toHaveBeenCalledTimes(1);watcher.stop();
});
