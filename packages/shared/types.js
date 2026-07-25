// Shared constants for Canvas (used by app + mcp). Plain CJS so both can require it.
const NODE_TYPES = ['frame', 'group', 'content'];
const NOTE_STATUS = ['open', 'resolved', 'wontfix'];
const AUTHORS = ['user', 'ai'];
const API_HOST = '127.0.0.1';
const API_PORT = 47600;
const API_BASE = `http://${API_HOST}:${API_PORT}`;

module.exports = { NODE_TYPES, NOTE_STATUS, AUTHORS, API_HOST, API_PORT, API_BASE };
