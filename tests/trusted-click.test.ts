import {afterEach,expect,it,vi} from 'vitest';
afterEach(()=>{vi.unstubAllGlobals();vi.resetModules();});
async function fixture(failure?:'attach'|'mousePressed'|'mouseReleased'){
  let listener:any;
  const sendCommand=vi.fn(async(_target:unknown,_method:string,p:any)=>{if(p.type===failure)throw new Error('Fixture transport error');});
  vi.stubGlobal('chrome',{
    action:{onClicked:{addListener:vi.fn()}},
    tabs:{onUpdated:{addListener:vi.fn()},onRemoved:{addListener:vi.fn()}},
    runtime:{onMessage:{addListener:(fn:any)=>listener=fn},sendMessage:vi.fn()},
    storage:{local:{get:vi.fn(async()=>({})),set:vi.fn()}},
    debugger:{attach:vi.fn(async()=>{if(failure==='attach')throw new Error('Unavailable');}),sendCommand,detach:vi.fn(async()=>{})}
  });
  await import('../src/background');
  const reply=await new Promise<any>(resolve=>listener({type:'TRUSTED_CLICK',x:30,y:40},{tab:{id:7,url:'https://docs.google.com/forms/d/e/test/viewform'}},resolve));
  return {reply,sendCommand};
}
it('permits the DOM fallback only when browser input could not start',async()=>{const f=await fixture('attach');expect(f.reply).toMatchObject({dispatched:false});expect(f.sendCommand).not.toHaveBeenCalled();});
it.each(['mousePressed','mouseReleased'] as const)('prevents a duplicate fallback after an uncertain %s',async failure=>{const f=await fixture(failure);expect(f.reply).toMatchObject({dispatched:true});});
it('dispatches a complete browser click',async()=>{const f=await fixture();expect(f.reply).toMatchObject({dispatched:true});expect(f.sendCommand.mock.calls.map(c=>c[2].type)).toEqual(['mouseMoved','mousePressed','mouseReleased']);});
