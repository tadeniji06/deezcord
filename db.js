const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, 'deezcord.db'));

// Create tables on startup
db.exec(`
  CREATE TABLE IF NOT EXISTS monitored_servers (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    telegram_chat_id TEXT NOT NULL,
    guild_id       TEXT NOT NULL,
    guild_name     TEXT NOT NULL,
    channel_link   TEXT NOT NULL,
    added_at       DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(telegram_chat_id, guild_id)
  )
`);

/**
 * Add a server to a user's monitor list.
 * Returns { success: boolean, alreadyExists: boolean }
 */
function addMonitoredServer({ telegramChatId, guildId, guildName, channelLink }) {
  try {
    const stmt = db.prepare(`
      INSERT INTO monitored_servers (telegram_chat_id, guild_id, guild_name, channel_link)
      VALUES (?, ?, ?, ?)
    `);
    stmt.run(String(telegramChatId), guildId, guildName, channelLink);
    return { success: true, alreadyExists: false };
  } catch (err) {
    if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return { success: false, alreadyExists: true };
    }
    throw err;
  }
}

/**
 * Remove a monitored server by its DB row id for a specific user.
 * Returns true if a row was deleted.
 */
function removeMonitoredServer({ telegramChatId, entryId }) {
  const stmt = db.prepare(`
    DELETE FROM monitored_servers
    WHERE id = ? AND telegram_chat_id = ?
  `);
  const result = stmt.run(entryId, String(telegramChatId));
  return result.changes > 0;
}

/**
 * Get all servers a Telegram user is monitoring.
 * Returns array of { id, guild_id, guild_name, channel_link, added_at }
 */
function getServersByUser(telegramChatId) {
  const stmt = db.prepare(`
    SELECT id, guild_id, guild_name, channel_link, added_at
    FROM monitored_servers
    WHERE telegram_chat_id = ?
    ORDER BY added_at DESC
  `);
  return stmt.all(String(telegramChatId));
}

/**
 * Get all Telegram chat IDs monitoring a given Discord guild.
 * Returns array of telegram_chat_id strings.
 */
function getUsersByGuild(guildId) {
  const stmt = db.prepare(`
    SELECT DISTINCT telegram_chat_id
    FROM monitored_servers
    WHERE guild_id = ?
  `);
  return stmt.all(guildId).map(r => r.telegram_chat_id);
}

/**
 * Get all distinct guilds being monitored (across all users).
 * Returns array of { guild_id, guild_name }
 */
function getAllMonitoredGuilds() {
  const stmt = db.prepare(`
    SELECT DISTINCT guild_id, guild_name
    FROM monitored_servers
  `);
  return stmt.all();
}

module.exports = { addMonitoredServer, removeMonitoredServer, getServersByUser, getUsersByGuild, getAllMonitoredGuilds };
