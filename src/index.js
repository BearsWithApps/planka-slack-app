require('dotenv').config();

const http = require('http');
const { App } = require('@slack/bolt');
const PlankaClient = require('./planka');
const { buildCardUnfurl, buildBoardUnfurl, buildProjectUnfurl } = require('./unfurl');

const {
  SLACK_BOT_TOKEN,
  SLACK_SIGNING_SECRET,
  SLACK_APP_TOKEN,
  PLANKA_BASE_URL,
  PLANKA_EMAIL,
  PLANKA_PASSWORD,
} = process.env;

const PORT = parseInt(process.env.PORT, 10) || 3000;

// Validate required env vars at startup
const required = {
  SLACK_BOT_TOKEN,
  SLACK_SIGNING_SECRET,
  PLANKA_BASE_URL,
  PLANKA_EMAIL,
  PLANKA_PASSWORD,
};
for (const [key, val] of Object.entries(required)) {
  if (!val) {
    console.error(`Missing required env var: ${key}`);
    process.exit(1);
  }
}

// Slack Bolt app — socket mode if SLACK_APP_TOKEN is set, otherwise HTTP
const appConfig = {
  token: SLACK_BOT_TOKEN,
  signingSecret: SLACK_SIGNING_SECRET,
};

let app;
if (SLACK_APP_TOKEN) {
  // Socket Mode (easier for local dev / Coolify deploys without public ingress)
  const { App: BoltApp } = require('@slack/bolt');
  app = new BoltApp({
    ...appConfig,
    socketMode: true,
    appToken: SLACK_APP_TOKEN,
  });
} else {
  app = new App({
    ...appConfig,
    port: parseInt(PORT, 10),
  });
}

// Planka client (singleton — re-auths as needed)
const planka = new PlankaClient(PLANKA_BASE_URL, PLANKA_EMAIL, PLANKA_PASSWORD);

// Domain to watch for unfurling
const PLANKA_DOMAIN = 'tasks.entouraige.com';

// ---------------------------------------------------------------------------
// Health check — probes Planka connectivity with a short-lived login attempt.
// A separate client instance is used so we don't disturb the shared singleton's
// token state.  Result is cached for 30 s to avoid hammering Planka on every poll.
// ---------------------------------------------------------------------------

const HEALTH_CACHE_TTL_MS = 30 * 1000;
let healthCache = { ok: null, timestamp: 0 };

async function probeHealth() {
  const now = Date.now();
  if (healthCache.ok !== null && now - healthCache.timestamp < HEALTH_CACHE_TTL_MS) {
    return healthCache.ok;
  }

  try {
    // Temporary client — its token is discarded after this call
    const probe = new PlankaClient(PLANKA_BASE_URL, PLANKA_EMAIL, PLANKA_PASSWORD);
    await probe.login();
    healthCache = { ok: true, timestamp: now };
    return true;
  } catch (_err) {
    healthCache = { ok: false, timestamp: now };
    return false;
  }
}

async function handleHealthCheck(req, res) {
  const ok = await probeHealth();
  const status = ok ? 200 : 503;
  const body = ok
    ? { status: 'ok', planka: 'connected' }
    : { status: 'error', planka: 'unreachable' };
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

// ---------------------------------------------------------------------------
// URL parsers
// ---------------------------------------------------------------------------

/** Extract card ID from a Planka card URL: /cards/:id */
function extractCardId(url) {
  try {
    const { pathname } = new URL(url);
    const match = pathname.match(/^\/cards\/([^/]+)/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

/** Extract board ID from a Planka board URL: /boards/:id */
function extractBoardId(url) {
  try {
    const { pathname } = new URL(url);
    const match = pathname.match(/^\/boards\/([^/]+)/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

/** Extract project ID from a Planka project URL: /projects/:id */
function extractProjectId(url) {
  try {
    const { pathname } = new URL(url);
    const match = pathname.match(/^\/projects\/([^/]+)/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Unfurl handlers per URL type
// ---------------------------------------------------------------------------

async function unfurlCardLink(link, logger) {
  const cardId = extractCardId(link.url);
  if (!cardId) return null;

  const [{ card, project, board, list, members }, tasks] = await Promise.all([
    planka.getCard(cardId),
    planka.getCardTasks(cardId).catch((err) => {
      logger.warn(`Could not fetch tasks for card ${cardId}: ${err.message}`);
      return [];
    }),
  ]);

  return buildCardUnfurl({ card, project, board, list, members, tasks, cardUrl: link.url });
}

async function unfurlBoardLink(link, logger) {
  const boardId = extractBoardId(link.url);
  if (!boardId) return null;

  const { board, project, lists, cardCountByList } = await planka.getBoardWithCards(boardId);
  return buildBoardUnfurl({ board, project, lists, cardCountByList, boardUrl: link.url });
}

async function unfurlProjectLink(link, logger) {
  const projectId = extractProjectId(link.url);
  if (!projectId) return null;

  const { project, boards } = await planka.getProject(projectId);
  return buildProjectUnfurl({ project, boards, projectUrl: link.url });
}

// ---------------------------------------------------------------------------
// Minimal fallback unfurl when we can't fetch data
// ---------------------------------------------------------------------------

function fallbackUnfurl(url, label) {
  return {
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*<${url}|${label}>*\n_Could not load details — Planka may be unreachable._`,
        },
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// link_shared event handler
// ---------------------------------------------------------------------------

app.event('link_shared', async ({ event, client, logger }) => {
  const { channel, message_ts, links } = event;

  // Only process links from our Planka domain
  const plankaLinks = links.filter((l) => l.domain === PLANKA_DOMAIN);
  if (plankaLinks.length === 0) return;

  const unfurls = {};

  await Promise.all(
    plankaLinks.map(async (link) => {
      try {
        let payload = null;

        if (link.url.includes('/cards/')) {
          payload = await unfurlCardLink(link, logger);
        } else if (link.url.includes('/boards/')) {
          payload = await unfurlBoardLink(link, logger);
        } else if (link.url.includes('/projects/')) {
          payload = await unfurlProjectLink(link, logger);
        }

        if (payload) {
          unfurls[link.url] = payload;
        }
      } catch (err) {
        logger.error(`Failed to unfurl ${link.url}:`, err.message);
        unfurls[link.url] = fallbackUnfurl(link.url, 'Planka Link');
      }
    })
  );

  if (Object.keys(unfurls).length === 0) return;

  try {
    await client.chat.unfurl({
      channel,
      ts: message_ts,
      unfurls,
    });
  } catch (err) {
    logger.error('chat.unfurl failed:', err.message);
  }
});

// ---------------------------------------------------------------------------
// App startup
// ---------------------------------------------------------------------------

(async () => {
  await app.start();
  console.log(`⚡ planka-slack-app running (${SLACK_APP_TOKEN ? 'socket mode' : `HTTP :${PORT}`})`);

  // Standalone health check server — completely separate from Bolt/Socket Mode.
  // SocketModeReceiver has no Express app, so we never touch app.receiver here.
  const hcPort = parseInt(PORT, 10);
  http
    .createServer(async (req, res) => {
      if (req.method === 'GET' && req.url === '/') {
        await handleHealthCheck(req, res);
      } else {
        res.writeHead(404);
        res.end();
      }
    })
    .listen(hcPort, () => {
      console.log(`Health check server listening on :${hcPort}/`);
    });
})();
