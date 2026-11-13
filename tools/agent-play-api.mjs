import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { pathToFileURL, fileURLToPath } from 'node:url';

const sha = value => 'sha256:' + createHash('sha256').update(JSON.stringify(value)).digest('hex');
const now = () => new Date().toISOString();
export function createGateway({ stateDir, token, executeWorker, conformanceProfiles = ["technocore-agent","tclk-transcript"], fetchImpl = fetch }) {
  fs.mkdirSync(stateDir, { recursive: true });
  let active = false;
  const workflows = ['technocore.snapshot', 'conformance.verify', 'execution.receipt', 'receipt.verify'];
  const file = id => path.join(stateDir, id + '.json');
  function write(job) {
    const tmp = file(job.id) + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(job, null, 2));
    fs.renameSync(tmp, file(job.id));
  }
  // Never silently repeat work whose execution was interrupted by a restart.
  for (const entry of fs.readdirSync(stateDir).filter(x => /^[A-Za-z0-9_-]+\.json$/.test(x))) {
    const job = JSON.parse(fs.readFileSync(path.join(stateDir, entry), 'utf8'));
    if (job.status === 'RUNNING') write({ ...job, status: 'INTERRUPTED', finishedAt: now(), error: 'RESTART_DURING_EXECUTION' });
  }
  async function execute(job) {
    try {
      let execution;
      if (job.request.workflow === 'technocore.snapshot') {
        const observations = [];
        for (const endpoint of ['healthz', 'config', 'openapi.json']) {
          const url = 'https://technocore.chat/' + endpoint;
          const response = await fetchImpl(url, { redirect: 'error', signal: AbortSignal.timeout(20000) });
          if (!response.ok) throw new Error('TECHNOCORE_HTTP_' + response.status);
          const text = await response.text();
          if (Buffer.byteLength(text) > 1024 * 1024) throw new Error('SOURCE_TOO_LARGE');
          observations.push({ url, observedAt: now(), httpStatus: response.status, bodyDigest: sha(text), body: endpoint === 'healthz' ? text.trim() : JSON.parse(text) });
        }
        const [health, config, api] = observations;
        if (health.body !== 'ok' || config.body.service !== 'technocore-chat' || !api.body.paths) throw new Error('INVALID_TECHNOCORE_SNAPSHOT');
        const output = { service: config.body.service, version: config.body.version, settings: config.body.settings, apiOperations: Object.values(api.body.paths).reduce((n, p) => n + Object.keys(p).filter(k => ['get','post','put','delete','patch'].includes(k)).length, 0), observations };
        execution = { schema: 'flop.worker-execution/v1', worker: 'protocol-observation', status: 'COMPLETED', startedAt: job.startedAt, finishedAt: now(), output, outputDigest: sha(output), evidenceRefs: observations.map(x => x.url), metadata: { provider: 'live-technocore-http', analysis: 'deterministic' } };
      } else {
        execution = await executeWorker(job.request.workflow === 'conformance.verify' ? 'conformance' : 'execution-proof', job.request.workflow === 'receipt.verify' ? {...job.request.input, operation:'verify-retained'} : job.request.input);
      }
      if (execution.status !== 'COMPLETED') throw new Error(execution.error || 'EXECUTION_FAILED');
      const receiptExecution = await executeWorker('execution-proof', { workId: job.id, executor: 'flop-agent-play', result: execution });
      if (receiptExecution.status !== 'COMPLETED') throw new Error(receiptExecution.error || 'RECEIPT_FAILED');
      write({ ...job, status: 'COMPLETED', finishedAt: now(), execution, receipt: receiptExecution.output.receipt, payment: { status: 'NOT_REQUESTED', valueMoved: false }, claimBoundary: 'Execution and captured evidence only. Independent acceptance, usefulness, external payment and FLOP rewards are not certified.' });
    } catch (error) {
      write({ ...job, status: 'FAILED', finishedAt: now(), error: String(error.message || error) });
    } finally { active = false; }
  }
  function send(res, code, body) { res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(body)); }
  const server = http.createServer(async (req, res) => {
    try {
      if (req.headers.origin || !/^127\.0\.0\.1(?::\d+)?$/.test(req.headers.host || '')) return send(res, 403, { error: 'LOCAL_CLIENT_REQUIRED' });
      if (req.method === 'GET' && req.url === '/healthz') return send(res, 200, { service: 'flop-agent-play', status: 'READY', at: now(), workflows, conformanceProfiles, active, settlement: 'NOT_CONFIGURED' });
      const supplied = Buffer.from(req.headers.authorization || '');
      const expected = Buffer.from('Bearer ' + token);
      if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return send(res, 401, { error: 'AUTH_REQUIRED' });
      const match = req.url?.match(/^\/v1\/jobs\/([A-Za-z0-9_-]{1,80})$/);
      if (req.method === 'GET' && match) return fs.existsSync(file(match[1])) ? send(res, 200, JSON.parse(fs.readFileSync(file(match[1]), 'utf8'))) : send(res, 404, { error: 'JOB_NOT_FOUND' });
      if (req.method !== 'POST' || req.url !== '/v1/workflows') return send(res, 404, { error: 'NOT_FOUND' });
      if (!String(req.headers['content-type'] || '').startsWith('application/json')) return send(res, 415, { error: 'JSON_REQUIRED' });
      let size = 0; const chunks = [];
      for await (const chunk of req) { size += chunk.length; if (size > 262144) return send(res, 413, { error: 'REQUEST_TOO_LARGE' }); chunks.push(chunk); }
      const request = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (!request || !/^[A-Za-z0-9_-]{1,80}$/.test(request.request_id || '') || !workflows.includes(request.workflow) || Object.keys(request).some(k => !['request_id','workflow','input'].includes(k))) return send(res, 400, { error: 'INVALID_WORKFLOW_REQUEST' });
      if (request.workflow === 'conformance.verify' && (!conformanceProfiles.includes(request.input?.profile) || !request.input?.artifact)) return send(res, 400, { error: 'PROFILE_OR_ARTIFACT_REQUIRED' });
      if (request.workflow === 'execution.receipt' && (!request.input || !Object.hasOwn(request.input, 'result'))) return send(res, 400, { error: 'RESULT_REQUIRED' });
      if (request.workflow === 'receipt.verify' && !request.input?.receipt) return send(res, 400, { error: 'RECEIPT_REQUIRED' });
      const id = request.request_id;
      const requestDigest = sha(request);
      if (fs.existsSync(file(id))) { const prior = JSON.parse(fs.readFileSync(file(id), 'utf8')); return send(res, prior.requestDigest === requestDigest ? 200 : 409, prior.requestDigest === requestDigest ? prior : { error: 'REQUEST_ID_CONFLICT' }); }
      if (active) return send(res, 429, { error: 'WORKER_BUSY', retryAfterSeconds: 5 });
      active = true;
      const job = { schema: 'flop.agent-play-job/v1', id, request, requestDigest, status: 'RUNNING', startedAt: now() };
      write(job);
      send(res, 202, { id, status: job.status, resultUrl: '/v1/jobs/' + id });
      void execute(job);
    } catch (error) { send(res, error instanceof SyntaxError ? 400 : 500, { error: error instanceof SyntaxError ? 'INVALID_JSON' : 'INTERNAL_ERROR' }); }
  });
  server.requestTimeout = 30000;
  server.headersTimeout = 10000;
  return server;
}

export async function startLocalGateway(stackRoot) {
  const localRoot = path.join(process.env.LOCALAPPDATA, 'FLOP', 'agent-play');
  const stateDir = path.join(stackRoot, 'runtime', 'agent-play', 'jobs');
  fs.mkdirSync(localRoot, { recursive: true });
  const tokenFile = path.join(localRoot, 'api-token.txt');
  if (!fs.existsSync(tokenFile)) fs.writeFileSync(tokenFile, randomBytes(32).toString('hex'), { flag: 'wx' });
  const token = fs.readFileSync(tokenFile, 'utf8').trim();
  const { executeWorker, supportedConformanceProfiles } = await import(pathToFileURL(path.join(stackRoot, 'flop-tools', 'dist', 'src', 'index.js')));
  const server = createGateway({ stateDir, token, executeWorker, conformanceProfiles: supportedConformanceProfiles() });
  const heartbeat = () => fs.writeFileSync(path.join(localRoot, 'heartbeat.json'), JSON.stringify({ schema: 'flop.agent-play-heartbeat/v1', at: now(), pid: process.pid, healthy: server.listening, endpoint: 'http://127.0.0.1:8766', tokenFile, stateDir }));
  server.listen(8766, '127.0.0.1', () => { heartbeat(); setInterval(heartbeat, 30000).unref(); });
  server.on('error', err => { console.error(err.message); process.exit(1); });
  for (const signal of ['SIGINT','SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)));
  return server;
}
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  await startLocalGateway(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..'));
}
