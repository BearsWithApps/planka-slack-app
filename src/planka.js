const axios = require('axios');

class PlankaClient {
  constructor(baseUrl, email, password) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.email = email;
    this.password = password;
    this.token = null;
    this.tokenExpiry = null;
  }

  async login() {
    const res = await axios.post(`${this.baseUrl}/api/access-tokens`, {
      emailOrUsername: this.email,
      password: this.password,
    });
    this.token = res.data.item;
    // Tokens are long-lived; refresh after 23 hours to be safe
    this.tokenExpiry = Date.now() + 23 * 60 * 60 * 1000;
    return this.token;
  }

  async ensureAuth() {
    if (!this.token || Date.now() >= this.tokenExpiry) {
      await this.login();
    }
  }

  authHeaders() {
    return { Authorization: `Bearer ${this.token}` };
  }

  /**
   * Get a card by ID. Returns the card item along with included project, board, list, and members.
   * @param {string} cardId
   * @returns {{ card, project, board, list, members }}
   */
  async getCard(cardId) {
    await this.ensureAuth();

    const res = await axios.get(`${this.baseUrl}/api/cards/${cardId}`, {
      headers: this.authHeaders(),
    });

    const { item: card, included = {} } = res.data;

    const board = included.boards?.find((b) => b.id === card.boardId) || null;
    const list = included.lists?.find((l) => l.id === card.listId) || null;
    const users = included.users || [];
    const cardMemberships = included.cardMemberships || [];
    const project = included.projects?.[0] || null;

    // Resolve member user objects for this card
    const memberUserIds = cardMemberships
      .filter((m) => m.cardId === cardId)
      .map((m) => m.userId);
    const members = users.filter((u) => memberUserIds.includes(u.id));

    return { card, project, board, list, members };
  }

  /**
   * Get tasks for a card.
   * @param {string} cardId
   * @returns {Array<{ id, name, isCompleted }>}
   */
  async getCardTasks(cardId) {
    await this.ensureAuth();

    const res = await axios.get(`${this.baseUrl}/api/cards/${cardId}/tasks`, {
      headers: this.authHeaders(),
    });

    return res.data.items || [];
  }

  /**
   * Get a board with its lists and card counts.
   * @param {string} boardId
   * @returns {{ board, project, lists, cardCountByList }}
   */
  async getBoardWithCards(boardId) {
    await this.ensureAuth();

    const res = await axios.get(`${this.baseUrl}/api/boards/${boardId}`, {
      headers: this.authHeaders(),
    });

    const { item: board, included = {} } = res.data;

    const project = included.projects?.[0] || null;
    const lists = included.lists || [];
    const cards = included.cards || [];

    // Build card count per list
    const cardCountByList = {};
    for (const list of lists) {
      cardCountByList[list.id] = cards.filter((c) => c.listId === list.id).length;
    }

    return { board, project, lists, cardCountByList };
  }

  /**
   * Get a project with its boards.
   * @param {string} projectId
   * @returns {{ project, boards }}
   */
  async getProject(projectId) {
    await this.ensureAuth();

    const res = await axios.get(`${this.baseUrl}/api/projects/${projectId}`, {
      headers: this.authHeaders(),
    });

    const { item: project, included = {} } = res.data;
    const boards = included.boards || [];

    return { project, boards };
  }
}

module.exports = PlankaClient;
