// Runs every hour (see netlify.toml). Re-checks items that have phone alerts
// switched on, within a daily search budget, and sends a push via ntfy.
import { readState, writeState, readJSON, writeJSON, checkItem, serpAccount, hasBackup, notify } from './core.mjs';
import { applyCheck, alertReason, PRICE_FIELDS } from '../public/shared.js';

const RESERVE = 20;          // searches always kept free for manual refreshes
const PER_RUN = 3;           // keeps each run well inside Netlify's 30s limit
const BACKUP_PER_DAY = 10;   // cap on backup searches per day
const money = (n) => '$' + (Math.round(n * 100) / 100).toFixed(2).replace(/\.00$/, '');

function sydney(now) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Sydney', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hour12: false }).formatToParts(now).map((p) => [p.type, p.value]));
  return { day: `${parts.year}-${parts.month}-${parts.day}`, month: `${parts.year}-${parts.month}`, hour: Number(parts.hour) % 24 };
}

export async function runCheck(now = new Date(), { ignoreHours = false } = {}) {
  const { day, month, hour } = sydney(now);
  const log = (await readJSON('cronlog')) || {};
  if (log.day !== day) Object.assign(log, { day, used: 0, backupUsed: 0 });
  log.lastRun = now.getTime();

  if (!ignoreHours && (hour < 7 || hour >= 21)) { log.note = 'Quiet hours'; await writeJSON('cronlog', log); return log; }

  const state = await readState();
  if (!state) return log;
  const settings = state.settings || {};
  const topic = settings.ntfyTopic;
  const everyMs = (Number(settings.alertEvery) || 1) * 864e5 - 45 * 60e3;

  const due = state.lists.flatMap((l) => l.items)
    .filter((i) => i.alerts && Date.now() - (i.checkedAt || 0) >= everyMs)
    .sort((a, b) => (a.checkedAt || 0) - (b.checkedAt || 0));

  // Work out today's budget from what's left this month.
  let left = null;
  try { left = (await serpAccount()).left; } catch {}
  const [y, m] = month.split('-').map(Number);
  const daysInMonth = new Date(y, m, 0).getDate();
  const daysLeft = Math.max(1, daysInMonth - Number(day.slice(8)) + 1);
  let allowance = left == null ? 0 : Math.max(0, Math.floor((left - RESERVE) / daysLeft));
  let budget = Math.max(0, allowance - log.used);
  const useBackup = budget === 0 && hasBackup() && log.backupUsed < BACKUP_PER_DAY;
  if (useBackup) budget = BACKUP_PER_DAY - log.backupUsed;

  // One-off warning when the monthly allowance is nearly gone.
  if (topic && left != null && left < 25 && settings.lowWarned !== month) {
    try {
      await notify(topic, { title: 'Pricewatch: searches running low', message: `${left} price searches left this month. Automatic checks ${hasBackup() ? 'will use the backup search' : 'are paused'} until it resets.`, tags: 'warning', priority: 'default' });
      settings.lowWarned = month; state.settings = settings;
    } catch {}
  }

  const batch = due.slice(0, Math.min(PER_RUN, budget));
  const results = await Promise.all(batch.map(async (item) => {
    try {
      const res = await checkItem(item);
      applyCheck(item, res, settings);
      const reason = alertReason(item);
      if (reason && topic) {
        const b = item.best;
        const msg = reason === 'target'
          ? `${money(b.price)} at ${b.store} (target ${money(Number(item.target))})`
          : `Down ${money(item.prevPrice - b.price)} to ${money(b.price)} at ${b.store}`;
        await notify(topic, { title: item.title.slice(0, 120), message: msg, click: b.link });
        item.alerted = { price: b.price, target: item.target != null && item.target !== '' ? Number(item.target) : null, at: Date.now() };
      }
      return { ok: true, via: res.via, item };
    } catch (e) {
      item.error = e.message;
      return { ok: false, item };
    }
  }));

  for (const r of results) r.via === 'backup' ? log.backupUsed++ : log.used += r.ok ? 1 : 0;
  log.checked = results.filter((r) => r.ok).length;
  log.due = due.length;
  log.note = batch.length ? '' : due.length ? 'Daily search budget reached' : 'Nothing due';

  // Save onto the freshest copy so edits made in the app meanwhile aren't lost.
  const fresh = (await readState()) || state;
  fresh.settings = { ...(fresh.settings || {}), lowWarned: settings.lowWarned };
  const byId = new Map(results.map((r) => [r.item.id, r.item]));
  for (const l of fresh.lists) for (const it of l.items) {
    const upd = byId.get(it.id);
    if (!upd || (it.checkedAt || 0) > (upd.checkedAt || 0)) continue;
    for (const f of PRICE_FIELDS) it[f] = upd[f];
    if (upd.alerted) it.alerted = upd.alerted;
  }
  if (results.length || settings.lowWarned === month) await writeState(fresh);
  await writeJSON('cronlog', log);
  return log;
}
