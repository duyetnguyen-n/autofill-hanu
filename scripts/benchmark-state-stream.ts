import { performance } from 'node:perf_hooks';
import { StateStreamEncoder, StateStreamReceiver } from '../manager/state-stream';

// Synthetic dashboard payloads, not Google Forms/Render production traffic.
// Includes initial connection, 100 progress updates, one reconnect and a repeat
// notification with no changed data. Timings cover encoding, not the network.
for (const profiles of [1, 5, 20, 100]) {
  const state = {
    owner: 'fixture-owner',
    sessions: Array.from({ length: profiles }, (_, i) => ({
      id: `fixture-${i}`, name: `Profile ${i}`, connected: true,
      profile: { values: { fullName: 'Ứng viên mô phỏng', fields: 'fixture '.repeat(250) }, attachments: {} },
      run: { eventSeq: 0, status: 'running', logs: Array.from({ length: 50 }, (_, n) => ({ at: String(n), message: `Bước mô phỏng ${n}` })) }
    })),
    groups: Array.from({ length: 100 }, (_, i) => ({ id: `group-${i}`, members: stateMembers(profiles), url: 'https://docs.google.com/forms/d/e/fixture/viewform', mode: 'test' }))
  };
  const encoder = new StateStreamEncoder(); let receiver = new StateStreamReceiver<typeof state>();
  let previousBytes = 0, optimizedBytes = 0;
  const timings: number[] = [];
  for (let seq = 0; seq <= 100; seq++) {
    const run = state.sessions[seq % profiles].run;
    if (seq) { run.eventSeq++; run.logs.push({ at: String(seq + 50), message: `Tiến độ mô phỏng ${seq}` }); }
    previousBytes += Buffer.byteLength(JSON.stringify({ type: 'STATE', ...state }));
    const start = performance.now(), frame = encoder.encode(state); timings.push(performance.now() - start);
    optimizedBytes += Buffer.byteLength(frame.update!);
    if (JSON.stringify(receiver.receive(JSON.parse(frame.update!))) !== JSON.stringify(state)) throw new Error('State mismatch');
    if (seq === 50) {
      previousBytes += Buffer.byteLength(JSON.stringify({ type: 'STATE', ...state }));
      optimizedBytes += Buffer.byteLength(frame.full);
      receiver = new StateStreamReceiver<typeof state>(); receiver.receive(JSON.parse(frame.full));
    }
  }
  if (encoder.encode(state).update !== null) throw new Error('Unchanged state was retransmitted');
  timings.sort((a, b) => a - b);
  console.log(JSON.stringify({ profiles, updates: 100, reconnects: 1, previousBytes, optimizedBytes,
    reductionPercent: Number((100 * (1 - optimizedBytes / previousBytes)).toFixed(2)),
    encodeP95Ms: Number(timings[Math.floor(timings.length * 0.95)].toFixed(2)) }));
}
function stateMembers(count: number) { return Array.from({ length: count }, (_, i) => `fixture-${i}`); }
