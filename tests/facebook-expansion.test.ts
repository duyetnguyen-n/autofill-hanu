import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {JSDOM} from 'jsdom';
import {FacebookPostPreparation,facebookMessage} from '../src/facebook-document';
import {startFacebookReader} from '../src/facebook-reader';
const config={token:'token',scheduleId:'schedule',postKey:'456:123'};
let dom:JSDOM,stop:(()=>void)|undefined;
beforeEach(()=>{vi.useFakeTimers();vi.setSystemTime(90000);dom=new JSDOM('<article role="article"><div data-ad-preview="message">Bản xem trước<button>Xem thêm</button></div></article>',{url:'https://www.facebook.com/story.php?story_fbid=123&id=456'});});
afterEach(()=>{stop?.();stop=undefined;dom.window.close();vi.useRealTimers();});
const root=()=>dom.window.document.querySelector<HTMLElement>('[data-ad-preview]')!;
const reports=(send:ReturnType<typeof vi.fn>)=>send.mock.calls.filter(c=>c[0].type==='FACEBOOK_WATCH_REPORT').map(c=>c[0]);
function reader(){const send=vi.fn(async(m:any)=>m.type==='FACEBOOK_WATCH_CONFIG'?config:{ok:true});stop=startFacebookReader(dom.window.document,send);return send;}
it('retries an ignored click, withholds partial links, then waits for the expanded body to settle',async()=>{
  root().insertAdjacentHTML('afterbegin','HSK 3: <a href="https://forms.gle/Partial">Partial</a>');
  let clicks=0;root().querySelector('button')!.onclick=()=>{if(++clicks===2)setTimeout(()=>{root().innerHTML='HSK 4: <a href="https://forms.gle/Four">Full</a>';},300);};
  const send=reader();await vi.advanceTimersByTimeAsync(0);
  expect(clicks).toBe(1);expect(reports(send)[0]).toMatchObject({text:'',postState:'expanding'});
  await vi.advanceTimersByTimeAsync(2200);expect(clicks).toBe(2);expect(reports(send).every(r=>r.text==='')).toBe(true);
  await vi.advanceTimersByTimeAsync(1800);expect(reports(send).at(-1)).toMatchObject({postState:'ready',error:undefined});
  expect(reports(send).at(-1)!.text).toContain('https://forms.gle/Four');expect(reports(send).some(r=>r.text.includes('Partial'))).toBe(false);
});
it('does not treat the toggle disappearing as proof before delayed content arrives',async()=>{
  root().querySelector('button')!.onclick=e=>{(e.currentTarget as HTMLElement).remove();setTimeout(()=>{root().innerHTML='HSK 4: <a href="https://forms.gle/Late">Full</a>';},5000);};
  const send=reader();await vi.advanceTimersByTimeAsync(4500);expect(reports(send).every(r=>r.text==='')).toBe(true);
  await vi.advanceTimersByTimeAsync(2000);expect(reports(send).at(-1)!.text).toContain('https://forms.gle/Late');
});
it('has a bounded retry budget even when React replaces the entire message after every click',async()=>{
  let clicks=0;
  const install=()=>{const old=root();const replacement=old.cloneNode(true) as HTMLElement;replacement.querySelector('button')!.onclick=()=>{clicks++;install();};old.replaceWith(replacement);};install();
  const send=reader();await vi.advanceTimersByTimeAsync(30000);
  expect(clicks).toBe(3);expect(reports(send).at(-1)).toMatchObject({postState:'collapsed',text:'',error:expect.stringContaining('Chưa mở hết nội dung bài')});
});
it('recovers after a manual expansion even after the automatic budget is exhausted',async()=>{
  const send=reader();await vi.advanceTimersByTimeAsync(11000);expect(reports(send).at(-1)!.postState).toBe('collapsed');
  root().innerHTML='HSK 4: <a href="https://forms.gle/Manual">Full</a>';await vi.advanceTimersByTimeAsync(1500);
  expect(reports(send).at(-1)).toMatchObject({postState:'ready',error:undefined});expect(reports(send).at(-1)!.text).toContain('https://forms.gle/Manual');
});
it.each(['Xem thêm','See more','查看更多','顯示更多','… Xem\n thêm'])('opens an immediate adjacent toggle labelled %s without touching comments or another article',label=>{
  root().querySelector('button')!.remove();root().insertAdjacentHTML('afterend',`<span><span role="button">${label}</span></span><section><div role="button">Xem thêm</div></section>`);
  const toggle=root().nextElementSibling!.querySelector<HTMLElement>('[role=button]')!,clicked=vi.fn(()=>{root().append(' Toàn bộ nội dung');toggle.remove();});toggle.onclick=clicked;
  const comment=vi.fn();dom.window.document.querySelector<HTMLElement>('section [role=button]')!.onclick=comment;
  const p=new FacebookPostPreparation();expect(p.prepare(dom.window.document,0)).toBe('expanding');expect(clicked).toHaveBeenCalledOnce();
  expect(p.prepare(dom.window.document,25)).toBe('expanding');expect(p.prepare(dom.window.document,500)).toBe('ready');expect(comment).not.toHaveBeenCalled();
});
it('does not click anything when multiple unrelated messages make the selected post ambiguous',()=>{
  dom.window.document.body.insertAdjacentHTML('beforeend','<div data-ad-preview="message">Other<button>Xem thêm</button></div>');
  const click=vi.fn();for(const button of dom.window.document.querySelectorAll('button'))button.onclick=click;
  new FacebookPostPreparation().prepare(dom.window.document);expect(click).not.toHaveBeenCalled();expect(facebookMessage(dom.window.document)).toBeUndefined();
});
it('does not accept aria-expanded alone while Facebook is still fetching the actual body',async()=>{
  const button=root().querySelector('button')!,clicked=vi.fn(()=>{button.setAttribute('aria-expanded','true');button.textContent='See less';setTimeout(()=>{root().innerHTML='HSK 4: <a href="https://forms.gle/AriaLate">Full</a>';},5000);});button.onclick=clicked;
  const send=reader();await vi.advanceTimersByTimeAsync(4500);expect(reports(send).every(r=>r.text==='')).toBe(true);
  await vi.advanceTimersByTimeAsync(2000);expect(reports(send).at(-1)!.text).toContain('https://forms.gle/AriaLate');expect(clicked).toHaveBeenCalledOnce();
});
it('recognizes a removed CSS line clamp when full text was already in the DOM',()=>{
  root().style.setProperty('-webkit-line-clamp','3');const p=new FacebookPostPreparation();root().querySelector('button')!.onclick=e=>{root().style.removeProperty('-webkit-line-clamp');(e.currentTarget as HTMLElement).remove();};
  expect(p.prepare(dom.window.document,0)).toBe('expanding');expect(p.prepare(dom.window.document,50)).toBe('expanding');expect(p.prepare(dom.window.document,500)).toBe('ready');
});
it('ignores hidden toggles and hidden links, and retries a click that throws',()=>{
  const p=new FacebookPostPreparation(),button=root().querySelector('button')!;button.click=vi.fn().mockImplementationOnce(()=>{throw Error('not ready');}).mockImplementation(()=>{button.setAttribute('aria-expanded','true');});
  expect(p.prepare(dom.window.document,0)).toBe('expanding');expect(p.prepare(dom.window.document,1000)).toBe('expanding');expect(button.click).toHaveBeenCalledTimes(1);
  p.prepare(dom.window.document,2000);expect(button.click).toHaveBeenCalledTimes(2);
  root().insertAdjacentHTML('beforeend','<a hidden href="https://forms.gle/Hidden">Hidden</a><a style="display:none" href="https://forms.gle/CssHidden">Hidden</a>');expect(facebookMessage(dom.window.document)).not.toContain('forms.gle');
});
it('stops retrying expansion after pagehide',async()=>{
  const click=vi.fn();root().querySelector('button')!.onclick=click;reader();await vi.advanceTimersByTimeAsync(0);dom.window.dispatchEvent(new dom.window.Event('pagehide'));
  await vi.advanceTimersByTimeAsync(30000);expect(click).toHaveBeenCalledOnce();
});

it('leaves an adjacent comment section and already expanded controls untouched',()=>{
  root().querySelector('button')!.remove();root().insertAdjacentHTML('afterend','<section><button>Xem thêm</button></section>');
  const click=vi.fn();dom.window.document.querySelector('section button')!.addEventListener('click',click);const p=new FacebookPostPreparation();expect(p.prepare(dom.window.document)).toBe('ready');expect(click).not.toHaveBeenCalled();
});
it('recognizes an aria-labelled toggle and never reads a message hidden by an ancestor',()=>{
  const button=root().querySelector('button')!;button.textContent='…';button.setAttribute('aria-label','See more');const clicked=vi.fn();button.onclick=clicked;
  expect(new FacebookPostPreparation().prepare(dom.window.document)).toBe('expanding');expect(clicked).toHaveBeenCalledOnce();
  root().parentElement!.style.display='none';expect(facebookMessage(dom.window.document)).toBeUndefined();
});
