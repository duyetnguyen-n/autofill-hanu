export interface DirectInspection {
  url: string;
  action: string;
  script: string;
  sessionFields: string[];
  currentPageHistory?: string;
  hasUpload: boolean;
  diagnostics?: {history:string;partialSlots:string[];rows:{id:number|null;shape:string[];values:number|null;valueTypes:string[];filesShape:unknown}[];fileFields:{name:string;format:string;count:number;shape:unknown;matchesPartial?:boolean}[]};
}

// Serialized by chrome.scripting. Read-only and self-contained: never changes
// form controls, exports token values, uploads files or submits a response.
export function inspectDirectForm(): DirectInspection {
  if (location.origin !== 'https://docs.google.com' || !/^\/forms\/(?:u\/\d+\/)?d\/e\/[^/]+\/(?:viewform|formResponse)$/.test(location.pathname)) throw new Error('Mở Google Form trong đúng Chrome profile trước.');
  const form = document.querySelector<HTMLFormElement>('form[action*="/formResponse"]');
  const script = [...document.scripts].find(s => /^\s*(?:var\s+)?FB_PUBLIC_LOAD_DATA_\s*=/.test(s.textContent ?? ''))?.textContent;
  if (!form || !script) throw new Error('Không đọc được form. Kiểm tra đăng nhập, form đóng hoặc trang CAPTCHA.');
  const action = new URL(form.action);
  const canonicalPath = (path:string) => path.replace(/^\/forms\/u\/\d+\//,'/forms/').replace(/\/(?:viewform|formResponse)$/,'');
  if (action.origin !== location.origin || canonicalPath(action.pathname) !== canonicalPath(location.pathname)) throw new Error('Đích gửi không khớp form đang mở.');
  const sessionFields = [...form.querySelectorAll<HTMLInputElement>('input[type="hidden"][name]')].map(i => i.name);
  const history = form.querySelector<HTMLInputElement>('input[name="pageHistory"]')?.value;
  let partialSlots:string[]=[],rows:{id:number|null;shape:string[];values:number|null;valueTypes:string[];filesShape:unknown}[]=[],fileRowValue:unknown;
  const shape=(v:any):unknown=>Array.isArray(v)?v.map(shape):v===null?'null':typeof v==='object'?Object.fromEntries(Object.entries(v).map(([k,value])=>[k,shape(value)])):typeof v;
  try{
    const partial=JSON.parse(form.querySelector<HTMLInputElement>('input[name="partialResponse"]')?.value??'null');
    if(Array.isArray(partial)){
      partialSlots=partial.map(v=>Array.isArray(v)?'array':v===null?'null':typeof v);
      if(Array.isArray(partial[0])){
        fileRowValue=partial[0].find((r:any)=>r?.[1]===1365092776)?.[4];
        rows=partial[0].map((row:any)=>({id:Number.isSafeInteger(row?.[1])?row[1]:null,shape:Array.isArray(row)?row.map(v=>Array.isArray(v)?'array':v===null?'null':typeof v):[],values:Array.isArray(row?.[2])?row[2].length:null,valueTypes:Array.isArray(row?.[2])?row[2].map((v:any)=>Array.isArray(v)?'array':typeof v):[],filesShape:row?.[4]?shape(row[4]):null}));
      }
    }
  }catch{}
  const fileFields:{name:string;format:string;count:number;shape:unknown;matchesPartial?:boolean}[]=[];
  for(const input of form.querySelectorAll<HTMLInputElement>('input[name="fuIds"],input[name="entry.1365092776"]')){
    try{const value=JSON.parse(input.value);fileFields.push({name:input.name,format:Array.isArray(value)?'array':typeof value,count:Array.isArray(value)?value.length:0,shape:shape(value),matchesPartial:input.name==='entry.1365092776'&&fileRowValue!==undefined?JSON.stringify(value)===JSON.stringify(fileRowValue):undefined});}
    catch{fileFields.push({name:input.name,format:input.value?'string':'empty',count:input.value?1:0,shape:'string'});}
  }
  return {url:location.href, action:action.href, script, sessionFields,
    currentPageHistory:history && /^\d+(?:,\d+)*$/.test(history) ? history : undefined,
    hasUpload:/,13,\[/.test(script),diagnostics:{history:history&&/^\d+(?:,\d+)*$/.test(history)?history:'unknown',partialSlots,rows,fileFields}};
}
