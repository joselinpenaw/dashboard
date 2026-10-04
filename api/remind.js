// Vercel Cron — Friday timesheet reminder.
// For every employee who hasn't submitted a timesheet for the current week,
// inserts an in-app notification (always) and emails them (if Resend is set up).
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (required); RESEND_API_KEY, RESEND_FROM (optional).

export default async function handler(req, res) {
  // Vercel sends "Authorization: Bearer $CRON_SECRET" on cron calls when CRON_SECRET is set.
  if (process.env.CRON_SECRET && req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    res.status(401).json({ error: "Unauthorized" }); return;
  }
  const SUPA = process.env.SUPABASE_URL;
  const SR = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPA || !SR) { res.status(500).json({ error: "Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in Vercel env." }); return; }
  const h = { apikey: SR, Authorization: "Bearer " + SR, "Content-Type": "application/json" };

  // Monday (UTC) of the current week
  const now = new Date();
  const x = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7));
  const wsISO = x.toISOString().slice(0, 10);

  try {
    const emps = await (await fetch(`${SUPA}/rest/v1/profiles?role=eq.employee&select=id,full_name,email`, { headers: h })).json();
    const subs = await (await fetch(`${SUPA}/rest/v1/timesheets?week_start=eq.${wsISO}&select=user_id`, { headers: h })).json();
    const done = new Set((Array.isArray(subs) ? subs : []).map((s) => s.user_id));
    const missing = (Array.isArray(emps) ? emps : []).filter((e) => !done.has(e.id));

    // in-app notifications (always works)
    for (const e of missing) {
      await fetch(`${SUPA}/rest/v1/notifications`, { method: "POST", headers: { ...h, Prefer: "return=minimal" }, body: JSON.stringify({ user_id: e.id, type: "reminder", message: `Reminder: submit your timesheet for the week of ${wsISO}.` }) });
    }

    // optional email via the admin's connected Gmail
    const CID = process.env.GOOGLE_CLIENT_ID, CS = process.env.GOOGLE_CLIENT_SECRET;
    let emailed = 0, accessToken = null;
    if (CID && CS) {
      try {
        const cfg = await (await fetch(`${SUPA}/rest/v1/app_config?key=eq.gmail_refresh_token&select=value`, { headers: h })).json();
        const refresh = Array.isArray(cfg) && cfg[0] ? cfg[0].value : null;
        if (refresh) {
          const tj = await (await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: CID, client_secret: CS, refresh_token: refresh, grant_type: "refresh_token" }) })).json();
          accessToken = tj.access_token || null;
        }
      } catch (e) { /* ignore email errors */ }
    }
    if (accessToken) {
      for (const e of missing) {
        if (!e.email) continue;
        const mime = [`To: ${e.email}`, "Subject: Please submit your timesheet", "MIME-Version: 1.0", 'Content-Type: text/html; charset="UTF-8"', "", `<p>Hi ${e.full_name || "there"},</p><p>Reminder to submit your timesheet for the week of <strong>${wsISO}</strong> in the Workspace dashboard.</p>`].join("\r\n");
        const raw = Buffer.from(mime).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
        const r = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", { method: "POST", headers: { Authorization: "Bearer " + accessToken, "Content-Type": "application/json" }, body: JSON.stringify({ raw }) });
        if (r.ok) emailed++;
      }
    }

    res.status(200).json({ week: wsISO, employees: (Array.isArray(emps) ? emps.length : 0), missing: missing.length, notified: missing.length, emailed });
  } catch (e) {
    res.status(502).json({ error: String(e && e.message ? e.message : e) });
  }
}
