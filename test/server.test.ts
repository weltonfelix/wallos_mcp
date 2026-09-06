import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createApp } from '../src/server.js';
import { readConfig } from '../src/config.js';
import { WallosClient, redact } from '../src/wallos.js';

const config = { baseUrl: 'http://wallos/subpath/', apiKey: 'private-key', token: 'a'.repeat(32), port: 3000 };

test('configuration rejects invalid inputs without disclosing secrets', () => {
  assert.throws(() => readConfig({ WALLOS_BASE_URL: 'http://user:password@wallos', WALLOS_API_KEY: 'secret', MCP_AUTH_TOKEN: config.token }));
  assert.throws(() => readConfig({}));
  assert.equal(readConfig({ WALLOS_BASE_URL: 'http://wallos/path', WALLOS_API_KEY: 'key', MCP_AUTH_TOKEN: config.token }).baseUrl, 'http://wallos/path/');
});

test('redacts nested sensitive fields and secret values', () => {
  assert.deepEqual(redact({ api_key: 'x', nested: ['private-key'], password: 'y' }, [config.apiKey]), { api_key: '[REDACTED]', nested: ['[REDACTED]'], password: '[REDACTED]' });
});

test('Wallos failures never expose upstream bodies or network errors', async () => {
  for (const response of [Response.json({ success: false, message: config.apiKey }), new Response(config.apiKey, { status: 500 }), new Response('not json')]) {
    const client = new WallosClient(config, async () => response);
    await assert.rejects(client.request('subscriptions/get_subscriptions'), error => error instanceof Error && !error.message.includes(config.apiKey));
  }
  const client = new WallosClient(config, async () => { throw new Error(config.apiKey); });
  await assert.rejects(client.request('subscriptions/get_subscriptions'), /not retried/);
});

test('oversized upstream responses are rejected', async () => {
  const client = new WallosClient(config, async () => new Response('x'.repeat(2 * 1024 * 1024 + 1)));
  await assert.rejects(client.request('subscriptions/get_subscriptions'), /exceeds 2 MiB/);
});

test('SDK handshake, tool schemas, authentication, and form-encoded operations', async () => {
  const calls: { path: string; body: URLSearchParams }[] = [];
  const wallos = new WallosClient(config, async (url, options) => {
    assert.equal(options?.method, 'POST');
    assert.equal(options?.redirect, 'error');
    assert.ok(options?.signal);
    const path = new URL(String(url));
    assert.equal(path.search, '');
    assert.ok(path.pathname.startsWith('/subpath/api/'));
    const body = options?.body as URLSearchParams;
    assert.equal(body.get('api_key'), config.apiKey);
    calls.push({ path: path.pathname, body });
    return Response.json({ success: true, subscriptionId: 42 });
  });
  const http = createApp(config, wallos).listen(0, '127.0.0.1');
  await once(http, 'listening');
  const address = http.address();
  assert.ok(address && typeof address !== 'string');
  const url = new URL(`http://127.0.0.1:${address.port}/mcp`);
  const client = new Client({ name: 'test', version: '1.0.0' });
  try {
    assert.equal((await fetch(url, { method: 'POST' })).status, 401);
    assert.equal((await fetch(url, { method: 'POST', headers: { Authorization: 'Bearer wrong' } })).status, 401);
    assert.equal((await fetch(url, { headers: { Authorization: `Bearer ${config.token}`, Origin: 'http://evil.test' } })).status, 403);
    assert.equal((await fetch(url, { headers: { Authorization: `Bearer ${config.token}` } })).status, 405);
    assert.equal((await fetch(new URL('/healthz', url))).status, 200);
    assert.equal((await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${config.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ value: 'x'.repeat(65536) }) })).status, 413);
    await client.connect(new StreamableHTTPClientTransport(url, { requestInit: { headers: { Authorization: `Bearer ${config.token}` } } }));
    assert.equal((await client.listTools()).tools.length, 7);
    await client.callTool({ name: 'list_subscriptions', arguments: { payment: [1, 2], convert_currency: true } });
    assert.equal(calls.at(-1)?.body.get('payment'), '1,2');
    assert.equal(calls.at(-1)?.body.get('convert_currency'), 'true');
    const count = calls.length;
    for (const args of [{ id: 1 }, { id: 1, confirm: false }]) {
      assert.equal((await client.callTool({ name: 'delete_subscription', arguments: args })).isError, true);
    }
    assert.equal((await client.callTool({ name: 'update_subscription', arguments: { id: 1 } })).isError, true);
    assert.equal((await client.callTool({ name: 'create_subscription', arguments: { name: 'Bad', next_payment: '2026-02-30' } })).isError, true);
    assert.equal(calls.length, count);
    await client.callTool({ name: 'create_subscription', arguments: { name: 'Example', price: 0, currency_id: 1, cycle: 3, frequency: 1, next_payment: '2027-01-01' } });
    assert.equal(calls.at(-1)?.body.get('action'), 'add');
    assert.ok(calls.at(-1)?.path.endsWith('/set_subscriptions.php'));
    await client.callTool({ name: 'update_subscription', arguments: { id: 42, notes: '', category_id: null } });
    assert.equal(calls.at(-1)?.body.get('action'), 'edit');
    assert.equal(calls.at(-1)?.body.get('category_id'), '');
    assert.equal(calls.at(-1)?.body.has('price'), false);
    await client.callTool({ name: 'delete_subscription', arguments: { id: 42, confirm: true } });
    assert.equal(calls.at(-1)?.body.get('action'), 'delete');
    assert.equal(calls.at(-1)?.body.has('confirm'), false);
    await client.callTool({ name: 'get_reference_data', arguments: {} });
    assert.deepEqual(calls.slice(-4).map(call => call.path).sort(), ['categories/get_categories', 'currencies/get_currencies', 'household/get_household', 'payment_methods/get_payment_methods'].map(path => `/subpath/api/${path}.php`));
    await client.callTool({ name: 'get_subscription', arguments: { id: 42 } });
    assert.ok(calls.at(-1)?.path.endsWith('/get_subscription.php'));
    await client.callTool({ name: 'get_monthly_cost', arguments: { month: 1, year: 2027 } });
    assert.equal(calls.at(-1)?.body.get('year'), '2027');
  } finally { await client.close(); http.closeAllConnections(); await new Promise<void>(resolve => http.close(() => resolve())); }
});
