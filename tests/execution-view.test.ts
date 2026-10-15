import {expect,it} from 'vitest';
import {sameExecution,type ExecutionView,type SessionView} from '../src/protocol';
import {RunBuffer} from '../manager/server/run-buffer';
const base:ExecutionView={runId:'fixture',tabId:1,mode:'test',status:'running',managed:true,tabOpen:true,active:false,message:'old',startedAt:'old',updatedAt:'old'};
it.each(Object.entries({runId:'other',tabId:2,mode:'live',status:'paused',managed:false,tabOpen:false,active:true,message:'new',startedAt:'new',updatedAt:'new'}))('persists a change to execution.%s even when updatedAt is unchanged', (key,value)=>{
 const next={...base,[key]:value};expect(sameExecution(base,next)).toBe(false);
 const s={id:'s',execution:base} as SessionView,buffer=new RunBuffer({} as any);
 buffer.begin([s],{id:'fixture',mode:'test',url:'https://docs.google.com/forms/d/e/fixture/viewform',members:['s'],paused:false,createdAt:''});
 buffer.execution('s',next);expect(buffer.overlay([s])[0].execution).toEqual(next);
});
it('treats null/undefined as no execution and ignores property order',()=>{expect(sameExecution(null,undefined)).toBe(true);expect(sameExecution(base,{...base})).toBe(true);expect(sameExecution(base,null)).toBe(false);});
