// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { emptyProfile } from "../src/rules";
import type { ExtensionMessage } from "../src/shared";

let listener: (message: ExtensionMessage) => void;
afterEach(() => {
  listener?.({ type: "HALT_RUN" });
  vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.resetModules();
  document.body.replaceChildren();
});

async function setup(result = { state: "assigned" }, uploaded = false, mountDelay = 0,
  extra: {html?:string;values?:Record<string,string>;onMount?:()=>void;uploadDelay?:number;rejected?:string;repairGranted?:boolean} = {}) {
  vi.useFakeTimers();
  document.body.innerHTML = `<div role="listitem" data-item-id="file">
    <div role="heading">ẢNH MẶT TRƯỚC GTTT CỦA THÍ SINH | 身份证件图 *</div>
    <p>Upload 1 supported file: PDF or image.</p><button aria-label="ẢNH MẶT TRƯỚC GTTT CỦA THÍ SINH">Add file</button>
  </div><button id="next">Next</button>`;
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ width: 100, height: 40 } as DOMRect);
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: () => {} });
  const card = document.querySelector<HTMLElement>('[data-item-id="file"]')!;
  const commit = (name = "saved.png") => {
    card.innerHTML += `<span>${name}</span><button aria-label="Remove file">×</button>`;
    document.querySelector("iframe")?.remove();
  };
  if (uploaded) commit();
  {
    const opener = card.querySelector("button")!;
    if (mountDelay) { opener.remove(); window.setTimeout(() => card.append(opener), mountDelay); }
    opener.addEventListener("click", () => {
    const iframe = document.createElement("iframe");
    iframe.src = "https://docs.google.com/picker?hostId=file-upload&rpcService=test&rpctoken=token";
    document.body.append(iframe);
    });
  }
  if(extra.rejected){
    card.insertAdjacentHTML('beforeend',`<div role="alert">${extra.rejected}</div>`);
    card.addEventListener('click',e=>{const remove=(e.target as Element).closest('[aria-label="Remove file"]');if(remove){remove.remove();card.querySelector('span')?.remove();card.querySelector('[role="alert"]')?.remove();}});
  }
  const profile = emptyProfile();
  Object.assign(profile.values,extra.values);
  if(extra.html)document.querySelector('#next')!.insertAdjacentHTML('beforebegin',extra.html);
  extra.onMount?.();
  profile.attachments.identityDocument = { id: "stored-image", name: "saved.png", type: "image/png", size: 3, updatedAt: "" };
  const sent: ExtensionMessage[] = [];
  const sendMessage = vi.fn(async (message: ExtensionMessage) => {
    sent.push(message);
    if (message.type === "GET_PROFILE") return profile;
    if(message.type==='REQUEST_UPLOAD_REPAIR')return {ok:true,repairGranted:extra.repairGranted??true};
    if (message.type === "UPLOAD_STORED_FILE") {
      if(extra.uploadDelay&&!message.checkOnly)await new Promise(resolve=>window.setTimeout(resolve,extra.uploadDelay));
      return result;
    }
    return undefined;
  });
  vi.stubGlobal("chrome", { runtime: { sendMessage, onMessage: { addListener: (fn: typeof listener) => { listener = fn; } } } });
  const submit = vi.fn();
  const next = vi.fn(() => {
    document.body.innerHTML = "<button>Submit</button>";
    document.querySelector("button")!.addEventListener("click", submit);
  });
  document.querySelector("#next")!.addEventListener("click", next);
  await import("../src/content");
  listener({ type: "RUN_CURRENT_PAGE", mode: "test" });
  await vi.advanceTimersByTimeAsync(100);
  return { next, submit, sent, commit, sendMessage };
}

it('replaces the exact stored photo once after an explicit Google unavailable-file rejection, then waits for upload confirmation',async()=>{
  const f=await setup({state:'assigned'},true,0,{rejected:'Tệp này không còn có sẵn nữa'});
  expect(f.sent.filter(m=>m.type==='REQUEST_UPLOAD_REPAIR')).toHaveLength(1);
  expect(f.sent).toContainEqual(expect.objectContaining({type:'UPLOAD_STORED_FILE',attachmentId:'stored-image'}));
  expect(f.next).not.toHaveBeenCalled();f.commit();await vi.advanceTimersByTimeAsync(1000);
  expect(f.next).toHaveBeenCalledTimes(1);expect(f.submit).not.toHaveBeenCalled();
});
it('keeps a rejected photo untouched when the run has no repair grant left',async()=>{
  const f=await setup({state:'assigned'},true,0,{rejected:'Tệp này không còn có sẵn nữa',repairGranted:false});
  expect(f.sent.filter(m=>m.type==='REQUEST_UPLOAD_REPAIR')).toHaveLength(1);
  expect(f.sent.some(m=>m.type==='UPLOAD_STORED_FILE')).toBe(false);
  expect(f.sent).toContainEqual(expect.objectContaining({type:'FORM_EVENT',event:expect.objectContaining({type:'block',issue:expect.objectContaining({reason:'file_upload'})})}));
  expect(f.next).not.toHaveBeenCalled();expect(document.querySelector('[aria-label="Remove file"]')).not.toBeNull();
});
it('does not replace a photo for a generic validation message',async()=>{
  const f=await setup({state:'assigned'},true,0,{rejected:'Dữ liệu chưa hợp lệ'});
  expect(f.sent.some(m=>m.type==='REQUEST_UPLOAD_REPAIR')).toBe(false);
  expect(f.next).not.toHaveBeenCalled();expect(document.querySelector('[aria-label="Remove file"]')).not.toBeNull();
});

it("opens Picker with the stored attachment, waits for server completion, then advances without submitting", async () => {
  const fixture = await setup();
  expect(fixture.sendMessage).toHaveBeenCalledWith(expect.objectContaining({ type: "UPLOAD_STORED_FILE", attachmentId: "stored-image" }));
  expect(fixture.next).not.toHaveBeenCalled(); // files assigned != uploaded
  await vi.advanceTimersByTimeAsync(1000);
  expect(fixture.next).not.toHaveBeenCalled();
  fixture.commit();
  await vi.advanceTimersByTimeAsync(1500);
  expect(fixture.next).toHaveBeenCalledTimes(1);
  expect(fixture.submit).not.toHaveBeenCalled();
  expect(fixture.sent).toContainEqual({ type: "FORM_EVENT", event: { type: "ready_to_submit" } });
});

it("HALT during upload never advances even if the upload subsequently completes", async () => {
  const fixture = await setup();
  listener({ type: "HALT_RUN" });
  fixture.commit();
  await vi.advanceTimersByTimeAsync(2000);
  expect(fixture.next).not.toHaveBeenCalled();
});

it("finishes dropdowns before opening Picker and fills text while upload is still pending", async () => {
  const edits:string[]=[];
  const fixture=await setup({state:'assigned'},false,0,{
    values:{gender:'Nam',email:'correct@gmail.com'},uploadDelay:1500,
    html:'<div role="listitem"><div role="heading">EMAIL *</div><input type="email" required id="email"></div>'+
      '<div role="listitem"><div role="heading">GIỚI TÍNH *</div><select id="gender"><option>Chọn</option><option>Nam</option></select></div>',
    onMount:()=>{
      document.querySelector('#gender')!.addEventListener('change',()=>{expect(document.querySelector('iframe')).toBeNull();edits.push('dropdown');});
      document.querySelector('#email')!.addEventListener('change',()=>{expect(document.querySelector('iframe')).not.toBeNull();edits.push('text');});
    }
  });
  expect(edits,JSON.stringify(fixture.sent)).toEqual(['dropdown','text']);
  expect((document.querySelector('#email') as HTMLInputElement).value,JSON.stringify(fixture.sent)).toBe('correct@gmail.com');
  expect(fixture.next).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1600);
  expect(fixture.next).not.toHaveBeenCalled();
  fixture.commit();await vi.advanceTimersByTimeAsync(1000);
  expect(fixture.next).toHaveBeenCalledTimes(1);
  expect(fixture.submit).not.toHaveBeenCalled();
});

it("rechecks overlapped text after upload commits and blocks a value changed by a rerender", async () => {
  const fixture=await setup({state:'assigned'},false,0,{
    values:{email:'correct@gmail.com'},
    html:'<div role="listitem"><div role="heading">EMAIL *</div><input type="text" required id="email"></div>'
  });
  expect((document.querySelector('#email') as HTMLInputElement).value,JSON.stringify(fixture.sent)).toBe('correct@gmail.com');
  fixture.commit();
  (document.querySelector('#email') as HTMLInputElement).value='stale@gmail.com';
  await vi.advanceTimersByTimeAsync(1000);
  expect(fixture.next).not.toHaveBeenCalled();
  expect(fixture.sent).toContainEqual(expect.objectContaining({type:'FORM_EVENT',event:expect.objectContaining({type:'block',issue:expect.objectContaining({reason:'validation'})})}));
});

it("blocks on a rejected stored upload instead of falling through to Next", async () => {
  const fixture = await setup({ state: "error", error: "Picker từ chối tệp" } as { state: string });
  await vi.advanceTimersByTimeAsync(1000);
  expect(fixture.next).not.toHaveBeenCalled();
  expect(fixture.sent).toContainEqual(expect.objectContaining({ type: "FORM_EVENT", event: expect.objectContaining({ type: "block", issue: expect.objectContaining({ reason: "file_upload", message: "Picker từ chối tệp" }) }) }));
});

it("blocks if Picker closes without committing the expected filename", async () => {
  const fixture = await setup();
  fixture.commit("wrong.png");
  await vi.advanceTimersByTimeAsync(6000);
  expect(fixture.next).not.toHaveBeenCalled();
});

it("allows the committed chip to render just after Picker closes", async () => {
  const fixture = await setup();
  document.querySelector("iframe")!.remove();
  await vi.advanceTimersByTimeAsync(500);
  expect(fixture.next).not.toHaveBeenCalled();
  fixture.commit();
  await vi.advanceTimersByTimeAsync(1000);
  expect(fixture.next).toHaveBeenCalledTimes(1);
});

it("does not re-upload a matching committed file", async () => {
  const fixture = await setup({ state: "assigned" }, true);
  await vi.advanceTimersByTimeAsync(1000);
  expect(fixture.next).toHaveBeenCalledTimes(1);
  expect(fixture.sendMessage.mock.calls.some(([message]) => message.type === "UPLOAD_STORED_FILE")).toBe(false);
});

it("a stalled upload times out without repeating the upload or navigating", async () => {
  const fixture = await setup();
  await vi.advanceTimersByTimeAsync(121000);
  expect(fixture.next).not.toHaveBeenCalled();
  expect(fixture.sendMessage.mock.calls.filter(([message]) => message.type === "UPLOAD_STORED_FILE" && !message.checkOnly)).toHaveLength(1);
  expect(fixture.sent).toContainEqual(expect.objectContaining({ type: "FORM_EVENT", event: expect.objectContaining({ type: "block" }) }));
});

it("reports a Google upload error immediately without reuploading or advancing", async () => {
  const fixture = await setup();
  fixture.sendMessage.mockImplementation(async message => {
    fixture.sent.push(message);
    if (message.type === "UPLOAD_STORED_FILE" && message.checkOnly) return { state: "error", error: "Google Picker: Không thể tải tệp lên." };
    return undefined;
  });
  await vi.advanceTimersByTimeAsync(1000);
  expect(fixture.next).not.toHaveBeenCalled();
  expect(fixture.submit).not.toHaveBeenCalled();
  expect(fixture.sent).toContainEqual(expect.objectContaining({ type: "FORM_EVENT", event: expect.objectContaining({
    type: "block", issue: expect.objectContaining({ reason: "file_upload", message: "Google Picker: Không thể tải tệp lên." })
  }) }));
  expect(fixture.sendMessage.mock.calls.filter(([message]) => message.type === "UPLOAD_STORED_FILE" && !message.checkOnly)).toHaveLength(1);
});

it("does not skip a required upload card whose button mounts after page navigation", async () => {
  const fixture = await setup({ state: "assigned" }, false, 800);
  expect(fixture.next).not.toHaveBeenCalled();
  expect(fixture.sendMessage.mock.calls.some(([message]) => message.type === "UPLOAD_STORED_FILE")).toBe(false);
  await vi.advanceTimersByTimeAsync(900);
  expect(fixture.sendMessage).toHaveBeenCalledWith(expect.objectContaining({ type: "UPLOAD_STORED_FILE" }));
  expect(fixture.next).not.toHaveBeenCalled();
  fixture.commit();
  await vi.advanceTimersByTimeAsync(1500);
  expect(fixture.next).toHaveBeenCalledTimes(1);
  expect(fixture.submit).not.toHaveBeenCalled();
});


it('Resume adopts only its own Picker and request after a pause during upload',async()=>{
  const f=await setup();
  const first=f.sent.find(m=>m.type==='UPLOAD_STORED_FILE') as any;
  listener({type:'HALT_RUN'});await vi.advanceTimersByTimeAsync(300);
  listener({type:'RUN_CURRENT_PAGE',mode:'test'});await vi.advanceTimersByTimeAsync(400);
  const requests=f.sent.filter(m=>m.type==='UPLOAD_STORED_FILE') as any[];
  expect(requests.length).toBeGreaterThan(1);
  expect(requests.every(m=>m.requestId===first.requestId)).toBe(true);
  expect(document.querySelectorAll('iframe')).toHaveLength(1);
  f.commit();await vi.advanceTimersByTimeAsync(1200);
  expect(f.next).toHaveBeenCalledOnce();expect(f.submit).not.toHaveBeenCalled();
});
