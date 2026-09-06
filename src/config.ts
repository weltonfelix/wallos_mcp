export interface Config {
  baseUrl: string;
  apiKey: string;
  token: string;
  port: number;
}

export function readConfig(env = process.env): Config {
  const apiKey = env.WALLOS_API_KEY;
  const token = env.MCP_AUTH_TOKEN;
  if (!apiKey || !token || token.length < 32) {
    throw new Error('WALLOS_API_KEY and MCP_AUTH_TOKEN (at least 32 characters) are required.');
  }
  let url: URL;
  try { url = new URL(env.WALLOS_BASE_URL ?? ''); }
  catch { throw new Error('WALLOS_BASE_URL must be an absolute HTTP or HTTPS URL.'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('WALLOS_BASE_URL must use HTTP(S), without credentials, query, or fragment.');
  }
  const port = Number(env.MCP_PORT ?? 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('MCP_PORT must be between 1 and 65535.');
  return { baseUrl: url.href.replace(/\/$/, '') + '/', apiKey, token, port };
}
