import { assignPickerFile, type PickerUploadResult, type PickerUploadTimings } from './picker-upload';

type Payload = Parameters<typeof assignPickerFile>[0];
type Prepared = { dataUrl: string; readMs: number; encodeMs: number };
interface Scope {
  tabId: number;
  key: string;
  runId?: string;
  epoch?: string;
  pickerUrl: string;
  requestId: string;
  name: string;
  type: string;
  checkOnly?: boolean;
  assertActive(): Promise<void>;
  prepare(): Promise<Prepared>;
}
interface Job {
  key: string;
  runId?: string;
  epoch?: string;
  documentId: string;
  cancelled: boolean;
  attempted: boolean;
  error?: string;
  preparation?: Promise<{ value: Prepared } | { error: string }>;
  prepareTimer?: ReturnType<typeof setTimeout>;
  expiry: ReturnType<typeof setTimeout>;
  timing: PickerUploadTimings;
  started: number;
}

// One preparation per tab/request. Bytes stay in the worker until both the
// original Picker guard and preparation finish. Only metadata fans out.
export class StoredPickerUploads {
  private jobs = new Map<number, Job>();

  cancel(tabId: number): void {
    const job = this.jobs.get(tabId);
    if (!job) return;
    job.cancelled = true;
    job.preparation = undefined;
    clearTimeout(job.prepareTimer);
    clearTimeout(job.expiry);
    this.jobs.delete(tabId);
  }

  reconcile(tabId: number, run: { runId?: string; contentEpoch?: string; status: string; recoveryRequired?: boolean }): void {
    const job = this.jobs.get(tabId);
    if (job && (job.runId !== run.runId || job.epoch !== run.contentEpoch
      || run.status !== 'running' || run.recoveryRequired)) this.cancel(tabId);
  }

  async upload(scope: Scope): Promise<PickerUploadResult> {
    await scope.assertActive();
    let job = this.jobs.get(scope.tabId);
    if (job && job.key !== scope.key) { this.cancel(scope.tabId); job = undefined; }
    if (job?.error) return { state: 'error', error: job.error };
    const metadata: Payload = scope.checkOnly
      ? { pickerUrl: scope.pickerUrl, requestId: scope.requestId, checkOnly: true }
      : { pickerUrl: scope.pickerUrl, requestId: scope.requestId, prepareOnly: true };
    const probeStart = performance.now();
    let results: chrome.scripting.InjectionResult<PickerUploadResult>[];
    const discover = () => chrome.scripting.executeScript({
      target: { tabId: scope.tabId, allFrames: true }, func: assignPickerFile, args: [metadata]
    });
    try {
      results = await chrome.scripting.executeScript({
        target: job ? { tabId: scope.tabId, documentIds: [job.documentId] } : { tabId: scope.tabId, allFrames: true },
        func: assignPickerFile, args: [metadata]
      });
      if (job && !job.attempted && !scope.checkOnly && !results.some(r => r.result && r.result.state !== 'ignored')) results = await discover();
    } catch {
      // Normal successful upload removes the iframe. A status RPC already in
      // flight can then reject before the parent observes its committed chip.
      // Absence is not a Google upload error; let the parent's existing closed
      // Picker/chip grace period decide, without rediscovery or another file.
      if (scope.checkOnly && job?.attempted) return { state: 'waiting' };
      // A provisional Picker document can be replaced during its initial
      // navigation. Before ANY handoff, metadata may safely discover its
      // successor; cached bytes remain tied to the same frozen run/request.
      if (job && !job.attempted && !scope.checkOnly) {
        try { results = await discover(); }
        catch { return { state: 'waiting' }; }
      } else {
      if (job) return this.fail(job, 'Document Picker đã thay đổi hoặc không phản hồi. Chưa xác nhận ảnh; hãy kiểm tra form trước khi tiếp tục.');
      throw new Error('Không đọc được Google Picker. Hãy kiểm tra hộp tải tệp.');
      }
    }
    await scope.assertActive();
    if (job?.cancelled) throw new Error('Đã hủy chuẩn bị ảnh của trang cũ.');
    const matches = results.filter(result => result.result && result.result.state !== 'ignored');
    if (matches.length > 1) {
      if (job) return this.fail(job, 'Có nhiều document Picker khớp. Đã dừng để tránh gắn nhầm ảnh.');
      return { state: 'error', error: 'Có nhiều document Picker khớp. Đã dừng để tránh gắn nhầm ảnh.' };
    }
    const match = matches[0];
    if (!match && scope.checkOnly && job?.attempted) return { state: 'waiting' };
    if (!match) return job?.attempted
      ? this.fail(job, 'Document Picker không còn khớp lượt upload. Hãy kiểm tra form trước khi tiếp tục.')
      : { state: 'waiting' };
    if (job && match.documentId !== job.documentId) {
      if (job.attempted || !match.documentId) return this.fail(job, 'Document Picker không còn khớp lượt upload. Không tự tải lại ảnh.');
      job.documentId = match.documentId;
    }
    const state = match.result!;
    if (state.state === 'error') return job ? this.fail(job, state.error) : state;
    if (state.state === 'assigned') {
      if (job) this.assigned(job);
      return state;
    }
    if (scope.checkOnly) return job?.attempted
      ? this.fail(job, 'Picker không còn xác nhận lần bàn giao ảnh. Không tự tải lại; hãy đối chiếu form.')
      : state;
    if (job?.attempted) return this.fail(job, 'Lần bàn giao ảnh chưa được xác nhận. Không tự tải lại; hãy đối chiếu form.');
    if (!job) {
      if (!match.documentId) return { state: 'error', error: 'Trình duyệt không xác định được document Picker. Chưa chuyển ảnh.' };
      const entry: Job = {
        key: scope.key, runId: scope.runId, epoch: scope.epoch, documentId: match.documentId,
        cancelled: false, attempted: false,
        started: probeStart,
        timing: { readMs: 0, encodeMs: 0, probeMs: 0, handoffMs: 0, totalMs: 0 },
        expiry: setTimeout(() => { if (this.jobs.get(scope.tabId) === entry) this.cancel(scope.tabId); }, 145000)
      };
      job = entry;
      this.jobs.set(scope.tabId, job);
      job.prepareTimer = setTimeout(() => { this.fail(entry, 'Quá thời gian chuẩn bị ảnh cho Picker. Chưa tải lại ảnh.'); }, 20000);
      // Consume rejection immediately, even when this poll returns waiting.
      // Stop/navigation drops the reference and fences the eventual result.
      job.preparation = (async () => {
        await scope.assertActive();
        if (entry.cancelled) throw new Error('Đã hủy chuẩn bị ảnh.');
        const value = await scope.prepare();
        await scope.assertActive();
        if (entry.cancelled) throw new Error('Đã hủy chuẩn bị ảnh.');
        return { value };
      })().catch(error => ({ error: error instanceof Error ? error.message : String(error) }));
    }
    job.timing.probeMs += performance.now() - probeStart;
    if (state.state !== 'ready') return { state: 'waiting' };
    const prepared = await job.preparation!;
    await scope.assertActive();
    if (job.cancelled) throw new Error('Đã hủy chuẩn bị ảnh của trang cũ.');
    if (job.error) return { state: 'error', error: job.error };
    if ('error' in prepared) return this.fail(job, prepared.error);
    job.timing.readMs = prepared.value.readMs;
    job.timing.encodeMs = prepared.value.encodeMs;
    const handoffStart = performance.now();
    job.attempted = true; // A rejected injection may already have dispatched.
    try {
      const handed = await chrome.scripting.executeScript({
        target: { tabId: scope.tabId, documentIds: [job.documentId] },
        func: assignPickerFile,
        args: [{ dataUrl: prepared.value.dataUrl, name: scope.name, type: scope.type,
          pickerUrl: scope.pickerUrl, requestId: scope.requestId }]
      });
      await scope.assertActive();
      if (job.cancelled) throw new Error('Đã hủy lượt upload.');
      const result = handed.length === 1 && handed[0].documentId === job.documentId ? handed[0].result : undefined;
      job.timing.handoffMs += performance.now() - handoffStart;
      job.timing.totalMs = performance.now() - job.started;
      if (result?.state === 'assigned') {
        this.assigned(job);
        return { state: 'assigned', timing: { ...job.timing } };
      }
      // The helper returns waiting only before changing files/dispatching.
      // An input replaced between probe and handoff restarts its stable wait.
      if (result?.state === 'waiting' || result?.state === 'ready') { job.attempted = false; return { state: 'waiting' }; }
      return this.fail(job, result?.state === 'error' ? result.error : 'Không xác nhận được lần bàn giao ảnh vào đúng document Picker. Không tự tải lại.');
    } catch {
      return this.fail(job, 'Lần bàn giao ảnh bị gián đoạn. Không tự tải lại; hãy kiểm tra ảnh trên form.');
    }
  }

  private assigned(job: Job): void {
    job.attempted = true;
    job.preparation = undefined;
    clearTimeout(job.prepareTimer);
  }

  private fail(job: Job, error: string): PickerUploadResult {
    job.error = error;
    job.preparation = undefined;
    clearTimeout(job.prepareTimer);
    return { state: 'error', error };
  }
}
