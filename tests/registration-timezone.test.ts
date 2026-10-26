import {afterEach,expect,it,vi} from 'vitest';
import {RegistrationScheduler} from '../manager/server/registration-scheduler';
import {facebookPostKey,parseHskLinks,registrationDateError,type RegistrationSchedule} from '../src/registration-schedule';
import {emptyProfile} from '../src/rules';
import type {SessionView} from '../src/protocol';

const postUrl='https://www.facebook.com/HSKVienKhongTuHanu/posts/pfbid02qoGt6b5j5HdDhom3Bdnt1XodVcP9mqFHYg2Hn6AL5utR7bFQCjT1TrJgC4H9Jxwpl';
// Opening-time text observed in the public announcement. Future URLs are fixtures.
const levels=['3','4','5','6'] as const;
const announcement=(published:boolean)=>[
  'THÔNG BÁO MỞ ĐỢT THI [BỔ SUNG] NGÀY 29.11.2026',
  'MẪU FORM ĐĂNG KÝ THÍ SINH CÓ THỂ ĐIỀN THỬ: https://forms.gle/fAc5ex6xPyZdSUmu8',
  'Các thí sinh có thể bắt đầu đăng ký dự thi theo đường link dưới đây 𝟐𝟎:𝟎𝟎 𝐧𝐠𝐚̀𝐲 𝟐𝟔.𝟏𝟎.𝟐𝟎𝟐𝟔:',
  ...levels.map(level=>`HSK ${level} + HSK Khẩu ngữ: ${published?`https://forms.gle/Fixture${level}`:'đường link đăng ký sẽ được cập nhật lúc 𝟐𝟎:𝟎𝟎 ngày 𝟐𝟔.𝟏𝟎.𝟐𝟎𝟐𝟔'}`),
  'Biểu mẫu đăng ký dự thi sẽ đóng vào 𝟐𝟐:𝟎𝟎 ngày 𝟐𝟔.𝟏𝟎.𝟐𝟎𝟐𝟔.',
  '报名时间：𝟐𝟎𝟐𝟔年𝟏𝟎月𝟐𝟔日𝟐𝟎:𝟎𝟎点考生点击下方链接填写报名信息。',
  ...levels.map(level=>`HSK${level}级 + HSK口语：${published?`https://forms.gle/Fixture${level}`:'报名链接将于𝟐𝟎𝟐𝟔年𝟏𝟎月𝟐𝟔日𝟐𝟎:𝟎𝟎点更新'}`),
].join('\n');
const expected=Object.fromEntries(levels.map(level=>[level,{url:`https://forms.gle/Fixture${level}`} ]));
// Same conversion used by the datetime-local field in RegistrationSchedulePanel.
const inputTime=()=>new Date('2026-10-26T20:00:00+07:00').toISOString();
afterEach(()=>vi.unstubAllEnvs());

it.each(['UTC','Asia/Ho_Chi_Minh','Asia/Bangkok','America/Los_Angeles'])(
  'matches 20:00 Vietnam against the bilingual announcement when host timezone is %s',timezone=>{
    vi.stubEnv('TZ',timezone);
    const startsAt=inputTime();
    expect(startsAt).toBe('2026-10-26T13:00:00.000Z');
    expect(registrationDateError(announcement(false),startsAt)).toBeUndefined();
    expect(registrationDateError(announcement(true),startsAt)).toBeUndefined();
    expect(parseHskLinks(announcement(false),startsAt)).toEqual({});
    expect(parseHskLinks(announcement(true),startsAt)).toEqual(expected);
  },
);

it('detects a different opening time for warnings while unfiltered links remain usable',()=>{
  for(const at of ['2026-10-26T20:01:00+07:00','2026-10-19T20:00:00+07:00']){
    expect(registrationDateError(announcement(true),at)).toMatch(/khác lịch/);
    expect(parseHskLinks(announcement(true),at)).toEqual({});
    expect(parseHskLinks(announcement(true))).toEqual(expected);
  }
});

it.each(['2026-10-26T20:00:00+07:00','2026-10-26T20:01:00+07:00','2026-10-27T20:00:00+07:00'])(
  'dispatches all HSKs on link arrival with configured time %s',async configuredTime=>{
  const now=Date.parse('2026-10-26T19:55:00+07:00');
  const sessions:SessionView[]=levels.map(level=>({id:`fixture-${level}`,name:`HSK ${level}`,hskLevel:level,expectedEmail:'fixture@example.test',connected:true,lastSeen:'',revision:1,synced:true,profile:emptyProfile()}));
  const start=vi.fn(async(id:string,url:string,s:RegistrationSchedule)=>({id:`run-${id}`,url,mode:s.mode,members:[id],paused:false,createdAt:new Date(now).toISOString()}));
  const error=vi.fn();
  const scheduler=new RegistrationScheduler({load:async()=>undefined,save:async()=>{},sessions:async()=>sessions,connected:()=>true,command:async()=>({ready:true}),prepare:async()=>1,start,changed:()=>{},error},()=>now);
  try{
    await scheduler.arm({ids:sessions.map(s=>s.id),mode:'test',postUrl,startsAt:configuredTime});
    await scheduler.tick();
    await vi.waitFor(()=>expect(scheduler.value!.members.every(m=>m.prepared)).toBe(true));
    await vi.waitFor(()=>expect(scheduler.value!.watcher?.ready).toBe(true));
    const report=(text:string)=>scheduler.observe(scheduler.value!.watcher!.id,{scheduleId:scheduler.value!.id,token:scheduler.value!.watcher!.token,postKey:facebookPostKey(postUrl),text});
    await report(announcement(false));
    expect(scheduler.value!.lastError).toBeUndefined();
    expect(start).not.toHaveBeenCalled();
    await report(announcement(true));
    await vi.waitFor(()=>expect(start).toHaveBeenCalledTimes(4));
    expect(start.mock.calls.map(([id,url,s])=>({id,url,mode:s.mode}))).toEqual(levels.map(level=>({id:`fixture-${level}`,url:`https://forms.gle/Fixture${level}`,mode:'test'})));
    expect(scheduler.value!.dateWarning).toBe(registrationDateError(announcement(true),configuredTime));
    expect(scheduler.value!.lastError).toBeUndefined();
    expect(error).not.toHaveBeenCalled();
  }finally{scheduler.close();}
});
