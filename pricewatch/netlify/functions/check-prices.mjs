// Runs every hour (see netlify.toml): re-checks items with phone alerts on.
import { runCheck } from '../../lib/cron.mjs';

export default async () => {
  await runCheck();
  return new Response('ok');
};
