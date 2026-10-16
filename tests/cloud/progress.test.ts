import {expect,it} from 'vitest';
import {validCloudProgress} from '../../manager/cloud/progress';
import type {RunState} from '../../src/shared';
const run:RunState={tabId:1,formId:'fixture',status:'waiting_manual',mode:'test',eventSeq:1,filled:[],skipped:[],logs:[],submitAttempted:false,updatedAt:''};
it('accepts bounded recovery checkpoints and rejects malformed or oversized extensions',()=>{
 expect(validCloudProgress({...run,recovery:{reason:'server_error',attempt:4,automatic:false},corrections:{phone:{label:'Phone',kind:'text',values:['0900000000']}}})).toBe(true);
 for(const patch of [{recovery:{reason:'captcha',attempt:1,automatic:true}},{recovery:{reason:'network',attempt:100,automatic:true}},{recovery:{reason:'network',attempt:1,automatic:true,retryAt:'tomorrow'}},{activity:{phase:'unknown',message:'x',at:''}},{corrections:{x:{label:'Photo',kind:'file',values:['x']}}}])expect(validCloudProgress({...run,...patch} as any)).toBe(false);
});
