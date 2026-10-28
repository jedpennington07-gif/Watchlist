# Pricewatch — Netlify setup (about 15 minutes, free)

Accounts needed: **SerpApi** (price search), **GitHub** (holds the code), **Netlify** (hosting, storage, scheduled alerts). Optional: **Serper.dev** (backup search) and the **ntfy** phone app (alerts).

## 1. Get your search keys
1. **SerpApi** — sign up at https://serpapi.com (Free plan, 250 searches/month). Copy your **Private API Key** from the dashboard.
2. **Serper.dev (optional backup)** — sign up at https://serper.dev (2,500 free searches, one-off). Copy your **API key**. Used only when the SerpApi allowance runs out.

## 2. Put the code on GitHub
1. Log in at https://github.com → **+** (top right) → **New repository**.
2. Name: `pricewatch` · **Private** · **Create repository**.
3. Click **uploading an existing file**.
4. Unzip `pricewatch.zip`. Open the `pricewatch` folder, select **everything inside it** (`lib`, `netlify`, `public`, `netlify.toml`, `package.json`, `SETUP.md`) and drag it all onto the GitHub page. Keep the folders as folders.
5. **Commit changes**.

## 3. Deploy on Netlify
1. At https://app.netlify.com: **Add new project → Import an existing project → GitHub** and pick `pricewatch`.
2. Build settings fill in automatically from `netlify.toml` — leave them.
3. Add **Environment variables** (on this screen, or later under Project configuration → Environment variables):

   | Key | Value |
   |---|---|
   | `SERPAPI_KEY` | your SerpApi key |
   | `APP_PASSWORD` | the password you’ll sign in with |
   | `SERPER_API_KEY` | your Serper key (optional) |

4. **Deploy**. When it finishes you get a URL like `pricewatch-abc123.netlify.app`.
5. If you added variables after deploying: **Deploys → Trigger deploy → Deploy project**.

Storage (Netlify Blobs) and the hourly alert check are switched on automatically. No database setup.

## 4. On your phone
1. Open your Netlify URL in **Safari** (iPhone) or **Chrome** (Android) and sign in.
2. **Share → Add to Home Screen.** It opens full-screen like an app.

## 5. Phone alerts
1. Install **ntfy** (free) from the App Store / Google Play.
2. In Pricewatch: **Settings (gear) → Phone alerts**. Copy the topic shown.
3. In ntfy: **+** → paste the topic → **Subscribe**. Allow notifications.
4. Back in Pricewatch: **Send test alert** — it should arrive within seconds.
5. On any item: **⋯ → set a Target price → turn on Phone alert.**

Alert items are checked between 7am and 9pm (Sydney time), at the frequency set in Settings. Checks automatically keep 20 searches spare each month for your own refreshes.

## Using it
- **Add item** — search, tap the exact product.
- **Refresh** — on each item, or the top-right button for the whole list. Opening the app re-checks anything older than 12 hours.
- **⋯ on an item** — price chart, target price, phone alert, every store’s price, block a store, rename, move, remove.
- **List button** — sort (price, biggest drop, closest to target, name), refresh all, rename, new/delete list.
- **Settings** — searches left, major retailers only, blocked stores, alerts, export/import backup, sign out.

## Updating later
Upload the changed files to the same GitHub repository (**Add file → Upload files**). Netlify redeploys automatically.

## Troubleshooting
| Message | Fix |
|---|---|
| “APP_PASSWORD is not set” / “SERPAPI_KEY is not set” | Add it in Netlify environment variables, then Trigger deploy |
| No alerts arriving | Send test alert; check ntfy is subscribed to the exact topic and notifications are allowed |
| “Monthly searches nearly used” | Allowance resets monthly; add a Serper key for backup |
| Changing the password | Edit `APP_PASSWORD`, Trigger deploy, sign in again on each device |
