# Wallos MCP

A portable MCP server for a self-hosted [Wallos](https://github.com/ellite/Wallos) subscription tracker. Run it as a Node.js process or Docker container and connect an MCP client using a Bearer token.

## Project status and authorship

This project is vibe coded: its implementation and documentation were created with AI assistance and should be reviewed, tested, and adapted before production use. You remain responsible for validating deployments, credentials, data changes, and security controls in your environment.

Copyright (c) 2026 [Welton Felix](https://github.com/weltonfelix). Licensed under the MIT License; see [LICENSE](LICENSE).

The server targets the Wallos 5.x API. Endpoint contracts were checked against Wallos 5.5.0 source; automated tests use mocked Wallos responses, not a live instance or every 5.x release. See the [Wallos API documentation](https://api.wallosapp.com/).

## Requirements

- Wallos 5.x with an API key generated in your user profile.
- Docker with Compose v2, or Node.js 22+ and npm for local use.
- An MCP client supporting Streamable HTTP and a custom Authorization header.

One server instance uses one Wallos account. Everyone holding the MCP token can read and modify that account's subscriptions.

## Configuration

Copy `.env.example` to `.env` and replace both secret placeholders. Generate an MCP token with `openssl rand -hex 32`. Do not commit `.env`.

| Variable | Required | Meaning |
| --- | --- | --- |
| `WALLOS_BASE_URL` | Yes | Absolute HTTP(S) instance URL, optionally with a subpath. Use `http://wallos` for the bundled Compose example. |
| `WALLOS_API_KEY` | Yes | Your Wallos user API key. |
| `MCP_AUTH_TOKEN` | Yes | Independent random token, at least 32 characters. |
| `MCP_PORT` | No | Container/process listener port; defaults to `3000`. |

The process listens on `0.0.0.0`. Configuration is read at startup; restart to rotate credentials. URL credentials, query strings, and fragments are rejected. `npm run dev` loads the repository's `.env` file automatically; existing shell environment variables take precedence. For other launch methods, environment files are loaded by Docker Compose, `docker run --env-file`, or Node's `--env-file`.

## Docker

Build the image locally:

```sh
docker build -t wallos-mcp:local .
docker run --rm --env-file .env -p 127.0.0.1:3000:3000 wallos-mcp:local
```

This port mapping assumes `MCP_PORT=3000`; adjust its container port if changed. Set `WALLOS_BASE_URL` to an address reachable from the container. `localhost` inside a container refers to that container, not your host or another container.

For Compose:

```sh
docker compose -f compose.example.yaml --env-file .env config --quiet
docker compose -f compose.example.yaml --env-file .env up -d --build
```

The example includes Wallos with persistent named volumes and the MCP service on Compose's default network. It intentionally publishes no ports and configures no domain. Add your own proxy on that network, targeting `wallos-mcp:3000` (or your configured port), and provide separate access to the Wallos UI for initial account/API-key setup. Start Wallos first if you need to generate a key before starting MCP.

For an existing Wallos stack, copy only the `wallos-mcp` service, remove or adapt `depends_on`, and use either a built image or the correct build context. Ensure both services share a Docker network. Never mount the Docker socket or Wallos database into MCP. Back up the Wallos volumes before testing writes against important data.

The image runs as a non-root user and supports a read-only filesystem. `/healthz` is a public liveness endpoint and Docker health check; it does **not** verify Wallos connectivity or credentials. No database or persistent volume is needed for MCP.

## Connect an MCP client

Configure a Streamable HTTP connection with:

```json
{
  "url": "https://your-mcp-host.example/mcp",
  "headers": {
    "Authorization": "Bearer YOUR_MCP_AUTH_TOKEN"
  }
}
```

This is a connection illustration, not a universal client configuration file; use your client's HTTP server settings and secret storage. This server uses static Bearer authentication, not OAuth. Clients requiring OAuth-only discovery cannot authenticate to it.

For a manual protocol check, export `MCP_AUTH_TOKEN` in your shell and run:

```sh
curl -sS http://127.0.0.1:3000/mcp \
  -H "Authorization: Bearer $MCP_AUTH_TOKEN" \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  --data '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"manual-check","version":"1.0.0"}}}'
```

Use HTTPS when accessing the endpoint over a network. TLS is terminated by your reverse proxy; preserve the Authorization header and `/mcp` path. Do not log headers or request bodies. The protocol is stateless: POST returns JSON, GET and DELETE return 405, and no session identifier or persistent SSE stream is required. Browser Origin headers are rejected; browser-based direct access and CORS are not supported.

## Tools

| Tool | Inputs and behavior |
| --- | --- |
| `list_subscriptions` | Optional `member`, `category`, `payment` arrays of IDs, `state` (0 active/1 inactive), `sort`, `convert_currency`, `disabled_to_bottom`. |
| `get_subscription` | Required `id`; optional `convert_currency`. |
| `create_subscription` | Required `name`, `price`, `currency_id`, `frequency`, `cycle`, `next_payment`. |
| `update_subscription` | Required `id` and at least one editable field. Omitted fields are preserved. |
| `delete_subscription` | Required `id` and literal `confirm: true`. Deletes the Wallos record, not the subscription at its external provider. |
| `get_monthly_cost` | Required `month` (1–12) and `year`. Returns Wallos's calculation and currency warnings. |
| `get_reference_data` | No inputs. Returns categories, currencies, payment methods, and household response objects, including the main currency. |

Call `get_reference_data` before creating subscriptions to resolve IDs. Billing cycles are `1` days, `2` weeks, `3` months, `4` years; `frequency` is the number of those units per payment. Prices are per payment, not normalized monthly prices. Dates are valid `YYYY-MM-DD` strings.

Optional editable fields are `start_date`, `auto_renew`, `payment_method_id`, `payer_user_id`, `category_id`, `notes`, `url`, `notify`, `notify_days_before`, `inactive`, `cancellation_date`, and `replacement_subscription_id`. Flags use integer 0/1. Updates accept null to clear reference IDs, cancellation date, or notification lead time; empty strings clear notes and URL. Omitted creation defaults are supplied by Wallos. Logos/uploads and administrative configuration are outside this tool set.

Example creation arguments (substitute a real currency ID and date):

```json
{
  "name": "Example service",
  "price": 12.5,
  "currency_id": 1,
  "frequency": 1,
  "cycle": 3,
  "next_payment": "2027-01-01"
}
```

`confirm: true` is a guard against accidental tool calls, not an interactive approval system. Configure client-side approvals if you require a human to approve writes. Returned subscription content is user data, not instructions to the assistant.

## Security and errors

All Wallos calls use form-encoded POST bodies, keeping the API key out of URLs. Redirects are rejected. The client limits responses to 2 MiB and requests to 15 seconds; MCP JSON bodies are limited to 64 KiB. Known credentials and sensitive response field names are redacted. Raw upstream failures are not returned or logged.

Writes are never retried automatically. A timeout can occur after Wallos committed a change: read back the record before repeating a write to avoid duplicates. The configured base URL is operator-controlled; clients cannot choose arbitrary upstream URLs. Keep the service behind a trusted network/proxy and apply deployment-specific rate limits there.

## Development and verification

```sh
npm ci
npm run typecheck
npm run lint
npm test
npm run build
node --env-file=.env dist/index.js
```

For development, copy `.env.example` to `.env`, fill in your credentials, and run `npm run dev`. No manual export is needed. The command requires `.env` to exist. Restart it after changing `.env`; source changes restart automatically. Tests drive the real MCP client/server handshake over localhost and mock the Wallos HTTP boundary. CI additionally validates Compose, builds the Docker image, and checks container liveness, non-root execution, and unauthenticated request rejection.

## Troubleshooting

- **Startup exits:** verify required variables, token length, URL syntax, and port range. Startup errors deliberately omit supplied values.
- **401:** send the MCP token, not the Wallos API key, in the Authorization header. Check proxy header forwarding.
- **403:** direct browser requests carrying an Origin header are unsupported.
- **405:** use Streamable HTTP POST, not legacy `/sse` transport.
- **Wallos rejects a tool call:** verify the API key, Wallos version, field values, and ownership of all supplied IDs. HTTP 200 from Wallos does not guarantee success.
- **Timeout or connectivity failure:** test reachability from the MCP container; check Docker network membership, base URL subpath, DNS, and TLS trust. Redirecting login/proxy URLs will fail by design.
- **Health is green but tools fail:** health reports only process liveness. Run `get_reference_data` to verify the Wallos connection.

No production Wallos instance is modified by the automated test suite.
