#!/usr/bin/env node
// Operator browser check, run through the harness browser role for GPU isolation.
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { once } from 'node:events';

const url = new URL(process.argv[2]);
if (url.protocol !== 'https:') throw new Error('Login check requires HTTPS');
const output = `${process.cwd()}/.project/fork-web`;
await mkdir(output, { recursive: true });
const browser = spawn('chromium', [
  '--headless', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=vulkan',
  '--remote-debugging-port=0', `--user-data-dir=${output}/browser-profile`,
  '--window-size=1280,900', 'about:blank',
]);
let stderr = '';
const endpoint = new Promise((resolve, reject) => {
  browser.stderr.on('data', chunk => {
    stderr += chunk;
    const match = stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/);
    if (match) resolve(match[1]);
  });
  browser.once('error', reject);
  browser.once('exit', code => reject(new Error(`Chromium exited ${code}\n${stderr}`)));
});
let socket;
try {
  socket = new WebSocket(await endpoint);
  await once(socket, 'open');
  let id = 0;
  const pending = new Map();
  const listeners = new Map();
  socket.addEventListener('close', () => {
    for (const promise of pending.values()) promise.reject(new Error('Browser connection closed'));
    pending.clear();
  });
  socket.addEventListener('message', event => {
    const value = JSON.parse(event.data);
    if (value.id) {
      const promise = pending.get(value.id);
      if (promise) {
        pending.delete(value.id);
        if (value.error) promise.reject(new Error(JSON.stringify(value.error)));
        else promise.resolve(value.result);
      }
    } else {
      for (const listener of listeners.get(value.method) || []) listener(value);
      if (value.method === 'Runtime.exceptionThrown') console.error('PAGE_EXCEPTION', JSON.stringify(value.params));
    }
  });
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const message = { id: ++id, method, params, ...(sessionId ? { sessionId } : {}) };
    pending.set(message.id, { resolve, reject });
    socket.send(JSON.stringify(message));
  });
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  await send('Page.enable', {}, sessionId);
  await send('Runtime.enable', {}, sessionId);
  const loaded = new Promise(resolve => listeners.set('Page.loadEventFired', [resolve]));
  const navigation = await send('Page.navigate', { url: url.href }, sessionId);
  if (navigation.errorText) throw new Error(navigation.errorText);
  await loaded;
  const result = await send('Runtime.evaluate', {
    expression: `new Promise((resolve, reject) => {
      const check = () => {
        const failure = document.querySelector('[data-testid="expo-router-unmatched"], [data-testid="welcome-server-unavailable"]');
        if (failure) { observer.disconnect(); reject(new Error(failure.innerText)); return; }
        const login = document.querySelector('[data-testid="welcome-secondary-login"]');
        if (login && login.getBoundingClientRect().height > 0) {
          observer.disconnect(); resolve(document.body.innerText);
        }
      };
      const observer = new MutationObserver(check);
      observer.observe(document.documentElement, {childList:true, subtree:true, characterData:true, attributes:true});
      check();
    }).then(async text => {
      await document.fonts.ready;
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      return text;
    })`,
    awaitPromise: true,
    returnByValue: true,
  }, sessionId);
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
  console.log('CHECK rendered login control: visible');
  console.log('LOGIN_TEXT=' + JSON.stringify(result.result.value));
  const { data } = await send('Page.captureScreenshot', { format: 'png' }, sessionId);
  await writeFile(`${output}/login.png`, Buffer.from(data, 'base64'));
  console.log(`LOGIN_SCREENSHOT=${output}/login.png`);
} finally {
  socket?.close();
  if (browser.exitCode === null) {
    browser.kill('SIGTERM');
    await once(browser, 'exit');
  }
}
