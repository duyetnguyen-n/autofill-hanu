import type { GroupView, SessionView } from '../../src/protocol';
import type { RunState } from '../../src/shared';

type Result<T> = T | Promise<T>;

// SQLite and PostgreSQL implement the same domain operations. Transactions stay
// inside the store so a submit grant is durable before it leaves the server.
export interface DataStore {
  sessions(): Result<SessionView[]>;
  session(id: string): Result<SessionView>;
  saveSession(session: SessionView): Result<void>;
  touch(id: string): Result<void>;
  connected(id: string, value: boolean): Result<void>;
  groups(): Result<GroupView[]>;
  group(id: string): Result<GroupView>;
  saveGroup(group: GroupView): Result<void>;
  saveRun(session: string, run: RunState): Result<void>;
  history(session: string): Result<RunState[]>;
  beginGroup(group: GroupView, sessions: SessionView[]): Result<void>;
  acceptProgress(id: string, run: RunState): Result<boolean>;
  blocked(session: string, form: string): Result<boolean>;
  acquireSubmit(session: string, run: string, form: string, progress?: RunState): Result<void>;
  resolve(session: string, run: string, result: 'received' | 'not_received'): Result<void>;
  saveAttachment(session: string, id: string, bytes: Buffer, hash: string): Result<void>;
  attachment(session: string, id: string): Result<{ data: Buffer; hash: string }>;
  attachmentInfo(session: string, id: string): Result<{ size: number; hash: string }>;
  audit(session: string | undefined, run: string | undefined, kind: string, message: string): Result<void>;
}
