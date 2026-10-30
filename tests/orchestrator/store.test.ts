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
  it.each([true,false])('keeps a CAPTCHA member locked while another profile completes (autoContinue=%s)',autoContinue=>{
    const {store,members}=setup(2),[blocked,successful]=members;
    const first=store.session(blocked);
    Object.assign(first.run!,{autoContinue:true,retryOnReturn:true,contentEpoch:'new',submissionEpoch:'old',profileSnapshot:structuredClone(first.profile)});store.saveSession(first);
    store.acquireSubmit(blocked,'group','form');
    const submitted=store.session(blocked).run!;
    expect(store.acceptProgress(blocked,{...submitted,eventSeq:1,status:'submit_uncertain',autoContinue,blockingIssue:{reason:'captcha',message:'Traffic check; frame failed'}})).toBe(true);
    expect(()=>store.authorizeReturnedRetry(blocked,'group','new',0)).toThrow('không được phép');
    expect(store.session(blocked).run).toMatchObject({status:'submit_uncertain',submitAttempted:true,profileSnapshot:{values:{fullName:blocked}}});
    expect(store.blocked(blocked,'form')).toBe(true);
    store.acquireSubmit(successful,'group','form');const second=store.session(successful).run!;
    expect(store.acceptProgress(successful,{...second,eventSeq:1,status:'completed'})).toBe(true);
    expect(store.session(successful).run?.status).toBe('completed');expect(store.group('group').paused).toBe(false);
    expect(store.session(blocked).run?.status).toBe('submit_uncertain');expect(store.blocked(successful,'form')).toBe(false);
  });
  it('stops every active profile across separate HSK groups and reports a failed member without hiding it',async()=>{
    const {store,members}=setup(3),c=new Coordinator(store),calls:string[]=[];
    for(const id of members){const s=store.session(id);s.run!.runId=id;store.saveGroup({...store.group('group'),id,members:[id]});store.saveSession(s);}
    c.command=async(id,kind)=>{expect(kind).toBe('STOP_PROFILE');calls.push(id);if(id===members[1])throw new Error('Mất kết nối');return {execution:null};};
    const result=await c.stopAll();expect(calls.sort()).toEqual([...members].sort());
    expect(result).toContainEqual({id:members[1],ok:false,error:'Mất kết nối'});
    expect(store.session(members[0]).run?.status).toBe('idle');expect(store.session(members[2]).run?.status).toBe('idle');
    expect(store.session(members[1]).run?.status).toBe('running');
    const stopped=store.session(members[0]).run!;
    expect(store.acceptProgress(members[0],{...stopped,eventSeq:999,status:'running'})).toBe(false);
  });
  it('does not let a slow Stop hold back the other profile Stop commands',async()=>{
    const {store,members}=setup(3),c=new Coordinator(store),calls:string[]=[];let release!:()=>void;
    c.command=async(id)=>{calls.push(id);if(id===members[0])await new Promise<void>(resolve=>release=resolve);return {execution:null};};
    const stopping=c.stopAll();try{await vi.waitFor(()=>expect(calls).toHaveLength(3));expect(store.session(members[2]).run?.status).toBe('idle');}finally{release();}
    expect((await stopping).every(r=>r.ok)).toBe(true);
  });
  it('cancels a Start still writing its run before it can open a form',async()=>{
    const {store,members}=setup(1),id=members[0],c=new Coordinator(store),commands=vi.fn(async()=>({}));c.command=commands;c.peers.set(id,{} as any);
    const s=store.session(id);s.run!.status='idle';store.saveSession(s);
    const begin=store.beginGroup.bind(store);let release!:()=>void;
    vi.spyOn(store,'beginGroup').mockImplementation((async(g:any,sessions:any[],append?:boolean)=>{if(sessions.length)await new Promise<void>(r=>release=r);return begin(g,sessions,append);}) as any);
    const starting=c.start([id],store.group('group').url,'test');await vi.waitFor(()=>expect(release).toBeTypeOf('function'));
    expect(await c.stopAll()).toEqual([]);release();await expect(starting).rejects.toThrow('Đã dừng trước khi mở form');
    expect(commands).not.toHaveBeenCalled();expect(store.session(id).run?.status).toBe('idle');
  });
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
  it('retains a confirmed result but permits an explicit new run',()=>{const {store}=setup();store.acquireSubmit('session-0','group','form');store.resolve('session-0','group','received');expect(store.blocked('session-0','form')).toBe(false);expect(store.session('session-0').run?.status).toBe('completed');expect(store.history('session-0')[0].submitAttempted).toBe(true);expect(()=>store.acquireSubmit('session-0','group','form')).toThrow();});
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

it('re-arms only an authorized returned-form attempt and rejects old progress and duplicate grants',async()=>{
 const {store,members}=setup(1),id=members[0],s=store.session(id);
 Object.assign(s.run!,{autoContinue:true,retryOnReturn:true,submissionEpoch:'old',contentEpoch:'new'});store.saveSession(s);store.acquireSubmit(id,'group','form');
 store.authorizeReturnedRetry(id,'group','new',0);
 expect(store.session(id).run).toMatchObject({submitAttempted:false,submissionRetries:1,status:'waiting_manual'});
 store.authorizeReturnedRetry(id,'group','new',0);expect(store.session(id).run?.submissionRetries).toBe(1);
 const current=store.session(id),before=current.run!;
 expect(store.acceptProgress(id,{...before,submissionRetries:0,eventSeq:100,status:'completed',submitAttempted:true})).toBe(false);
 current.run!.status='running';store.saveSession(current);store.acquireSubmit(id,'group','form');expect(()=>store.acquireSubmit(id,'group','form')).toThrow();
 expect(store.session(id).run?.submitAttempted).toBe(true);
});

describe('verification answers isolated by scheduled HSK',()=>{
  async function scheduled(){
    const {store,members}=setup(2),c=new Coordinator(store),calls:any[]=[];
    for(const [i,id]of members.entries()){const s=store.session(id);s.hskLevel=i?'5':'4';s.run!.status='running';store.saveSession(s);c.peers.set(id,{} as any);}
    const plan=await c.scheduler.arm({ids:members,mode:'test',manualOnly:true,postUrl:'',startsAt:new Date(Date.now()+60000).toISOString()});
    for(const m of c.scheduler.value!.members){m.runId='group';m.status='started';}c.scheduler.value!.status='finished';
    c.command=async(id,kind,payload)=>{calls.push({id,kind,payload});if(kind==='RESUME')return {...store.session(id).run,status:'running',blockingIssue:undefined,eventSeq:(store.session(id).run?.eventSeq??0)+1};return {};};
    return {store,members,c,calls,plan};
  }
  it('sends Stop to all scheduled members before waiting for pending launches to settle',async()=>{
    const f=await scheduled();const settle=vi.spyOn(f.c.scheduler,'settleLaunches').mockImplementation(()=>new Promise<void>(()=>{}));
    const result=await f.c.stopScheduledRuns(f.plan.id);
    expect(f.calls.filter(c=>c.kind==='STOP_PROFILE').map(c=>c.id)).toEqual(f.members);expect(f.c.scheduler.value?.status).toBe('cancelled');
    expect(result.every(r=>r.ok)).toBe(true);expect(settle).not.toHaveBeenCalled();
  });
  it('keeps confirmed submissions and their locks intact when stopping the remaining schedule',async()=>{
    const f=await scheduled(),id=f.members[0];f.store.acquireSubmit(id,'group','form');f.store.resolve(id,'group','received');
    const result=await f.c.stopScheduledRuns(f.plan.id);
    expect(result).toContainEqual({id,ok:true,skipped:true});expect(f.calls.filter(c=>c.kind==='STOP_PROFILE').map(c=>c.id)).toEqual([f.members[1]]);
    expect(f.store.session(id).run?.status).toBe('completed');expect(f.store.blocked(id,'form')).toBe(false);
  });
  it('stores each answer separately, resumes only matching verification, and applies to a later arrival',async()=>{
    const f=await scheduled(),q4={label:'Tên trường?',value:'HANU',formId:'form'},q5={label:'Năm thi?',value:'2026',formId:'form'};
    await f.c.scheduledAnswer('4',q4);await f.c.scheduledAnswer('5',q5);expect(f.calls).toEqual([]);
    for(const [i,id]of f.members.entries()){
      const run=f.store.session(id).run!;await f.c.acceptState(id,{...run,status:'waiting_manual',eventSeq:1,blockingIssue:{reason:'verification',message:'Cần đáp án',questionLabel:i?q5.label:q4.label}});
      await vi.waitFor(()=>expect(f.calls.some(c=>c.id===id&&c.kind==='RESUME')).toBe(true));
    }
    expect(f.calls.filter(c=>c.kind==='SET_FINAL_QUESTION').map(c=>c.payload.finalQuestion)).toEqual([q4,q5]);
  });
  it('bounds a manual verification read and reports a timeout instead of waiting behind form controls',async()=>{
    const f=await scheduled();const command=vi.fn(async()=>({formId:'form',runId:'group',questions:[]}));f.c.command=command;
    await f.c.scanVerification(f.members[0]);expect(command).toHaveBeenCalledWith(f.members[0],'SCAN_FORM',{verificationOnly:true},'group',2000);
    command.mockRejectedValue(new Error('Profile chưa xác nhận SCAN_FORM.'));
    await expect(f.c.scanVerification(f.members[0])).rejects.toThrow('trong 2 giây');
  });
  it('applies the saved answer on arrival at the live HSK fee question, scoped to its entry',async()=>{
    const f=await scheduled();await f.c.scheduledAnswer('4',{value:'1234567'});
    const id=f.members[0],run=f.store.session(id).run!,label='Lệ phí thi HSK4+HSK Khẩu ngữ Trung cấp năm 2026 là bao nhiêu? *';
    await f.c.acceptState(id,{...run,status:'waiting_manual',eventSeq:1,blockingIssue:{reason:'verification',questionLabel:label,message:'Cần đáp án',question:{id:'fee',targetId:'entry.40',label,kind:'text',required:true,filled:false,options:[],verification:true}}});
    await vi.waitFor(()=>expect(f.calls.some(c=>c.kind==='RESUME')).toBe(true));
    expect(f.calls.filter(c=>c.kind==='SET_FINAL_QUESTION')).toEqual([{id,kind:'SET_FINAL_QUESTION',payload:{finalQuestion:{value:'1234567',label,formId:'form',questionId:'entry.40',kind:'text'}}}]);
    expect(f.calls.every(c=>c.id===id)).toBe(true);
  });
  it('reads an older unknown blocker without auto-answering, then resumes only after an exact explicit choice',async()=>{
    const f=await scheduled(),id=f.members[0],label='Câu mới chưa biết *';await f.c.scheduledAnswer('4',{value:'HANU'});
    const run=f.store.session(id).run!;
    await f.c.acceptState(id,{...run,status:'waiting_manual',eventSeq:1,blockingIssue:{reason:'unknown_required',questionId:'new',questionLabel:label,message:'Cần xử lý'}});
    await new Promise(r=>setImmediate(r));expect(f.calls).toEqual([]);
    const question={id:'new',targetId:'entry.40',label,kind:'text' as const,required:true,filled:false,options:[],verification:false};
    const command=f.c.command;f.c.command=async(id,kind,payload,...rest)=>kind==='SCAN_FORM'?{formId:'form',runId:'group',questions:[question]}:command(id,kind,payload,...rest);
    await f.c.scanVerification(id);
    expect(f.store.session(id).run?.blockingIssue).toMatchObject({reason:'unknown_required',question});expect(f.calls).toEqual([]);
    await f.c.scheduledAnswer('4',{label,value:'HANU',formId:'form',questionId:'entry.other',kind:'text'});
    await new Promise(r=>setImmediate(r));expect(f.calls).toEqual([]);
    await f.c.scheduledAnswer('4',{label,value:'HANU',formId:'form',questionId:'entry.40',kind:'text'});
    await vi.waitFor(()=>expect(f.calls.some(c=>c.kind==='RESUME')).toBe(true));
    expect(f.calls.map(c=>[c.id,c.kind])).toEqual([[id,'SET_FINAL_QUESTION'],[id,'RESUME']]);
  });
  it.each(['cancelled','expired','paused'] as const)('does not resume a selected unknown question while its schedule is %s',async state=>{
    const f=await scheduled(),id=f.members[0],label='Câu mới *';
    const q={label,value:'HANU',formId:'form',questionId:'entry.40',kind:'text' as const};
    if(state==='paused')f.c.scheduler.value!.pausedAt=new Date().toISOString();else f.c.scheduler.value!.status=state;
    const run=f.store.session(id).run!;
    await f.c.acceptState(id,{...run,status:'waiting_manual',eventSeq:1,blockingIssue:{reason:'unknown_required',questionId:'new',questionLabel:label,message:'Chờ',question:{id:'new',targetId:'entry.40',label,kind:'text',required:true,filled:false,options:[],verification:false}}});
    await f.c.scheduledAnswer('4',q);await new Promise(r=>setImmediate(r));expect(f.calls).toEqual([]);
  });
  it('accepts value-only answers and binds different questions to each HSK only on arrival',async()=>{
    const f=await scheduled();await f.c.scheduledAnswer('4',{value:'HANU'});await f.c.scheduledAnswer('5',{value:'2026'});
    expect(f.calls).toEqual([]);
    for(const [i,id]of f.members.entries()){
      const session=f.store.session(id);session.run!.formId=i?'five':'four';f.store.saveSession(session);const r=session.run!;await f.c.acceptState(id,{...r,status:'waiting_manual',eventSeq:1,blockingIssue:{reason:'verification',questionLabel:i?'Năm thi HSK 5?':'Trường thi HSK 4?',message:'Cần đáp án'}});
      await vi.waitFor(()=>expect(f.calls.some(c=>c.id===id&&c.kind==='RESUME')).toBe(true));
    }
    expect(f.calls.filter(c=>c.kind==='SET_FINAL_QUESTION').map(c=>c.payload.finalQuestion)).toEqual([{value:'HANU',label:'Trường thi HSK 4?',formId:'four'},{value:'2026',label:'Năm thi HSK 5?',formId:'five'}]);
  });
  it('keeps per-HSK answers on the same rehearsal form, taking precedence over legacy shared answers',async()=>{
    const f=await scheduled();f.c.scheduler.value!.rehearsal=true;f.c.scheduler.value!.rehearsalAnswer={value:'legacy'};
    await f.c.scheduledAnswer('4',{value:'1620000'});await f.c.scheduledAnswer('5',{value:'2026'});
    for(const id of ['session-0','session-1']){const run=f.store.session(id).run!;await f.c.acceptState(id,{...run,status:'waiting_manual',eventSeq:(run.eventSeq??0)+1,blockingIssue:{reason:'verification',questionLabel:'Câu xác thực?',message:'Cần đáp án'}});}
    await vi.waitFor(()=>expect(f.calls.filter(c=>c.kind==='SET_FINAL_QUESTION')).toHaveLength(2));
    expect(f.calls.filter(c=>c.kind==='SET_FINAL_QUESTION').map(c=>[c.id,c.payload.finalQuestion.value])).toEqual([['session-0','1620000'],['session-1','2026']]);
  });
  it('pauses/resumes the captured schedule groups and rejects stale schedule controls',async()=>{
    const f=await scheduled();await f.c.scheduledControl(f.plan.id,'PAUSE');expect(f.c.scheduler.value?.pausedAt).toBeTruthy();
    expect(f.calls.filter(c=>c.kind==='PAUSE').map(c=>c.id)).toEqual(f.members);
    await f.c.scheduledControl(f.plan.id,'RESUME');expect(f.c.scheduler.value?.pausedAt).toBeUndefined();
    expect(f.calls.filter(c=>c.kind==='RESUME').map(c=>c.id)).toEqual(f.members);
    await expect(f.c.stopScheduledRuns('old-schedule')).rejects.toThrow('Lịch đã thay đổi');expect(f.c.scheduler.value?.status).toBe('finished');
    await expect(f.c.scheduledControl('old-schedule','PAUSE')).rejects.toThrow('Lịch đã thay đổi');
  });
  it('uses one answer for all rehearsal levels on the shared Test form',async()=>{
    const f=await scheduled();f.c.scheduler.value!.rehearsal=true;await f.c.scheduledAnswer('test',{value:'Chung'});
    for(const id of f.members){const r=f.store.session(id).run!;await f.c.acceptState(id,{...r,status:'waiting_manual',eventSeq:1,blockingIssue:{reason:'verification',questionLabel:'Câu form thử?',message:'Cần đáp án'}});}
    await vi.waitFor(()=>expect(f.calls.filter(c=>c.kind==='SET_FINAL_QUESTION')).toHaveLength(2));
    expect(f.calls.filter(c=>c.kind==='SET_FINAL_QUESTION').every(c=>c.payload.finalQuestion.value==='Chung')).toBe(true);
  });
  it.each(['file_upload','captcha'] as const)('does not auto-resume %s or a newer run',async reason=>{
    const f=await scheduled(),q={label:'Câu xác thực?',value:'A',formId:'form'};await f.c.scheduledAnswer('4',q);
    const run=f.store.session(f.members[0]).run!;
    await f.c.acceptState(f.members[0],{...run,status:'waiting_manual',eventSeq:1,blockingIssue:{reason,message:'Cần xử lý',questionLabel:q.label}});
    await new Promise(r=>setImmediate(r));expect(f.calls).toEqual([]);
    // A stale schedule must never send its answer into another run.
    const s=f.store.session(f.members[0]);s.run!.runId='newer';f.store.saveGroup({...f.store.group('group'),id:'newer',members:[s.id]});f.store.saveSession(s);
    await f.c.acceptState(s.id,{...s.run!,status:'waiting_manual',eventSeq:2,blockingIssue:{reason:'verification',message:'Cần đáp án',questionLabel:q.label}});
    await new Promise(r=>setImmediate(r));expect(f.calls).toEqual([]);
  });
});
