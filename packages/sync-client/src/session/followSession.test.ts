import { expect, it } from 'vitest';
import type { SessionMessageV1 } from '@happier-dev/protocol';
import { followSession, type FollowedSessionEvent } from './followSession.js';

const row = (seq: number, updatedAt = 1): SessionMessageV1 => ({ id: `m${seq}`, seq, localId: null, content: { t: 'plain', v: { seq, updatedAt } }, createdAt: 1, updatedAt });
function connection() {
  const listeners = new Map<string, (data: unknown) => void>();
  let connected: (() => void) | undefined;
  return {
    on: (event: string, listener: (data: unknown) => void) => { listeners.set(event, listener); return () => { listeners.delete(event); }; },
    onConnected: (listener: () => void) => { connected = listener; return () => { connected = undefined; }; },
    update: (kind: string, message: SessionMessageV1) => listeners.get('update')?.({ id: `u${message.seq}`, seq: 1, createdAt: 1, body: { t: kind, delivery: 'full', sid: 's', message } }),
    sessionUpdate: (body: unknown) => listeners.get('update')?.({ id: 'state', seq: 1, createdAt: 1, body }),
    ephemeral: (data: unknown) => listeners.get('ephemeral')?.(data),
    connect: () => connected?.(),
  };
}
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
it('refuses a hint on a full-only follower without advancing its materialized sequence', async () => {
  const wire = connection();
  const stop = new AbortController();
  const errors: unknown[] = [];
  const events: FollowedSessionEvent[] = [];
  const follower = followSession({ connection: wire, sessionId: 's', afterSeq: 0, content: { mode: 'plain' }, signal: stop.signal,
    fetchPage: async () => ({ messages: [] }), onEvent: (event) => events.push(event), onError: (error) => errors.push(error) });
  await tick();
  wire.sessionUpdate({ t: 'message-updated', sid: 's', delivery: 'hint', message: { id: 'm', seq: 4, localId: null,
    createdAt: 1, updatedAt: 1, attentionImpact: { affectsUnread: true, affectsMeaningfulActivity: true } } });
  await tick();
  expect(errors).toHaveLength(1);
  expect(errors[0]).toMatchObject({ message: 'Session follower requires full message delivery' });
  expect(follower.lastSeq()).toBe(0);
  expect(events.filter(event => event.kind === 'message-updated')).toEqual([]);
  stop.abort();
});
it('ignores malformed updates explicitly addressed to another Session and keeps following its own', async () => {
  const wire = connection();
  const stop = new AbortController();
  const events: FollowedSessionEvent[] = [];
  const errors: unknown[] = [];
  const follower = followSession({ connection: wire, sessionId: 's', afterSeq: 0, content: { mode: 'plain' }, signal: stop.signal,
    fetchPage: async () => ({ messages: [] }), onEvent: (event) => events.push(event), onError: (error) => errors.push(error) });
  await tick();
  wire.sessionUpdate({ t: 'new-message', delivery: 'full' as const, sid: 'other', message: { content: 'bad' } });
  wire.sessionUpdate({ t: 'update-session', id: 'other', agentState: { version: 'bad' } });
  wire.ephemeral({ type: 'transcript-stream-segment', sessionId: 'other', message: { content: 'bad' } });
  wire.update('new-message', row(1));
  await tick();
  expect(errors).toEqual([]);
  expect(follower.lastSeq()).toBe(1);
  expect(events.at(-1)).toMatchObject({ kind: 'messages', messages: [{ id: 'm1' }] });
  wire.sessionUpdate({ t: 'new-message', delivery: 'full' as const, sid: 's', message: { content: 'bad' } });
  expect(errors).toHaveLength(1);
  stop.abort();
});
it('attaches before history, coalesces drains, and reconciles revisions at unchanged seq', async () => {
  const wire = connection();
  const stop = new AbortController();
  const emitted: Array<{ kind: string; messages?: readonly SessionMessageV1[]; message?: SessionMessageV1 }> = [];
  const errors: unknown[] = [];
  let release: (() => void) | undefined;
  let calls = 0;
  let revision = 1;
  const follower = followSession({ connection: wire, sessionId: 's', afterSeq: 0, content: { mode: 'plain' }, signal: stop.signal,
    fetchPage: async (after: number) => {
      calls++;
      if (calls === 1) await new Promise<void>((resolve) => { release = resolve; });
      return { messages: [row(1, revision), row(2), row(3)].filter((message) => message.seq > after), nextAfterSeq: null };
    }, onEvent: (event: typeof emitted[number]) => emitted.push(event), onError: (error: unknown) => errors.push(error),
  });
  wire.connect();
  wire.update('new-message', row(2));
  wire.connect();
  wire.connect();
  release?.();
  await tick();
  expect(emitted.flatMap((event) => event.messages?.map((message) => message.seq) ?? [])).toEqual([1, 2, 3]);
  expect(calls).toBe(2);
  expect(follower.lastSeq()).toBe(3);
  revision = 2;
  await follower.repair([{ messageId: 'm1', seq: 1 }]);
  expect(emitted.at(-1)).toMatchObject({ kind: 'message-updated', message: { id: 'm1', seq: 1, updatedAt: 2 } });
  expect(follower.lastSeq()).toBe(3);
  expect(errors).toEqual([]);
  stop.abort();
  wire.update('new-message', row(4));
  await tick();
  expect(follower.lastSeq()).toBe(3);
});
it('opens locked rows as data and repairs a live gap through durable pages', async () => {
  const wire = connection();
  const stop = new AbortController();
  const events: unknown[] = [];
  const rows: SessionMessageV1[] = [];
  const follower = followSession({ connection: wire, sessionId: 's', afterSeq: 0, content: { mode: 'e2ee', encryption: null }, signal: stop.signal,
    fetchPage: async (after: number) => ({ messages: rows.filter((message) => message.seq > after), nextAfterSeq: null }),
    onEvent: (event: unknown) => events.push(event), onError: (error: unknown) => { throw error; },
  });
  await tick();
  rows.push({ ...row(1), content: { t: 'encrypted', c: 'sealed' } }, { ...row(2), content: { t: 'encrypted', c: 'sealed' } });
  wire.update('new-message', rows[1]);
  await tick();
  expect(follower.lastSeq()).toBe(2);
  expect(events.at(-1)).toMatchObject({ kind: 'messages', messages: [{ seq: 1, opened: { status: 'locked' } }, { seq: 2, opened: { status: 'locked' } }] });
  stop.abort();
});
it('reconciles a live gap against authoritative sparse history without inventing missing rows', async () => {
  const wire = connection();
  const stop = new AbortController();
  const events: Array<{ kind: string; messages?: readonly SessionMessageV1[] }> = [];
  const errors: unknown[] = [];
  let calls = 0;
  const follower = followSession({ connection: wire, sessionId: 's', afterSeq: 0, content: { mode: 'plain' }, signal: stop.signal,
    fetchPage: async () => { calls++; return { messages: calls === 1 ? [] : [row(7)], nextAfterSeq: null }; },
    onEvent: (event) => events.push(event), onError: (error) => errors.push(error),
  });
  await tick();
  wire.update('new-message', row(7));
  await tick();
  expect(calls).toBe(2);
  expect(events.flatMap((event) => event.messages?.map((message) => message.seq) ?? [])).toEqual([7]);
  expect(follower.lastSeq()).toBe(7);
  expect(errors).toEqual([]);
  stop.abort();
});
it('catches up when the first socket connection follows the initial history read', async () => {
  const wire = connection();
  const stop = new AbortController();
  const events: FollowedSessionEvent[] = [];
  const rows: SessionMessageV1[] = [];
  const follower = followSession({ connection: wire, sessionId: 's', afterSeq: 0, content: { mode: 'plain' }, signal: stop.signal,
    fetchPage: async (after) => ({ messages: rows.filter((message) => message.seq > after) }),
    onEvent: (event) => events.push(event), onError: (error) => { throw error; },
  });
  await tick();
  expect(events[0]).toMatchObject({ kind: 'messages', messages: [], source: 'history' });
  rows.push(row(1));
  wire.connect();
  await tick();
  expect(events.at(-1)).toMatchObject({ kind: 'messages', messages: [{ seq: 1 }], source: 'catch-up' });
  expect(follower.lastSeq()).toBe(1);
  stop.abort();
});
it('discards a history opening that settles after cancellation', async () => {
  const wire = connection();
  const stop = new AbortController();
  const events: FollowedSessionEvent[] = [];
  const errors: unknown[] = [];
  let release: ((value: unknown) => void) | undefined;
  const follower = followSession({ connection: wire, sessionId: 's', afterSeq: 0, signal: stop.signal,
    content: { mode: 'e2ee', encryption: { encryptRaw: async () => '', decryptRaw: () => new Promise((resolve) => { release = resolve; }) } },
    fetchPage: async () => ({ messages: [{ ...row(1), content: { t: 'encrypted', c: 'sealed' } }] }),
    onEvent: (event) => events.push(event), onError: (error) => errors.push(error),
  });
  await tick();
  stop.abort();
  release?.({ text: 'stale' });
  await tick();
  expect(events).toEqual([]);
  expect(errors).toEqual([]);
  expect(follower.lastSeq()).toBe(0);
});
it('passes full snapshot and delta frames through and opens raw session state', async () => {
  const wire = connection();
  const stop = new AbortController();
  const events: FollowedSessionEvent[] = [];
  followSession({ connection: wire, sessionId: 's', afterSeq: 0, content: { mode: 'plain' }, signal: stop.signal,
    fetchPage: async () => ({ messages: [] }), onEvent: (event) => events.push(event), onError: (error) => { throw error; },
  });
  await tick();
  const snapshot = { type: 'transcript-stream-segment', sessionId: 's', message: { localId: 'live', content: { t: 'plain', v: { text: 'a' } }, messageRole: null, tick: 1, createdAt: 1, updatedAt: 1 } };
  const delta = { type: 'transcript-stream-segment-delta', sessionId: 's', message: { ...snapshot.message, content: { t: 'plain', v: { text: 'b' } }, tick: 2, baseLength: 1 } };
  wire.ephemeral(snapshot);
  wire.ephemeral(delta);
  wire.sessionUpdate({ t: 'update-session', id: 's', agentState: { value: '{"requests":{}}', version: 1 } });
  await tick();
  expect(events.filter((event) => event.kind === 'stream-segment')).toEqual([{ kind: 'stream-segment', segment: snapshot }, { kind: 'stream-segment', segment: delta }]);
  expect(events.at(-1)).toMatchObject({ kind: 'session-updated', agentState: { status: 'ready', value: { requests: {} } } });
  stop.abort();
});
