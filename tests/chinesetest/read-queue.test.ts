import { expect,it } from "vitest";
import { ReadQueue } from "../../integrations/chinesetest/ui/read-queue";
it("bounds pending relay reads to two and releases the next read even after a failure",async()=>{
 const q=new ReadQueue(),gates:Array<()=>void>=[];let active=0,peak=0;
 const work=Array.from({length:6},(_,i)=>q.run(async()=>{active++;peak=Math.max(peak,active);try{await new Promise<void>(r=>gates.push(r));if(i===0)throw new Error("synthetic read error");return i;}finally{active--;}}));
 const settled=Promise.allSettled(work);expect(active).toBe(2);
 for(let i=0;i<6;i++){while(!gates.length)await Promise.resolve();gates.shift()!();await Promise.resolve();await Promise.resolve();}
 expect((await settled).filter(r=>r.status==="fulfilled")).toHaveLength(5);expect(peak).toBe(2);expect(active).toBe(0);
});
