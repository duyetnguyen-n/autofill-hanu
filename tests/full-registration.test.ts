// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { emptyProfile } from '../src/rules';
import type { ExtensionMessage } from '../src/shared';
let listener: (message: ExtensionMessage) => void;
afterEach(() => {
  listener?.({type:'HALT_RUN'}); vi.useRealTimers();
  vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.resetModules(); document.body.replaceChildren();
});

it('fills every registration page from blank, waits for upload, clears, and repeats with the same saved profile', async () => {
  vi.useFakeTimers();
  vi.spyOn(HTMLElement.prototype,'getBoundingClientRect').mockReturnValue({width:100,height:40} as DOMRect);
  Object.defineProperty(HTMLElement.prototype,'scrollIntoView',{configurable:true,value:()=>{}});
  const profile=emptyProfile();
  Object.assign(profile.values,{
    recordGoogleEmail:'true',firstCommitment:'true',termsCommitment:'true',fullName:'NGUYEN TEST AUTOFILL',
    identityType:'CCCD',identityNumber:'000000000000',phone:'0900000000',birthDate:'2000-01-02',
    email:'hanu.test@gmail.com',gender:'Nam',nationality:'Việt Nam',motherTongue:'Tiếng Việt',
    chineseStudyDuration:'1 năm',paymentMethod:'CHUYỂN KHOẢN TẠI NGÂN HÀNG',
    bankAccountNumber:'0000000000',bankAccountHolder:'NGUYEN TEST AUTOFILL',bankName:'MB Bank'
  });
  profile.attachments.identityDocument={id:'fixture',name:'upload-fixture.png',type:'image/png',size:68,updatedAt:''};
  const card=(label:string,control:string)=>`<div role="listitem"><div role="heading">${label} *</div>${control}</div>`;
  const text=(label:string,key:string)=>card(label,`<input type="text" data-key="${key}">`);
  const select=(label:string,key:string,values:string[])=>card(label,`<select data-key="${key}"><option value="">Chọn</option>${values.map(v=>`<option>${v}</option>`).join('')}</select>`);
  const check=(label:string,key:string)=>card(label,`<input type="checkbox" data-key="${key}">`);
  const radio=(label:string,key:string,value:string)=>card(label,`<input type="radio" data-key="${key}" value="${value}" aria-label="${value}"><input type="text" aria-label="Other">`);
  const pages=[
    '<div role="checkbox" aria-checked="false" aria-label="Lưu lại other.account@gmail.com dưới dạng email để thêm vào câu trả lời của tôi" data-key="recordGoogleEmail"></div>',
    check('TÔI CAM KẾT 本人保证','firstCommitment'),
    text('-. .- -- .','fullName')+select('LOẠI GIẤY TỜ TÙY THÂN | 证件类型','identityType',['CCCD | 身份证','HỘ CHIẾU | 护照']),
    text('.. -.. -. ..- --','identityNumber'),
    card('ẢNH MẶT TRƯỚC GTTT CỦA THÍ SINH | 身份证件图','<span id="file-status">Tải 1 tệp lên</span>')+
      text('.--. .... --- -. . -. ..- --','phone')+text('-... .. .-. - .... -.. .- - .','birthDate')+
      text('EMAIL | 邮箱','email')+radio('QUỐC TỊCH | 国籍','nationality','Việt Nam | 越南')+
      radio('TIẾNG MẸ ĐẺ | 母语','motherTongue','Tiếng Việt | 越南语')+
      select('GIỚI TÍNH | 性别','gender',['Nam | 男','Nữ | 女'])+
      select('THỜI GIAN HỌC TIẾNG TRUNG | 学习中文年限','chineseStudyDuration',['Dưới 6 tháng | 6个月以下','1 năm | 1年']),
    select('PHƯƠNG THỨC CHUYỂN KHOẢN | 缴费方式','paymentMethod',['E-BANKING','CHUYỂN KHOẢN TẠI NGÂN HÀNG | 银行柜台转账'])+
      text('SỐ TÀI KHOẢN | 银行账号','bankAccountNumber')+text('CHỦ TÀI KHOẢN | 开户人','bankAccountHolder')+
      select('TÊN NGÂN HÀNG | 银行名称','bankName',['Vietcombank','MB Bank'])+
      check('Tôi đã đọc và đồng ý với những điều khoản trên và sẽ chịu trách nhiệm với thông tin dự thi của mình.','termsCommitment'),
    card('Năm nay là năm bao nhiêu? 今年是哪一年？','<input type="text" id="year">')
  ];
  const sent:ExtensionMessage[]=[];
  const submit=vi.fn();
  let page=0;
  let uploaded=false;
  let uploadRequests=0;
  const answers:Record<string,string>[]=[];
  const mount=()=>{
    document.body.innerHTML=pages[page]+`<button>${page===pages.length-1?'Submit':'Next'}</button>`;
    const record=document.querySelector<HTMLElement>('[role="checkbox"]');
    record?.addEventListener('click',()=>record.setAttribute('aria-checked','true'));
    if(page===4){
      window.setTimeout(()=>{
        const status=document.querySelector('#file-status')!;
        const button=document.createElement('button'); button.textContent='Thêm tệp'; status.after(button);
        button.addEventListener('click',()=>{
          const frame=document.createElement('iframe');
          frame.src='https://docs.google.com/picker?hostId=file-upload&rpcService=test&rpctoken=token';
          document.body.append(frame);
        });
      },600);
    }
    document.querySelector('body > button')!.addEventListener('click',()=>{
      if(page===pages.length-1){submit();return;}
      const captured:Record<string,string>={};
      document.querySelectorAll<HTMLElement>('[data-key]').forEach(el=>{
        const key=el.dataset.key!;
        captured[key]=el.getAttribute('role')==='checkbox'?el.getAttribute('aria-checked')!:
          el instanceof HTMLInputElement && el.type==='checkbox'?String(el.checked):
          el instanceof HTMLInputElement && el.type==='radio'?(el.checked?el.value:''):
          (el as HTMLInputElement|HTMLSelectElement).value;
      });
      if(page===4){expect(uploaded).toBe(true);expect(document.querySelector('iframe')).toBeNull();}
      answers.push(captured); page++; mount();
    });
  };
  vi.stubGlobal('chrome',{runtime:{onMessage:{addListener:(fn:typeof listener)=>listener=fn},sendMessage:async(message:ExtensionMessage)=>{
    sent.push(message);
    if(message.type==='TRUSTED_CLICK')return {dispatched:false};
    if(message.type==='GET_PROFILE')return profile;
    if(message.type==='UPLOAD_STORED_FILE'){
      if(message.checkOnly)return {state:'assigned'};
      uploadRequests++;
      window.setTimeout(()=>{
        uploaded=true; document.querySelector('iframe')!.remove();
        document.querySelector('#file-status')!.insertAdjacentHTML('afterend','<span>upload-fixture.png</span><button aria-label="Xóa tệp">×</button>');
      },800);
      return {state:'assigned'};
    }
  }}});
  for(let cycle=0;cycle<2;cycle++){
    page=0;uploaded=false;answers.length=0;sent.length=0;mount();
    vi.resetModules();await import('../src/content');listener({type:'RUN_CURRENT_PAGE',mode:'test'});
    await vi.advanceTimersByTimeAsync(9000);
    expect(page).toBe(6);
    expect(document.querySelector<HTMLInputElement>('#year')!.value).toBe('');
    expect(sent).toContainEqual(expect.objectContaining({type:'FORM_EVENT',event:expect.objectContaining({type:'block',issue:expect.objectContaining({reason:'verification'})})}));
    const actual=Object.assign({},...answers);
    for(const [key,value] of Object.entries(profile.values).filter(([key,value])=>value && !['chineseName','passportNumber'].includes(key))){
      expect(actual[key]?.split('|')[0].trim(),key).toBe(value);
    }
    // Simulate the human-only verification on the local fixture. The extension
    // must then reach ready_to_submit; it must never click Submit in Test mode.
    const year=document.querySelector<HTMLInputElement>('#year')!;
    year.value='2026';year.dispatchEvent(new Event('input',{bubbles:true}));
    await vi.advanceTimersByTimeAsync(500);
    expect(sent).not.toContainEqual({type:'FORM_EVENT',event:{type:'ready_to_submit'}});
    listener({type:'RUN_CURRENT_PAGE',mode:'test'});
    await vi.advanceTimersByTimeAsync(500);
    expect(sent).toContainEqual({type:'FORM_EVENT',event:{type:'ready_to_submit'}});
    listener({type:'HALT_RUN'});
  }
  expect(uploadRequests).toBe(2);expect(submit).not.toHaveBeenCalled();
});
