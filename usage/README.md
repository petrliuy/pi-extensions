# Usage Extension

Provider quota and balance reporting for Pi.

## Commands

- `/usage` - Query usage for the selected model's provider
- `/usage all` - Query every provider in `~/.pi/agent/models.json`
- `/usage <provider>` - Query one provider or alias
- `/usage help` - Show command help

## Behavior

The command queries provider quota or balance data. It does not use manually configured 5-hour, weekly, or monthly limits.

The extension also keeps a compact status line below the editor for the current model's provider, for example:

```text
5h 32% · weekly 89%
```

The status line refreshes on startup, `/usage`, model changes, and after agent runs.

Authentication rules:

- OAuth is used only for OAuth-only subscription usage, currently Codex/ChatGPT usage through the active `openai-codex` model.
- API-key providers read `apiKey` and `baseUrl` from `~/.pi/agent/models.json`.
- Provider CLIs are not installed or invoked.
- If no verified quota endpoint is mapped, `/usage` reports `unsupported` instead of guessing.

## Current adapters

- `openai-codex` - OAuth Codex usage endpoint, showing 5-hour and weekly usage when available.
- `zhipu` / `z.ai` - API-key monitor usage endpoints for model usage, tool usage, and quota limits.
- `xiaomi-token-plan` - Cookie-authenticated token-plan usage endpoint.
- `deepseek` - API-key balance endpoint.
- `kimi` / `moonshot` - API-key balance endpoint.

Known unsupported until a verified API-key endpoint is mapped:

- `minimax` - public docs expose `mmx quota`, but this extension does not depend on CLIs.
- `claude`, `gemini`, `opencode-go`, and cloud billing providers.

## Provider config

API-key adapters use existing provider entries in `~/.pi/agent/models.json`.

Cookie-based adapters read local-only settings from `~/.pi/agent/usage.json`. Example:

```json
{
  "providers": {
    "xiaomi-token-plan": {
      "usageEndpoint": "https://platform.xiaomimimo.com/api/v1/tokenPlan/usage",
      "cookie": "<full Cookie header value>"
    }
  }
}
```

Do not commit cookies or paste them into repository files.

Reload extensions with `/reload` after editing.
