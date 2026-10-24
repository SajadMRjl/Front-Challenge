const jsonServer = require('json-server');
const path = require('node:path');
const seed = require('./seed.json');

const scenarios = {
  normal: { delayMs: 400, listError: false, patchError: false, view: 'all' },
  slow: { delayMs: 2000, listError: false, patchError: false, view: 'all' },
  empty: { delayMs: 400, listError: false, patchError: false, view: 'empty' },
  'no-drafts': { delayMs: 400, listError: false, patchError: false, view: 'no-drafts' },
  'list-error': { delayMs: 400, listError: true, patchError: false, view: 'all' },
  'patch-error': { delayMs: 400, listError: false, patchError: true, view: 'all' },
};

function createServer({ database = path.join(__dirname, '../db.json'), delay, scenario = 'normal' } = {}) {
  if (!Object.hasOwn(scenarios, scenario)) throw new Error(`Unknown scenario: ${scenario}`);
  const server = jsonServer.create();
  const router = jsonServer.router(database);
  let current = scenario;
  const error = (res, status, code, message) => res.status(status).json({ code, message });
  const config = () => ({ scenario: current, ...scenarios[current], ...(delay === undefined ? {} : { delayMs: delay }) });
  server.use(jsonServer.defaults({ logger: false }));
  server.use(jsonServer.bodyParser);

  server.get('/health', (_req, res) => res.json({ status: 'ok' }));
  server.get('/__mock', (_req, res) => res.json({ ...config(), availableScenarios: Object.keys(scenarios) }));
  server.put('/__mock/scenario', (req, res) => {
    if (!req.body || Object.keys(req.body).length !== 1 || !Object.hasOwn(scenarios, req.body.scenario)) {
      return error(res, 400, 'INVALID_SCENARIO', `Provide only scenario: ${Object.keys(scenarios).join(', ')}.`);
    }
    current = req.body.scenario;
    res.json(config());
  });
  server.post('/__mock/reset', (_req, res) => {
    router.db.setState(structuredClone(seed)).write();
    current = 'normal';
    res.json({ scenario: current, campaignCount: seed.campaigns.length });
  });

  server.use('/campaigns', (req, _res, next) => {
    // Capture a scenario when a request arrives; changes affect subsequent requests.
    req.mockConfig = config();
    setTimeout(next, req.mockConfig.delayMs);
  });
  server.get('/campaigns', (req, res) => {
    if (Object.keys(req.query).length) return error(res, 400, 'UNSUPPORTED_QUERY', 'Query parameters are not supported. Filter locally.');
    const settings = req.mockConfig;
    if (settings.listError) return error(res, 503, 'SIMULATED_LIST_ERROR', 'Campaigns could not be loaded. Please try again.');
    let campaigns = router.db.get('campaigns').value();
    if (settings.view === 'empty') campaigns = [];
    if (settings.view === 'no-drafts') campaigns = campaigns.filter((c) => c.status !== 'draft');
    res.json([...campaigns].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id)));
  });
  server.get('/campaigns/:id', (req, res) => {
    if (Object.keys(req.query).length) return error(res, 400, 'UNSUPPORTED_QUERY', 'Query parameters are not supported.');
    const campaign = router.db.get('campaigns').find({ id: req.params.id }).value();
    if (!campaign) return error(res, 404, 'CAMPAIGN_NOT_FOUND', 'Campaign not found.');
    res.json(campaign);
  });
  server.patch('/campaigns/:id', (req, res) => {
    if (Object.keys(req.query).length) return error(res, 400, 'UNSUPPORTED_QUERY', 'Query parameters are not supported.');
    const body = req.body;
    if (!body || Array.isArray(body) || Object.keys(body).length !== 1 || !['active', 'draft', 'paused'].includes(body.status)) {
      return error(res, 400, 'INVALID_PAYLOAD', 'Provide only status: active, draft, or paused.');
    }
    const campaign = router.db.get('campaigns').find({ id: req.params.id }).value();
    if (!campaign) return error(res, 404, 'CAMPAIGN_NOT_FOUND', 'Campaign not found.');
    const allowed = { draft: ['active'], active: ['paused'], paused: ['active'] };
    // Repeating the desired status is safe, allowing retry after a lost response.
    if (body.status !== campaign.status && !allowed[campaign.status].includes(body.status)) {
      return error(res, 409, 'INVALID_TRANSITION', `Cannot change status from ${campaign.status} to ${body.status}.`);
    }
    if (req.mockConfig.patchError) return error(res, 503, 'SIMULATED_PATCH_ERROR', 'Campaign could not be updated. Please try again.');
    const updated = router.db.get('campaigns').find({ id: req.params.id }).assign({ status: body.status }).write();
    res.json(updated);
  });
  server.all(['/campaigns', '/campaigns/:id'], (_req, res) => error(res, 405, 'METHOD_NOT_ALLOWED', 'Use GET /campaigns, GET /campaigns/:id, or PATCH /campaigns/:id.'));
  server.use((_req, res) => error(res, 404, 'ENDPOINT_NOT_FOUND', 'Endpoint not found.'));
  server.use((err, _req, res, _next) => {
    if (err.type === 'entity.parse.failed') return error(res, 400, 'INVALID_JSON', 'Request body must be valid JSON.');
    console.error(err);
    error(res, 500, 'INTERNAL_ERROR', 'Unexpected mock API error.');
  });
  return server;
}

if (require.main === module) {
  const port = Number(process.env.PORT || 3001);
  createServer().listen(port, '127.0.0.1', () => console.log(`Mock API: http://localhost:${port}/campaigns\nScenarios: npm run mock-api:scenario -- <name>`));
}
module.exports = { createServer, scenarios };
