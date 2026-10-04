# Deploying your own copy

This copy of `anonomyous-coder/dashboard` differs from upstream in a few ways:

- `assets/js/config.js` is **blank**. Upstream ships the original author's
  Supabase URL and anon key, so an unchanged deploy would put your sign-ups
  in their database.
- `supabase/hardening.sql` fixes two privilege-escalation holes in
  `schema.sql`: (1) anyone could sign up as admin by passing
  `data: { role: "admin" }`, and (2) any user could `update profiles set role = 'admin'`
  on their own row.
- `api/remind.js` rejects calls without `CRON_SECRET` once you set that env var,
  so strangers can't trigger reminder emails.
- Removed references to the upstream author's URLs.

## 0. Run it locally (no setup)

```bash
python3 -m http.server 8000     # open http://localhost:8000
```

Data lives in `localStorage`. This is enough if you only want a personal dashboard.

## 1. Supabase

1. Create a project at supabase.com.
2. In the **SQL Editor**, run these in order:
   1. `supabase/schema.sql`
   2. the "additional migration" SQL block in `README.md` (section 1)
   3. `supabase/hardening.sql`
3. **Project Settings → API**: copy the **Project URL** and **anon** key into
   `assets/js/config.js`, then run `node build.js` and commit.
4. Open the deployed site and **sign up right away**. The first account becomes
   admin. Then turn off **Authentication → Sign In / Providers → Allow new users
   to sign up**. Admins still create employees from the Team page, because that
   goes through the service-role API.

## 2. Vercel

Import the repo at vercel.com/new. Framework preset: **Other**; no build
command; output directory: root. Add these under **Settings → Environment
Variables**, then redeploy:

| Variable | Required for |
| --- | --- |
| `SUPABASE_URL` | Team admin, email, reminders |
| `SUPABASE_SERVICE_ROLE_KEY` | same (secret; never put it in client code) |
| `CRON_SECRET` | any random string; protects `/api/remind` |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Gmail hands-free send |
| `ADZUNA_APP_ID`, `ADZUNA_APP_KEY` | Job Search (free key at developer.adzuna.com) |

Always use the stable production domain (`<project>.vercel.app` or a custom
domain), not preview URLs.

## 3. Google OAuth (optional, for Gmail sync and send)

In Google Cloud Console:

1. Enable the **Gmail API**.
2. Under **Google Auth Platform → Clients**, create a **Web application** client. Add
   your production URL (no trailing slash) to **Authorized JavaScript
   origins**.
3. Under **Audience**, add yourself and your employees as **Test users** while
   the app is in testing.
4. Put the client ID and secret into Vercel. Paste the client ID into the
   app once when prompted for Gmail sync.
5. As admin, open **My Account → Connect Gmail for sending**.

## 4. Crons

`vercel.json` already defines the crons: Adzuna refresh daily at 13:00 UTC, and the
timesheet reminder on Fridays at 21:00 UTC. They run on any Vercel plan
(Hobby allows daily crons).
