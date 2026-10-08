import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const baseUrl = process.env.TASK_ROOM_URL ?? 'http://127.0.0.1:4310';
const token = readFileSync(resolve('data', 'controller-token.txt'), 'utf8').trim();
const conversationId = process.env.CODEX_CONVERSATION_ID ?? 'local-codex-session';
const intervalMs = 20_000;

async function request(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      authorization: `Bearer ${token}`,
      ...(options.body ? { 'content-type': 'application/json' } : {}),
      ...options.headers,
    },
  });
  if (!response.ok) {
    throw new Error(`${path} returned ${response.status}`);
  }
  return response.json();
}

async function register() {
  return request('/client-api/session', {
    method: 'POST',
    body: JSON.stringify({
      clientName: 'Codex Desktop',
      model: 'Codex / GPT-5',
      conversationId,
      state: 'idle',
    }),
  });
}

await register();

console.log(`Controller heartbeat connected to ${baseUrl}`);
setInterval(() => {
  register().catch((error) => {
    console.error(`Heartbeat failed: ${error.message}`);
  });
}, intervalMs);
