/**
 * Builds Slack Block Kit unfurl payloads for Planka cards, boards, and projects.
 */

// ---------------------------------------------------------------------------
// Card unfurl
// ---------------------------------------------------------------------------

/**
 * Builds a clean Block Kit unfurl for a Planka card.
 *
 * @param {object} params
 * @param {object}       params.card     - Planka card item
 * @param {object|null}  params.project  - Planka project
 * @param {object|null}  params.board    - Planka board
 * @param {object|null}  params.list     - Planka list
 * @param {Array}        params.members  - User objects assigned to card
 * @param {Array}        params.tasks    - Task objects for the card
 * @param {string}       params.cardUrl  - The original URL that was shared
 * @returns {{ blocks: Array }} Slack blocks payload for chat.unfurl
 */
function buildCardUnfurl({ card, project, board, list, members, tasks, cardUrl }) {
  const blocks = [];

  // ── Header: card title linked to card URL ─────────────────────────────────
  // Header blocks don't support links, so use a bold section link instead.
  blocks.push({
    type: 'section',
    text: {
      type: 'mrkdwn',
      text: `*📋 <${cardUrl}|${escapeText(card.name)}>*`,
    },
  });

  // ── Breadcrumb: Project › Board › List ────────────────────────────────────
  const breadcrumbParts = [project?.name, board?.name, list?.name].filter(Boolean);
  if (breadcrumbParts.length > 0) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: breadcrumbParts.map(escapeText).join(' › '),
      },
    });
  }

  // ── Divider ───────────────────────────────────────────────────────────────
  blocks.push({ type: 'divider' });

  // ── Fields row 1: Assignees + Tasks (omit if empty) ─────────────────────
  const fields1 = [];

  if (members.length > 0) {
    const assigneeText = members
      .map((u) => {
        const name = u.name || u.username || '?';
        // Return first name (first space-separated token)
        return escapeText(name.split(' ')[0]);
      })
      .join(', ');
    fields1.push({ type: 'mrkdwn', text: `*👤 Assignees*\n${assigneeText}` });
  }

  if (tasks && tasks.length > 0) {
    const done = tasks.filter((t) => t.isCompleted).length;
    fields1.push({ type: 'mrkdwn', text: `*✅ Tasks*\n${done}/${tasks.length}` });
  }

  if (fields1.length > 0) {
    blocks.push({ type: 'section', fields: fields1 });
  }

  // ── Fields row 2: Description + Timer (both optional) ────────────────────
  const descField = buildDescField(card.description);
  const timerField = buildTimerField(card.stopwatch);

  if (descField || timerField) {
    const fields = [];
    if (descField) fields.push(descField);
    if (timerField) fields.push(timerField);
    blocks.push({ type: 'section', fields });
  }

  // ── Footer context ────────────────────────────────────────────────────────
  const ts = new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
  blocks.push({
    type: 'context',
    elements: [{ type: 'mrkdwn', text: `Planka Unfurl • ${ts}` }],
  });

  return { blocks };
}

// ---------------------------------------------------------------------------
// Board unfurl
// ---------------------------------------------------------------------------

/**
 * Builds a Block Kit unfurl for a Planka board.
 *
 * @param {object} params
 * @param {object}        params.board           - Planka board
 * @param {object|null}   params.project         - Planka project
 * @param {Array}         params.lists           - Lists on the board
 * @param {object}        params.cardCountByList - { listId: count }
 * @param {string}        params.boardUrl        - The original URL that was shared
 * @returns {{ blocks: Array }}
 */
function buildBoardUnfurl({ board, project, lists, cardCountByList, boardUrl }) {
  const blocks = [];

  // Header
  blocks.push({
    type: 'section',
    text: {
      type: 'mrkdwn',
      text: `*📌 <${boardUrl}|${escapeText(board.name)}>*`,
    },
  });

  if (project?.name) {
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `Project: *${escapeText(project.name)}*` },
    });
  }

  if (lists.length > 0) {
    blocks.push({ type: 'divider' });

    const listLines = lists
      .map((l) => {
        const count = cardCountByList[l.id] || 0;
        return `• *${escapeText(l.name)}* — ${count} card${count !== 1 ? 's' : ''}`;
      })
      .join('\n');

    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: listLines },
    });
  }

  const ts = new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
  blocks.push({
    type: 'context',
    elements: [{ type: 'mrkdwn', text: `Planka Unfurl • ${ts}` }],
  });

  return { blocks };
}

// ---------------------------------------------------------------------------
// Project unfurl
// ---------------------------------------------------------------------------

/**
 * Builds a Block Kit unfurl for a Planka project.
 *
 * @param {object} params
 * @param {object}  params.project    - Planka project
 * @param {Array}   params.boards     - Boards in the project
 * @param {string}  params.projectUrl - The original URL that was shared
 * @returns {{ blocks: Array }}
 */
function buildProjectUnfurl({ project, boards, projectUrl }) {
  const blocks = [];

  blocks.push({
    type: 'section',
    text: {
      type: 'mrkdwn',
      text: `*🗂 <${projectUrl}|${escapeText(project.name)}>*`,
    },
  });

  if (boards.length > 0) {
    blocks.push({ type: 'divider' });

    const boardLines = boards
      .map((b) => `• ${escapeText(b.name)}`)
      .join('\n');

    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: boardLines },
    });
  }

  const ts = new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
  blocks.push({
    type: 'context',
    elements: [{ type: 'mrkdwn', text: `Planka Unfurl • ${ts}` }],
  });

  return { blocks };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Strip common markdown syntax from a string (for plain-text display).
 */
function stripMarkdown(text) {
  return text
    .replace(/#{1,6}\s+/g, '')                   // ## headings
    .replace(/\*\*(.+?)\*\*/gs, '$1')             // **bold**
    .replace(/\*(.+?)\*/gs, '$1')                 // *italic*
    .replace(/__(.+?)__/gs, '$1')                 // __bold__
    .replace(/_(.+?)_/gs, '$1')                   // _italic_
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')      // [text](url) → text
    .replace(/`{1,3}[^`]*`{1,3}/g, '')            // `code` / ```code```
    .replace(/\n+/g, ' ')                         // newlines → space
    .trim();
}

/** Escape Slack mrkdwn special chars (& < >) */
function escapeText(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** Build description field (first 150 chars, markdown stripped). Returns null if empty. */
function buildDescField(description) {
  if (!description) return null;
  const stripped = stripMarkdown(description);
  if (!stripped) return null;
  const truncated = stripped.length > 150 ? stripped.slice(0, 147) + '…' : stripped;
  return { type: 'mrkdwn', text: escapeText(truncated) };
}

/** Build timer field if stopwatch is running. Returns null otherwise. */
function buildTimerField(stopwatch) {
  if (!stopwatch || stopwatch.startedAt === null || stopwatch.startedAt === undefined) {
    return null;
  }
  return { type: 'mrkdwn', text: '*⏱ Timer*\nRunning' };
}

module.exports = { buildCardUnfurl, buildBoardUnfurl, buildProjectUnfurl };
