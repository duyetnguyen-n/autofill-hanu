import {afterEach,describe,it,expect,vi} from 'vitest';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Store,digest} from '../../manager/server/store';
import {Coordinator} from '../../manager/server/coordinator';
import {emptyProfile} from '../../src/rules';
import type {RunState} from '../../src/shared';

const stores:Store[]=[],dirs:string[]=[];
afterEach(()=>{for(const store of stores)try{store.close();}catch{}for(const dir of dirs)rmSync(dir,{recursive:true,force:true});stores.length=dirs.length=0;});
function setup(count=2){const dir=mkdtempSync(join(tmpdir(),'hanu-store-'));dirs.push(dir);const path=join(dir,'db.sqlite');const store=new Store(path);stores.push(store);const members=Array.from({length:count},(_,i)=>`session-${i}`);for(const id of members){const token=store.pair(id,store.pairCode());expect(store.authenticate(id,token)).toBe(true);const s=store.session(id);s.profile=emptyProfile();s.profile.values.fullName=id;s.expectedEmail=`${id}@example.com`;s.synced=true;s.run={runId:'group',sessionId:id,managed:true,formId:'form',tabId:1,mode:'live',status:'running',filled:[],skipped:[],logs:[],submitAttempted:false,updatedAt:'',eventSeq:0};store.saveSession(s);}store.saveGroup({id:'group',url:'https://docs.google.com/forms/d/e/form/viewform',mode:'live',members,paused:false,createdAt:''});return {store,path,members};}
describe('durable coordinator state',()=>{
  it('invalidates cached sessions after rollback and does not expose mutable cache references',()=>{
    const {store,members}=setup(1),id=members[0],before=store.session(id).name;
    expect(()=>store.transaction(()=>{const s=store.session(id);s.name='rollback';store.saveSession(s);throw new Error('rollback');})).toThrow('rollback');
    expect(store.session(id).name).toBe(before);
    store.sessions()[0].name='unsaved';expect(store.session(id).name).toBe(before);
    const changed=store.session(id);changed.name='failed insert';expect(()=>store.saveSession(changed,'duplicate-token')).toThrow();expect(store.session(id).name).toBe(before);
  });
  it('automatically resumes only an unsubmitted correction wait without unpausing a stopped group',async()=>{
    const {store,members}=setup(1),c=new Coordinator(store),commands=vi.fn(async()=>({})),id=members[0];c.command=commands;
    const s=store.session(id);s.run!.status='waiting_manual';s.run!.blockingIssue={reason:'validation',message:'Sai định dạng'};store.saveSession(s);
    await c.control(id,'RESUME','group',true);expect(commands).toHaveBeenCalledWith(id,'RESUME',{automatic:true},'group',90000);commands.mockClear();
    const g=store.group('group');g.paused=true;g.stopped=true;store.saveGroup(g);
    await expect(c.control(id,'RESUME','group',true)).rejects.toThrow('Nhóm đã dừng');expect(commands).not.toHaveBeenCalled();expect(store.group('group')).toMatchObject({paused:true,stopped:true});
  });
  it.each(['paused','idle','completed','submit_uncertain'] as const)('does not automatically resume a coordinator run in %s',async status=>{
    const {store,members}=setup(1),c=new Coordinator(store),commands=vi.fn(async()=>({})),id=members[0];c.command=commands;
    const s=store.session(id);s.run!.status=status;s.run!.blockingIssue={reason:'validation',message:'Sai định dạng'};store.saveSession(s);
    await expect(c.control(id,'RESUME','group',true)).rejects.toThrow('không tự tiếp tục');expect(commands).not.toHaveBeenCalled();
  });
  it('snapshots one shared final question into every selected run without changing personal profiles',async()=>{
    const {store,members}=setup(3),c=new Coordinator(store),before=members.map(id=>store.session(id).profile),payloads:any[]=[];
    for(const id of members){const s=store.session(id);s.run!.status='idle';store.saveSession(s);c.peers.set(id,{} as any);}
    c.command=async(id,kind,payload)=>{if(kind==='PING')return {capabilities:['sharedFinalQuestion']};payloads.push({id,kind,payload});return {};};
    const q={label:'Năm nay là năm bao nhiêu?',value:'2026'};await c.start(members,store.group('group').url,'test',q);q.value='changed';
    for(const id of members)expect(store.session(id).run?.finalQuestion?.value).toBe('2026');
    expect(members.map(id=>store.session(id).profile)).toEqual(before);expect(payloads).toHaveLength(3);expect(payloads.every(p=>p.payload.finalQuestion.value==='2026')).toBe(true);
  });
  it('updates the waiting selected runs, preserves their snapshots against late STATE events and refuses locked runs',async()=>{
    const {store,members}=setup(2),c=new Coordinator(store);for(const id of members){const s=store.session(id);s.run!.status='waiting_manual';store.saveSession(s);c.peers.set(id,{} as any);}
    c.command=async()=>({});const q={label:'Câu hỏi cuối',value:'Đáp án'};
    expect((await c.setFinalQuestion(members,q)).every(r=>r.ok)).toBe(true);
    const s=store.session(members[0]);await c.acceptState(s.id,{...s.run!,eventSeq:1,finalQuestion:undefined});expect(store.session(s.id).run?.finalQuestion).toEqual(q);
    const locked=store.session(members[1]);locked.run!.submitAttempted=true;store.saveSession(locked);expect(await c.setFinalQuestion(members,q)).toEqual([{id:members[0],ok:true},expect.objectContaining({id:members[1],ok:false,skipped:true})]);
  });
  it('blocks only the unsupported member while supported extensions start a shared-answer run',async()=>{
    const {store,members}=setup(2),c=new Coordinator(store),starts:any[]=[];for(const id of members){const s=store.session(id);s.run!.status='idle';store.saveSession(s);c.peers.set(id,{} as any);}
    c.command=async(id,kind)=>{if(kind==='START')starts.push(id);return {capabilities:id===members[0]?['sharedFinalQuestion']:[]};};
    const group=await c.start(members,store.group('group').url,'test',{label:'Câu cuối',value:'2026'});
    expect(group.startResults).toEqual([{id:members[0],ok:true},{id:members[1],ok:false,error:expect.stringContaining('Reload')}]);
    expect(starts).toEqual([members[0]]);expect(store.session(members[1]).run?.status).toBe('idle');
  });
  it('resumes a persisted answer without waiting for a slower profile acknowledgement',async()=>{
    const {store,members}=setup(2),c=new Coordinator(store),resumed:string[]=[],q={label:'Câu cuối',value:'A'};
    for(const id of members){const s=store.session(id);s.run!.status='waiting_manual';s.run!.blockingIssue={reason:'verification',message:'Cần đáp án',questionLabel:q.label};s.run!.mode='test';store.saveSession(s);c.peers.set(id,{} as any);}
    let release!:()=>void;const slow=new Promise<void>(resolve=>{release=resolve;});
    c.command=async(id,kind)=>{
      if(kind==='SET_FINAL_QUESTION'&&id===members[1])await slow;
      if(kind==='RESUME'){
        expect(store.session(id).run?.finalQuestion).toEqual(q);
        expect(store.history(id)[0].finalQuestion).toEqual(q);
        resumed.push(id);return {...store.session(id).run,status:'running',eventSeq:1};
      }
      return {};
    };
    const applying=c.setFinalQuestion(members,q,true);
    try{await vi.waitFor(()=>expect(resumed).toEqual([members[0]]));}
    finally{release();}
    expect(await applying).toEqual(members.map(id=>({id,ok:true})));
    for(const id of members)expect(store.session(id).run).toMatchObject({mode:'test',status:'running',submitAttempted:false,finalQuestion:q});
  });
  it('does not resume a failed update while letting other selected profiles continue',async()=>{
    const {store,members}=setup(2),c=new Coordinator(store),resumed:string[]=[];
    for(const id of members){const s=store.session(id);s.run!.status='waiting_manual';s.run!.blockingIssue={reason:'verification',message:'Cần đáp án',questionLabel:'Câu cuối'};store.saveSession(s);c.peers.set(id,{} as any);}
    c.command=async(id,kind)=>{if(kind==='SET_FINAL_QUESTION'&&id===members[1])throw new Error('offline');if(kind==='RESUME')resumed.push(id);return {};};
    expect(await c.setFinalQuestion(members,{label:'Câu cuối',value:'A'},true)).toEqual([{id:members[0],ok:true},{id:members[1],ok:false,error:'offline'}]);
    expect(resumed).toEqual([members[0]]);expect(store.session(members[1]).run?.finalQuestion).toBeUndefined();
  });
  it('skips a locked profile while applying and resuming a ready profile',async()=>{
    const {store,members}=setup(2),c=new Coordinator(store),commands=vi.fn(async()=>({}));c.command=commands;
    for(const id of members){const s=store.session(id);s.run!.status='waiting_manual';s.run!.blockingIssue={reason:'verification',message:'Cần đáp án',questionLabel:'Câu cuối'};s.run!.submitAttempted=id===members[1];store.saveSession(s);c.peers.set(id,{} as any);}
    expect(await c.setFinalQuestion(members,{label:'Câu cuối',value:'A'},true)).toEqual([{id:members[0],ok:true},expect.objectContaining({id:members[1],ok:false,skipped:true})]);expect(commands.mock.calls.map(call=>call.slice(0,2))).toEqual([[members[0],'SET_FINAL_QUESTION'],[members[0],'RESUME']]);
  });
  it('does not resume when the answer cannot be persisted',async()=>{
    const {store,members}=setup(1),c=new Coordinator(store),commands:string[]=[];
    const s=store.session(members[0]);s.run!.status='waiting_manual';s.run!.blockingIssue={reason:'verification',message:'Cần đáp án',questionLabel:'Câu cuối'};store.saveSession(s);c.peers.set(s.id,{} as any);
    c.command=async(_id,kind)=>{commands.push(kind);return {};};
    const save=vi.spyOn(store,'saveSession').mockImplementation(()=>{throw new Error('disk unavailable');});
    try{expect(await c.setFinalQuestion(members,{label:'Câu cuối',value:'A'},true)).toEqual([{id:s.id,ok:false,error:'disk unavailable'}]);expect(commands).toEqual(['SET_FINAL_QUESTION']);}
    finally{save.mockRestore();}
  });
  it('applies only to the arrived profiles, then lets a late profile receive a later answer',async()=>{
    const {store,members}=setup(8),c=new Coordinator(store),commands:{id:string;kind:string}[]=[],q={label:'Câu cuối',value:'A',formId:'form'};
    for(const [i,id] of members.entries()){
      const s=store.session(id);s.run!.status=i===1?'running':i===2?'failed':i===7?'ready_to_submit':'waiting_manual';
      s.run!.blockingIssue={reason:i===4?'file_upload':'verification',message:'Chờ',questionLabel:i===6?'Câu khác':q.label};
      if(i===5)s.run!.formId='other';store.saveSession(s);if(i!==3)c.peers.set(id,{} as any);
    }
    c.command=async(id,kind)=>{commands.push({id,kind});if(kind==='RESUME')return {...store.session(id).run,status:'running',eventSeq:1};return {};};
    const before=members.slice(1,7).map(id=>structuredClone(store.session(id).run));
    const result=await c.setFinalQuestion(members,q,true);
    expect(result.filter(r=>r.ok).map(r=>r.id)).toEqual([members[0],members[7]]);
    expect(result.filter(r=>'skipped' in r&&r.skipped)).toHaveLength(6);
    expect(commands.filter(c=>c.kind==='RESUME').map(c=>c.id)).toEqual([members[0],members[7]]);
    expect(members.slice(1,7).map(id=>store.session(id).run)).toEqual(before);
    const late=store.session(members[1]);late.run!.status='waiting_manual';store.saveSession(late);
    commands.length=0;
    const later=await c.setFinalQuestion(members,{...q,value:'B'},true);
    expect(later.filter(r=>r.ok).map(r=>r.id)).toEqual([members[1]]);
    expect(commands).toEqual([{id:members[1],kind:'SET_FINAL_QUESTION'},{id:members[1],kind:'RESUME'}]);
    expect(store.session(members[0]).run?.finalQuestion?.value).toBe('A');
    expect(store.session(members[1]).run).toMatchObject({mode:'live',submitAttempted:false,finalQuestion:{value:'B'}});
  });
  it('does not wait for another profile database read before resuming a ready member',async()=>{
    const {store,members}=setup(2),c=new Coordinator(store),resumed:string[]=[];
    for(const id of members){const s=store.session(id);s.run!.status='ready_to_submit';store.saveSession(s);c.peers.set(id,{} as any);}
    let release!:()=>void;const slow=new Promise<void>(resolve=>{release=resolve;}),read=store.session.bind(store);
    vi.spyOn(store,'session').mockImplementation(((id:string)=>id===members[1]?slow.then(()=>read(id)):read(id)) as any);
    c.command=async(id,kind)=>{if(kind==='RESUME')resumed.push(id);return {};};
    const applying=c.setFinalQuestion(members,{label:'Câu cuối',value:'A'},true);
    try{await vi.waitFor(()=>expect(resumed).toEqual([members[0]]));}finally{release();}
    expect((await applying).every(r=>r.ok)).toBe(true);
  });
  it('refuses to update or resume a replacement run after the initial checks',async()=>{
    const {store,members}=setup(1),c=new Coordinator(store),commands:string[]=[];
    const s=store.session(members[0]);s.run!.status='waiting_manual';s.run!.blockingIssue={reason:'verification',message:'Cần đáp án',questionLabel:'Câu cuối'};store.saveSession(s);c.peers.set(s.id,{} as any);
    c.command=async(id,kind,_payload,runId)=>{commands.push(kind);expect(runId).toBe('group');const changed=store.session(id);changed.run!.runId='replacement';store.saveSession(changed);return {};};
    const results=await c.setFinalQuestion(members,{label:'Câu cuối',value:'A'},true);
    expect(results[0]).toMatchObject({ok:false,error:'Lượt đã thay đổi trong lúc cập nhật.'});expect(commands).toEqual(['SET_FINAL_QUESTION']);expect(store.session(s.id).run?.finalQuestion).toBeUndefined();
  });
  it('reports an acknowledged answer separately from a failed resume',async()=>{
    const {store,members}=setup(1),c=new Coordinator(store);
    const s=store.session(members[0]);s.run!.status='waiting_manual';s.run!.blockingIssue={reason:'verification',message:'Cần đáp án',questionLabel:'Câu cuối'};store.saveSession(s);c.peers.set(s.id,{} as any);
    c.command=async(_id,kind)=>{if(kind==='RESUME')throw new Error('offline');return {};};
    expect(await c.setFinalQuestion(members,{label:'Câu cuối',value:'A'},true)).toEqual([{id:s.id,ok:false,error:'Đã cập nhật đáp án nhưng chưa tiếp tục được: offline'}]);expect(store.session(s.id).run?.finalQuestion?.value).toBe('A');
  });
  it('reports individual update failures and keeps other profiles unchanged',async()=>{
    const {store,members}=setup(3),c=new Coordinator(store);for(const id of members){const s=store.session(id);s.run!.status='paused';store.saveSession(s);c.peers.set(id,{} as any);}
    c.command=async(id)=>{if(id===members[1])throw new Error('offline');return {};};
    const results=await c.setFinalQuestion(members.slice(0,2),{label:'Câu cuối',value:'A'});expect(results).toEqual([{id:members[0],ok:true},{id:members[1],ok:false,error:'offline'}]);expect(store.session(members[2]).run?.finalQuestion).toBeUndefined();
  });
  it('grants renderer requests to different connected profiles concurrently and cancels only the paused member',async()=>{
    const {store,members}=setup(2),c=new Coordinator(store),replies:any[]=[];
    for(const id of members)c.peers.set(id,{send:(json:string)=>replies.push({id,...JSON.parse(json)})} as any);
    try{
      await Promise.all(members.map((id,i)=>c.receive(id,{type:'REQUEST',requestId:`request-${i}`,kind:'ATTENTION_ACQUIRE',runId:'group',rendering:'background'})));
      const a=replies.find(r=>r.id===members[0]),b=replies.find(r=>r.id===members[1]);expect(a).toMatchObject({ok:true,mode:'background'});expect(b).toMatchObject({ok:true,mode:'background'});
      const run=store.session(members[0]).run!;await c.acceptState(members[0],{...run,status:'paused',eventSeq:1});
      expect(c.attention.renew(members[0],a.token)).toBe(false);expect(c.attention.renew(members[1],b.token)).toBe(true);
      await c.receive(members[0],{type:'REQUEST',requestId:'stopped',kind:'ATTENTION_ACQUIRE',runId:'group',rendering:'background'});expect(replies.at(-1)).toMatchObject({ok:false});
    }finally{c.attention.close();}
  });
  it('consumes expiring pair codes once and binds credentials to the right profile',()=>{const {store}=setup();const code=store.pairCode();const token=store.pair('third',code);expect(()=>store.pair('fourth',code)).toThrow();expect(store.authenticate('session-0',token)).toBe(false);const expired=store.pairCode();store.db.prepare('UPDATE pairing SET expires=0 WHERE code=?').run(digest(expired));expect(()=>store.pair('expired',expired)).toThrow();});
  it('stores images under the owning session even if their attachment IDs match',()=>{const {store}=setup();store.saveAttachment('session-0','same',Buffer.from('A'),digest('A'));store.saveAttachment('session-1','same',Buffer.from('B'),digest('B'));expect(store.attachment('session-0','same').data.toString()).toBe('A');expect(store.attachment('session-1','same').data.toString()).toBe('B');expect(()=>store.saveAttachment('session-0','bad',Buffer.from('A'),digest('B'))).toThrow();});
  it('commits a send lock once, persists it through restart, and keeps it per nick/form',()=>{const {store,path}=setup();store.acquireSubmit('session-0','group','form');expect(()=>store.acquireSubmit('session-0','group','form')).toThrow();expect(store.blocked('session-1','form')).toBe(false);store.close();stores.splice(stores.indexOf(store),1);const restored=new Store(path);stores.push(restored);expect(restored.blocked('session-0','form')).toBe(true);expect(restored.session('session-0').run?.status).toBe('submit_uncertain');expect(restored.session('session-0').connected).toBe(false);});
  it('can promote one local reservation to a send grant but rejects a second grant',()=>{const {store}=setup();const s=store.session('session-0');s.run!.status='submitting';s.run!.submitAttempted=true;store.saveSession(s);store.db.prepare('INSERT INTO locks VALUES(?,?,?,?,?)').run('session-0','form','group','local_reserved','');store.acquireSubmit('session-0','group','form');expect(()=>store.acquireSubmit('session-0','group','form')).toThrow();});
  it('manual not-received resolution keeps the old run locked but permits a new run',()=>{const {store}=setup();store.acquireSubmit('session-0','group','form');store.resolve('session-0','group','not_received');expect(store.blocked('session-0','form')).toBe(false);expect(store.session('session-0').run?.submitAttempted).toBe(true);expect(store.history('session-0')[0].submitAttempted).toBe(true);const s=store.session('session-0');s.run!.status='running';store.saveSession(s);expect(()=>store.acquireSubmit('session-0','group','form')).toThrow();});
  it('does not unlock a confirmed received response',()=>{const {store}=setup();store.acquireSubmit('session-0','group','form');store.resolve('session-0','group','received');expect(store.blocked('session-0','form')).toBe(true);expect(store.session('session-0').run?.status).toBe('completed');});
  it('rejects old-run, old-sequence and other-session events',async()=>{const {store}=setup();const c=new Coordinator(store);const r=store.session('session-0').run!;await c.acceptState('session-0',{...r,runId:'old',eventSeq:10,status:'completed'});await c.acceptState('session-0',{...r,sessionId:'session-1',eventSeq:10,status:'completed'});expect(store.session('session-0').run?.status).toBe('running');await c.acceptState('session-0',{...r,eventSeq:2,status:'paused'});await c.acceptState('session-0',{...r,eventSeq:1,status:'running'});expect(store.session('session-0').run?.status).toBe('paused');});
  it('records simultaneous load failures without pausing healthy group members',async()=>{const {store}=setup(24);const c=new Coordinator(store);for(let i=0;i<20;i++)await c.failure('session-0','group');for(let i=1;i<5;i++)await c.failure(`session-${i}`,'group');expect(store.group('group').paused).toBe(false);await c.failure('session-5','group');expect(store.group('group').paused).toBe(false);expect(c.failures.get('group')?.size).toBe(6);});
  it('expires old failure events and does not treat two profiles as three',async()=>{const {store}=setup(2);const c=new Coordinator(store);await c.failure('session-0','group');await c.failure('session-1','group');expect(store.group('group').paused).toBe(false);c.failures.get('group')!.set('session-0',Date.now()-31000);await c.failure('session-1','group');expect(c.failures.get('group')!.size).toBe(1);});
  it('resumes a stopped group without touching members that moved to a newer run',async()=>{const {store}=setup();const c=new Coordinator(store);const s=store.session('session-0');s.run!.runId='new';store.saveSession(s);const commands:any[]=[];c.command=async(...args)=>{commands.push(args);return {};};await c.groupControl('group','STOP');expect(commands.map(args=>args[0])).toEqual(['session-1']);commands.length=0;await c.groupControl('group','RESUME');expect(commands.map(args=>[args[0],args[1]])).toEqual([['session-1','RESUME']]);expect(store.group('group')).toMatchObject({paused:false,stopped:false});await expect(c.control('session-0','PAUSE','group')).rejects.toThrow('lượt cũ');});
  it('persists an acknowledged Stop, clears its old error and permits a fresh run',async()=>{
    const {store}=setup(1);const c=new Coordinator(store),s=store.session('session-0');s.error='Old resume error';store.saveSession(s);
    c.peers.set(s.id,{} as any);const commands:any[]=[];
    c.command=async(id,kind)=>{commands.push(kind);if(kind==='STOP_PROFILE')return {...store.session(id).run,status:'idle',blockingIssue:undefined,eventSeq:1};return {};};
    await c.groupControl('group','STOP');expect(store.session(s.id).error).toBeUndefined();expect(store.session(s.id).run?.status).toBe('idle');
    const next=await c.start([s.id],store.group('group').url,'test');expect(next.id).not.toBe('group');expect(commands).toEqual(['STOP_PROFILE','START']);expect(store.history(s.id).some(r=>r.runId==='group')).toBe(true);
  });
  it('resumes one stopped member while leaving the other member halted',async()=>{
    const {store}=setup();const c=new Coordinator(store);for(const id of ['session-0','session-1']){const s=store.session(id);s.run!.status='idle';store.saveSession(s);}
    const group=store.group('group');group.paused=true;group.stopped=true;store.saveGroup(group);
    const commands:any[]=[];c.command=async(id,kind)=>{commands.push([id,kind]);return {...store.session(id).run,status:'running',eventSeq:1};};
    await c.control('session-0','RESUME');expect(commands).toEqual([['session-0','RESUME']]);expect(store.session('session-0').run?.status).toBe('running');expect(store.session('session-1').run?.status).toBe('idle');
  });
  it('keeps a submitted member locked when resuming the stopped group',async()=>{
    const {store}=setup();store.acquireSubmit('session-0','group','form');const c=new Coordinator(store),commands:any[]=[];c.command=async(...args)=>{commands.push(args);return {};};
    await c.groupControl('group','STOP');commands.length=0;await c.groupControl('group','RESUME');expect(commands.map(args=>args[0])).toEqual(['session-1']);expect(store.blocked('session-0','form')).toBe(true);
    await expect(c.control('session-0','RESUME')).rejects.toThrow('khóa gửi');c.peers.set('session-0',{} as any);await expect(c.start(['session-0'],store.group('group').url,'live')).rejects.toThrow('khóa gửi');
  });
  it('shows a standalone owner and stops it even when the app has recorded a different failed run',async()=>{
    const {store}=setup(1);const c=new Coordinator(store),s=store.session('session-0');s.run!.status='failed';store.saveSession(s);c.peers.set(s.id,{} as any);
    await c.receive(s.id,{type:'EXECUTION',execution:{runId:'standalone',tabId:99,status:'running',managed:false,mode:'test',tabOpen:true,updatedAt:''}});
    await expect(c.start([s.id],store.group('group').url,'test')).rejects.toThrow('Xem form');
    const commands:any[]=[];c.command=async(id,kind)=>{commands.push([id,kind]);return {run:{runId:'different-extension-run',status:'idle'},execution:null};};
    await c.control(s.id,'STOP');expect(commands).toEqual([[s.id,'STOP_PROFILE']]);expect(store.session(s.id).execution).toBeNull();expect(store.session(s.id).run?.status).toBe('idle');
    await c.start([s.id],store.group('group').url,'test');expect(commands.at(-1)?.[1]).toBe('START');
  });
});
