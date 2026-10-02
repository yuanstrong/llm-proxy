# llm-proxy

`llm-proxy` is a local TypeScript proxy manager for routing Claude-compatible client requests to multiple configured LLM providers. A resident management server runs on port `3000`; each provider can be started as an independent child proxy process on its own configured port.

## Features

- Supports Anthropic Messages, OpenAI Chat Completions, and OpenAI Responses request paths.
- Runs one management server and one optional child process per provider.
- Rewrites a JSON request's `model` field when a mapping exists.
- Passes through unmapped models and non-JSON request bodies unchanged.
- Forwards upstream response headers and bodies directly, including streaming responses.
- Supports both HTTP and HTTPS upstream endpoints.
- Uses an optional provider API key as `x-api-key` for Anthropic and as a bearer token for OpenAI-compatible APIs.
- Serves a management console at `http://127.0.0.1:3000/`.
- Starts and stops providers through the UI or management API.
- Stores provider PID files under `$LLM_PROXY_HOME/var/pids`.
- Captures each provider's stdout/stderr under `$LLM_PROXY_HOME/var/logs/<provider>.log` and prefixes those lines in the manager console.
- Shows configured and running providers, supported upstream endpoints, and copyable OpenAI/Anthropic client base URLs in the management console.
- Provides provider/level log filtering and a newest-first prompt history for proxied requests and provider responses.
- Stores prompt history as JSONL under `$LLM_PROXY_HOME/var/history/<provider>.jsonl`.
- Uses React with Tailwind CSS, local shadcn/ui primitives, and lucide-react icons for the management console.
- Uses Winston for provider log levels, formatting, console transports, and testable log transports.
- Runs lint, unit tests, build, and artifact upload as sequential GitHub Actions jobs.
- Flushes both provider log files and the manager console forwarding before a provider stop or manager shutdown completes.
- At `debug` level, logs every proxy request and its final response status, outcome, and duration.

## Requirements

- Node.js
- pnpm

Install dependencies with:

```bash
pnpm install
```

## Configuration

The proxy loads `config.toml` from the project root. The default configuration looks like this:

```toml
[providers.deepseek]
listen = "127.0.0.1:9876"
api_key = "sk-xxx"
log_level = "info"

[providers.deepseek.endpoints]
anthropic = "https://api.example.com/anthropic"
openai-completions = "https://api.example.com/v1/chat/completions"
openai-responses = "https://api.example.com/v1/responses"

[providers.deepseek.models]
"claude-sonnet-4-6" = "provider-model-name"

[providers.ollama-local]
listen = "127.0.0.1:9878"

[providers.ollama-local.endpoints]
openai-completions = "http://localhost:11434/v1/chat/completions"

[providers.ollama-local.models]
"claude-sonnet-4-6" = "llama3:latest"
```

Configuration fields:

- Management server: fixed at `127.0.0.1:3000`.
- `[providers.<name>]`: A provider definition. `api_key` is optional.
- `providers.<name>.listen`: The child proxy bind address in `host:port` format.
- `providers.<name>.log_level`: Child-process logging threshold: `debug`, `info`, `warn`, or `error`. Defaults to `info`.
- `[providers.<name>.endpoints]`: Upstream URLs keyed by supported API format. Anthropic entries may be either a base URL or a complete `/v1/messages` URL.
- `[providers.<name>.models]`: Client model name to upstream model name mappings.

Keep API keys in a locally protected configuration file. The application does not encrypt them or load them from a separate secret store.

For local development, create a `.env` file from `.env.example`. The manager loads `.env` before reading `config.toml`, and TOML string values can reference environment variables with `${NAME}` syntax:

```toml
[providers.deepseek]
api_key = "${DEEPSEEK_API_KEY}"
```

Shell environment variables take precedence over values in `.env`. A referenced variable that is not set causes startup to fail with a configuration error. `.env` is ignored by Git.

Runtime data is controlled by `LLM_PROXY_HOME`:

```bash
LLM_PROXY_HOME=/tmp/my-llm-proxy
```

If unset, it defaults to `~/.llm_proxy`. PID files are written to `$LLM_PROXY_HOME/var/pids/<provider>.pid`, and provider logs are written to `$LLM_PROXY_HOME/var/logs/<provider>.log`.

## Running

Build and start the resident manager:

```bash
pnpm install
pnpm run build
pnpm run start:built
```

Run the same checks locally as CI:

```bash
pnpm lint
pnpm test
pnpm run build
```

The GitHub Actions workflow runs these stages in order: `lint` → `unit-test` → `build` → `upload-artifact`. The final build artifact is published as `llm-proxy-dist`.

The manager listens on:

- Management console: `http://127.0.0.1:3000/`

Open `http://127.0.0.1:3000/` in a browser. The console has three views:

- Overview lists every configured provider, its running state, supported upstream endpoints, and copyable `/openai` and `/anthropic` base URLs. Expand a provider to start or stop it.
- Logs can be filtered by provider and exact log level (`debug`, `info`, `warn`, or `error`).
- Prompt history lists captured user prompts and provider responses in reverse chronological order, with provider, model, format, status, and duration metadata.

The proxy ports are only available after starting their provider from the UI. For example, after starting `deepseek`:

```text
http://127.0.0.1:8964/openai/v1/chat/completions
```

For development with automatic restart:

```bash
pnpm run build:ui
pnpm dev
```

Build the backend and management console separately, or together:

```bash
pnpm run build:backend  # TypeScript backend -> dist/server
pnpm run build:ui       # Vite management console -> dist/ui
pnpm run build          # both outputs
LLM_PROXY_HOME=/tmp/my-llm-proxy pnpm run start:built
```

The process exits with an error if a provider is missing its listen address, has invalid endpoints, or has no valid endpoints.

On startup, the manager prints port `3000` and the number of configured providers. Provider child processes print their own listen address.

## Request routing

Each provider listener exposes protocol-specific local base paths. Configure Claude Code with
`http://127.0.0.1:<provider-port>/anthropic` and Codex with
`http://127.0.0.1:<provider-port>/openai`.

The request path determines the API format:

| Client path | Format | Configuration key |
| --- | --- | --- |
| `HEAD /anthropic` | Anthropic health check | local |
| `GET /anthropic/v1/models` | Anthropic Models | local provider model mappings |
| `/anthropic/v1/messages` | Anthropic Messages | `anthropic` |
| `/openai/v1/chat/completions` | OpenAI Chat Completions | `openai-completions` |
| `/openai/v1/responses` | OpenAI Responses | `openai-responses` |

The proxy ignores query strings when detecting the format. `HEAD /anthropic` returns a local health-check response. `GET /anthropic/v1/models` returns the configured client-facing model IDs in Anthropic Models API format and supports `limit` from 1 to 1000. Other paths that do not exactly match a supported API path return `400`. If the configured provider child does not define an endpoint for the detected format, the proxy also returns `400`.

The local `/anthropic` and `/openai` prefixes are independent from the upstream URLs in `providers.<name>.endpoints`. For example, a request to `/openai/v1/chat/completions` uses that provider's `openai-completions` endpoint, while a request to `/anthropic/v1/messages` uses its `anthropic` endpoint. The proxy does not convert Anthropic requests to OpenAI requests, or vice versa.

For a JSON request body, the proxy replaces `model` only when that model appears in the configured mapping. It updates `Content-Length` after a replacement. Invalid JSON and unmapped models pass through unchanged. For Anthropic requests, an endpoint configured as a base URL (for example `https://api.deepseek.com/anthropic`) receives `/v1/messages`; an endpoint that already ends in `/v1/messages` is used as-is.

Debug request logs include the provider name, HTTP method, URL, response status, whether the response finished or the client disconnected, and processing duration. Request and response bodies are not logged.

Each provider child must support the format that its client sends.

The management API used by the console is available at `GET /admin/api/status`, `GET /admin/api/logs`, and `GET /admin/api/prompt-history`. Log requests accept `provider`, `level`, and `limit` query parameters; history requests accept `provider` and `limit`. Prompt history stores extracted text from common Anthropic/OpenAI JSON and SSE responses, with a bounded response capture. API keys are not included in management API responses.

## Error handling and scope

- Upstream connection errors return `502 Bad Gateway` when no response has been sent yet.
- Upstream status codes, headers, and response bodies are passed through.
- The management listener binds to `127.0.0.1:3000`.
- Provider processes bind to their individual `providers.<name>.listen` addresses.
- Provider lifecycle is managed through `POST /admin/api/providers/<name>/start` and `/stop`.
- The project does not currently provide retries, rate limiting, request logging, hot configuration reload, local TLS, or Ollama-native API routing.

## Project structure

```text
src/
├── server/
│   ├── index.ts   # Loads configuration and starts the server
│   ├── config.ts  # Parses and validates config.toml
│   ├── server.ts  # Proxy routing for one provider child process
│   ├── management-server.ts # Management API and static UI server
│   ├── provider-manager.ts # Provider child processes and PID files
│   ├── provider.ts # Child-process proxy entry point
│   ├── logger.ts   # Winston logger factory and transports
│   ├── runtime.ts  # LLM_PROXY_HOME and runtime directories
│   ├── proxy.ts   # Rewrites model names and forwards requests
│   └── ui.ts      # Serves the built management console
├── types/
│   └── index.ts   # Backend/frontend shared TypeScript types
└── ui/
    ├── index.html # Management console shell
    ├── main.tsx   # React entrypoint
    ├── App.tsx    # Console shell and view state
    ├── components/ # Overview, logs, history, and shadcn/ui primitives
    ├── lib/       # API helpers and cn() utility
    └── styles.css # Tailwind theme and global styles
```

## License

MIT
