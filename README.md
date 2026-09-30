# llm-proxy

`llm-proxy` is a small TypeScript HTTP proxy for routing Claude-compatible client requests to a selected LLM provider. It reads provider definitions from `config.toml`, chooses one provider with `LLM_PROXY_PROVIDER`, maps client-facing model names to provider model names, and forwards requests without translating their API format.

## Features

- Supports Anthropic Messages, OpenAI Chat Completions, and OpenAI Responses request paths.
- Selects one configured provider per process.
- Rewrites a JSON request's `model` field when a mapping exists.
- Passes through unmapped models and non-JSON request bodies unchanged.
- Forwards upstream response headers and bodies directly, including streaming responses.
- Supports both HTTP and HTTPS upstream endpoints.
- Uses an optional provider API key as a bearer token.

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
listen = "127.0.0.1:9876"

[providers.deepseek]
api_key = "sk-xxx"

[providers.deepseek.endpoints]
anthropic = "https://api.example.com/anthropic"
openai-completions = "https://api.example.com/v1/chat/completions"
openai-responses = "https://api.example.com/v1/responses"

[providers.deepseek.models]
"claude-sonnet-4-6" = "provider-model-name"

[providers.ollama-local]

[providers.ollama-local.endpoints]
openai-completions = "http://localhost:11434/v1/chat/completions"

[providers.ollama-local.models]
"claude-sonnet-4-6" = "llama3:latest"
```

Configuration fields:

- `listen`: Bind address in `host:port` format.
- `[providers.<name>]`: A provider definition. `api_key` is optional.
- `[providers.<name>.endpoints]`: Complete upstream URLs keyed by supported API format.
- `[providers.<name>.models]`: Client model name to upstream model name mappings.

Keep API keys in a locally protected configuration file. The application does not encrypt them or load them from a separate secret store.

## Running

Choose a provider when starting the proxy:

```bash
LLM_PROXY_PROVIDER=deepseek pnpm start
```

For development with automatic restart:

```bash
LLM_PROXY_PROVIDER=deepseek pnpm dev
```

The process exits with an error if `LLM_PROXY_PROVIDER` is missing, the provider is not configured, the listen address is invalid, or the selected provider has no valid endpoints.

On startup, the proxy prints its listen address, selected provider, supported formats, and number of configured model mappings.

## Request routing

The request path determines the API format:

| Client path | Format | Configuration key |
| --- | --- | --- |
| `/v1/messages` | Anthropic Messages | `anthropic` |
| `/v1/chat/completions` | OpenAI Chat Completions | `openai-completions` |
| `/v1/responses` | OpenAI Responses | `openai-responses` |

The proxy ignores query strings when detecting the format. Paths with an unsupported prefix return `400`. If the selected provider does not define an endpoint for the detected format, the proxy also returns `400`.

For a JSON request body, the proxy replaces `model` only when that model appears in the configured mapping. It updates `Content-Length` after a replacement. Invalid JSON and unmapped models pass through unchanged.

The proxy does not convert Anthropic requests to OpenAI requests, or vice versa. The selected provider must support the format that the client sends.

## Error handling and scope

- Upstream connection errors return `502 Bad Gateway` when no response has been sent yet.
- Upstream status codes, headers, and response bodies are passed through.
- The default listener binds to `127.0.0.1`.
- One process serves one selected provider. Restart the process to change providers or configuration.
- The project does not currently provide retries, rate limiting, request logging, hot configuration reload, local TLS, or Ollama-native API routing.

## Project structure

```text
src/
├── index.ts   # Loads configuration and starts the server
├── config.ts  # Parses and validates config.toml
├── server.ts  # Detects API formats and selects endpoints
├── proxy.ts   # Rewrites model names and forwards requests
└── types.ts   # Shared TypeScript types
```

## License

MIT
