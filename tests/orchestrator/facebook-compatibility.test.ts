import {expect,it,vi} from 'vitest';
import {Coordinator} from '../../manager/server/coordinator';
import type {DataStore} from '../../manager/server/data-store';

function fixture(){
 const c=new Coordinator({} as DataStore),sent:any[]=[];
 const peer=(capabilities:string[])=>({readyState:1,send(raw:string){
   const command=JSON.parse(raw);sent.push(command);
   const result=command.kind==='PING'?{capabilities}:{ready:true};
   void c.receive('profile',{type:'RESULT',commandId:command.commandId,ok:true,result});
 }} as any);
 return {c,sent,peer};
}
it('never sends watcher, focus or cleanup commands into an older extension form-control fallback',async()=>{
 const f=fixture();f.c.peers.set('profile',f.peer(['reliableRuns','sharedFinalQuestion']));
 for(const payload of [{postUrl:'test'},{focus:true},{stop:true}])await expect(f.c.command('profile','WATCH_FACEBOOK',payload)).rejects.toThrow('chưa hỗ trợ săn link');
 expect(f.sent.map(m=>m.kind)).toEqual(['PING']);expect(f.sent.every(m=>!m.runId)).toBe(true);
});
it('verifies once per connection and detects an old extension after reconnect',async()=>{
 const f=fixture();f.c.peers.set('profile',f.peer(['scheduledHskLinks','facebookWatchWindow']));
 await f.c.command('profile','WATCH_FACEBOOK',{});await f.c.command('profile','WATCH_FACEBOOK',{focus:true});
 expect(f.sent.map(m=>m.kind)).toEqual(['PING','WATCH_FACEBOOK','WATCH_FACEBOOK']);
 f.c.peers.set('profile',f.peer([]));await expect(f.c.command('profile','WATCH_FACEBOOK',{})).rejects.toThrow('chưa hỗ trợ');
 expect(f.sent.map(m=>m.kind)).toEqual(['PING','WATCH_FACEBOOK','WATCH_FACEBOOK','PING']);
});
it('keeps 1.7.0 watching compatible and rejects only the newer window operation with an actionable error',async()=>{
 const f=fixture();f.c.peers.set('profile',f.peer(['scheduledHskLinks']));
 await f.c.command('profile','WATCH_FACEBOOK',{});
 await expect(f.c.command('profile','WATCH_FACEBOOK',{focus:true})).rejects.toThrow('cửa sổ Facebook nhỏ');
 expect(f.sent.map(m=>m.kind)).toEqual(['PING','WATCH_FACEBOOK']);
});
it('does not send a verified command after its connection changes during the probe',async()=>{
 const f=fixture();let ping:any;
 f.c.peers.set('profile',{readyState:1,send:vi.fn(raw=>{ping=JSON.parse(raw);})} as any);
 const opening=f.c.command('profile','WATCH_FACEBOOK',{}),check=expect(opening).rejects.toThrow('đã thay đổi');
 await Promise.resolve();f.c.peers.set('profile',f.peer([]));
 await f.c.receive('profile',{type:'RESULT',commandId:ping.commandId,ok:true,result:{capabilities:['scheduledHskLinks']}});await check;
 expect(f.sent).toHaveLength(0);
});
