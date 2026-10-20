import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { LlmProvider, resolveLlmConfig } from './llm.js';
import { runBatches } from '../provider.js';
import type { TranslationRequest } from '../provider.js';
import { buildGlossary } from '../glossary.js';

/**
 * Integration coverage for the OpenAI-compatible branch without an API key.
 *
 * Every case here mirrors a shape a real backend has actually been observed to
 * return: a fenced array, an object-wrapped array, a reply that dropped a
 * `[[n]]` placeholder, a short array, a 500. None of those are hypothetical,
 * and all of them used to be able to corrupt a README.
 */

interface CapturedRequest {
  body: {
    model?: string;
    messages?: Array<{ role: string; content: string }>;
  };
  authorization?: string;
}

interface Stub {
  baseUrl: string;
  requests: CapturedRequest[];
  close(): Promise<void>;
}

type Replier = (segments: string[], index: number) => unknown;

async function startStub(reply: Replier, status = 200): Promise<Stub> {
  const requests: CapturedRequest[] = [];
  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')) as CapturedRequest['body'];
      requests.push({ body: parsed, authorization: req.headers.authorization });

      const user = parsed.messages?.[1]?.content ?? '';
      const segments = JSON.parse(user) as string[];

      let content: unknown;
      try {
        content = reply(segments, requests.length - 1);
      } catch {
        // A replier that throws models a transport-level failure: the client
        // must see an error, not a half-written response body.
        res.writeHead(500, { 'content-type': 'application/json' });
        res.end('{}');
        return;
      }

      if (status !== 200) {
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'upstream exploded' } }));
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { content: typeof content === 'string' ? content : JSON.stringify(content) } }] }));
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  return {
    baseUrl: `http://127.0.0.1:${port}/v1`,
    requests,
    close: () => new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve()))),
  };
}

function request(to: 'zh' | 'en' = 'zh'): TranslationRequest {
  return { from: 'auto', to, glossary: buildGlossary(to, {}, []) };
}

function provider(stub: Stub): LlmProvider {
  return new LlmProvider({ baseUrl: stub.baseUrl, model: 'stub-model', apiKey: 'test-key' });
}

test('translates a batch and preserves segment order', async () => {
  const stub = await startStub((segments) => segments.map((s) => `译文:${s}`));
  try {
    const out = await provider(stub).translate(['Install it.', 'Run it.'], request());
    assert.deepEqual(out, ['译文:Install it.', '译文:Run it.']);

    const sent = stub.requests[0]!;
    assert.equal(sent.authorization, 'Bearer test-key');
    assert.equal(sent.body.model, 'stub-model');
    assert.equal(sent.body.messages?.[0]?.role, 'system');
    assert.equal(sent.body.messages?.[1]?.role, 'user');
    // The system prompt must state the exact expected length — that is what
    // keeps weaker backends from summarising the array.
    assert.match(sent.body.messages![0]!.content, /a JSON array of 2 strings/);
  } finally {
    await stub.close();
  }
});

test('tolerates a code-fenced reply', async () => {
  const stub = await startStub((segments) => '```json\n' + JSON.stringify(segments.map((s) => `中文:${s}`)) + '\n```');
  try {
    assert.deepEqual(await provider(stub).translate(['One', 'Two'], request()), ['中文:One', '中文:Two']);
  } finally {
    await stub.close();
  }
});

test('unwraps an object-wrapped reply from json_object backends', async () => {
  const stub = await startStub((segments) => JSON.stringify({ translations: segments.map((s) => `包:${s}`) }));
  try {
    assert.deepEqual(await provider(stub).translate(['One'], request()), ['包:One']);
  } finally {
    await stub.close();
  }
});

test('keeps the original when the reply drops a placeholder', async () => {
  // The classic failure: the model "helpfully" translates away `[[0]]`, which
  // in a README wraps a badge URL. Restoring the source beats emitting broken
  // Markdown, and it must only cost the affected segment.
  const stub = await startStub(() => ['丢失了占位符', '好的 [[0]] 译文']);
  try {
    const out = await provider(stub).translate(['见 [[0]] 徽章', '参考 [[0]] 文档'], request());
    assert.equal(out[0], '见 [[0]] 徽章', 'placeholder loss was not rejected');
    assert.equal(out[1], '好的 [[0]] 译文');
  } finally {
    await stub.close();
  }
});

test('a short or overlong reply never changes the returned length', async () => {
  const stub = await startStub(() => ['只有一条', '两条', '三条', '四条']);
  try {
    const out = await provider(stub).translate(['a', 'b', 'c'], request());
    assert.equal(out.length, 3, 'provider must return exactly the input length');
    assert.deepEqual(out, ['只有一条', '两条', '三条']);
  } finally {
    await stub.close();
  }
});

test('an empty completion is an error, not a silent pass-through', async () => {
  const stub = await startStub(() => '');
  try {
    await assert.rejects(() => provider(stub).translate(['a'], request()), /empty completion/);
  } finally {
    await stub.close();
  }
});

test('a server error rejects so the caller can fall back to the source', async () => {
  const stub = await startStub(() => [], 500);
  try {
    await assert.rejects(() => provider(stub).translate(['a'], request()), /LLM request failed \(500\)/);
  } finally {
    await stub.close();
  }
});

test('a failing batch leaves every other segment intact', async () => {
  let calls = 0;
  const stub = await startStub((segments) => {
    calls++;
    if (calls === 2) throw new Error('simulated transport failure');
    return segments.map((s) => `译:${s}`);
  });
  try {
    const sources = ['a', 'b', 'c', 'd'];
    const p = provider(stub);
    // maxChars of 1 forces one segment per batch, so the second request dies
    // on its own.
    const results = await runBatches(sources, 1, 1, async (batch) => {
      const out = await p.translate(batch, request());
      if (out.length !== batch.length) throw new Error('mismatch');
      return out;
    });
    assert.equal(results.length, sources.length);
    assert.equal(results.filter((r) => r.startsWith('译:')).length, 3);
    assert.equal(results[1], 'b', 'the failed batch must keep its originals');
  } finally {
    await stub.close();
  }
});

test('batch offsets stay aligned when replies arrive out of order', async () => {
  const stub = await startStub((segments) => segments.map((s) => `${s}→${segments.length}`));
  try {
    const sources = Array.from({ length: 9 }, (_, i) => `seg${i}`);
    const p = provider(stub);
    // Four characters per segment and a 12-character budget means three
    // per batch; concurrency 3 means completion order is not submission order,
    // and results are keyed by offset so that must not matter.
    const results = await runBatches(sources, 12, 3, (batch) => p.translate(batch, request()));
    assert.deepEqual(results, sources.map((s) => `${s}→3`));
  } finally {
    await stub.close();
  }
});

test('a configured base URL makes the llm provider available keyless', () => {
  const saved = {
    base: process.env.README_SMITH_LLM_BASE_URL,
    key: process.env.README_SMITH_LLM_API_KEY,
    model: process.env.README_SMITH_LLM_MODEL,
  };
  const cleared = [
    'OPENAI_API_KEY', 'DEEPSEEK_API_KEY', 'MOONSHOT_API_KEY', 'DASHSCOPE_API_KEY',
    'QWEN_API_KEY', 'ZHIPUAI_API_KEY', 'GLM_API_KEY', 'OPENROUTER_API_KEY', 'GROQ_API_KEY',
    'OLLAMA_BASE_URL', 'OPENAI_BASE_URL', 'OPENAI_MODEL', 'LLM_BASE_URL', 'LLM_MODEL',
  ];
  const previous = cleared.map((name) => [name, process.env[name]] as const);
  try {
    for (const name of cleared) delete process.env[name];
    process.env.README_SMITH_LLM_BASE_URL = 'http://127.0.0.1:11434/v1/';

    const config = resolveLlmConfig();
    assert.ok(config, 'a local base URL alone should configure the provider');
    assert.equal(config.baseUrl, 'http://127.0.0.1:11434/v1', 'trailing slash must be normalised');
    assert.equal(config.apiKey, undefined, 'a local server must not be sent a bogus key');
    // An explicit model wins, and without one the provider reports unavailable
    // rather than calling a backend with a guessed name.
    delete process.env.README_SMITH_LLM_BASE_URL;
    process.env.README_SMITH_LLM_BASE_URL = 'http://127.0.0.1:1234/v1';
    process.env.README_SMITH_LLM_MODEL = 'my-model';
    assert.equal(resolveLlmConfig()?.model, 'my-model');
  } finally {
    if (saved.base === undefined) delete process.env.README_SMITH_LLM_BASE_URL;
    else process.env.README_SMITH_LLM_BASE_URL = saved.base;
    if (saved.key === undefined) delete process.env.README_SMITH_LLM_API_KEY;
    else process.env.README_SMITH_LLM_API_KEY = saved.key;
    if (saved.model === undefined) delete process.env.README_SMITH_LLM_MODEL;
    else process.env.README_SMITH_LLM_MODEL = saved.model;
    for (const [name, value] of previous) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});
