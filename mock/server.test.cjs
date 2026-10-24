const { test } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { mkdtempSync, writeFileSync, readFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { createServer, scenarios } = require('./server.cjs');
const seed = require('./seed.json');

async function setup(t, options = {}) {
  const server = createServer({ database: structuredClone(seed), delay: 0, ...options }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = (url, method = 'GET', body) => fetch(base + url, {
    method, headers: { Origin: 'http://localhost:5173', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const scenario = (name) => request('/__mock/scenario', 'PUT', { scenario: name });
  return { request, scenario, base };
}

const sorted = (campaigns) => [...campaigns].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id));

test('seed covers documented statuses, rewards and edge cases', () => {
  assert.equal(seed.campaigns.length, 12);
  assert.equal(new Set(seed.campaigns.map(c => c.id)).size, 12);
  for (const status of ['active', 'draft', 'paused']) assert.equal(seed.campaigns.filter(c => c.status === status).length, 4);
  for (const reward of ['points', 'discount', 'multiplier']) assert.equal(seed.campaigns.filter(c => c.rewardType === reward).length, 4);
  assert.ok(seed.campaigns.some(c => c.budget === 0 && c.spent === 0));
  assert.ok(seed.campaigns.some(c => c.spent > c.budget));
  assert.ok(seed.campaigns.some(c => c.budget > 0 && c.spent === c.budget));
});

test('list and detail contract, ordering, transitions and idempotent retry', async (t) => {
  const { request } = await setup(t);
  const response = await request('/campaigns');
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), sorted(seed.campaigns));
  assert.equal(response.headers.get('access-control-allow-origin'), 'http://localhost:5173');
  for (const [id, status] of [['c_101', 'paused'], ['c_101', 'active'], ['c_102', 'active'], ['c_103', 'active'], ['c_103', 'active'], ['c_107', 'paused'], ['c_108', 'active']]) {
    const before = await (await request(`/campaigns/${id}`)).json();
    const update = await request(`/campaigns/${id}`, 'PATCH', { status });
    assert.equal(update.status, 200);
    assert.deepEqual(await update.json(), { ...before, status });
    assert.deepEqual(await (await request(`/campaigns/${id}`)).json(), { ...before, status });
  }
  assert.deepEqual((await (await request('/campaigns')).json()).map(c => c.id), sorted(seed.campaigns).map(c => c.id));
});

test('uniform errors; malformed and invalid writes do not alter database', async (t) => {
  const { request, base } = await setup(t);
  const cases = [
    ['/campaigns/c_101', 'PATCH', { status: 'draft' }, 409, 'INVALID_TRANSITION'],
    ['/campaigns/c_102', 'PATCH', { status: 'paused' }, 409, 'INVALID_TRANSITION'],
    ['/campaigns/c_101', 'PATCH', { status: 'invalid' }, 400, 'INVALID_PAYLOAD'],
    ['/campaigns/c_101', 'PATCH', { status: 'paused', budget: 0 }, 400, 'INVALID_PAYLOAD'],
    ['/campaigns/c_101', 'PATCH', {}, 400, 'INVALID_PAYLOAD'],
    ['/campaigns/c_101', 'PATCH', [], 400, 'INVALID_PAYLOAD'],
    ['/campaigns/missing', 'PATCH', { status: 'active' }, 404, 'CAMPAIGN_NOT_FOUND'],
    ['/campaigns/missing', 'GET', undefined, 404, 'CAMPAIGN_NOT_FOUND'],
    ['/campaigns?status=active', 'GET', undefined, 400, 'UNSUPPORTED_QUERY'],
    ['/campaigns/c_101?x=1', 'PATCH', { status: 'paused' }, 400, 'UNSUPPORTED_QUERY'],
    ['/campaigns/c_101', 'DELETE', undefined, 405, 'METHOD_NOT_ALLOWED'],
    ['/campaigns', 'POST', {}, 405, 'METHOD_NOT_ALLOWED'],
    ['/missing', 'GET', undefined, 404, 'ENDPOINT_NOT_FOUND'],
    ['/__mock/scenario', 'PUT', { scenario: 'missing' }, 400, 'INVALID_SCENARIO'],
    ['/__mock/scenario', 'PUT', { scenario: 'normal', extra: true }, 400, 'INVALID_SCENARIO'],
  ];
  for (const [url, method, body, status, code] of cases) {
    const response = await request(url, method, body);
    assert.equal(response.status, status, `${method} ${url}`);
    const error = await response.json();
    assert.equal(error.code, code);
    assert.equal(typeof error.message, 'string');
  }
  const malformed = await fetch(base + '/campaigns/c_101', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: '{' });
  assert.equal(malformed.status, 400);
  assert.equal((await malformed.json()).code, 'INVALID_JSON');
  assert.deepEqual(await (await request('/campaigns')).json(), sorted(seed.campaigns));
});

test('live scenarios, recovery, health and reset are deterministic', async (t) => {
  const { request, scenario } = await setup(t);
  assert.deepEqual(await (await request('/health')).json(), { status: 'ok' });
  for (const name of Object.keys(scenarios)) assert.equal((await scenario(name)).status, 200);
  assert.equal((await (await request('/__mock')).json()).scenario, 'patch-error');
  const failure = await request('/campaigns/c_101', 'PATCH', { status: 'paused' });
  assert.equal(failure.status, 503);
  assert.equal((await failure.json()).code, 'SIMULATED_PATCH_ERROR');
  assert.equal((await (await request('/campaigns/c_101')).json()).status, 'active');
  await scenario('list-error');
  for (let i = 0; i < 2; i++) assert.equal((await request('/campaigns')).status, 503);
  assert.equal((await request('/health')).status, 200);
  await scenario('empty');
  assert.deepEqual(await (await request('/campaigns')).json(), []);
  assert.equal((await request('/campaigns/c_101')).status, 200);
  await scenario('no-drafts');
  const filtered = await (await request('/campaigns')).json();
  assert.equal(filtered.length, 8);
  assert.ok(filtered.every(c => c.status !== 'draft'));
  await scenario('normal');
  assert.equal((await (await request('/campaigns')).json()).length, 12);
  assert.equal((await request('/campaigns/c_101', 'PATCH', { status: 'paused' })).status, 200);
  await scenario('empty');
  const reset = await request('/__mock/reset', 'POST');
  assert.deepEqual(await reset.json(), { scenario: 'normal', campaignCount: 12 });
  assert.deepEqual(await (await request('/campaigns')).json(), sorted(seed.campaigns));
});

test('scenario delays apply to campaign requests; controls remain immediate', async (t) => {
  const { request, scenario } = await setup(t, { delay: undefined });
  await scenario('slow');
  assert.equal((await (await request('/__mock')).json()).delayMs, 2000);
  const start = performance.now();
  assert.equal((await request('/campaigns')).status, 200);
  assert.ok(performance.now() - start >= 1900);
  await scenario('normal');
  assert.equal((await (await request('/__mock')).json()).delayMs, 400);
});

test('file-backed updates survive creating a new server; reset restores disk', async (t) => {
  const directory = mkdtempSync(path.join(tmpdir(), 'campaign-api-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const database = path.join(directory, 'db.json');
  writeFileSync(database, JSON.stringify(seed));
  const first = await setup(t, { database });
  assert.equal((await first.request('/campaigns/c_101', 'PATCH', { status: 'paused' })).status, 200);
  assert.equal(JSON.parse(readFileSync(database)).campaigns[0].status, 'paused');
  const second = await setup(t, { database });
  assert.equal((await (await second.request('/campaigns/c_101')).json()).status, 'paused');
  await second.request('/__mock/reset', 'POST');
  assert.deepEqual(JSON.parse(readFileSync(database)), seed);
});

test('documented scenario CLI switches, inspects, resets, and rejects invalid names', async (t) => {
  const { execFile } = require('node:child_process');
  const { promisify } = require('node:util');
  const run = promisify(execFile);
  const { request, base } = await setup(t);
  const cli = (name) => run(process.execPath, [path.join(__dirname, '../scripts/scenario.cjs'), name], {
    env: { ...process.env, PORT: new URL(base).port },
  });
  assert.equal(JSON.parse((await cli('patch-error')).stdout).scenario, 'patch-error');
  assert.equal(JSON.parse((await cli('status')).stdout).scenario, 'patch-error');
  assert.equal((await request('/campaigns/c_101', 'PATCH', { status: 'paused' })).status, 503);
  assert.equal(JSON.parse((await cli('reset')).stdout).campaignCount, 12);
  assert.equal((await (await request('/__mock')).json()).scenario, 'normal');
  await assert.rejects(cli('invalid'), error => error.code === 1 && error.stderr.includes('Usage:'));
});
