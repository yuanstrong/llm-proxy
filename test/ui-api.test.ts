import assert from 'node:assert/strict';
import test from 'node:test';
import { getPromptHistory, getPromptHistoryDates } from '../src/ui/lib/api';

function stubFetch(body: unknown): { calls: string[]; restore: () => void } {
  const calls: string[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    calls.push(input.toString());
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;
  return { calls, restore: () => { globalThis.fetch = original; } };
}

test('prompt history requests a specific day', async () => {
  const stub = stubFetch([]);
  try {
    await getPromptHistory('deepseek', '2026-11-14');
    assert.deepEqual(stub.calls, ['/admin/api/prompt-history?provider=deepseek&date=2026-11-14']);
  } finally {
    stub.restore();
  }
});

test('prompt history dates are requested for the selected provider', async () => {
  const payload = { dates: ['2026-11-14', '2026-11-15'], today: '2026-11-15' };
  const stub = stubFetch(payload);
  try {
    assert.deepEqual(await getPromptHistoryDates('deepseek'), payload);
    assert.deepEqual(stub.calls, ['/admin/api/prompt-history/dates?provider=deepseek']);
  } finally {
    stub.restore();
  }
});
