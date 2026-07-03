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
  const deadline = Date.now() + 60_000; // give up after 60s no matter what
  let offset = 0;
  let totalCleared = 0;

  console.log('[Telegram] 🧹 Clearing stale updates...');

  while (Date.now() < deadline) {
    try {
      // Race the getUpdates call against a 6-second timeout so it never hangs
      const updates = await Promise.race([
        bot.telegram.getUpdates({ offset, timeout: 1, limit: 100 }),
        new Promise((_, rej) => setTimeout(() => rej(new Error('FETCH_TIMEOUT')), 6000)),
      ]);

      if (updates.length === 0) break; // queue is empty — done

      offset = updates[updates.length - 1].update_id + 1;
      totalCleared += updates.length;

    } catch (err) {
      const is409 = err?.response?.error_code === 409 || String(err.message).includes('409');

      if (is409) {
        // Old Railway container is still alive — wait for it to die
        console.log('[Telegram] ⏳ Old container still running, retrying in 5s...');
        await sleep(5000);
      } else {
        // Network hiccup or timeout — just start polling from offset 0
        console.log('[Telegram] ⚠️  Could not clear updates:', err.message);
        break;
      }
    }
  }

  if (totalCleared > 0) console.log(`[Telegram] 🗑  Cleared ${totalCleared} stale update(s).`);
  return offset;
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

  // ── Dummy Web Server for Railway Health Checks ──────────────────────────────
  // Railway expects the app to bind to a PORT, otherwise it marks it as crashed
  const http = require('http');
  const PORT = process.env.PORT || 3000;
  http.createServer((req, res) => {
    res.writeHead(200);
    res.end('DeeZcord Bot is running.');
  }).listen(PORT, () => {
    console.log(`[Startup] 🌐 Web server listening on port ${PORT} (Health check)`);
  });

  process.once('SIGINT',  () => { console.log('\n[Shutdown] Bye!'); process.exit(0); });
  process.once('SIGTERM', () => { console.log('\n[Shutdown] Bye!'); process.exit(0); });
}

main().catch(err => {
  console.error('[Startup] ❌ Fatal:', err.message);
  process.exit(1);
});
