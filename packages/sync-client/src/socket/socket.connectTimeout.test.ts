import { Manager } from 'socket.io-client';
import { afterEach, expect, it, vi } from 'vitest';
import { createHappierSocket } from './createHappierSocket.js';

afterEach(() => vi.useRealTimers());

it.each([false, true])('keeps black-holed dial settlement owned by the caller deadline (bounded: %s)', async bounded => {
  vi.useFakeTimers();
  // Socket.IO owns the default budget; do not invent a Happier-specific cutoff.
  const manager = new Manager({ autoConnect: false, reconnection: false });
  const timeoutMs = manager.timeout();
  expect(typeof timeoutMs).toBe('number');
  if (typeof timeoutMs !== 'number') throw new Error('Expected a finite Manager connection budget');
  const close = vi.fn();
  // The byte socket never opens or reports an error, as with a black-holed TCP
  // handshake. Real Engine.IO/Manager/Socket and transport adapter remain in use.
  const { socket, transport } = createHappierSocket({ endpoint: 'https://black-hole.example.test',
    token: 'synthetic-token', clientType: 'user-scoped', websocketFactory: () => ({ close }),
    ...(bounded ? { connectTimeoutMs: timeoutMs } : {}) });
  let result: unknown;
  let settled = false;
  const pending = transport.connect().then(() => { settled = true; }, error => { settled = true; result = error; });
  try {
    await vi.advanceTimersByTimeAsync(timeoutMs - 1);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(settled).toBe(bounded);
    if (bounded) expect(result).toBeInstanceOf(Error);
    expect(socket.connected).toBe(false);
  } finally {
    await transport.destroy();
    await pending;
  }
});
