require('dotenv').config();

if (!process.env.TELEGRAM_BOT_TOKEN) {
  console.error('[Startup] ❌ Missing TELEGRAM_BOT_TOKEN');
  process.exit(1);
}

const { buildBot }       = require('./bot');
const { startSimulator } = require('./simulator');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Drop all pending updates (single atomic API call) ─────────────────────────
// deleteWebhook with drop_pending_updates=true tells Telegram to wipe its
// entire update queue instantly. Much safer than draining with getUpdates,
// which can hang when another instance is still holding the polling connection.
async function dropPendingUpdates(bot) {
  try {
    await bot.telegram.deleteWebhook({ drop_pending_updates: true });
    console.log('[Telegram] 🗑  Pending updates dropped.');
  } catch (err) {
    // Non-fatal — just log and continue. Stale updates will be filtered below.
    console.log('[Telegram] ⚠️  Could not drop updates:', err.message);
  }
}

// ── Manual polling loop ───────────────────────────────────────────────────────
async function startPolling(bot) {
  // Drop any stale updates BEFORE we start receiving new ones
  await dropPendingUpdates(bot);

  let offset = 0;
  console.log('[Telegram] 🔄 Polling started.');

  while (true) {
    try {
      const updates = await bot.telegram.getUpdates({
        offset,
        timeout: 30,
        allowed_updates: [],
      });

      for (const update of updates) {
        offset = update.update_id + 1;

        // ── Stale-update guard ───────────────────────────────────────────────
        // Skip any update whose message/callback is older than 60 seconds.
        // This is a safety net against updates that slip through the drop call
        // (e.g. during zero-downtime Railway deploys with two containers racing).
        const msgDate =
          update.message?.date ||
          update.edited_message?.date ||
          update.callback_query?.message?.date ||
          0;
        if (msgDate && (Date.now() / 1000 - msgDate) > 60) {
          continue; // silently discard — no log spam
        }

        bot.handleUpdate(update).catch(err =>
          console.error('[Telegram] Update error:', err.message)
        );
      }
    } catch (err) {
      const code = err?.response?.error_code;

      if (code === 409) {
        console.log('[Telegram] ⏳ Another session detected — waiting 5s...');
        await sleep(5000);
      } else {
        console.error('[Telegram] ⚠️  Poll error:', err.message, '— retrying in 2s');
        await sleep(2000);
      }
    }
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log('[Startup] 🚀 Starting DeeZcord...');

  const { bot, sendNotificationToChat } = buildBot();

  bot.botInfo = await bot.telegram.getMe();
  console.log(`[Startup] ✅ Connected as @${bot.botInfo.username}`);

  startSimulator(sendNotificationToChat);

  // Not awaited — runs forever in the background
  startPolling(bot);

  // Railway requires a bound PORT for health checks
  const http = require('http');
  const PORT = process.env.PORT || 3000;
  http.createServer((req, res) => {
    res.writeHead(200);
    res.end('DeeZcord is running.');
  }).listen(PORT, () => {
    console.log(`[Startup] 🌐 Health-check server on port ${PORT}`);
  });

  process.once('SIGINT',  () => { console.log('\n[Shutdown] Bye!'); process.exit(0); });
  process.once('SIGTERM', () => { console.log('\n[Shutdown] Bye!'); process.exit(0); });
}

main().catch(err => {
  console.error('[Startup] ❌ Fatal:', err.message);
  process.exit(1);
});
