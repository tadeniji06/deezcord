const { Client, GatewayIntentBits, Events } = require('discord.js');
const { getUsersByGuild } = require('./db');

const discordClient = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
  ],
});

/**
 * Check if the Discord bot is currently in a given guild by ID.
 */
function isBotInGuild(guildId) {
  return discordClient.guilds.cache.has(guildId);
}

/**
 * Fetch guild info (name) from cache or API.
 * Returns { id, name } or null.
 */
async function getGuildInfo(guildId) {
  try {
    const guild = await discordClient.guilds.fetch(guildId);
    return { id: guild.id, name: guild.name };
  } catch {
    return null;
  }
}

/**
 * Start the Discord client. Accepts a `sendNotification` callback:
 *   sendNotification(telegramChatId, message)
 */
function startDiscordBot(sendNotification) {
  discordClient.once(Events.ClientReady, (c) => {
    console.log(`[Discord] ✅ Logged in as ${c.user.tag}`);
    console.log(`[Discord] Watching ${discordClient.guilds.cache.size} server(s)`);
  });

  discordClient.on(Events.GuildMemberAdd, async (member) => {
    const guildId = member.guild.id;
    const guildName = member.guild.name;
    const username = member.user.username;
    const displayName = member.displayName;
    const joinedAt = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    const avatarUrl = member.user.displayAvatarURL({ size: 64 });

    console.log(`[Discord] 👤 ${username} joined ${guildName}`);

    const chatIds = getUsersByGuild(guildId);
    if (chatIds.length === 0) {
      console.log(`[Discord] No Telegram users monitoring ${guildName} — skipping.`);
      return;
    }

    const message =
      `🔔 *New Member Alert!*\n\n` +
      `🏠 *Server:* ${escapeMarkdown(guildName)}\n` +
      `👤 *Username:* @${escapeMarkdown(username)}\n` +
      `📛 *Display Name:* ${escapeMarkdown(displayName)}\n` +
      `🕐 *Joined at:* ${joinedAt}`;

    for (const chatId of chatIds) {
      await sendNotification(chatId, message);
    }
  });

  discordClient.login(process.env.DISCORD_BOT_TOKEN);
}

function escapeMarkdown(text) {
  return text.replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&');
}

module.exports = { startDiscordBot, isBotInGuild, getGuildInfo };
