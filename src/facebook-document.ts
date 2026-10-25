import {formLink} from './registration-schedule';
const RETRY_MS=2000,MAX_ATTEMPTS=3,EXPANSION_TIMEOUT_MS=10000,SETTLE_MS=400;
export type FacebookPostState='ready'|'expanding'|'collapsed';

function hidden(element:HTMLElement){
  for(let node:HTMLElement|null=element;node;node=node.parentElement){
    if(node.hidden||node.getAttribute('aria-hidden')==='true')return true;
    const style=node.ownerDocument.defaultView!.getComputedStyle(node);
    if(style.display==='none'||style.visibility==='hidden')return true;
  }
  return false;
}
const isMore=(text:string)=>/^(?:…|\.{3})?\s*(?:see more|xem thêm|查看更多|顯示更多)(?:\s*(?:…|\.{3}))?$/i.test(text.replace(/\s+/g,' ').trim());
function clipped(element:HTMLElement){const style=element.ownerDocument.defaultView!.getComputedStyle(element);return Number.parseFloat(style.getPropertyValue('-webkit-line-clamp')||style.getPropertyValue('line-clamp'))>0||Number.isFinite(Number.parseFloat(style.maxHeight))&&[style.overflow,style.overflowY].some(value=>value==='hidden'||value==='clip');}
function moreButtons(root:HTMLElement){
  const selector='button,[role="button"],a[aria-expanded]';
  const candidates=Array.from(root.querySelectorAll<HTMLElement>(selector));
  // Some layouts put the toggle immediately after the message or a single
  // wrapper. Never search the article's reactions, comments or the whole feed.
  let node=root;
  for(let depth=0;depth<2;depth++){
    const sibling=node.nextElementSibling as HTMLElement|null;
    if(sibling){
      if(sibling.matches(selector))candidates.push(sibling);
      else if(['DIV','SPAN'].includes(sibling.tagName)&&!sibling.matches('[role=article],[role=comment],[data-ad-rendering-role=comment]')&&!sibling.querySelector('[role=article],[role=comment]')&&isMore(sibling.textContent??''))candidates.push(...sibling.querySelectorAll<HTMLElement>(selector));
    }
    const parent=node.parentElement;
    if(!parent||parent.children.length!==1||parent.getAttribute('role')==='article')break;
    node=parent;
  }
  return [...new Set(candidates)].filter(button=>button.getAttribute('aria-expanded')!=='true'&&!hidden(button)&&(isMore(button.textContent??'')||isMore(button.getAttribute('aria-label')??'')));
}

/** Per-reader budget survives React replacing the toggle or message nodes. */
export class FacebookPostPreparation {
  private opened=new WeakSet<Element>();
  private started?:number;private lastAttempt?:number;private attempts=0;
  private signature?:string;private stableSince?:number;
  private collapsedText?:string;private clamped:HTMLElement[]=[];
  prepare(document:Document,now=Date.now()):FacebookPostState{
    const root=facebookMessageRoot(document);if(!root)return this.started===undefined?'ready':now-this.started<EXPANSION_TIMEOUT_MS?'expanding':'collapsed';
    const login=document.getElementById('login_popup_cta_form'),dialog=login?.closest('[role="dialog"]');
    // Dismiss only an optional invitation beside an already loaded public post.
    if(dialog&&!dialog.contains(root)){
      const close=Array.from(dialog.querySelectorAll<HTMLElement>('button,[role="button"]')).find(e=>/^(?:close|đóng)$/i.test(e.getAttribute('aria-label')??''));
      if(close&&!this.opened.has(close)){this.opened.add(close);close.click();}
    }
    const buttons=moreButtons(root);
    if(buttons.length){
      if(this.started===undefined){this.started=now;this.collapsedText=facebookMessage(document);this.clamped=[root,...root.querySelectorAll<HTMLElement>('*')].filter(clipped);}
      this.signature=undefined;this.stableSince=undefined;
      if(now-this.started>=EXPANSION_TIMEOUT_MS)return 'collapsed';
      const button=buttons.find(b=>!b.hasAttribute('disabled')&&b.getAttribute('aria-disabled')!=='true');
      if(button&&this.attempts<MAX_ATTEMPTS&&(this.lastAttempt===undefined||now-this.lastAttempt>=RETRY_MS)){
        this.attempts++;this.lastAttempt=now;
        try{button.click();}catch{/* Retry on the next bounded attempt. */}
      }
      return 'expanding';
    }
    if(this.started!==undefined){
      // Disappearing controls alone do not prove Facebook has rendered the body.
      // Require nonempty, stable content before allowing any links through.
      const signature=facebookMessage(document);
      if(!signature?.trim())return now-this.started<EXPANSION_TIMEOUT_MS?'expanding':'collapsed';
      const confirmed=signature!==this.collapsedText||this.clamped.some(element=>root.contains(element)&&!clipped(element));
      if(!confirmed)return now-this.started<EXPANSION_TIMEOUT_MS?'expanding':'collapsed';
      if(signature!==this.signature){this.signature=signature;this.stableSince=now;return now-this.started<EXPANSION_TIMEOUT_MS?'expanding':'collapsed';}
      if(now-this.stableSince!<SETTLE_MS)return now-this.started<EXPANSION_TIMEOUT_MS?'expanding':'collapsed';
      this.started=undefined;this.lastAttempt=undefined;this.attempts=0;this.signature=undefined;this.stableSince=undefined;this.collapsedText=undefined;this.clamped=[];
    }
    return 'ready';
  }
}
const preparations=new WeakMap<Document,FacebookPostPreparation>();
/** Expand only the selected story and confirm completion before extracting. */
export function prepareFacebookPost(document:Document){
  let preparation=preparations.get(document);if(!preparation){preparation=new FacebookPostPreparation();preparations.set(document,preparation);}
  return preparation.prepare(document);
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
  const root=facebookMessageRoot(document);if(!root||hidden(root))return;let output='';
  function walk(node:Node){
    if(node.nodeType===3){output+=node.textContent??'';return;}
    if(!(node instanceof document.defaultView!.HTMLElement))return;
    const e=node as HTMLElement;if(['SCRIPT','STYLE','BUTTON'].includes(e.tagName)||e.getAttribute('role')==='button'||e.hidden||e.getAttribute('aria-hidden')==='true')return;
    const style=document.defaultView!.getComputedStyle(e);if(style.display==='none'||style.visibility==='hidden')return;
    const block=['DIV','P','BR','LI','SECTION'].includes(e.tagName);if(block)output+='\n';
    if(e.tagName==='A'){
      const url=formLink((e as HTMLAnchorElement).href);
      if(url){output+=` ${url} `;return;}
    }
    for(const child of e.childNodes)walk(child);if(block)output+='\n';
  }
  walk(root);return output.replace(/\n[ \t]*\n+/g,'\n').trim().slice(0,120000);
}
