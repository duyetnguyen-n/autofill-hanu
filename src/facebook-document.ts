import {formLink} from './registration-schedule';

/** Extract only Facebook's post message, not the whole feed or its comments. */
export function facebookMessage(document:Document):string|undefined {
  const candidates=Array.from(document.querySelectorAll<HTMLElement>('[data-ad-preview="message"],[data-ad-comet-preview="message"],[data-ad-rendering-role="story_message"]'));
  const dialog=document.querySelector('[role="dialog"]');
  const scoped=dialog?candidates.filter(e=>dialog.contains(e)):candidates;
  // A permalink with several unrelated stories is ambiguous; fail closed.
  const roots=scoped.filter(e=>!scoped.some(other=>other!==e&&other.contains(e)));
  if(roots.length!==1)return;
  const root=roots[0];let output='';
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
