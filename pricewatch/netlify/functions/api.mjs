import {
  json, checkPassword, makeToken, authed, readState, writeState, mergeState, readJSON,
  searchProducts, checkItem, serpAccount, hasBackup, notify,
} from '../../lib/core.mjs';

export const config = { path: '/api/*' };

export default async (req) => {
  const route = new URL(req.url).pathname.replace(/^\/api\/?/, '').replace(/\/$/, '');
  const body = async () => { try { return await req.json(); } catch { return {}; } };

  try {
    if (route === 'login') {
      if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
      const { password } = await body();
      if (!checkPassword(password)) {
        await new Promise((r) => setTimeout(r, 800));
        return json({ error: 'Wrong password' }, 401);
      }
      return json({ token: makeToken() });
    }

    if (!authed(req)) return json({ error: 'Not signed in' }, 401);

    switch (route) {
      case 'data': {
        if (req.method === 'GET') return json({ state: await readState() });
        if (req.method === 'PUT') {
          const { state } = await body();
          if (!state || !Array.isArray(state.lists)) return json({ error: 'Bad data' }, 400);
          if (JSON.stringify(state).length > 4_000_000) return json({ error: 'Too much data' }, 413);
          const merged = mergeState(state, await readState());
          const savedAt = await writeState(merged);
          return json({ ok: true, savedAt, state: merged });
        }
        return json({ error: 'GET or PUT only' }, 405);
      }
      case 'search': {
        const q = (new URL(req.url).searchParams.get('q') || '').trim();
        if (q.length < 2) return json({ error: 'Type a product name' }, 400);
        const r = await searchProducts(q);
        return json({ results: r.results.slice(0, 20), via: r.via });
      }
      case 'refresh': {
        if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
        const { item } = await body();
        if (!item || (!item.query && !item.token)) return json({ error: 'Nothing to look up' }, 400);
        return json(await checkItem(item));
      }
      case 'usage': {
        let serp = null, serpError = null;
        try { serp = await serpAccount(); } catch (e) { serpError = e.message; }
        return json({ serp, serpError, backup: hasBackup(), cron: await readJSON('cronlog') });
      }
      case 'test-alert': {
        const { topic } = await body();
        await notify(topic, { title: 'Pricewatch alerts are working', message: "You'll get a notification like this when a price drops.", tags: 'white_check_mark', priority: 'default' });
        return json({ ok: true });
      }
      default:
        return json({ error: 'Not found' }, 404);
    }
  } catch (e) {
    return json({ error: e.message || 'Something went wrong' }, 502);
  }
};
