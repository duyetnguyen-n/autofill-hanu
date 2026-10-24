import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {JSDOM} from 'jsdom';
import {startFacebookReader} from '../src/facebook-reader';

const config={token:'token',scheduleId:'schedule',postKey:'456:123'};
const html='<div data-ad-preview="message">HSK 4: <a href="https://forms.gle/Four">Link</a></div>';
let dom:JSDOM,stop:(()=>void)|undefined;
beforeEach(()=>{vi.useFakeTimers();vi.setSystemTime(90000);dom=new JSDOM(html,{url:'https://www.facebook.com/story.php?story_fbid=123&id=456'});});
afterEach(()=>{stop?.();stop=undefined;dom.window.close();vi.useRealTimers();});
const reports=(send:ReturnType<typeof vi.fn>)=>send.mock.calls.filter(c=>c[0].type==='FACEBOOK_WATCH_REPORT');

it('retries a rejected configuration request without requiring a DOM mutation',async()=>{
  const send=vi.fn().mockRejectedValueOnce(Error('worker waking')).mockResolvedValueOnce(config).mockResolvedValue({ok:true});
  stop=startFacebookReader(dom.window.document,send);
  await vi.advanceTimersByTimeAsync(500);
  expect(reports(send)).toHaveLength(1);expect(reports(send)[0][0].text).toContain('https://forms.gle/Four');
});
it('retries a dropped observation with unchanged content, then deduplicates successful reads',async()=>{
  const send=vi.fn().mockResolvedValueOnce(config).mockRejectedValueOnce(Error('coordinator reconnecting')).mockResolvedValue({ok:true});
  stop=startFacebookReader(dom.window.document,send);
  await vi.advanceTimersByTimeAsync(500);expect(reports(send)).toHaveLength(2);
  await vi.advanceTimersByTimeAsync(5000);expect(reports(send)).toHaveLength(2);
  await vi.advanceTimersByTimeAsync(6000);expect(reports(send)).toHaveLength(3);
});
it('refreshes its binding after a refused report and stops when the watcher is inactive',async()=>{
  const send=vi.fn().mockResolvedValueOnce(config).mockResolvedValueOnce({ok:false}).mockResolvedValue({active:false});
  stop=startFacebookReader(dom.window.document,send);
  await vi.advanceTimersByTimeAsync(30000);
  expect(send).toHaveBeenCalledTimes(3);expect(reports(send)).toHaveLength(1);
});
it('publishes content changed during an in-flight report without overlapping requests',async()=>{
  let release!:(v:any)=>void;
  const send=vi.fn().mockResolvedValueOnce(config).mockImplementationOnce(()=>new Promise(r=>release=r)).mockResolvedValue({ok:true});
  stop=startFacebookReader(dom.window.document,send);await vi.advanceTimersByTimeAsync(0);
  dom.window.document.querySelector('a')!.href='https://forms.gle/Updated';
  await vi.advanceTimersByTimeAsync(2000);expect(reports(send)).toHaveLength(1);
  release({ok:true});await vi.advanceTimersByTimeAsync(25);
  expect(reports(send)).toHaveLength(2);expect(reports(send)[1][0].text).toContain('https://forms.gle/Updated');
});
it('treats an empty shell as loading, then reports the rendered message',async()=>{
  dom.window.document.querySelector('[data-ad-preview]')!.textContent='';
  const send=vi.fn().mockResolvedValueOnce(config).mockResolvedValue({ok:true});
  stop=startFacebookReader(dom.window.document,send);await vi.advanceTimersByTimeAsync(0);
  expect(reports(send)[0][0].error).toMatch(/đang chờ/i);
  dom.window.document.querySelector('[data-ad-preview]')!.innerHTML=html;
  await vi.advanceTimersByTimeAsync(25);
  expect(reports(send).at(-1)![0].error).toBeUndefined();expect(reports(send).at(-1)![0].text).toContain('https://forms.gle/Four');
});
it('observes visibility changes without waiting for a reload',async()=>{
  dom.window.document.querySelector('a')!.setAttribute('aria-hidden','true');
  const send=vi.fn().mockResolvedValueOnce(config).mockResolvedValue({ok:true});
  stop=startFacebookReader(dom.window.document,send);await vi.advanceTimersByTimeAsync(0);
  dom.window.document.querySelector('a')!.removeAttribute('aria-hidden');await vi.advanceTimersByTimeAsync(25);
  expect(reports(send).at(-1)![0].text).toContain('https://forms.gle/Four');
});
it('pagehide prevents a delayed configuration from reporting or starting timers again',async()=>{
  let release!:(v:any)=>void;const send=vi.fn(()=>new Promise(r=>release=r));
  stop=startFacebookReader(dom.window.document,send);
  dom.window.dispatchEvent(new dom.window.Event('pagehide'));release(config);
  await vi.advanceTimersByTimeAsync(30000);expect(send).toHaveBeenCalledTimes(1);
});
