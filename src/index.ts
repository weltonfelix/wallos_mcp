import { readConfig } from './config.js';
import { createApp } from './server.js';

try {
  const config = readConfig();
  const server = createApp(config).listen(config.port, '0.0.0.0', () => console.log(`Wallos MCP listening on port ${config.port}`));
  server.requestTimeout = 30000;
  server.on('error', () => { console.error('Unable to start HTTP server. Check the port configuration.'); process.exitCode = 1; });
  for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 10000).unref();
  });
} catch {
  console.error('Invalid configuration. Check WALLOS_BASE_URL, WALLOS_API_KEY, MCP_AUTH_TOKEN (32+ characters), and MCP_PORT.');
  process.exitCode = 1;
}
