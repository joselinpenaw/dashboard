/* ============================================================
   DB — Supabase data layer (active only when logged in).
   Loads shared data into memory after auth; views read synchronously
   from the cache and call async mutators that re-fetch + re-render.
   ============================================================ */
(function () {
  const A = window.Auth;
  const DB = {
    active: false,
    viewAs: null, // admin "view as member": a profile id being inspected
    cache: { profiles: [], time_entries: [], contracts: [], notifications: [], departments: [], sops: [], timesheets: [] },
  };

  const c = () => A.client();
  DB.me = () => (A && A.profile());
  DB.isAdmin = () => !!(A && A.isAdmin());
  DB.targetId = () => DB.viewAs || (DB.me() && DB.me().id);
  DB.target = () => DB.cache.profiles.find((p) => p.id === DB.targetId()) || DB.me();
  DB.displayName = (p) => (p ? (p.full_name || p.email || "User") : "User");

  DB.load = async function () {
    if (!(A && A.enabled && A.user())) return;
    DB.active = true;
    const [pf, te, ct, nt, dp, sp, ts] = await Promise.all([
      c().from("profiles").select("*").order("created_at", { ascending: true }),
      c().from("time_entries").select("*").order("clock_in", { ascending: false }),
      c().from("contracts").select("*").order("created_at", { ascending: false }),
      c().from("notifications").select("*").order("created_at", { ascending: false }),
      c().from("departments").select("*").order("name", { ascending: true }),
      c().from("sops").select("*").order("created_at", { ascending: false }),
      c().from("timesheets").select("*").order("week_start", { ascending: false }),
    ]);
    DB.cache.profiles = pf.data || [];
    DB.cache.time_entries = te.data || [];
    DB.cache.contracts = ct.data || [];
    DB.cache.notifications = nt.data || [];
    DB.cache.departments = dp.data || [];
    DB.cache.sops = sp.data || [];
    DB.cache.timesheets = ts.data || [];
  };
  DB.reload = DB.load;

  // surface Supabase errors instead of failing silently
  const chk = (r) => { if (r && r.error) throw new Error(r.error.message || JSON.stringify(r.error)); return r; };

  // ---- profiles ----
  DB.profiles = () => DB.cache.profiles;
  DB.profile = (id) => DB.cache.profiles.find((p) => p.id === id);
  DB.updateProfile = async (id, patch) => { chk(await c().from("profiles").update(patch).eq("id", id)); await DB.load(); };
  DB.removeProfile = async (id) => { chk(await c().from("profiles").delete().eq("id", id)); await DB.load(); };

  // ---- time entries ----
  DB.timeEntries = () => DB.cache.time_entries;
  DB.activeEntryFor = (uid) => DB.cache.time_entries.find((e) => e.user_id === uid && !e.clock_out);
  DB.clockIn = async (uid, project) => { chk(await c().from("time_entries").insert({ user_id: uid, project: project || "General" })); await DB.load(); };
  DB.clockOut = async (entryId) => { chk(await c().from("time_entries").update({ clock_out: new Date().toISOString() }).eq("id", entryId)); await DB.load(); };
  DB.removeTimeEntry = async (id) => { chk(await c().from("time_entries").delete().eq("id", id)); await DB.load(); };

  // ---- contracts ----
  DB.contracts = () => DB.cache.contracts;
  DB.addContract = async (rec) => {
    rec.created_by = DB.me().id;
    const r = chk(await c().from("contracts").insert(rec).select().single());
    await DB.load();
    return r.data;
  };
  DB.updateContract = async (id, patch) => { chk(await c().from("contracts").update(patch).eq("id", id)); await DB.load(); };
  DB.removeContract = async (id) => { chk(await c().from("contracts").delete().eq("id", id)); await DB.load(); };
  DB.signContract = async (ct, fieldValues) => {
    chk(await c().from("contracts").update({ status: "signed", signed_at: new Date().toISOString(), field_values: fieldValues || {} }).eq("id", ct.id));
    const me = DB.me();
    const admins = DB.cache.profiles.filter((p) => p.role === "admin");
    for (const a of admins) {
      await c().from("notifications").insert({ user_id: a.id, type: "contract_signed", message: `${DB.displayName(me)} signed "${ct.title}"` });
    }
    await DB.load();
  };

  // ---- timesheets (employees submit weekly; admin reviews) ----
  DB.timesheets = () => DB.cache.timesheets;
  DB.submitTimesheet = async (rec) => {
    rec.user_id = DB.me().id; rec.status = "submitted"; rec.submitted_at = new Date().toISOString(); rec.reviewed_at = null;
    chk(await c().from("timesheets").upsert(rec, { onConflict: "user_id,week_start" }));
    const me = DB.me();
    for (const a of DB.cache.profiles.filter((p) => p.role === "admin")) {
      await c().from("notifications").insert({ user_id: a.id, type: "timesheet", message: `${DB.displayName(me)} submitted a timesheet (${rec.hours}h, week of ${rec.week_start})` });
    }
    await DB.load();
  };
  DB.reviewTimesheet = async (id, status) => { chk(await c().from("timesheets").update({ status, reviewed_at: new Date().toISOString() }).eq("id", id)); await DB.load(); };

  // ---- SOPs (admin uploads + assigns; employees see only theirs) ----
  DB.sops = () => DB.cache.sops;
  DB.addSop = async (rec) => { chk(await c().from("sops").insert(rec)); await DB.load(); };
  DB.updateSop = async (id, patch) => { chk(await c().from("sops").update(patch).eq("id", id)); await DB.load(); };
  DB.removeSop = async (id) => { chk(await c().from("sops").delete().eq("id", id)); await DB.load(); };

  // ---- departments (admin-managed; used when clocking in) ----
  DB.departments = () => DB.cache.departments;
  DB.addDepartment = async (name) => { chk(await c().from("departments").insert({ name })); await DB.load(); };
  DB.removeDepartment = async (id) => { chk(await c().from("departments").delete().eq("id", id)); await DB.load(); };

  // ---- admin user management (via /api/admin serverless function) ----
  async function callAdmin(action, payload) {
    const { data } = await c().auth.getSession();
    const token = data.session && data.session.access_token;
    const r = await fetch("/api/admin", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + (token || "") },
      body: JSON.stringify({ action, ...payload }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || (r.status === 404 ? "Admin API not deployed (use your Vercel site)" : "HTTP " + r.status));
    await DB.load();
    return j;
  }
  DB.adminCreateUser = (p) => callAdmin("create_user", p);
  DB.adminUpdateUser = (id, p) => callAdmin("update_user", { id, ...p });

  // send an email server-side via Resend (no user interaction)
  DB.sendEmail = async ({ to, subject, html, text }) => {
    const { data } = await c().auth.getSession();
    const token = data.session && data.session.access_token;
    const r = await fetch("/api/email", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + (token || "") }, body: JSON.stringify({ to, subject, html, text }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || (r.status === 404 ? "Email API not deployed (use your Vercel site)" : "HTTP " + r.status));
    return j;
  };

  // ---- notifications ----
  DB.notifications = () => DB.cache.notifications;
  DB.unreadCount = () => DB.cache.notifications.filter((n) => !n.read).length;
  DB.markAllRead = async () => {
    const ids = DB.cache.notifications.filter((n) => !n.read).map((n) => n.id);
    if (ids.length) { await c().from("notifications").update({ read: true }).in("id", ids); await DB.load(); }
  };

  window.DB = DB;
})();
