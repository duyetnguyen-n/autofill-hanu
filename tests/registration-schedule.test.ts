import {describe,it,expect,vi} from 'vitest';
import {JSDOM} from 'jsdom';
import {facebookMessage,prepareFacebookPost} from '../src/facebook-document';
import {facebookPostKey,formLink,parseHskLinks,parseTestForm,registrationDateError,type RegistrationSchedule} from '../src/registration-schedule';
import {RegistrationScheduler} from '../manager/server/registration-scheduler';
import {emptyProfile} from '../src/rules';
import type {SessionView,GroupView} from '../src/protocol';

const post='https://www.facebook.com/story.php?story_fbid=1134747255900532&id=100080958031371';
const four='https://forms.gle/LevelFour',five='https://forms.gle/LevelFive';
const start=Date.parse('2026-10-21T08:00:00+07:00');
const flush=()=>new Promise<void>(r=>setImmediate(r));
describe('post / level / form identity',()=>{
  it('finds only explicitly labelled Test forms, rejecting conflicting sample links',()=>{
    expect(parseTestForm('MẪU FORM ĐĂNG KÝ THÍ SINH CÓ THỂ ĐIỀN THỬ:\nhttps://forms.gle/Sample\nHSK 4: '+four)).toEqual({url:'https://forms.gle/Sample'});
    expect(parseTestForm('HSK 4: '+four)).toBeUndefined();
    expect(parseTestForm('Form thử: https://forms.gle/A\nForm thử: https://forms.gle/B')?.error).toMatch(/nhiều form thử/);
  });
  it('scopes the story correctly when a separate login invitation is the first dialog',()=>{
    const d=new JSDOM('<div role="dialog"><form id="login_popup_cta_form"></form><button aria-label="Close"></button></div><div role="dialog"><div data-ad-rendering-role="story_message"><div data-ad-preview="message">HSK 4: '+four+'</div></div></div>');
    const close=vi.fn();d.window.document.querySelector('button')!.addEventListener('click',close);
    expect(facebookMessage(d.window.document)).toContain(four);prepareFacebookPost(d.window.document);prepareFacebookPost(d.window.document);expect(close).toHaveBeenCalledOnce();d.window.close();
    const loginOnly=new JSDOM('<div role="dialog"><form id="login_popup_cta_form"></form><button aria-label="Close"></button></div>');
    const noClose=vi.fn();loginOnly.window.document.querySelector('button')!.addEventListener('click',noClose);prepareFacebookPost(loginOnly.window.document);expect(noClose).not.toHaveBeenCalled();loginOnly.window.close();
  });
  it('binds bilingual labels, excludes test, deduplicates repeated links',()=>{
    const text=`MẪU FORM ĐĂNG KÝ THÍ SINH CÓ THỂ ĐIỀN THỬ:\nhttps://forms.gle/Test\nCác thí sinh có thể bắt đầu đăng ký từ 08:00 ngày 21.10.2026:\nHSK 4 + HSK Khẩu ngữ Trung cấp:\n${four}\nHSK 5 + HSK Khẩu ngữ Cao cấp: ${five}\nHSK4级 + HSK口语中级：\n${four}\nHSK5级 + HSK口语高级：${five}`;
    expect(parseHskLinks(text,new Date(start).toISOString())).toEqual({'4':{url:four},'5':{url:five}});
    expect(registrationDateError(text,new Date(start+86400000).toISOString())).toMatch(/khác lịch/);
    expect(parseHskLinks(text,new Date(start+86400000).toISOString())).toEqual({});
  });
  it('rejects conflict and multi-level ambiguity rather than selecting the first URL',()=>{
    expect(parseHskLinks(`HSK 4: ${four}\nHSK4级: ${five}`)['4']?.error).toMatch(/2 link/);
    expect(parseHskLinks(`HSK 4 và HSK 5: ${four}`)).toEqual({});
    expect(parseHskLinks(`HSKK Trung cấp: ${four}`)).toEqual({});
    expect(parseHskLinks(`HSK 4\nTham khảo\nNội dung khác\nKhông phải mục đăng ký\n${four}`)).toEqual({});
  });
  it('normalizes styled digits and Facebook wrappers, keeps semantic prefill',()=>{
    const wrapped=`https://l.facebook.com/l.php?u=${encodeURIComponent(four+'?utm_source=fb')}&h=tracking`;
    expect(parseHskLinks(`HSK 𝟒: ${wrapped}`)).toEqual({'4':{url:four}});
    expect(formLink('https://docs.google.com/forms/d/e/form-id/viewform?entry.123=4&fbclid=x')).toBe('https://docs.google.com/forms/d/e/form-id/viewform?entry.123=4');
    for(const bad of ['https://forms.gle.evil.test/x','https://user:password@forms.gle/x','https://docs.google.com/forms/d/e/id/edit','http://forms.gle/x'])expect(formLink(bad)).toBeUndefined();
    expect(facebookPostKey(post)).toBe('100080958031371:1134747255900532');
    expect(facebookPostKey('https://facebook.com.evil.test/story.php?story_fbid=1&id=2')).toBeUndefined();
  });
  it('scopes old/new registration windows to the configured time',()=>{
    const text=`Đăng ký từ 08:00 ngày 20.10.2026\nHSK 4: https://forms.gle/Old\nĐăng ký từ 08:00 ngày 21.10.2026\nHSK 4: ${four}`;
    expect(parseHskLinks(text,new Date(start).toISOString())).toEqual({'4':{url:four}});
  });
  it('reads only the post message, excluding comment links',()=>{
    const dom=new JSDOM(`<div role="dialog"><div data-ad-preview="message"><div>HSK 4:</div><a href="${four}">Link</a><div>HSK 5:</div><a href="${five}">Link</a></div><div role="article">HSK 4 <a href="https://forms.gle/WrongComment">comment</a></div></div>`);
    expect(parseHskLinks(facebookMessage(dom.window.document)!)).toEqual({'4':{url:four},'5':{url:five}});
    dom.window.document.body.insertAdjacentHTML('beforeend','<div data-ad-preview="message">HSK 4 https://forms.gle/UnrelatedFeed</div>');
    expect(facebookMessage(dom.window.document)).not.toContain('UnrelatedFeed');
    dom.window.document.querySelector('[role="dialog"]')!.insertAdjacentHTML('beforeend','<div data-ad-preview="message">unrelated second story</div>');
    expect(facebookMessage(dom.window.document)).toBeUndefined();dom.window.close();
  });
});
function fixture(seed?:RegistrationSchedule){
  let clock=start-360000,saved=seed?structuredClone(seed):undefined;
  const sessions:SessionView[]=Array.from({length:10},(_,i)=>({id:`profile-${i}`,name:`P${i}`,hskLevel:i%2?'5':'4',expectedEmail:`p${i}@example.test`,connected:true,lastSeen:'',revision:1,synced:true,profile:emptyProfile()}));
  const online=new Set(sessions.map(s=>s.id));
  const hooks={load:vi.fn(async()=>saved),save:vi.fn(async(s:RegistrationSchedule)=>{saved=structuredClone(s);}),sessions:vi.fn(async()=>structuredClone(sessions)),connected:(id:string)=>online.has(id),command:vi.fn(async()=>({ready:true})),prepare:vi.fn(async()=>{}),start:vi.fn(async(id:string,url:string,s:RegistrationSchedule,valid:()=>boolean):Promise<GroupView>=>{if(!valid())throw Error('cancelled');return {id:`run-${id}`,url,mode:s.mode,members:[id],paused:false,createdAt:new Date(clock).toISOString()};}),changed:vi.fn(),error:vi.fn()};
  const engine=new RegistrationScheduler(hooks,()=>clock);
  const arm=(extra={})=>engine.arm({postUrl:post,startsAt:new Date(start).toISOString(),ids:sessions.map(s=>s.id),mode:'test',...extra});
  const observe=(text:string)=>engine.observe(engine.value!.watcher!.id,{scheduleId:engine.value!.id,token:engine.value!.watcher!.token,postKey:facebookPostKey(post),text});
  const tick=async()=>{await engine.tick();await flush();await engine.tick();await flush();};
  return {engine,hooks,sessions,online,arm,observe,tick,setTime:(at:number)=>{clock=at;},saved:()=>saved};
}
describe('durable scheduled dispatch',()=>{
  it('rehearses all 10 profiles on the labelled Test form, retaining accurate per-HSK links',async()=>{
    const f=fixture();await f.arm({rehearsal:true,watcherProfileId:'profile-4'});f.setTime(start-30000);await f.tick();
    expect(f.engine.value?.watcher?.id).toBe('profile-4');
    f.setTime(start);await f.observe('MẪU FORM ĐIỀN THỬ:\nhttps://forms.gle/Sample\nĐăng ký từ 08:00 ngày 20.10.2026\nHSK 4: '+four+'\nHSK 5: '+five);await f.tick();
    expect(f.hooks.start).toHaveBeenCalledTimes(10);expect(f.hooks.start.mock.calls.every(c=>c[1]==='https://forms.gle/Sample'&&c[2].mode==='test')).toBe(true);
    expect(f.engine.value?.links['4']?.url).toBe(four);expect(f.engine.value?.links['5']?.url).toBe(five);expect(f.engine.value?.dateWarning).toMatch(/khác lịch/);
  });
  it.each(['missing','conflicting','removed'] as const)('never falls back to a real registration form when the Test link is %s',async problem=>{
    const f=fixture();await f.arm({rehearsal:true,links:{'4':four}});f.setTime(start-30000);await f.tick();
    if(problem==='removed')await f.observe('Form thử: https://forms.gle/Sample\nHSK 4: '+four);
    f.setTime(start);await f.observe((problem==='conflicting'?'Form thử: https://forms.gle/A\nForm thử: https://forms.gle/B\n':'')+'HSK 4: '+four);await f.tick();
    expect(f.hooks.start).not.toHaveBeenCalled();expect(f.engine.value?.lastError).toMatch(/form thử/);
  });
  it('shows discovered links with a blocking date error during a normal run',async()=>{
    const f=fixture();await f.arm();f.setTime(start-30000);await f.tick();f.setTime(start);
    await f.observe('Đăng ký từ 08:00 ngày 20.10.2026\nHSK 4: '+four);await f.tick();
    expect(f.engine.value?.links['4']).toMatchObject({url:four,error:expect.stringContaining('khác lịch')});expect(f.hooks.start).not.toHaveBeenCalled();
  });
  it('rejects Live rehearsals and watcher profiles from another account',async()=>{
    const f=fixture();await expect(f.arm({mode:'live',rehearsal:true})).rejects.toThrow('chỉ dùng chế độ Test');
    await expect(f.arm({watcherProfileId:'another-owner'})).rejects.toThrow('không thuộc tài khoản');
  });
  it('prepares 5 minutes early, watches before the hour, never starts early',async()=>{
    const f=fixture();await f.arm();await f.tick();expect(f.hooks.prepare).not.toHaveBeenCalled();
    f.setTime(start-300000);await f.tick();expect(f.hooks.prepare).toHaveBeenCalledTimes(10);expect(f.hooks.command).toHaveBeenCalled();
    f.setTime(start-30000);await f.tick();expect(f.engine.value?.status).toBe('watching');
    await f.observe(`HSK 4: ${four}\nHSK 5: ${five}`);await f.tick();expect(f.hooks.start).not.toHaveBeenCalled();
    f.setTime(start);await f.observe(`HSK 4: ${four}\nHSK 5: ${five}`);await f.tick();
    expect(f.hooks.start).toHaveBeenCalledTimes(10);for(const [id,url]of f.hooks.start.mock.calls)expect(url).toBe(Number(id.split('-')[1])%2?five:four);
    expect(f.engine.value?.status).toBe('finished');expect(f.hooks.error).not.toHaveBeenCalled();
  });
  it('dispatches available levels independently of missing links, disconnected and slow peers',async()=>{
    const f=fixture();await f.arm();f.setTime(start-30000);await f.tick();
    f.online.delete('profile-2');f.hooks.start.mockImplementation(async(id,url,s)=>{if(id==='profile-0')await new Promise(()=>{});return {id:`run-${id}`,url,mode:s.mode,members:[id],paused:false,createdAt:''};});
    f.setTime(start);await f.observe(`HSK 4: ${four}`);await f.tick();
    expect(f.hooks.start.mock.calls.map(c=>c[0])).toEqual(['profile-0','profile-4','profile-6','profile-8']);
    expect(f.engine.value?.members.find(m=>m.id==='profile-4')?.status).toBe('started');
    expect(f.engine.value?.members.find(m=>m.id==='profile-1')?.status).toBe('waiting');
  });
  it('manual fallback runs immediately and Facebook never overwrites it',async()=>{
    const f=fixture();await f.arm();f.setTime(start-30000);await f.tick();
    await f.engine.manual('4',four);await f.observe('HSK 4: https://forms.gle/Other');expect(f.engine.value?.links['4']?.url).toBe(four);
    f.setTime(start);await f.tick();expect(f.hooks.start).toHaveBeenCalledTimes(5);
    await f.engine.manual('5',five);await f.tick();expect(f.hooks.start).toHaveBeenCalledTimes(10);
    await f.tick();expect(f.hooks.start).toHaveBeenCalledTimes(10);
  });
  it('rejects wrong post, stale watcher and clears removed/conflicting automatic links',async()=>{
    const f=fixture();await f.arm();f.setTime(start-30000);await f.tick();
    await expect(f.engine.observe('wrong',{text:''})).rejects.toThrow('cũ');
    await expect(f.engine.observe(f.engine.value!.watcher!.id,{scheduleId:f.engine.value!.id,token:f.engine.value!.watcher!.token,postKey:'other',text:''})).rejects.toThrow('không thuộc');
    await f.observe(`HSK 4: ${four}`);expect(f.engine.value?.links['4']?.url).toBe(four);
    await f.observe(`HSK 4: ${four}\nHSK 4: ${five}`);expect(f.engine.value?.links['4']?.url).toBeUndefined();
    await f.observe('Link sẽ có sau');expect(f.engine.value?.links).toEqual({});
    f.setTime(start);await f.tick();expect(f.hooks.start).not.toHaveBeenCalled();
  });
  it('does not dispatch stale links or a previous registration date',async()=>{
    const f=fixture();await f.arm();f.setTime(start-30000);await f.tick();await f.observe(`HSK 4: ${four}`);
    f.setTime(start);await f.tick();expect(f.hooks.start).not.toHaveBeenCalled();
    await f.observe(`Đăng ký từ 08:00 ngày 20.10.2026\nHSK 4: ${four}`);await f.tick();expect(f.hooks.start).not.toHaveBeenCalled();expect(f.engine.value?.lastError).toMatch(/khác lịch/);
  });
  it('holds only the stopped profile and cancellation fences queued starts',async()=>{
    const f=fixture();await f.arm({links:{'4':four,'5':five}});f.setTime(start-30000);await f.tick();
    f.engine.hold('profile-0');f.setTime(start);await f.tick();expect(f.hooks.start).toHaveBeenCalledTimes(9);expect(f.hooks.start.mock.calls.some(c=>c[0]==='profile-0')).toBe(false);
    const g=fixture();await g.arm({links:{'4':four,'5':five}});g.setTime(start-30000);await g.tick();await g.engine.cancel();g.setTime(start);await g.tick();expect(g.hooks.start).not.toHaveBeenCalled();expect(g.saved()?.status).toBe('cancelled');
  });
  it('restores saved intent without the management tab and expires after the window',async()=>{
    const f=fixture();await f.arm({links:{'4':four,'5':five}});
    const g=fixture(f.saved());g.setTime(start);await g.tick();expect(g.hooks.start).toHaveBeenCalledTimes(10);
    const h=fixture(f.saved());h.setTime(start+120000);await h.tick();expect(h.hooks.start).not.toHaveBeenCalled();expect(h.saved()?.status).toBe('expired');
  });
  it('invalid setup never leaves a hidden armed schedule',async()=>{
    const f=fixture();await expect(f.arm({links:{'4':'https://evil.test/'}})).rejects.toThrow('không hợp lệ');expect(f.engine.active).toBe(false);
    f.sessions[0].hskLevel=undefined;await expect(f.arm()).rejects.toThrow('chưa khai báo HSK');expect(f.engine.active).toBe(false);
  });
  it('backs off after all watchers fail instead of continuously cycling through profiles',async()=>{
    const f=fixture();f.hooks.command.mockRejectedValue(new Error('Cần cấp quyền Facebook'));
    await f.arm();f.setTime(start-30000);
    for(let i=0;i<15;i++)await f.tick();
    const attempts=()=>f.hooks.command.mock.calls.filter((c:any)=>!c[2]?.stop).length;
    expect(attempts()).toBe(10);
    expect(f.engine.value?.lastError).toBe('P9: Cần cấp quyền Facebook');
    f.setTime(start-20200);await f.tick();expect(attempts()).toBe(10);
    f.setTime(start-20000);for(let i=0;i<15;i++)await f.tick();expect(attempts()).toBe(20);
  });
  it('clears a stale preparation error when that profile is updated, without holding up other profiles',async()=>{
    const f=fixture();f.hooks.prepare.mockRejectedValueOnce(new Error('Cập nhật extension'));
    await f.arm({links:{'4':four,'5':five}});f.setTime(start-30000);await f.tick();
    expect(f.engine.value?.members[0].error).toBe('Cập nhật extension');
    f.setTime(start-24000);await f.tick();expect(f.engine.value?.members[0].error).toBeUndefined();
    f.setTime(start);await f.tick();expect(f.hooks.start).toHaveBeenCalledTimes(10);
  });
  it('focuses only the current ready watcher and rejects focus after cancellation',async()=>{
    const f=fixture();await f.arm();await expect(f.engine.focusWatcher()).rejects.toThrow('Chưa có');
    f.setTime(start-30000);await f.tick();const w=f.engine.value!.watcher!;
    await f.engine.focusWatcher();expect(f.hooks.command).toHaveBeenLastCalledWith(w.id,'WATCH_FACEBOOK',{focus:true,token:w.token,scheduleId:f.engine.value!.id});
    await f.engine.cancel();await expect(f.engine.focusWatcher()).rejects.toThrow('Chưa có');
  });
});
