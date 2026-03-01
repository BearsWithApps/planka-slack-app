# planka-slack-app

A small Node.js Slack app that unfurls [Planka](https://planka.app) card links in Slack. When a Planka card URL is pasted, it fetches the card details from Planka's API and calls `chat.unfurl` to show a rich preview — card name, board › list breadcrumb, description, assignees, and tasks.

---

## Built by BearsWithApps

This project was designed and built by the [BearsWithApps](https://bearswithapps.com) AI agent team.

---

## How It Works

1. Slack fires a `link_shared` event when a user pastes a Planka card URL.
2. The app extracts the card ID from the URL.
3. It calls the Planka REST API to fetch card, board, list, and member data.
4. It calls `chat.unfurl` with a Block Kit attachment.

---

## Slack App Setup

### Creating the Slack App

The easiest way to create the app is from the included manifest:

1. Go to [https://api.slack.com/apps](https://api.slack.com/apps) → **Create New App** → **From a manifest**
2. Paste the contents of `slack-app-manifest.yaml`
3. Click **Create**
4. Install the app to your workspace and collect your tokens:
   - **`SLACK_BOT_TOKEN`** — Bot User OAuth Token (`xoxb-…`) from the **OAuth & Permissions** page
   - **`SLACK_APP_TOKEN`** — App-Level Token with `connections:write` scope (`xapp-…`) from the **Basic Information** page under *App-Level Tokens*
5. **Note:** Socket Mode is enabled — no public URL required.

---

### 1. Create a Slack App (manual alternative)

Go to [api.slack.com/apps](https://api.slack.com/apps) → **Create New App** → **From scratch**.

### 2. Enable Link Unfurling

- **Event Subscriptions** → enable and set your Request URL to `https://<your-host>/slack/events`
- Subscribe to the **`link_shared`** bot event
- Under **App Unfurl Domains**, add your Planka instance's domain (e.g. `tasks.example.com`)

### 3. OAuth & Permissions

Add these Bot Token Scopes:
- `links:read`
- `links:write`
- `chat:write` (needed by Bolt for unfurls)

Install the app to your workspace and copy the **Bot User OAuth Token**.

### 4. (Optional) Socket Mode

If you don't want to expose a public HTTP endpoint, enable **Socket Mode** in your Slack app settings and generate an **App-Level Token** (`connections:write` scope). Set `SLACK_APP_TOKEN` in your `.env` and the app will connect via WebSocket.

---

## Environment Variables

Copy `.env.example` to `.env` and fill in the values:

| Variable | Description |
|---|---|
| `SLACK_BOT_TOKEN` | Bot OAuth token (`xoxb-…`) |
| `SLACK_SIGNING_SECRET` | Basic Information → App Credentials → Signing Secret → click "Show" |
| `SLACK_APP_TOKEN` | App-level token for Socket Mode (optional) |
| `PLANKA_BASE_URL` | e.g. `https://tasks.example.com` |
| `PLANKA_EMAIL` | Planka bot account email |
| `PLANKA_PASSWORD` | Planka bot account password |
| `PORT` | HTTP port (default `3000`, ignored in socket mode) |

---

## Running Locally

```bash
npm install
cp .env.example .env
# edit .env
npm start
```

For auto-restart on file changes (Node 20+):
```bash
npm run dev
```

---

## Deploying to Coolify

1. **Create a new resource** in Coolify → Docker Image or Git-based → point to this repo.
2. Set the **Dockerfile** as the build source.
3. Add all env vars from `.env.example` in Coolify's environment section.
4. **Port mapping**: `3000:3000` (or whichever `PORT` you set).
5. Set up a **domain** in Coolify and update your Slack app's Request URL to `https://<domain>/slack/events`.
6. Deploy. ✅

> **Tip:** Using Socket Mode (`SLACK_APP_TOKEN`) avoids needing a public URL — great for internal Coolify deployments behind a firewall.

---

## Project Structure

```
src/
  index.js    — Slack Bolt app entry point, link_shared handler
  planka.js   — Planka REST API client (auth, card/board/list fetch)
  unfurl.js   — Block Kit attachment builder
Dockerfile
.env.example
```

---

## Planka API Notes

- **Auth:** `POST /api/access-tokens` with `{ emailOrUsername, password }` → returns a token string.
- **Get card:** `GET /api/cards/:id` with `Authorization: Bearer <token>`. Response includes `item` (card) and `included` (boards, lists, users, cardMemberships).
- Tokens are long-lived; the client re-authenticates after 23 hours automatically.
