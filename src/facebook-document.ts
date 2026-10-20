import {formLink} from './registration-schedule';
const opened=new WeakSet<Element>();

/** Expand the selected public story; dismiss only its optional login invitation. */
export function prepareFacebookPost(document:Document){
  const root=facebookMessageRoot(document);if(!root)return;
  for(const button of root.querySelectorAll<HTMLElement>('button,[role="button"]')){
    if(/^(?:see more|xem thêm|查看更多|顯示更多)$/i.test((button.textContent??'').trim())&&!opened.has(button)){opened.add(button);button.click();}
  }
  const login=document.getElementById('login_popup_cta_form'),dialog=login?.closest('[role="dialog"]');
  // The invitation has a normal Close button and a separate, already loaded
  // public story. A login page/checkpoint without that story is left intact.
  if(dialog&&!dialog.contains(root)){
    const close=Array.from(dialog.querySelectorAll<HTMLElement>('button,[role="button"]')).find(e=>/^(?:close|đóng)$/i.test(e.getAttribute('aria-label')??''));
    if(close&&!opened.has(close)){opened.add(close);close.click();}
  }
}

/** Extract only Facebook's post message, not the whole feed or its comments. */
export function facebookMessageRoot(document:Document):HTMLElement|undefined {
  const candidates=Array.from(document.querySelectorAll<HTMLElement>('[data-ad-preview="message"],[data-ad-comet-preview="message"],[data-ad-rendering-role="story_message"]'));
  const dialogs=Array.from(document.querySelectorAll('[role="dialog"]')).filter(d=>candidates.some(e=>d.contains(e)));
  const scoped=dialogs.length?candidates.filter(e=>dialogs.some(d=>d.contains(e))):candidates;
  // A permalink with several unrelated stories is ambiguous; fail closed.
  const roots=scoped.filter(e=>!scoped.some(other=>other!==e&&other.contains(e)));
  if(roots.length!==1)return;
  return roots[0];
}
export function facebookMessage(document:Document):string|undefined {
  const root=facebookMessageRoot(document);if(!root)return;let output='';
  function walk(node:Node){
    if(node.nodeType===3){output+=node.textContent??'';return;}
    if(!(node instanceof document.defaultView!.HTMLElement))return;
    const e=node as HTMLElement;if(['SCRIPT','STYLE','BUTTON'].includes(e.tagName)||e.getAttribute('aria-hidden')==='true')return;
    const block=['DIV','P','BR','LI','SECTION'].includes(e.tagName);if(block)output+='\n';
    if(e.tagName==='A'){
      const url=formLink((e as HTMLAnchorElement).href);
      if(url){output+=` ${url} `;return;}
    }
    for(const child of e.childNodes)walk(child);if(block)output+='\n';
  }
  walk(root);return output.replace(/\n[ \t]*\n+/g,'\n').trim().slice(0,120000);
}
