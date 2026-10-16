import type { DataStore } from './data-store';
import { currentExecution, sameExecution, canonicalFormId, type GroupView, type SessionView, type ExecutionView } from '../../src/protocol';
import type { RunState } from '../../src/shared';
import { validCloudProgress } from '../cloud/progress';

interface Entry {
  session: SessionView;
  group: GroupView;
  halted: boolean;
  runDirty: boolean;
  executionDirty: boolean;
  resuming?: { terminal?: RunState };
  flushing?: Promise<void>;
}

// Only a durably started run may enter this cache. Intermediate progress stays
// in memory; the extension also journals it locally. Submission still crosses
// a persistence barrier and the store's transactional, fenced submit lock.
export class RunBuffer {
  private entries = new Map<string, Entry>();
  constructor(private store: DataStore) {}

  begin(sessions: SessionView[], group: GroupView) {
    const gate = structuredClone(group);
    for (const session of sessions) this.entries.set(session.id, {
      session: structuredClone(session), group: gate, halted: false, runDirty: false, executionDirty: false
    });
  }
  has(id: string) { return this.entries.has(id); }
  finished(id: string) { const run = this.entries.get(id)?.session.run; return !!run && !['running', 'submitting'].includes(run.status); }
  touch(id: string) {
    const entry = this.entries.get(id);
    if (!entry) return false;
    entry.session.lastSeen = new Date().toISOString();
    return true;
  }
  halt(id: string) { const entry = this.entries.get(id); if (entry) {entry.halted = true;entry.resuming = undefined;} }
  haltGroup(id: string) { for (const [session,entry] of this.entries) if (entry.group.id === id) this.halt(session); }
  matches(id: string, runId: string) { return this.entries.get(id)?.session.run?.runId === runId; }
  groupGate(group: GroupView) {
    for (const entry of this.entries.values()) if (entry.group.id === group.id) {
      entry.group = structuredClone(group);
      if (group.paused || group.stopped) {entry.halted = true;entry.resuming = undefined;}
    }
  }
  refresh(id: string, session: SessionView, resume = false) {
    const entry = this.entries.get(id);
    if (!entry) return;
    entry.session = structuredClone(session);
    if (resume) { entry.halted = false;entry.resuming = {};if (entry.session.run) entry.session.run.status = 'running'; }
  }
  finishResume(id: string) {
    const entry = this.entries.get(id), terminal = entry?.resuming?.terminal;
    if (entry) entry.resuming = undefined;
    return terminal;
  }
  forget(id: string) { this.entries.delete(id); }

  stage(id: string, run: RunState): boolean | undefined {
    const entry = this.entries.get(id);
    if (!entry) return undefined;
    const current = entry.session.run, group = entry.group;
    if (!validCloudProgress(run) || !current || run.runId !== current.runId || run.sessionId !== id ||
        run.eventSeq! <= (current.eventSeq ?? 0) || current.submitAttempted && !run.submitAttempted ||
        (entry.halted || group.paused) && run.status === 'running' ||
        current.formId && run.formId !== current.formId ||
        canonicalFormId(group.url) && run.formId && run.formId !== canonicalFormId(group.url)) return false;
    // RESULT can bypass an earlier queued STATE from SET_FINAL_QUESTION. While
    // Resume is in flight, defer terminal events until its sequence is known;
    // an old waiting state must not halt the newly resumed renderer.
    if (entry.resuming && !['running', 'submitting'].includes(run.status)) {
      if (run.eventSeq! > (entry.resuming.terminal?.eventSeq ?? -1)) entry.resuming.terminal = structuredClone(run);
      return false;
    }
    entry.session.run = { ...structuredClone(run), mode: current.mode, managed: true,
      url: current.url, expectedEmail: current.expectedEmail, profileRevision: current.profileRevision,
      startedAt: current.startedAt, profileSnapshot: current.profileSnapshot, finalQuestion: current.finalQuestion };
    entry.session.error = run.blockingIssue?.message ?? (run.status === 'failed' ? run.logs.at(-1)?.message : undefined);
    entry.runDirty = true;
    if (!['running', 'submitting'].includes(run.status)) entry.halted = true;
    return true;
  }
  execution(id: string, execution: ExecutionView | null, sourceRunId?:string) {
    const entry = this.entries.get(id);
    if (!entry) return false;
    if (!currentExecution(entry.session.run,execution,sourceRunId)) return false;
    if (!sameExecution(entry.session.execution,execution)) {
      entry.session.execution = structuredClone(execution);
      entry.executionDirty = true;
    }
    return true;
  }
  allowed(id: string, runId: string) {
    const entry = this.entries.get(id), run = entry?.session.run;
    return !!entry && !entry.halted && !entry.group.paused && !entry.group.stopped &&
      run?.runId === runId && run.status === 'running' && !run.submitAttempted;
  }
  checkedForm(id: string, runId: string, formId: string): boolean | undefined {
    const entry = this.entries.get(id);
    if (!entry || !canonicalFormId(entry.group.url)) return undefined;
    return this.allowed(id, runId) && entry.group.members.includes(id) &&
      entry.session.run?.formId === formId && canonicalFormId(entry.group.url) === formId;
  }
  canSubmit(id: string, runId: string) {
    const entry = this.entries.get(id), run = entry?.session.run;
    return !!entry && !entry.halted && !entry.group.paused && !entry.group.stopped &&
      run?.runId === runId && run.mode === 'live' && ['running', 'submitting'].includes(run.status);
  }
  submitSnapshot(id: string) { return structuredClone(this.entries.get(id)?.session.run); }
  submitted(id: string, seq?: number) {
    const entry = this.entries.get(id);
    if (entry?.session.run) {
      entry.session.run.submitAttempted = true; entry.session.run.status = 'submitting';
      if (seq !== undefined && (entry.session.run.eventSeq ?? 0) <= seq) entry.runDirty = false;
    }
  }
  overlay(sessions: SessionView[]) {
    return sessions.map(session => {
      const live = this.entries.get(session.id)?.session;
      // Never replace profile edits or another run with a cached snapshot.
      if (!live || live.run?.runId !== session.run?.runId) return session;
      return { ...session, run: structuredClone(live.run), execution: structuredClone(live.execution),
        error: live.error, lastSeen: live.lastSeen };
    });
  }

  async flush(id: string): Promise<void> {
    const entry = this.entries.get(id);
    if (!entry) return;
    if (entry.flushing) { await entry.flushing; return this.flush(id); }
    if (!entry.runDirty && !entry.executionDirty) return;
    const run = entry.runDirty ? structuredClone(entry.session.run) : undefined;
    const execution = entry.executionDirty ? structuredClone(entry.session.execution ?? null) : undefined;
    entry.runDirty = false; entry.executionDirty = false;
    const work = (async () => {
      if (run) await this.store.acceptProgress(id, run);
      if (execution !== undefined) {
        const session = await this.store.session(id);
        if (session.run?.runId === entry.session.run?.runId) {
          session.execution = execution;
          await this.store.saveSession(session);
        }
      }
    })();
    entry.flushing = work;
    try { await work; }
    catch(error){if(this.entries.get(id)===entry){if(run)entry.runDirty=true;if(execution!==undefined)entry.executionDirty=true;}throw error;}
    finally { entry.flushing = undefined; }
    if (entry.runDirty || entry.executionDirty) await this.flush(id);
  }
}
