/* ============================================================
   Auth — Supabase login / sign-up + role (admin vs employee).
   If Supabase isn't configured/loaded, Auth.enabled is false and the
   app runs in single-user (no-login) mode exactly as before.
   ============================================================ */
(function () {
  const cfg = window.APP_CONFIG || {};
  const ready = !!(cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY && window.supabase && window.supabase.createClient);
  const client = ready ? window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY) : null;

  let session = null;
  let profile = null;

  async function loadProfile() {
    if (!session) { profile = null; return null; }
    const { data, error } = await client.from("profiles").select("*").eq("id", session.user.id).single();
    if (error) { profile = null; return null; }
    profile = data;
    return data;
  }

  const Auth = {
    enabled: ready,
    client: () => client,
    user: () => (session ? session.user : null),
    profile: () => profile,
    role: () => (profile ? profile.role : null),
    isAdmin: () => !!(profile && profile.role === "admin"),

    async init() {
      if (!ready) return false;
      try {
        const { data } = await client.auth.getSession();
        session = data.session || null;
        if (session) await loadProfile();
        client.auth.onAuthStateChange((_evt, s) => { session = s; });
        return !!session;
      } catch (e) { return false; }
    },
    async signIn(email, password) {
      const { data, error } = await client.auth.signInWithPassword({ email, password });
      if (error) throw error;
      session = data.session;
      await loadProfile();
      return data;
    },
    async signUp(email, password, fullName) {
      const { data, error } = await client.auth.signUp({ email, password, options: { data: { full_name: fullName } } });
      if (error) throw error;
      session = data.session;
      if (session) await loadProfile();
      return data; // session may be null if email confirmation is on
    },
    async signOut() {
      if (client) await client.auth.signOut();
      session = null; profile = null;
    },
    reloadProfile: loadProfile,
  };

  window.Auth = Auth;
})();
