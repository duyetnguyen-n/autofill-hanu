import { afterEach, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { access } from 'node:fs/promises';
import { chromium, type BrowserContext } from 'playwright-core';
import { LoginWindow } from '../../integrations/chinesetest/runner/login';

const windows: LoginWindow[]=[];
afterEach(async()=>{for(const window of windows.splice(0))await window.close();vi.restoreAllMocks();});
function fixture(){
 const emitter=new EventEmitter(),page={goto:vi.fn().mockResolvedValue(null)},context=Object.assign(emitter,{
  pages:()=>[page],newPage:vi.fn(),cookies:vi.fn().mockResolvedValue([]),
  close:vi.fn(async()=>{emitter.emit('close');})
 });
 const launch=vi.spyOn(chromium,'launchPersistentContext').mockResolvedValue(context as unknown as BrowserContext);
 const login=new LoginWindow();windows.push(login);return{login,context,page,launch};
}

it('returns after navigation commits and leaves Chrome open for a human to finish',async()=>{
 const f=fixture();await f.login.open();
 expect(f.page.goto).toHaveBeenCalledWith('https://www.chinesetest.cn/login?redirect=%2Fpersonal-test',{waitUntil:'commit',timeout:45000});
 expect(f.launch).toHaveBeenCalledWith(expect.any(String),expect.objectContaining({channel:'chrome',headless:false,viewport:null}));
 expect(f.login.pending).toBe(true);expect(f.context.close).not.toHaveBeenCalled();
 await expect(f.login.finish()).rejects.toThrow('Chưa đăng nhập xong');
 expect(f.login.pending).toBe(true);expect(f.context.close).not.toHaveBeenCalled();
 await expect(f.login.open()).rejects.toThrow('Một cửa sổ đăng nhập đang mở');
});

it.each([
 ['TimeoutError: page.goto: Timeout 45000ms exceeded','phản hồi chậm'],
 ['net::ERR_ABORTED; navigation interrupted by another navigation','Chưa tải được'],
 ['net::ERR_CERT_AUTHORITY_INVALID','chứng chỉ HTTPS'],
 ['net::ERR_NAME_NOT_RESOLVED','Chưa tải được']
])('keeps the same window and profile after a navigation error: %s',async(error,reason)=>{
 const f=fixture();f.page.goto.mockRejectedValue(new Error(error));
 await expect(f.login.open()).rejects.toThrow(reason);
 expect(f.login.pending).toBe(true);expect(f.context.close).not.toHaveBeenCalled();
 await expect(access(f.launch.mock.calls[0][0] as string)).resolves.toBeUndefined();
 await f.login.close();expect(f.context.close).toHaveBeenCalledTimes(1);expect(f.login.pending).toBe(false);
 await expect(access(f.launch.mock.calls[0][0] as string)).rejects.toThrow();
});

it.each([
 ['macOS: Chromium distribution chrome is not found; executable does not exist','Không tìm thấy Google Chrome'],
 ['Windows: ENOENT C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe','Không tìm thấy Google Chrome'],
 ['browserType.launchPersistentContext: Timeout 45000ms exceeded','chưa khởi động xong'],
 ['EACCES; process launch blocked by operating system','Không khởi động được Chrome']
])('distinguishes startup failure and cleans the temporary profile: %s',async(error,reason)=>{
 const f=fixture();f.launch.mockRejectedValue(new Error(error));
 await expect(f.login.open()).rejects.toThrow(reason);expect(f.login.pending).toBe(false);
 expect(f.page.goto).not.toHaveBeenCalled();
 await expect(access(f.launch.mock.calls[0][0] as string)).rejects.toThrow();
 f.launch.mockResolvedValue(f.context as unknown as BrowserContext);await f.login.open();expect(f.login.pending).toBe(true);
});

it('allows another login after the user closes Chrome without pressing Cancel',async()=>{
 const f=fixture();await f.login.open();f.context.emit('close');expect(f.login.pending).toBe(false);
 await f.login.open();expect(f.login.pending).toBe(true);expect(f.launch).toHaveBeenCalledTimes(2);
});

it('does not reopen a window after cancellation while Chrome is still launching',async()=>{
 const f=fixture();let complete!:(value:BrowserContext)=>void;
 f.launch.mockImplementationOnce(()=>new Promise(resolve=>{complete=resolve;}));
 const opening=f.login.open();const cancelled=expect(opening).rejects.toThrow('Đã hủy');
 await vi.waitFor(()=>expect(f.launch).toHaveBeenCalledTimes(1));
 const profile=f.launch.mock.calls[0][0] as string;
 await f.login.close();complete(f.context as unknown as BrowserContext);await cancelled;
 expect(f.context.close).toHaveBeenCalledTimes(1);expect(f.login.pending).toBe(false);
 expect(f.page.goto).not.toHaveBeenCalled();await expect(access(profile)).rejects.toThrow();
});
