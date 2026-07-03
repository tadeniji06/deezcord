const { Telegraf, Markup, session } = require('telegraf');
const { addMonitoredServer, removeMonitoredServer, getServersByUser } = require('./db');

// ── Discord link parsers ─────────────────────────────────────────────────────

/**
 * Try to extract guild info from a given link.
 * Supports:
 *   https://discord.com/channels/GUILD_ID/CHANNEL_ID  → uses guild ID as key, generic name
 *   https://discord.gg/INVITE_CODE                     → resolves via Discord public API (no auth)
 *   https://discord.com/invite/INVITE_CODE             → same
 *
 * Returns { guildId, guildName, memberCount } or null if unrecognised.
 */
async function resolveDiscordLink(link) {
  // Pattern 1: channel link
  const channelMatch = link.match(/discord\.com\/channels\/(\d{17,20})/);
  if (channelMatch) {
    return {
      guildId: channelMatch[1],
      guildName: `Discord Server`,
      memberCount: null,
    };
  }

  // Pattern 2: invite link  (discord.gg/CODE  or  discord.com/invite/CODE)
  const inviteMatch = link.match(/discord(?:\.gg|\.com\/invite)\/([A-Za-z0-9-]+)/);
  if (inviteMatch) {
    const code = inviteMatch[1];
    try {
      const res = await fetch(
        `https://discord.com/api/v10/invites/${code}?with_counts=true`
      );
      if (!res.ok) return null;
      const data = await res.json();
      if (!data.guild) return null;
      return {
        guildId: data.guild.id,
        guildName: data.guild.name,
        memberCount: data.approximate_member_count ?? null,
      };
    } catch {
      return null;
    }
  }

  return null;
}

// ── UI helpers ───────────────────────────────────────────────────────────────

function mainMenu() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('📡  My Channels', 'list_channels')],
    [Markup.button.callback('➕  Add a Channel', 'add_channel')],
    [Markup.button.callback('ℹ️  Help', 'show_help')],
  ]);
}

function escapeV2(text) {
  return String(text).replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&');
}

// ── Bot builder ──────────────────────────────────────────────────────────────

function buildBot() {
  const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);

  bot.use(session());

  // ── /start ────────────────────────────────────────────────────────────────
  bot.start(async (ctx) => {
    ctx.session = {};
    const firstName = ctx.from.first_name || 'there';
    await ctx.replyWithMarkdownV2(
      `👋 Hey *${escapeV2(firstName)}\\!* Welcome to *DeeZcord*\\.\n\n` +
        `I monitor your Discord servers and ping you right here on Telegram whenever a new member joins\\.\n\n` +
        `Paste a Discord channel or invite link to get started\\.`,
      mainMenu()
    );
  });

  // ── /menu ─────────────────────────────────────────────────────────────────
  bot.command('menu', async (ctx) => {
    ctx.session = {};
    await ctx.replyWithMarkdownV2('*Main Menu*', mainMenu());
  });

  // ── /help ─────────────────────────────────────────────────────────────────
  bot.command('help', (ctx) => sendHelp(ctx));
  bot.action('show_help', (ctx) => { ctx.answerCbQuery(); return sendHelp(ctx); });

  async function sendHelp(ctx) {
    await ctx.replyWithMarkdownV2(
      `*How DeeZcord Works*\n\n` +
        `1️⃣  Copy a Discord channel link or invite link\\.\n` +
        `2️⃣  Tap *➕ Add a Channel* and paste it\\.\n` +
        `3️⃣  That's it\\! I'll notify you whenever a new member joins\\.\n\n` +
        `*Supported link formats:*\n` +
        `• \`https://discord\\.gg/INVITE\\_CODE\`\n` +
        `• \`https://discord\\.com/invite/INVITE\\_CODE\`\n` +
        `• \`https://discord\\.com/channels/GUILD\\_ID/CHANNEL\\_ID\`\n\n` +
        `*Commands*\n` +
        `/start — Welcome screen\n` +
        `/menu  — Main menu\n` +
        `/add   — Add a Discord server to monitor\n` +
        `/list  — View your monitored servers\n` +
        `/help  — Show this message`
    );
  }

  // ── /add ──────────────────────────────────────────────────────────────────
  bot.command('add', (ctx) => startAddFlow(ctx));
  bot.action('add_channel', (ctx) => { ctx.answerCbQuery(); return startAddFlow(ctx); });

  async function startAddFlow(ctx) {
    ctx.session = { awaitingLink: true };
    await ctx.replyWithMarkdownV2(
      `*➕ Add a Discord Server*\n\n` +
        `Paste a Discord channel link or server invite link below\\.\n\n` +
        `_Supported:_\n` +
        `• \`discord\\.gg/INVITE\\_CODE\`\n` +
        `• \`discord\\.com/channels/GUILD/CHANNEL\``,
      Markup.inlineKeyboard([[Markup.button.callback('❌  Cancel', 'cancel_add')]])
    );
  }

  bot.action('cancel_add', async (ctx) => {
    ctx.session = {};
    await ctx.answerCbQuery('Cancelled');
    await ctx.editMessageText('Action cancelled.', mainMenu());
  });

  // ── /list ─────────────────────────────────────────────────────────────────
  bot.command('list', (ctx) => showList(ctx));
  bot.action('list_channels', (ctx) => { ctx.answerCbQuery(); return showList(ctx); });

  async function showList(ctx) {
    const chatId = String(ctx.from.id);
    const servers = getServersByUser(chatId);

    if (servers.length === 0) {
      return ctx.replyWithMarkdownV2(
        `📭 *No servers monitored yet\\.*\n\nTap below to add one\\.`,
        Markup.inlineKeyboard([[Markup.button.callback('➕  Add a Channel', 'add_channel')]])
      );
    }

    const buttons = servers.map((s) => [
      Markup.button.callback(`🏠  ${s.guild_name}`, `noop`),
      Markup.button.callback(`🗑  Remove`, `del:${s.id}`),
    ]);
    buttons.push([Markup.button.callback('➕  Add Another', 'add_channel')]);
    buttons.push([Markup.button.callback('🏠  Main Menu', 'main_menu')]);

    await ctx.replyWithMarkdownV2(
      `*📡 Your Monitored Servers* \\(${servers.length}\\)\n\nTap *🗑 Remove* to stop monitoring a server\\.`,
      Markup.inlineKeyboard(buttons)
    );
  }

  // ── Delete ────────────────────────────────────────────────────────────────
  bot.action(/^del:(\d+)$/, async (ctx) => {
    const entryId = parseInt(ctx.match[1], 10);
    const chatId  = String(ctx.from.id);
    const removed  = removeMonitoredServer({ telegramChatId: chatId, entryId });

    if (removed) {
      await ctx.answerCbQuery('✅ Server removed');
      await ctx.deleteMessage().catch(() => {});
      return showList(ctx);
    } else {
      await ctx.answerCbQuery('⚠️ Could not find that entry.');
    }
  });

  bot.action('noop',      (ctx) => ctx.answerCbQuery());
  bot.action('main_menu', async (ctx) => {
    ctx.session = {};
    await ctx.answerCbQuery();
    await ctx.replyWithMarkdownV2('*Main Menu*', mainMenu());
  });

  // ── Text handler — link processing ────────────────────────────────────────
  bot.on('text', async (ctx) => {
    if (!ctx.session?.awaitingLink) {
      return ctx.replyWithMarkdownV2('Use the menu to get started\\.', mainMenu());
    }

    ctx.session = {};
    const link   = ctx.message.text.trim();
    const chatId = String(ctx.from.id);

    // Show a loading indicator
    const loadingMsg = await ctx.reply('🔍 Checking link...');

    const guildInfo = await resolveDiscordLink(link);

    // Delete the loading message
    await ctx.telegram.deleteMessage(ctx.chat.id, loadingMsg.message_id).catch(() => {});

    if (!guildInfo) {
      return ctx.replyWithMarkdownV2(
        `⚠️ *Couldn't recognise that link\\.*\n\n` +
          `Please send a valid Discord link:\n` +
          `• \`https://discord\\.gg/INVITE\\_CODE\`\n` +
          `• \`https://discord\\.com/channels/GUILD\\_ID/CHANNEL\\_ID\``,
        Markup.inlineKeyboard([[Markup.button.callback('➕  Try Again', 'add_channel')]])
      );
    }

    const result = addMonitoredServer({
      telegramChatId: chatId,
      guildId:        guildInfo.guildId,
      guildName:      guildInfo.guildName,
      channelLink:    link,
    });

    if (result.alreadyExists) {
      return ctx.replyWithMarkdownV2(
        `ℹ️ You're already monitoring *${escapeV2(guildInfo.guildName)}*\\.`,
        Markup.inlineKeyboard([
          [Markup.button.callback('📡  View My Channels', 'list_channels')],
          [Markup.button.callback('🏠  Main Menu', 'main_menu')],
        ])
      );
    }

    const memberLine = guildInfo.memberCount
      ? `👥 *Members:* ${guildInfo.memberCount.toLocaleString()}\n`
      : '';

    await ctx.replyWithMarkdownV2(
      `✅ *Server added\\!*\n\n` +
        `🏠 *${escapeV2(guildInfo.guildName)}*\n` +
        memberLine +
        `\nYou'll be notified here whenever a new member joins\\.`,
      Markup.inlineKeyboard([
        [Markup.button.callback('📡  View My Channels', 'list_channels')],
        [Markup.button.callback('➕  Add Another',     'add_channel')],
        [Markup.button.callback('🏠  Main Menu',       'main_menu')],
      ])
    );
  });

  // ── Error handler ─────────────────────────────────────────────────────────
  bot.catch((err, ctx) => {
    console.error(`[Telegram] Error for ${ctx.updateType}:`, err.message);
  });

  // ── Notification sender ───────────────────────────────────────────────────
  async function sendNotificationToChat(chatId, message) {
    const send = () =>
      bot.telegram.sendMessage(chatId, message, { parse_mode: 'MarkdownV2' });

    try {
      await send();
      console.log(`[Telegram] ✉️  Notified chat ${chatId}`);
    } catch (err) {
      // Respect Telegram's rate limit — wait retry_after seconds then try once more
      const retryAfter = err?.response?.parameters?.retry_after;
      if (retryAfter) {
        console.log(`[Telegram] ⏳ Rate limited — retrying in ${retryAfter}s`);
        await new Promise(r => setTimeout(r, (retryAfter + 1) * 1000));
        try {
          await send();
          console.log(`[Telegram] ✉️  Notified chat ${chatId} (after retry)`);
        } catch (e) {
          console.error(`[Telegram] Failed to notify chat ${chatId}:`, e.message);
        }
      } else {
        console.error(`[Telegram] Failed to notify chat ${chatId}:`, err.message);
      }
    }
  }

  return { bot, sendNotificationToChat };
}

module.exports = { buildBot };
