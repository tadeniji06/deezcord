require('dotenv').config();

if (!process.env.TELEGRAM_BOT_TOKEN) {
  console.error('[Startup] ❌ Missing TELEGRAM_BOT_TOKEN');
  process.exit(1);
}

const { buildBot }       = require('./bot');
const { startSimulator } = require('./simulator');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Clear stale updates from previous sessions ───────────────────────────────
// Calling getUpdates with timeout=0 instantly drains any queued updates
// from crash/restart cycles without processing them, preventing 429 floods.
async function clearPendingUpdates(bot) {
  let offset = 0;
  let totalCleared = 0;
  try {
    while (true) {
      const updates = await bot.telegram.getUpdates({ offset, timeout: 0, limit: 100 });
      if (updates.length === 0) break;
      
      offset = updates[updates.length - 1].update_id + 1;
      totalCleared += updates.length;
    }
    if (totalCleared > 0) {
      console.log(`[Telegram] 🗑  Cleared ${totalCleared} stale update(s).`);
    }
    return offset;
  } catch (err) {
    console.log('[Telegram] Could not clear pending updates:', err.message);
  }
  return 0;
}

// ── Manual polling loop — replaces bot.launch() ───────────────────────────────
// This gives us direct control over 409 conflicts and network errors,
// instead of relying on Telegraf's internal loop which hangs silently.
async function startPolling(bot) {
  let offset = await clearPendingUpdates(bot);
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

  // Fetch bot info once (required for Telegraf to process updates correctly)
  bot.botInfo = await bot.telegram.getMe();
  console.log(`[Startup] ✅ Connected as @${bot.botInfo.username}`);

  // Start the fake-join simulator
  startSimulator(sendNotificationToChat);

  // Start polling in the background (never awaited — runs forever)
  startPolling(bot);

  process.once('SIGINT',  () => { console.log('\n[Shutdown] Bye!'); process.exit(0); });
  process.once('SIGTERM', () => { console.log('\n[Shutdown] Bye!'); process.exit(0); });
}

main().catch(err => {
  console.error('[Startup] ❌ Fatal:', err.message);
  process.exit(1);
});
