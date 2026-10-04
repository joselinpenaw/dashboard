// Vercel serverless function — admin-only user management via Supabase Auth Admin API.
// Env vars (Vercel → Settings → Environment Variables):
//   SUPABASE_URL                (e.g. https://<project-ref>.supabase.co)
//   SUPABASE_SERVICE_ROLE_KEY   (Supabase → Project Settings → API → service_role secret)
//
// Security: the caller must send their Supabase access token (Authorization: Bearer …);
// we verify that token belongs to a user whose profile role = 'admin' before doing anything.

export default async function handler(req, res) {
  if (req.method !== "POST") { res.status(405).json({ error: "POST only" }); return; }
  const SUPA = process.env.SUPABASE_URL;
  const SR = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPA || !SR) { res.status(500).json({ error: "Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in Vercel env." }); return; }

  const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!token) { res.status(401).json({ error: "Not signed in" }); return; }

  // who is calling?
  const who = await fetch(SUPA + "/auth/v1/user", { headers: { apikey: SR, Authorization: "Bearer " + token } });
  if (!who.ok) { res.status(401).json({ error: "Invalid session" }); return; }
  const caller = await who.json();
  // is the caller an admin?
  const pr = await fetch(`${SUPA}/rest/v1/profiles?id=eq.${caller.id}&select=role`, { headers: { apikey: SR, Authorization: "Bearer " + SR } });
  const prof = await pr.json().catch(() => []);
  if (!Array.isArray(prof) || !prof[0] || prof[0].role !== "admin") { res.status(403).json({ error: "Admins only" }); return; }

  let body = req.body; if (typeof body === "string") { try { body = JSON.parse(body); } catch (e) { body = {}; } } body = body || {};
  const h = { apikey: SR, Authorization: "Bearer " + SR, "Content-Type": "application/json" };

  try {
    if (body.action === "create_user") {
      const { email, password, full_name, role } = body;
      if (!email || !password) { res.status(400).json({ error: "Email and password are required" }); return; }
      const r = await fetch(SUPA + "/auth/v1/admin/users", { method: "POST", headers: h, body: JSON.stringify({ email, password, email_confirm: true, user_metadata: { full_name: full_name || "", role: role || "employee" } }) });
      const j = await r.json();
      if (!r.ok) { res.status(502).json({ error: j.msg || j.error_description || j.error || JSON.stringify(j) }); return; }
      if (j.id) await fetch(`${SUPA}/rest/v1/profiles?id=eq.${j.id}`, { method: "PATCH", headers: { ...h, Prefer: "return=minimal" }, body: JSON.stringify({ email, full_name: full_name || "", role: role || "employee" }) });
      res.status(200).json({ ok: true, id: j.id }); return;
    }
    if (body.action === "update_user") {
      const { id, email, password } = body;
      if (!id) { res.status(400).json({ error: "Missing user id" }); return; }
      const patch = {}; if (email) patch.email = email; if (password) patch.password = password;
      if (!Object.keys(patch).length) { res.status(400).json({ error: "Nothing to update" }); return; }
      const r = await fetch(`${SUPA}/auth/v1/admin/users/${id}`, { method: "PUT", headers: h, body: JSON.stringify(patch) });
      const j = await r.json();
      if (!r.ok) { res.status(502).json({ error: j.msg || j.error_description || j.error || JSON.stringify(j) }); return; }
      if (email) await fetch(`${SUPA}/rest/v1/profiles?id=eq.${id}`, { method: "PATCH", headers: { ...h, Prefer: "return=minimal" }, body: JSON.stringify({ email }) });
      res.status(200).json({ ok: true }); return;
    }
    res.status(400).json({ error: "Unknown action" });
  } catch (e) {
    res.status(502).json({ error: String(e && e.message ? e.message : e) });
  }
}
