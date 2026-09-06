import type { Config } from './config.js';

export class WallosError extends Error {}

export function redact(value: unknown, secrets: string[]): unknown {
  if (typeof value === 'string') {
    for (const secret of secrets.filter(Boolean)) {
      value = (value as string).split(secret).join('[REDACTED]');
    }
    return value;
  }
  if (Array.isArray(value)) return value.map(item => redact(item, secrets));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [
    key, /api.?key|password|secret|token|authorization/i.test(key) ? '[REDACTED]' : redact(item, secrets),
  ]));
  return value;
}

export class WallosClient {
  constructor(private config: Config, private fetcher: typeof fetch = fetch, private timeout = 15000) {}

  async request(endpoint: string, parameters: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    const body = new URLSearchParams();
    for (const [key, value] of Object.entries(parameters)) {
      if (value !== undefined) body.set(key, value === null ? '' : String(value));
    }
    body.set('api_key', this.config.apiKey);
    try {
      const response = await this.fetcher(new URL(`api/${endpoint}.php`, this.config.baseUrl), {
        method: 'POST', body, redirect: 'error', signal: AbortSignal.timeout(this.timeout),
      });
      if (!response.ok) throw new WallosError(`Wallos returned HTTP ${response.status}. Check its availability and API configuration.`);
      const reader = response.body?.getReader();
      if (!reader) throw new WallosError('Wallos returned an empty response.');
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.length;
          if (size > 2 * 1024 * 1024) {
            await reader.cancel();
            throw new WallosError('Wallos response exceeds 2 MiB. Narrow your filters.');
          }
          chunks.push(value);
        }
      } finally { reader.releaseLock(); }
      const data: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (!data || typeof data !== 'object' || Array.isArray(data) || !('success' in data)) throw new WallosError('Wallos returned an unexpected response.');
      if (data.success !== true) throw new WallosError('Wallos rejected the request. Check the API key, resource ownership, and field values.');
      return redact(data, [this.config.apiKey, this.config.token]) as Record<string, unknown>;
    } catch (error) {
      if (error instanceof WallosError) throw error;
      throw new WallosError('Wallos request failed or timed out. Check connectivity and API compatibility. Writes are not retried; verify the subscription before repeating a write.');
    }
  }
}
