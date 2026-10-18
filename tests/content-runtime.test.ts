// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { emptyProfile } from "../src/rules";

type Listener = (message: { type: string; mode?: "test" | "live"; skipQuestionId?: string }, sender?: unknown, sendResponse?: (response: unknown) => void) => void;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.resetModules();
  document.body.replaceChildren();
});

describe("compiled content-script behavior", () => {
  it('selects the same commitment after a late image pushes it below the viewport before the trusted fallback',async()=>{
    document.body.innerHTML='<div role="listitem"><div role="heading">TÔI CAM KẾT 本人保证 *</div><div id="yes" role="radio" aria-checked="false" aria-label="Tôi cam kết không thuê người đăng ký dự thi kỳ thi lần này."></div><div role="radio" aria-checked="false" aria-label="本人保证未雇用他人代替报名本次考试。"></div></div><button>Submit</button>';
    const target=document.querySelector<HTMLElement>('#yes')!;let top=200,shifted=false;const clicks:any[]=[];
    vi.spyOn(HTMLElement.prototype,'getBoundingClientRect').mockImplementation(function(this:HTMLElement){return (this===target?{left:20,top,width:20,height:20}:{left:0,top:0,width:640,height:80}) as DOMRect;});
    Object.defineProperty(HTMLElement.prototype,'scrollIntoView',{configurable:true,value:function(this:HTMLElement){if(this===target)top=200;}});
    target.addEventListener('click',()=>{if(!shifted){shifted=true;window.setTimeout(()=>{top=1200;},30);}});
    const profile=emptyProfile();profile.values.firstCommitment='true';let listener:Listener;const sent:any[]=[];
    vi.stubGlobal('chrome',{runtime:{onMessage:{addListener:(fn:Listener)=>listener=fn},sendMessage:async(m:any)=>{
      sent.push(m);if(m.type==='GET_PROFILE')return profile;
      if(m.type==='TRUSTED_CLICK'){clicks.push(m);if(m.x===30&&m.y===top+10&&m.y<window.innerHeight)target.setAttribute('aria-checked','true');return {dispatched:true};}
      return {ok:true};
    }}});
    await import('../src/content');listener!({type:'RUN_CURRENT_PAGE',mode:'test'});
    await vi.waitFor(()=>expect(sent).toContainEqual(expect.objectContaining({type:'FORM_EVENT',event:{type:'ready_to_submit'}})),{timeout:2500});
    expect(target.getAttribute('aria-checked')).toBe('true');
    expect(clicks).toHaveLength(1);
    expect(clicks[0]).toMatchObject({x:30,y:210});
    expect(sent.some(m=>m.type==='FORM_EVENT'&&m.event.type==='block')).toBe(false);
  });
  it.each([
    {key:'termsCommitment',other:'firstCommitment',options:['本人已详细阅读并同意接受以上条款限制。','Tôi đã đọc và đồng ý với những điều khoản trên và sẽ chịu trách nhiệm với thông tin dự thi của mình.']},
    {key:'firstCommitment',other:'termsCommitment',options:['本人保证未雇用他人代替报名本次考试。','Tôi cam kết không thuê người đăng ký dự thi kỳ thi lần này.']}
  ])('distinguishes bilingual commitments by option wording: $key',async ({key,other,options})=>{
    document.body.innerHTML='<div role="listitem"><div role="heading">TÔI CAM KẾT | 本人保证 *</div><input type="radio" name="commit"><input type="radio" name="commit"></div><button>Submit</button>';
    const inputs=[...document.querySelectorAll<HTMLInputElement>('input')];inputs.forEach((input,i)=>input.setAttribute('aria-label',options[i]));
    vi.spyOn(HTMLElement.prototype,'getBoundingClientRect').mockReturnValue({width:640,height:80} as DOMRect);
    Object.defineProperty(HTMLElement.prototype,'scrollIntoView',{configurable:true,value:()=>{}});
    const profile=emptyProfile();profile.values[key]='true';profile.values[other]='false';let listener:Listener;const sent:any[]=[];
    vi.stubGlobal('chrome',{runtime:{onMessage:{addListener:(fn:Listener)=>listener=fn},sendMessage:async(m:any)=>{sent.push(m);return m.type==='GET_PROFILE'?profile:{ok:true};}}});
    await import('../src/content');listener!({type:'RUN_CURRENT_PAGE',mode:'test'});
    await vi.waitFor(()=>expect(sent).toContainEqual(expect.objectContaining({type:'FORM_EVENT',event:{type:'ready_to_submit'}})));
    expect(inputs.filter(input=>input.checked)).toHaveLength(1);
    expect(sent).toContainEqual(expect.objectContaining({type:'FORM_EVENT',event:expect.objectContaining({type:'progress',message:`Đã điền: ${key==='termsCommitment'?'Đồng ý điều khoản':'Cam kết tự đăng ký'}`})}));
  });
  it.each(['nguyen van cu','Nguyễn Văn Cư'])('restores the exact saved text instead of accepting normalized prefill %s',async prefill=>{
    document.body.innerHTML='<div role="listitem"><div role="heading">Họ và tên *</div><input type="text"></div><button>Submit</button>';
    vi.spyOn(HTMLElement.prototype,'getBoundingClientRect').mockReturnValue({width:640,height:80} as DOMRect);
    Object.defineProperty(HTMLElement.prototype,'scrollIntoView',{configurable:true,value:()=>{}});
    document.querySelector<HTMLInputElement>('input')!.value=prefill;
    const profile=emptyProfile();profile.values.fullName='NGUYEN VAN CU';let listener:Listener;const sent:any[]=[];
    vi.stubGlobal('chrome',{runtime:{onMessage:{addListener:(fn:Listener)=>listener=fn},sendMessage:async(m:any)=>{sent.push(m);return m.type==='GET_PROFILE'?profile:{ok:true};}}});
    await import('../src/content');listener!({type:'RUN_CURRENT_PAGE',mode:'test'});
    await vi.waitFor(()=>expect(sent).toContainEqual(expect.objectContaining({type:'FORM_EVENT',event:{type:'ready_to_submit'}})));
    expect(document.querySelector<HTMLInputElement>('input')!.value).toBe('NGUYEN VAN CU');
  });
  it("fills the required CCCD field whose Google Forms heading contains a trailing asterisk", async () => {
    document.body.innerHTML = `
      <div role="listitem" data-item-id="cccd-question">
        <div role="heading">.. -.. -. ..- -- *</div>
        <input type="text" name="entry.123" />
      </div>
      <button type="button">Next</button>
    `;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ width: 640, height: 80 } as DOMRect);
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: () => undefined });

    const profile = emptyProfile();
    profile.values.identityNumber = "033056789514";
    const listeners: Listener[] = [];
    const sent: unknown[] = [];
    vi.stubGlobal("chrome", {
      runtime: {
        onMessage: { addListener: (listener: Listener) => listeners.push(listener) },
        sendMessage: vi.fn(async (message: { type: string }) => {
          sent.push(message);
          return message.type === "GET_PROFILE" ? profile : { ok: true };
        })
      }
    });

    document.querySelector("button")!.addEventListener("click", () => {
      document.querySelector('[role="heading"]')!.textContent = "Trang cuối";
      document.querySelector("button")!.textContent = "Submit";
    });

    await import("../src/content");
    listeners[0]({ type: "RUN_CURRENT_PAGE", mode: "test" });
    await vi.waitFor(()=>expect(sent).toContainEqual(expect.objectContaining({type:'FORM_EVENT',event:expect.objectContaining({type:'ready_to_submit'})})),{timeout:2000});

    expect(document.querySelector<HTMLInputElement>('input[name="entry.123"]')!.value).toBe("033056789514");
    expect(sent).toContainEqual(expect.objectContaining({ type: "FORM_EVENT", event: expect.objectContaining({ type: "ready_to_submit" }) }));
  });

  it("selects Quốc tịch = Việt Nam when Forms adds an Other-response text input to the radio card", async () => {
    document.body.innerHTML = `
      <div role="listitem" data-item-id="nationality-question">
        <div role="heading">QUỐC TỊCH | 国籍 *</div>
        <div role="radio" data-value="Việt Nam   |   越南" aria-label="Việt Nam   |   越南" aria-checked="false"></div>
        <div role="radio" aria-label="Khác" aria-checked="false"></div>
        <input type="text" aria-label="Other response" />
      </div>
      <button type="button">Submit</button>
    `;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ width: 640, height: 80 } as DOMRect);
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: () => undefined });
    const vietnam = document.querySelector<HTMLElement>('[aria-label="Việt Nam   |   越南"]')!;
    vietnam.addEventListener("click", () => vietnam.setAttribute("aria-checked", "true"));

    const profile = emptyProfile();
    profile.values.nationality = "Việt Nam";
    const listeners: Listener[] = [];
    const sent: unknown[] = [];
    vi.stubGlobal("chrome", {
      runtime: {
        onMessage: { addListener: (listener: Listener) => listeners.push(listener) },
        sendMessage: vi.fn(async (message: { type: string }) => {
          sent.push(message);
          return message.type === "GET_PROFILE" ? profile : { ok: true };
        })
      }
    });

    await import("../src/content");
    listeners[0]({ type: "RUN_CURRENT_PAGE", mode: "test" });
    await new Promise((resolve) => window.setTimeout(resolve, 30));

    expect(vietnam.getAttribute("aria-checked")).toBe("true");
    expect(sent).toContainEqual(expect.objectContaining({ type: "FORM_EVENT", event: expect.objectContaining({ type: "ready_to_submit" }) }));
  });

  it("does not treat the default Choose option as a filled dropdown and selects the profile gender", async () => {
    document.body.innerHTML = `
      <div role="listitem" data-item-id="gender-question">
        <div role="heading">GIỚI TÍNH | 性别 *</div>
        <div role="listbox">
          <div role="option" data-value="" aria-selected="true">Choose</div>
          <div role="option" data-value="Nam   |   男" aria-selected="false">Nam   |   男</div>
          <div role="option" data-value="Nữ   |   女" aria-selected="false">Nữ   |   女</div>
        </div>
      </div>
      <button type="button">Submit</button>
    `;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ width: 640, height: 80 } as DOMRect);
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: () => undefined });
    const choose = document.querySelector<HTMLElement>('[role="option"][data-value=""]')!;
    const male = document.querySelector<HTMLElement>('[role="option"][data-value^="Nam"]')!;
    male.addEventListener("click", () => {
      choose.setAttribute("aria-selected", "false");
      male.setAttribute("aria-selected", "true");
    });
    const profile = emptyProfile();
    profile.values.gender = "Nam";
    const listeners: Listener[] = [];
    vi.stubGlobal("chrome", {
      runtime: {
        onMessage: { addListener: (listener: Listener) => listeners.push(listener) },
        sendMessage: vi.fn(async (message: { type: string }) => message.type === "GET_PROFILE" ? profile : { ok: true })
      }
    });

    await import("../src/content");
    listeners[0]({ type: "RUN_CURRENT_PAGE", mode: "test" });
    await new Promise((resolve) => window.setTimeout(resolve, 130));

    expect(male.getAttribute("aria-selected")).toBe("true");
  });

  it("selects from a Google Forms detached overlay dropdown rendered into document.body", async () => {
    document.body.innerHTML = `
      <div role="listitem" data-item-id="nationality-dropdown">
        <div role="heading">QUỐC TỊCH | 国籍 *</div>
        <div role="listbox" aria-expanded="false" tabindex="0">
          <div role="option" data-value="" aria-selected="true">Chọn</div>
        </div>
      </div>
      <button type="button">Submit</button>
    `;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ width: 640, height: 80, left: 100, top: 200 } as DOMRect);
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: () => undefined });

    const trigger = document.querySelector<HTMLElement>('[role="listbox"]')!;
    trigger.addEventListener("click", () => {
      if (!document.querySelector(".exportSelectPopup")) {
        const popup = document.createElement("div");
        popup.className = "exportSelectPopup OA0qNb";
        popup.setAttribute("role", "listbox");
        popup.innerHTML = `
          <div role="option" data-value="">Chọn</div>
          <div role="option" data-value="Việt Nam | 越南" id="vn-opt">Việt Nam | 越南</div>
          <div role="option" data-value="Khác | 其他">Khác | 其他</div>
        `;
        document.body.appendChild(popup);
        trigger.setAttribute("aria-expanded", "true");
        const vnOpt = popup.querySelector<HTMLElement>('#vn-opt')!;
        vnOpt.addEventListener("click", () => {
          trigger.setAttribute("aria-expanded", "false");
          const opt = trigger.querySelector<HTMLElement>('[role="option"]')!;
          opt.setAttribute("data-value", "Việt Nam | 越南");
          opt.textContent = "Việt Nam | 越南";
          trigger.setAttribute("aria-activedescendant", "vn-opt");
          vnOpt.setAttribute("aria-selected", "true");
        });
      }
    });

    const profile = emptyProfile();
    profile.values.nationality = "Việt Nam";
    const listeners: Listener[] = [];
    vi.stubGlobal("chrome", {
      runtime: {
        onMessage: { addListener: (listener: Listener) => listeners.push(listener) },
        sendMessage: vi.fn(async (message: { type: string }) => message.type === "GET_PROFILE" ? profile : { ok: true })
      }
    });

    await import("../src/content");
    listeners[0]({ type: "RUN_CURRENT_PAGE", mode: "test" });
    await new Promise((resolve) => window.setTimeout(resolve, 200));

    expect(trigger.querySelector('[role="option"]')?.getAttribute("data-value")).toBe("Việt Nam | 越南");
  });

  it("formats an ISO birth date to the exact date order stated by the form", async () => {
    document.body.innerHTML = `
      <div role="listitem" data-item-id="birth-date-question">
        <div role="heading">NGÀY SINH | 出生日期 *</div>
        <p>Viết theo cú pháp NGÀY-THÁNG-NĂM, ví dụ 26-06-2002</p>
        <input type="text" />
      </div>
      <button type="button">Submit</button>
    `;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ width: 640, height: 80 } as DOMRect);
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: () => undefined });
    const profile = emptyProfile();
    profile.values.birthDate = "2002-06-26";
    const listeners: Listener[] = [];
    vi.stubGlobal("chrome", {
      runtime: {
        onMessage: { addListener: (listener: Listener) => listeners.push(listener) },
        sendMessage: vi.fn(async (message: { type: string }) => message.type === "GET_PROFILE" ? profile : { ok: true })
      }
    });

    await import("../src/content");
    listeners[0]({ type: "RUN_CURRENT_PAGE", mode: "test" });
    await new Promise((resolve) => window.setTimeout(resolve, 30));

    expect(document.querySelector<HTMLInputElement>('input[type="text"]')!.value).toBe("26-06-2002");
  });

  it("scans visible questions without filling or submitting", async () => {
    document.body.innerHTML = `
      <div role="listitem" data-item-id="gender-question">
        <div role="heading">GIỚI TÍNH | 性别 *</div>
        <div role="listbox">
          <div role="option" data-value="" aria-selected="true">Choose</div>
          <div role="option" data-value="Nam | 男" aria-selected="false">Nam | 男</div>
          <div role="option" data-value="Nữ | 女" aria-selected="false">Nữ | 女</div>
        </div>
      </div>
    `;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ width: 640, height: 80 } as DOMRect);
    const listeners: Listener[] = [];
    vi.stubGlobal("chrome", {
      runtime: {
        onMessage: { addListener: (listener: Listener) => listeners.push(listener) },
        sendMessage: vi.fn()
      }
    });

    await import("../src/content");
    let result: unknown;
    listeners[0]({ type: "SCAN_FORM" }, undefined, (response) => { result = response; });

    expect(result).toEqual(expect.objectContaining({
      questions: [expect.objectContaining({ kind: "dropdown", filled: false, options: expect.arrayContaining(["Nam | 男", "Nữ | 女"]) })]
    }));
  });

  it("replaces a preselected answer when the profile has a different value", async () => {
    document.body.innerHTML = `
      <div role="listitem" data-item-id="nationality-question">
        <div role="heading">QUỐC TỊCH | 国籍 *</div>
        <div role="radio" data-value="Việt Nam | 越南" aria-checked="true">Việt Nam | 越南</div>
        <div role="radio" data-value="Khác" aria-checked="false">Khác</div>
      </div>
      <button type="button">Submit</button>
    `;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ width: 640, height: 80 } as DOMRect);
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: () => undefined });
    const vietnam = document.querySelector<HTMLElement>('[data-value^="Việt Nam"]')!;
    const other = document.querySelector<HTMLElement>('[data-value="Khác"]')!;
    other.addEventListener("click", () => {
      vietnam.setAttribute("aria-checked", "false");
      other.setAttribute("aria-checked", "true");
    });
    const profile = emptyProfile();
    profile.values.nationality = "Khác";
    const listeners: Listener[] = [];
    const sent: unknown[] = [];
    vi.stubGlobal("chrome", {
      runtime: {
        onMessage: { addListener: (listener: Listener) => listeners.push(listener) },
        sendMessage: vi.fn(async (message: { type: string }) => {
          sent.push(message);
          return message.type === "GET_PROFILE" ? profile : { ok: true };
        })
      }
    });

    await import("../src/content");
    listeners[0]({ type: "RUN_CURRENT_PAGE", mode: "test" });
    await new Promise((resolve) => window.setTimeout(resolve, 50));

    expect(other.getAttribute("aria-checked")).toBe("true");
    expect(sent).toContainEqual(expect.objectContaining({ type: "FORM_EVENT", event: expect.objectContaining({ message: expect.stringContaining("thay thế") }) }));
  });

  it("recognizes Google Forms' button-only file upload card and asks for the saved file", async () => {
    document.body.innerHTML = `
      <div role="listitem" data-item-id="identity-file-question">
        <div role="heading">ẢNH MẶT TRƯỚC GTTT CỦA THÍ SINH | 身份证件图 *</div>
        <p>Upload 1 supported file: PDF or image. Max 100 MB.</p>
        <button type="button">Add file</button>
      </div>
      <button type="button">Submit</button>
    `;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ width: 640, height: 80 } as DOMRect);
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: () => undefined });
    const listeners: Listener[] = [];
    const sent: unknown[] = [];
    vi.stubGlobal("chrome", {
      runtime: {
        onMessage: { addListener: (listener: Listener) => listeners.push(listener) },
        sendMessage: vi.fn(async (message: { type: string }) => {
          sent.push(message);
          return message.type === "GET_PROFILE" ? emptyProfile() : { ok: true };
        })
      }
    });

    await import("../src/content");
    listeners[0]({ type: "RUN_CURRENT_PAGE", mode: "test" });
    await new Promise((resolve) => window.setTimeout(resolve, 30));

    expect(sent).toContainEqual(expect.objectContaining({ type: "FORM_EVENT", event: expect.objectContaining({ type: "block", issue: expect.objectContaining({ reason: "file_upload" }) }) }));
  });

  it("keeps a file that Google Forms already shows as uploaded even when the profile has no local file", async () => {
    document.body.innerHTML = `
      <div role="listitem" data-item-id="identity-file-question">
        <div role="heading">ẢNH MẶT TRƯỚC GTTT CỦA THÍ SINH | 身份证件图 *</div>
        <p>Upload 1 supported file: PDF or image. Max 100 MB.</p>
        <button type="button">Open file</button>
        <button type="button">Remove file</button>
      </div>
      <button type="button">Submit</button>
    `;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ width: 640, height: 80 } as DOMRect);
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: () => undefined });
    const listeners: Listener[] = [];
    const sent: unknown[] = [];
    vi.stubGlobal("chrome", {
      runtime: {
        onMessage: { addListener: (listener: Listener) => listeners.push(listener) },
        sendMessage: vi.fn(async (message: { type: string }) => {
          sent.push(message);
          return message.type === "GET_PROFILE" ? emptyProfile() : { ok: true };
        })
      }
    });

    await import("../src/content");
    listeners[0]({ type: "RUN_CURRENT_PAGE", mode: "test" });
    await new Promise((resolve) => window.setTimeout(resolve, 30));

    expect(sent).not.toContainEqual(expect.objectContaining({ type: "FORM_EVENT", event: expect.objectContaining({ type: "block" }) }));
    expect(sent).toContainEqual(expect.objectContaining({ type: "FORM_EVENT", event: expect.objectContaining({ type: "ready_to_submit" }) }));
  });

  it("rejects an old upload skip hint after reload, then resumes when the current card actually has a file", async () => {
    document.body.innerHTML = `
      <div role="listitem" data-item-id="identity-file-question">
        <div role="heading">ẢNH MẶT TRƯỚC GTTT CỦA THÍ SINH | 身份证件图 *</div>
        <p>Upload 1 supported file: PDF or image. Max 100 MB.</p>
        <button type="button">Add file</button>
      </div>
      <button type="button">Next</button>
    `;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ width: 640, height: 80 } as DOMRect);
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: () => undefined });
    const next = Array.from(document.querySelectorAll<HTMLButtonElement>("button")).at(-1)!;
    next.addEventListener("click", () => document.body.innerHTML = '<button type="button">Submit</button>');
    const listeners: Listener[] = [];
    const sent: unknown[] = [];
    vi.stubGlobal("chrome", {
      runtime: {
        onMessage: { addListener: (listener: Listener) => listeners.push(listener) },
        sendMessage: vi.fn(async (message: { type: string }) => {
          sent.push(message);
          return message.type === "GET_PROFILE" ? emptyProfile() : { ok: true };
        })
      }
    });

    await import("../src/content");
    listeners[0]({ type: "RUN_CURRENT_PAGE", mode: "test" });
    await new Promise((resolve) => window.setTimeout(resolve, 30));
    expect(sent).toContainEqual(expect.objectContaining({ type: "FORM_EVENT", event: expect.objectContaining({ type: "block" }) }));

    listeners[0]({ type: "RUN_CURRENT_PAGE", mode: "test", skipQuestionId: "identity-file-question" });
    await new Promise((resolve) => window.setTimeout(resolve,30));
    expect(sent).not.toContainEqual(expect.objectContaining({type:'FORM_EVENT',event:expect.objectContaining({type:'page_advanced'})}));
    expect(next.isConnected).toBe(true);
    document.querySelector('[data-item-id="identity-file-question"]')!.insertAdjacentHTML('beforeend','<button aria-label="Remove file">×</button>');
    listeners[0]({type:'RUN_CURRENT_PAGE',mode:'test'});
    await vi.waitFor(()=>expect(sent).toContainEqual(expect.objectContaining({ type: "FORM_EVENT", event: expect.objectContaining({ type: "ready_to_submit" }) })),{timeout:2000});

    expect(sent).toContainEqual(expect.objectContaining({ type: "FORM_EVENT", event: expect.objectContaining({ type: "page_advanced" }) }));
    expect(sent).toContainEqual(expect.objectContaining({ type: "FORM_EVENT", event: expect.objectContaining({ type: "ready_to_submit" }) }));
  });

  it("fills gender, mother tongue and commitment, then advances without a manual scan", async () => {
    document.body.innerHTML = `
      <div role="listitem" data-item-id="gender-question">
        <div role="heading">GIỚI TÍNH | 性别 *</div>
        <div role="listbox">
          <div role="option" data-value="" aria-selected="true">Choose</div>
          <div role="option" data-value="Nam | 男" aria-selected="false">Nam | 男</div>
        </div>
      </div>
      <div role="listitem" data-item-id="mother-question">
        <div role="heading">TIẾNG MẸ ĐẺ | 母语 *</div>
        <div role="radio" data-value="Tiếng Việt | 越南语" aria-checked="false">Tiếng Việt | 越南语</div>
        <input type="text" aria-label="Other response" />
      </div>
      <div role="listitem" data-item-id="commitment-question">
        <div role="heading">TÔI CAM KẾT *</div>
        <div role="checkbox" aria-checked="false">Tôi xác nhận</div>
      </div>
      <button type="button">Next</button>
    `;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ width: 640, height: 80 } as DOMRect);
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: () => undefined });
    const choose = document.querySelector<HTMLElement>('[role="option"][data-value=""]')!;
    const male = document.querySelector<HTMLElement>('[data-value="Nam | 男"]')!;
    const mother = document.querySelector<HTMLElement>('[data-value="Tiếng Việt | 越南语"]')!;
    const commitment = document.querySelector<HTMLElement>('[role="checkbox"]')!;
    male.addEventListener("click", () => { choose.setAttribute("aria-selected", "false"); male.setAttribute("aria-selected", "true"); });
    mother.addEventListener("click", () => mother.setAttribute("aria-checked", "true"));
    commitment.addEventListener("click", () => commitment.setAttribute("aria-checked", "true"));
    const next = document.querySelector<HTMLButtonElement>("button")!;
    next.addEventListener("click", () => document.body.innerHTML = '<button type="button">Submit</button>');

    const profile = emptyProfile();
    profile.values.gender = "Nam";
    profile.values.motherTongue = "Tiếng Việt";
    profile.values.firstCommitment = "true";
    const listeners: Listener[] = [];
    const sent: unknown[] = [];
    vi.stubGlobal("chrome", {
      runtime: {
        onMessage: { addListener: (listener: Listener) => listeners.push(listener) },
        sendMessage: vi.fn(async (message: { type: string }) => {
          sent.push(message);
          return message.type === "GET_PROFILE" ? profile : { ok: true };
        })
      }
    });

    await import("../src/content");
    listeners[0]({ type: "RUN_CURRENT_PAGE", mode: "test" });
    await vi.waitFor(()=>expect(sent).toContainEqual(expect.objectContaining({ type: "FORM_EVENT", event: expect.objectContaining({ type: "ready_to_submit" }) })),{timeout:2000});

    expect(male.getAttribute("aria-selected")).toBe("true");
    expect(mother.getAttribute("aria-checked")).toBe("true");
    expect(commitment.getAttribute("aria-checked")).toBe("true");
    expect(sent).toContainEqual(expect.objectContaining({ type: "FORM_EVENT", event: expect.objectContaining({ type: "page_advanced" }) }));
    expect(sent).toContainEqual(expect.objectContaining({ type: "FORM_EVENT", event: expect.objectContaining({ type: "ready_to_submit" }) }));
  });

  it("does not flag an already-selected nationality as missing", async () => {
    document.body.innerHTML = `
      <div role="listitem" data-item-id="nationality-question">
        <div role="heading">QUỐC TỊCH | 国籍 *</div>
        <div role="radio" aria-label="Việt Nam | 越南" aria-checked="true"></div>
      </div>
      <button type="button">Submit</button>
    `;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ width: 640, height: 80 } as DOMRect);
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: () => undefined });
    const listeners: Listener[] = [];
    const sent: unknown[] = [];
    vi.stubGlobal("chrome", {
      runtime: {
        onMessage: { addListener: (listener: Listener) => listeners.push(listener) },
        sendMessage: vi.fn(async (message: { type: string }) => {
          sent.push(message);
          return message.type === "GET_PROFILE" ? emptyProfile() : { ok: true };
        })
      }
    });

    await import("../src/content");
    listeners[0]({ type: "RUN_CURRENT_PAGE", mode: "test" });
    await new Promise((resolve) => window.setTimeout(resolve, 30));

    expect(sent).toContainEqual(expect.objectContaining({ type: "FORM_EVENT", event: expect.objectContaining({ type: "progress", skipped: "nationality-question" }) }));
    expect(sent).toContainEqual(expect.objectContaining({ type: "FORM_EVENT", event: expect.objectContaining({ type: "ready_to_submit" }) }));
  });

  it("continues automatically after the user supplies a missing nationality", async () => {
    document.body.innerHTML = `
      <div role="listitem" data-item-id="nationality-question">
        <div role="heading">QUỐC TỊCH | 国籍 *</div>
        <div role="radio" aria-label="Việt Nam | 越南" aria-checked="false"></div>
      </div>
      <button type="button">Next</button>
    `;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ width: 640, height: 80 } as DOMRect);
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: () => undefined });
    const nationality = document.querySelector<HTMLElement>('[aria-label="Việt Nam | 越南"]')!;
    nationality.addEventListener("click", () => nationality.setAttribute("aria-checked", "true"));
    const next = document.querySelector<HTMLButtonElement>("button")!;
    let nextClicks = 0;
    next.addEventListener("click", () => {
      nextClicks += 1;
      next.textContent = "Submit";
    });

    const listeners: Listener[] = [];
    const sent: unknown[] = [];
    vi.stubGlobal("chrome", {
      runtime: {
        onMessage: { addListener: (listener: Listener) => listeners.push(listener) },
        sendMessage: vi.fn(async (message: { type: string }) => {
          sent.push(message);
          return message.type === "GET_PROFILE" ? emptyProfile() : { ok: true };
        })
      }
    });

    await import("../src/content");
    listeners[0]({ type: "RUN_CURRENT_PAGE", mode: "test" });
    await new Promise((resolve) => window.setTimeout(resolve, 30));
    expect(sent).toContainEqual(expect.objectContaining({ type: "FORM_EVENT", event: expect.objectContaining({ type: "block" }) }));

    nationality.click();
    await new Promise((resolve) => window.setTimeout(resolve, 520));
    expect(nextClicks).toBe(1);
    await vi.waitFor(()=>expect(sent).toContainEqual(expect.objectContaining({type:'FORM_EVENT',event:expect.objectContaining({type:'ready_to_submit'})})),{timeout:2000});

    expect(nextClicks).toBe(1);
    expect(sent).toContainEqual(expect.objectContaining({ type: "FORM_EVENT", event: expect.objectContaining({ type: "ready_to_submit" }) }));
  });

  it("fills a native select element with profile value and dispatches change event", async () => {
    document.body.innerHTML = `
      <div role="listitem" data-item-id="gender-select-question">
        <div role="heading">GIỚI TÍNH | 性别 *</div>
        <select>
          <option value="">-- Chọn giới tính --</option>
          <option value="Nam">Nam | 男</option>
          <option value="Nu">Nữ | 女</option>
        </select>
      </div>
      <button type="button">Submit</button>
    `;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ width: 640, height: 80 } as DOMRect);
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: () => undefined });
    const select = document.querySelector<HTMLSelectElement>("select")!;
    let changeFired = false;
    select.addEventListener("change", () => {
      changeFired = true;
    });

    const profile = emptyProfile();
    profile.values.gender = "Nam";
    const listeners: Listener[] = [];
    vi.stubGlobal("chrome", {
      runtime: {
        onMessage: { addListener: (listener: Listener) => listeners.push(listener) },
        sendMessage: vi.fn(async (message: { type: string }) => message.type === "GET_PROFILE" ? profile : { ok: true })
      }
    });

    await import("../src/content");
    listeners[0]({ type: "RUN_CURRENT_PAGE", mode: "test" });
    await new Promise((resolve) => window.setTimeout(resolve, 130));

    expect(select.value).toBe("Nam");
    expect(changeFired).toBe(true);
  });

  it("fills an ARIA combobox when its Material options are mounted outside the question card", async () => {
    document.body.innerHTML = `
      <div role="listitem" data-item-id="gender-combobox-question">
        <div role="heading">GIỚI TÍNH | 性别 *</div>
        <div role="combobox" aria-haspopup="listbox" aria-valuetext="Chọn">Chọn</div>
      </div>
      <button type="button">Submit</button>
    `;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ left: 20, top: 20, width: 640, height: 80 } as DOMRect);
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: () => undefined });

    const trigger = document.querySelector<HTMLElement>('[role="combobox"]')!;
    trigger.addEventListener("click", () => {
      if (document.getElementById("gender-popup")) return;
      const popup = document.createElement("div");
      popup.id = "gender-popup";
      popup.setAttribute("role", "listbox");
      popup.innerHTML = '<div role="option" id="gender-male" data-value="Nam | 男">Nam | 男</div>';
      document.body.appendChild(popup);
      popup.querySelector<HTMLElement>("#gender-male")!.addEventListener("click", () => {
        trigger.setAttribute("aria-valuetext", "Nam | 男");
        trigger.setAttribute("aria-activedescendant", "gender-male");
        trigger.textContent = "Nam | 男";
      });
    });

    const profile = emptyProfile();
    profile.values.gender = "Nam";
    const listeners: Listener[] = [];
    vi.stubGlobal("chrome", {
      runtime: {
        onMessage: { addListener: (listener: Listener) => listeners.push(listener) },
        sendMessage: vi.fn(async (message: { type: string }) => message.type === "GET_PROFILE" ? profile : { ok: true })
      }
    });

    await import("../src/content");
    listeners[0]({ type: "RUN_CURRENT_PAGE", mode: "test" });
    await new Promise((resolve) => window.setTimeout(resolve, 130));

    expect(trigger.getAttribute("aria-valuetext")).toBe("Nam | 男");
  });
});
