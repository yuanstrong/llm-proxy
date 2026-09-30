# LLM Proxy Redesign

## 概述

将当前单文件硬编码代理改造成基于 TOML 配置的多 provider LLM 代理。启动时通过环境变量选择目标 provider，代理负责：接收客户端请求 → 自动检测 API 格式 → 匹配 provider 对应 endpoint → 模型名替换 → 透传转发。

**核心理念**：代理不做请求/响应格式翻译。客户端发什么格式，provider 必须支持该格式并提供对应 endpoint。代理只做路由 + model 名替换。

## 技术栈

| 角色 | 选择 |
|------|------|
| 语言 | TypeScript |
| 运行时 | tsx（开发/运行） |
| 包管理 | pnpm |
| HTTP | 原生 `http` / `https`，零框架依赖 |
| 配置解析 | `@iarna/toml` |
| 环境变量 | `dotenv`（可选，开发用）+ 手动 `process.env` |

## 项目结构

```
llm-proxy/
├── src/
│   ├── index.ts         # 入口：读取环境变量 → 加载配置 → 启动
│   ├── server.ts        # HTTP server：路由分发
│   ├── proxy.ts         # 纯函数：model 名替换 + pipe 转发
│   ├── config.ts        # TOML 解析 + 按环境变量筛选 provider + 校验
│   └── types.ts         # 类型定义
├── config.toml          # 默认配置文件
├── tsconfig.json
├── package.json
└── pnpm-lock.yaml
```

## 配置文件结构

### config.toml

```toml
listen = "127.0.0.1:8964"

[providers.deepseek]
api_key = "sk-xxx"

[providers.deepseek.endpoints]
anthropic = "https://api.deepseek.com/anthropic"
openai-completions = "https://api.deepseek.com/v1/chat/completions"
openai-responses = "https://api.deepseek.com/v1/responses"

[providers.deepseek.models]
"claude-opus-4-7" = "deepseek-v4-pro"
"claude-sonnet-4-6" = "deepseek-v4-flash"
"claude-haiku-4-5" = "deepseek-v4-haiku"

[providers.anthropic]
api_key = "sk-ant-xxx"

[providers.anthropic.endpoints]
anthropic = "https://api.anthropic.com/v1/messages"

[providers.anthropic.models]
"claude-opus-4-7" = "claude-opus-4-7-20250219"
"claude-sonnet-4-6" = "claude-sonnet-4-6-20250508"

[providers.ollama-local]

[providers.ollama-local.endpoints]
openai-completions = "http://localhost:11434/v1/chat/completions"

[providers.ollama-local.models]
"claude-sonnet-4-6" = "llama3:latest"
"claude-haiku-4-5" = "qwen2.5:7b"
```

### 配置说明

- `listen` — 代理监听地址与端口，格式 `host:port`
- `[providers.<name>]` — provider 定义块
  - `api_key` — 可选（如 Ollama 本地部署可不填）
  - `[providers.<name>.endpoints]` — 该 provider 支持的 API 格式到完整 endpoint URL 的映射
  - `[providers.<name>.models]` — 本地模型名到该 provider 端实际模型名的映射表
- 每个 `endpoints` 条目是一个完整的 URL（含 path），代理直接使用不拼接任何路径
- 所有 `api_key` 值直接写在 TOML 中（本地代理，安全性依赖本地文件权限）

## API 格式自动检测

代理从客户端请求路径自动检测 API 格式：

| 请求路径 | 检测为格式 |
|----------|-----------|
| `/v1/messages` 或以 `/v1/messages` 开头 | `anthropic` |
| `/v1/chat/completions` | `openai-completions` |
| `/v1/responses` | `openai-responses` |

检测示例：
- `POST /v1/messages` → `anthropic`
- `POST /v1/messages?foo=bar` → `anthropic`（忽略 query string）
- `POST /anthropic/v1/messages` → 不匹配，返回 400

### 处理流程

```
接收请求
  │
  ├─ 1. 自动检测 API 格式（从 URL path）
  │   └─ 无法识别 → 400 "Unsupported API format. Supported paths: /v1/messages, /v1/chat/completions, /v1/responses"
  │
  ├─ 2. 查找 provider 是否支持该格式
  │   ├─ 有 endpoints.<format> → 继续，获得目标 URL
  │   └─ 无 → 400 "Provider 'deepseek' does not support anthropic format. Supported: openai-completions, openai-responses"
  │
  ├─ 3. 收集请求体
  │   ├─ 空 → 直接转发
  │   └─ 有数据
  │       ├─ JSON 解析成功 → 提取 model，查 models 映射表，替换 model，更新 Content-Length
  │       └─ JSON 解析失败 → 原样转发（灰度保护）
  │
  └─ 4. 转发
      ├─ URL = provider.endpoints.<format>
      ├─ 复制并更新 headers（host → 目标 host，Authorization）
      └─ http/https.request → pipe 响应
```

## 启动流程

```
用户执行：
  LLM_PROXY_PROVIDER=deepseek tsx src/index.ts

程序：
1. 读取环境变量 LLM_PROXY_PROVIDER（必须，缺失则报错退出）
2. 解析 config.toml
3. 查找 providers.<name>
   - 找不到则报错并列出可用 provider 名称
4. 校验：至少声明了一个 endpoint
5. 构造运行时配置对象（只包含选中 provider）
6. 启动 HTTP server 监听 listen 地址
7. 打印启动信息：监听地址、选中 provider 名、支持的格式列表、model 映射数
```

## 关键行为

- **model 映射未找到时透传**：不报错，原样转发。允许使用 provider 原生支持的、不在映射中的模型。
- **JSON 解析失败时透传**：不拦截，按原始 body 转发。
- **响应体不做任何修改**：直接 `proxyRes.pipe(res)`，天然支持 SSE 流式。
- **provider 只需声明自己支持的格式**：如果 DeepSeek 的 `/v1/responses` API 还不存在，配置里就不写 `openai-responses` 条目，代理会自动拒绝该格式的请求。
- **错误处理**：
  - 上游拒绝连接 → 502 Bad Gateway
  - 上游超时 → 504 Gateway Timeout（后续版本可配置超时时间）

## 类型定义要点

```typescript
// types.ts

type ApiFormat = 'anthropic' | 'openai-completions' | 'openai-responses';

interface ProviderConfig {
  name: string;
  api_key?: string;
  endpoints: Partial<Record<ApiFormat, string>>;  // 格式 → 完整 URL，至少一个
  models: Record<string, string>;                 // local_name → remote_name
}

interface AppConfig {
  listen: { host: string; port: number };
  provider: ProviderConfig;
}
```

## 安全与边界

- **本地使用**：默认绑定 `127.0.0.1`，不接受外部连接
- **TOML 中的 api_key**：以文件权限保护，不做额外加密
- **Content-Length 更新**：使用 `Buffer.byteLength` 而非 `string.length`，避免中文等多字节字符导致的截断

## 不在第一版范围内的内容

- 配置热加载（修改 TOML 需重启）
- 多 provider 同时运行（单实例单 provider）
- 请求/响应日志
- 请求重试
- 并发限流
- TLS/HTTPS 本地监听（由反向代理如 nginx 处理）
- Ollama 原生 API（Ollama 已支持 OpenAI Chat Completions 兼容）
