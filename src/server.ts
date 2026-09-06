import express from 'express';
import { createHash, timingSafeEqual } from 'node:crypto';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { Config } from './config.js';
import { WallosClient } from './wallos.js';
import { createMcp } from './tools.js';

export function createApp(config: Config, client = new WallosClient(config)) {
  const app = express();
  app.disable('x-powered-by');
  app.get('/healthz', (_req, res) => { res.json({ status: 'ok' }); });
  const digest = (value: string) => createHash('sha256').update(value).digest();
  app.use('/mcp', (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!timingSafeEqual(digest(req.headers.authorization ?? ''), digest(`Bearer ${config.token}`))) {
      res.setHeader('WWW-Authenticate', 'Bearer');
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    // Browser clients are outside this server's scope; reject Origin-bearing requests.
    if (req.headers.origin) { res.status(403).json({ error: 'Browser origins are not allowed' }); return; }
    next();
  });
  app.post('/mcp', express.json({ limit: '64kb' }), async (req, res) => {
    const server = createMcp(client);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on('close', () => { void server.close(); });
    try { await server.connect(transport); await transport.handleRequest(req, res, req.body); }
    catch { if (!res.headersSent) res.status(500).json({ error: 'MCP request failed' }); }
  });
  app.all('/mcp', (_req, res) => { res.setHeader('Allow', 'POST'); res.status(405).json({ error: 'Stateless MCP supports POST only' }); });
  app.use((error: { status?: number }, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(error.status === 413 ? 413 : 400).json({ error: 'Invalid or oversized request' });
  });
  return app;
}
