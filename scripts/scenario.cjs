const { scenarios } = require('../mock/server.cjs');
const name = process.argv[2];
if (!name || (name !== 'reset' && name !== 'status' && !Object.hasOwn(scenarios, name))) {
  console.error(`Usage: npm run mock-api:scenario -- <${[...Object.keys(scenarios), 'status', 'reset'].join('|')}>`);
  process.exit(1);
}
const base = `http://127.0.0.1:${process.env.PORT || 3001}`;
(async () => {
  try {
    const response = await fetch(`${base}${name === 'reset' ? '/__mock/reset' : name === 'status' ? '/__mock' : '/__mock/scenario'}`, {
      method: name === 'reset' ? 'POST' : name === 'status' ? 'GET' : 'PUT',
      ...(name === 'reset' || name === 'status' ? {} : {
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ scenario: name }),
      }),
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error(`API returned ${response.status}: ${await response.text()}`);
    console.log(JSON.stringify(await response.json(), null, 2));
  } catch (error) {
    console.error(`Could not control the mock API: ${error.message}. Start it with npm run mock-api.`);
    process.exitCode = 1;
  }
})();
