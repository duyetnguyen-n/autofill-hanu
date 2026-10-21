// Dashboard transport only. Commands, extension messages and submit locks do
// not pass through this stream. Each connection starts with a full snapshot.
type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type Path = (string | number)[];
type Change = { path: Path; value: Json } | { path: Path; remove: true } | { path: Path; append: Json[] };
const object = (v: Json): v is { [key: string]: Json } => v !== null && typeof v === 'object' && !Array.isArray(v);
const equal = (a: Json, b: Json) => a === b || JSON.stringify(a) === JSON.stringify(b);

function diff(before: Json, after: Json, path: Path, changes: Change[]) {
  if (before === after) return;
  if (Array.isArray(before) && Array.isArray(after)) {
    // Logs/filled fields usually grow by a few entries. Do not retransmit their
    // entire prefix; truncation/reordering is still handled as replacement.
    if (after.length > before.length && before.every((v, i) => equal(v, after[i]))) {
      changes.push({ path, append: after.slice(before.length) });
    } else if (before.length === after.length) {
      for (let i = 0; i < after.length; i++) diff(before[i], after[i], [...path, i], changes);
    } else if (!equal(before, after)) changes.push({ path, value: after });
  } else if (object(before) && object(after)) {
    for (const key of Object.keys(before)) if (!Object.hasOwn(after, key)) changes.push({ path: [...path, key], remove: true });
    for (const key of Object.keys(after)) {
      if (!Object.hasOwn(before, key)) changes.push({ path: [...path, key], value: after[key] });
      else diff(before[key], after[key], [...path, key], changes);
    }
  } else if (!equal(before, after)) changes.push({ path, value: after });
}

export class StateStreamEncoder {
  private previous?: Json;
  private serialized?: string;
  private revision = 0;
  private full = '';

  encode(state: object) {
    // Normalize undefined/optional fields exactly as the JSON wire format does.
    // One diff per account/broadcast, shared by all its dashboard connections.
    const serialized = JSON.stringify(state);
    const baseRevision = this.revision;
    if (serialized === this.serialized) return { full: this.full, update: null, revision: this.revision, baseRevision };
    const next = JSON.parse(serialized) as Json;
    const changes: Change[] = [];
    if (this.previous) diff(this.previous, next, [], changes);
    if (this.previous && !changes.length) return { full: this.full, update: null, revision: this.revision, baseRevision };
    this.revision++;
    this.full = JSON.stringify({ ...state, type: 'STATE', streamVersion: 1, revision: this.revision });
    const patch = JSON.stringify({ type: 'STATE_PATCH', streamVersion: 1, baseRevision, revision: this.revision, changes });
    const update = this.previous && patch.length < this.full.length ? patch : this.full;
    this.previous = next;
    this.serialized = serialized;
    return { full: this.full, update, revision: this.revision, baseRevision };
  }
}

function apply(value: Json, change: Change, depth = 0): Json {
  if (depth === change.path.length) {
    if ('value' in change) return change.value;
    if ('append' in change && Array.isArray(value)) return [...value, ...change.append];
    throw new Error('Invalid dashboard patch');
  }
  if (!value || typeof value !== 'object') throw new Error('Invalid dashboard path');
  const key = change.path[depth];
  if (Array.isArray(value) && (!Number.isSafeInteger(key) || Number(key) < 0 || Number(key) >= value.length)) throw new Error('Invalid dashboard index');
  const copy: any = Array.isArray(value) ? [...value] : { ...value };
  if (depth === change.path.length - 1 && 'remove' in change) delete copy[key];
  else {
    if (depth < change.path.length - 1 && !Object.hasOwn(value, key)) throw new Error('Missing dashboard path');
    // Define an own property so even a user field named __proto__ cannot invoke
    // a prototype setter. Intermediate paths must already exist as own keys.
    Object.defineProperty(copy, key, { value: apply(copy[key], change, depth + 1), writable: true, enumerable: true, configurable: true });
  }
  return copy;
}

export class StateStreamReceiver<T extends object> {
  private state?: T;
  private revision?: number;

  receive(message: any): T {
    if (message.type === 'STATE') {
      const { type, streamVersion, revision, ...state } = message;
      this.state = state as T;
      this.revision = streamVersion === 1 ? revision : undefined;
    } else {
      if (message.type !== 'STATE_PATCH' || message.streamVersion !== 1 || !this.state ||
          this.revision === undefined || message.baseRevision !== this.revision || message.revision !== this.revision + 1 || !Array.isArray(message.changes)) {
        throw new Error('Dashboard needs a fresh snapshot');
      }
      // Apply atomically. Never expose a partial update or mutate React's
      // previous state; a rejected patch causes a reconnect/full snapshot.
      let next = this.state as Json;
      for (const change of message.changes as Change[]) next = apply(next, change);
      this.state = next as T;
      this.revision = message.revision;
    }
    return this.state;
  }
}
