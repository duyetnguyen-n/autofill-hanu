import {describe,it,expect} from 'vitest';
import {runElapsed} from '../src/run-presentation';

describe('elapsed time after a stopped form is reloaded or cleared',()=>{
 const start='2026-10-17T23:33:01.378Z';
 const stopped={status:'idle' as const,startedAt:start,updatedAt:'2026-10-17T23:33:52.590Z',logs:[{at:'2026-10-17T23:33:50.893Z',level:'info' as const,message:'Đã dừng.'}]};
 it('keeps the stop duration after document bookkeeping moves updatedAt an hour later',()=>{
  expect(runElapsed(stopped)).toBe('0:49');
  expect(runElapsed({...stopped,updatedAt:'2026-10-18T00:38:45.518Z'})).toBe('0:49');
 });
 it('advances running and confirming time, and supports execution snapshots without logs',()=>{
  for(const status of ['running','submitting'] as const)expect(runElapsed({...stopped,status},Date.parse(start)+65000)).toBe('1:05');
  expect(runElapsed({...stopped,logs:undefined})).toBe('0:51');
 });
 it('handles absent, invalid and backwards timestamps',()=>{
  expect(runElapsed(undefined)).toBe('⋯');
  expect(runElapsed({...stopped,startedAt:'invalid'})).toBe('⋯');
  expect(runElapsed({...stopped,startedAt:'2027-01-01'})).toBe('0:00');
 });
});
