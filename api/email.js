// Vercel function — send email server-side from the admin's Gmail (no interaction).
// Uses the refresh token stored by /api/gmail-connect. Admin-only.
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET.

export default async function handler(req, res) {
  if (req.method !== "POST") { res.status(405).json({ error: "POST only" }); return; }
  const SUPA = process.env.SUPABASE_URL, SR = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const CID = process.env.GOOGLE_CLIENT_ID, CS = process.env.GOOGLE_CLIENT_SECRET;
  if (!SUPA || !SR) { res.status(500).json({ error: "Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in Vercel env." }); return; }
  if (!CID || !CS) { res.status(500).json({ error: "Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in Vercel env." }); return; }

  const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  const who = await fetch(SUPA + "/auth/v1/user", { headers: { apikey: SR, Authorization: "Bearer " + token } });
  if (!who.ok) { res.status(401).json({ error: "Not signed in" }); return; }
  const caller = await who.json();
  const pr = await fetch(`${SUPA}/rest/v1/profiles?id=eq.${caller.id}&select=role`, { headers: { apikey: SR, Authorization: "Bearer " + SR } });
  const prof = await pr.json().catch(() => []);
  if (!Array.isArray(prof) || !prof[0] || prof[0].role !== "admin") { res.status(403).json({ error: "Admins only" }); return; }

  let body = req.body; if (typeof body === "string") { try { body = JSON.parse(body); } catch (e) { body = {}; } } body = body || {};
  const { to, subject } = body;
  if (!to || !subject) { res.status(400).json({ error: "Missing recipient or subject" }); return; }
  const html = body.html || `<p>${(body.text || "").replace(/\n/g, "<br>")}</p>`;

  try {
    const cfg = await (await fetch(`${SUPA}/rest/v1/app_config?key=eq.gmail_refresh_token&select=value`, { headers: { apikey: SR, Authorization: "Bearer " + SR } })).json();
    const refresh = Array.isArray(cfg) && cfg[0] ? cfg[0].value : null;
    if (!refresh) { res.status(400).json({ error: "Gmail not connected. Open My Account → Connect Gmail for sending." }); return; }

    const tok = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: CID, client_secret: CS, refresh_token: refresh, grant_type: "refresh_token" }),
    });
    const tj = await tok.json();
    if (!tok.ok || !tj.access_token) { res.status(502).json({ error: "Gmail token refresh failed: " + (tj.error_description || tj.error || "") }); return; }

    const mime = [`To: ${to}`, `Subject: ${subject}`, "MIME-Version: 1.0", 'Content-Type: text/html; charset="UTF-8"', "", html].join("\r\n");
    const raw = Buffer.from(mime).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const send = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
      method: "POST", headers: { Authorization: "Bearer " + tj.access_token, "Content-Type": "application/json" },
      body: JSON.stringify({ raw }),
    });
    if (!send.ok) { const t = await send.text(); res.status(502).json({ error: "Gmail send failed: " + t.slice(0, 160) }); return; }
    res.status(200).json({ ok: true });
  } catch (e) {
    res.status(502).json({ error: String(e && e.message ? e.message : e) });
  }
}
