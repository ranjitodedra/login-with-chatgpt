# Login with ChatGPT — Device-Code Demo

> **Demo only.** This uses the Codex CLI device-code OAuth flow, which is **not** an official "Login with ChatGPT" web SDK. OpenAI may change or block these endpoints at any time. Do not use in production without a supported auth path (e.g. AuthAI relay, API keys, or future official OAuth).

Minimal spike to test whether you can sign in with a ChatGPT account via the Codex device-code flow and send a chat message through the subscription Codex Responses API.

## Architecture

```
Browser (Vite :5173)
  → POST /api/auth/start, /api/auth/poll, /api/chat  (proxied)
Express backend (:3091)
  → auth.openai.com  (device code + OAuth token exchange)
  → chatgpt.com/backend-api/codex/responses  (chat)
```

All auth and API calls stay server-side. The browser never sees `device_auth_id`, access tokens, or refresh tokens.

### Flow

1. **Start** — `POST /auth/start` requests a device code from OpenAI.
2. **User action** — Open `https://auth.openai.com/codex/device` and enter the one-time code.
3. **Poll** — Frontend calls `POST /auth/poll` every few seconds until authorized.
4. **Exchange** — Backend exchanges the authorization code for access/refresh tokens.
5. **Chat** — `POST /chat` calls the Codex Responses API with the session token.

## Setup

### Prerequisites

- Node.js 18+
- **ChatGPT Plus / Pro / Business** subscription (for real auth + chat)
- Two terminals

### Install

```bash
# Backend
cd login-test/backend
npm install
cp ../.env.example ../.env   # edit SESSION_SECRET if you like

# Frontend
cd ../frontend
npm install
```

### Run

```bash
# Terminal 1 — backend on :3091
cd login-test/backend
npm run dev

# Terminal 2 — frontend on :5173
cd login-test/frontend
npm run dev
```

Open [http://localhost:5173](http://localhost:5173), click **Login with ChatGPT**, complete device auth, then send **hi**.

## Environment variables

Copy `login-test/.env.example` to `login-test/.env`:

| Variable | Default | Purpose |
|----------|---------|---------|
| `PORT` | `3091` | Express listen port |
| `SESSION_SECRET` | (required in prod) | Session cookie signing |
| `MOCK_MODE` | `0` | `1` = fake auth + mock chat (no OpenAI calls) |
| `DEBUG` | `0` | `1` = log poll attempts (never logs tokens) |
| `CODEX_CLIENT_ID` | `app_EMoamEEZ73f0CkXaXp7hrann` | Codex CLI OAuth client id |
| `CODEX_MODEL` | `gpt-5.5` | Model for `/chat` (ChatGPT OAuth; `gpt-5.3-codex` is deprecated) |

No `OPENAI_API_KEY` is needed — this uses your ChatGPT subscription token.

## API endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/auth/start` | Start device-code flow |
| `POST` | `/auth/poll` | Single poll attempt; returns `pending`, `complete`, or `error` |
| `GET` | `/me` | Current user info from JWT |
| `POST` | `/chat` | `{ "message": "hi" }` → `{ "text": "..." }` |
| `POST` | `/auth/logout` | Clear session |

## Mock mode

If you only want to test the UI without a ChatGPT subscription:

```env
MOCK_MODE=1
```

- Login shows a fake device code; poll succeeds after ~3 seconds.
- Chat returns `Mock reply to: <your message>`.

## Common failure points

| Symptom | Likely cause |
|---------|----------------|
| 404 on `/deviceauth/usercode` | Device auth disabled; try `MOCK_MODE=1` |
| Poll never completes | Code not entered, expired (15 min), or wrong account |
| 401/403 on `/codex/responses` | No Plus/Pro plan, expired token, or missing account id |
| 400 "instructions are required" | Codex API requires non-empty `instructions` in body |
| 400 on `input` | Must be message array, not a plain string |
| Empty chat response | SSE parse issue — enable `DEBUG=1` and check backend logs |
| CORS errors | Frontend must call `/api/*` only, never OpenAI directly |

## Folder structure

```
login-test/
  .env.example
  README.md
  backend/
    server.js
    auth.js
    openai.js
    session.js
  frontend/
    src/
      App.jsx
      pages/Login.jsx
      pages/Dashboard.jsx
```

## License

Same as parent repo. For experimentation only.
