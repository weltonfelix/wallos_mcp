# Agent guidance

- Keep code, comments, errors, and documentation in English.
- `src/tools.ts` defines tool schemas; `src/wallos.ts` owns upstream requests and redaction; `src/server.ts` owns HTTP/authentication; `src/config.ts` validates environment settings.
- Run `npm run typecheck`, `npm run lint`, `npm test`, and `npm run build`. Tests need a localhost listener. Docker checks live in `.github/workflows/ci.yaml`.
- Wallos writes use `api/subscriptions/set_subscriptions.php` with form-encoded `action=add|edit|delete`. HTTP 200 can still contain `success: false`. Check upstream source before changing field mappings.
- Preserve omitted update fields. Do not retry writes automatically. Deletion requires literal `confirm: true`.
- Never log credentials, Authorization headers, request bodies, or raw upstream errors. Never accept an upstream URL or API key through a tool argument.
- Keep deployment examples portable and update README configuration/tool descriptions when behavior changes. Report Docker or live-Wallos checks as unverified when unavailable.
