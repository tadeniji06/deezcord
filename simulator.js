const { getAllMonitoredGuilds, getUsersByGuild } = require('./db');

// ── Pool of fake Discord-style usernames ────────────────────────────────────
const FAKE_USERS = [
  { username: 'pixel_ninja42',    displayName: 'Pixel Ninja' },
  { username: 'cosmic_ray_99',    displayName: 'Cosmic Ray' },
  { username: 'darkwolf_exe',     displayName: 'DarkWolf' },
  { username: 'neonpulse',        displayName: 'Neon Pulse' },
  { username: 'shadow_byte',      displayName: 'ShadowByte' },
  { username: 'astro_drift',      displayName: 'AstroDrift' },
  { username: 'glitch_mode',      displayName: 'Glitch Mode' },
  { username: 'synthwave_kid',    displayName: 'Synthwave Kid' },
  { username: 'vortex_xd',        displayName: 'VortexXD' },
  { username: 'luminary_arc',     displayName: 'Luminary Arc' },
  { username: 'phantom_coder',    displayName: 'PhantomCoder' },
  { username: 'zerox_alpha',      displayName: 'ZeroX Alpha' },
  { username: 'blaze_runner_01',  displayName: 'Blaze Runner' },
  { username: 'nocturnalbyte',    displayName: 'NocturnalByte' },
  { username: 'crystalvoid',      displayName: 'Crystal Void' },
  { username: 'echo_striker',     displayName: 'Echo Striker' },
  { username: 'turbodawn',        displayName: 'TurboDawn' },
  { username: 'rogue_signal',     displayName: 'Rogue Signal' },
  { username: 'nebula_drop',      displayName: 'Nebula Drop' },
  { username: 'ironveil_x',       displayName: 'IronVeil X' },
];

// ── Shuffled queue — no repeats until the whole pool is exhausted ───────────
let userQueue = [];

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function nextUser() {
  if (userQueue.length === 0) {
    userQueue = shuffle(FAKE_USERS);
    console.log('[Simulator] 🔀 User pool reshuffled — starting next round.');
  }
  return userQueue.pop();
}

/**
 * Weighted random delay that mimics real Discord join patterns.
 *
 * Tier distribution (roll a dice first, then pick a time in that range):
 *   55% → 45s – 8min   (active window — regular trickle)
 *   25% → 8min – 45min (normal lull between bursts)
 *   15% → 45min – 3hr  (quiet period)
 *    5% → 3hr – 5hr    (dead hours / overnight)
 */
function randomDelay() {
  const roll = Math.random();

  let minMs, maxMs, label;
  if (roll < 0.55) {
    minMs = 45_000;        maxMs = 8 * 60_000;      label = 'active';
  } else if (roll < 0.80) {
    minMs = 8 * 60_000;    maxMs = 45 * 60_000;     label = 'lull';
  } else if (roll < 0.95) {
    minMs = 45 * 60_000;   maxMs = 3 * 60 * 60_000; label = 'quiet';
  } else {
    minMs = 3 * 60 * 60_000; maxMs = 5 * 60 * 60_000; label = 'dead';
  }

  const ms = Math.floor(Math.random() * (maxMs - minMs)) + minMs;
  return { ms, label };
}

function formatTime() {
  return new Date().toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function escapeMarkdown(text) {
  return String(text).replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&');
}

/**
 * Start the simulator loop.
 * On each tick it picks a random monitored guild and fires a fake join
 * notification to all Telegram users watching that guild.
 *
 * @param {(chatId: string, message: string) => Promise<void>} sendNotification
 */
function startSimulator(sendNotification) {
  console.log('[Simulator] 🎲 Simulator started — realistic join intervals (45s → 5hr)');
  scheduleNext(sendNotification);
}

function scheduleNext(sendNotification) {
  const { ms, label } = randomDelay();

  const display = ms < 60_000
    ? `${(ms / 1000).toFixed(0)}s`
    : ms < 3_600_000
    ? `${(ms / 60_000).toFixed(1)} min`
    : `${(ms / 3_600_000).toFixed(2)} hr`;

  console.log(`[Simulator] ⏱  Next join in ${display} [${label}]`);

  setTimeout(async () => {
    await fireFakeJoin(sendNotification);
    scheduleNext(sendNotification);
  }, ms);
}

async function fireFakeJoin(sendNotification) {
  const guilds = getAllMonitoredGuilds();

  if (guilds.length === 0) {
    console.log('[Simulator] No guilds monitored — skipping tick.');
    return;
  }

  // Pick a random guild
  const guild = guilds[Math.floor(Math.random() * guilds.length)];
  const user  = nextUser();
  const time  = formatTime();

  console.log(`[Simulator] 👤 Fake join → ${user.username} joined "${guild.guild_name}"`);

  const message =
    `🔔 *New Member Alert\\!*\n\n` +
    `🏠 *Server:* ${escapeMarkdown(guild.guild_name)}\n` +
    `👤 *Username:* @${escapeMarkdown(user.username)}\n` +
    `📛 *Display Name:* ${escapeMarkdown(user.displayName)}\n` +
    `🕐 *Joined at:* ${escapeMarkdown(time)}`;

  const chatIds = getUsersByGuild(guild.guild_id);
  for (const chatId of chatIds) {
    await sendNotification(chatId, message);
  }
}

module.exports = { startSimulator };
