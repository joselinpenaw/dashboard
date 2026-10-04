// Vercel function — store a Gmail refresh token so the server can send email
// as the admin's Gmail without further interaction. Admin-only.
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET.

export default async function handler(req, res) {
  if (req.method !== "POST") { res.status(405).json({ error: "POST only" }); return; }
  const SUPA = process.env.SUPABASE_URL, SR = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const CID = process.env.GOOGLE_CLIENT_ID, CS = process.env.GOOGLE_CLIENT_SECRET;
  if (!SUPA || !SR) { res.status(500).json({ error: "Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in Vercel env." }); return; }
  if (!CID || !CS) { res.status(500).json({ error: "Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in Vercel env." }); return; }

  // verify caller is an admin
  const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  const who = await fetch(SUPA + "/auth/v1/user", { headers: { apikey: SR, Authorization: "Bearer " + token } });
  if (!who.ok) { res.status(401).json({ error: "Not signed in" }); return; }
  const caller = await who.json();
  const pr = await fetch(`${SUPA}/rest/v1/profiles?id=eq.${caller.id}&select=role`, { headers: { apikey: SR, Authorization: "Bearer " + SR } });
  const prof = await pr.json().catch(() => []);
  if (!Array.isArray(prof) || !prof[0] || prof[0].role !== "admin") { res.status(403).json({ error: "Admins only" }); return; }

  let body = req.body; if (typeof body === "string") { try { body = JSON.parse(body); } catch (e) { body = {}; } } body = body || {};
  if (!body.code) { res.status(400).json({ error: "Missing authorization code" }); return; }

  try {
    const tok = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ code: body.code, client_id: CID, client_secret: CS, redirect_uri: "postmessage", grant_type: "authorization_code" }),
    });
    const tj = await tok.json();
    if (!tok.ok || !tj.refresh_token) {
      res.status(502).json({ error: tj.error_description || tj.error || "No refresh token returned. Revoke prior access at myaccount.google.com/permissions and try again." });
      return;
    }
    const save = await fetch(`${SUPA}/rest/v1/app_config?on_conflict=key`, {
      method: "POST",
      headers: { apikey: SR, Authorization: "Bearer " + SR, "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify({ key: "gmail_refresh_token", value: tj.refresh_token }),
    });
    if (!save.ok) { const t = await save.text(); res.status(502).json({ error: "Couldn't store token: " + t.slice(0, 160) }); return; }
    res.status(200).json({ ok: true });
  } catch (e) {
    res.status(502).json({ error: String(e && e.message ? e.message : e) });
  }
}
