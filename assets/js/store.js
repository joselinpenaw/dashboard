/* ============================================================
   Store — localStorage-backed data layer with seed data
   ============================================================ */
(function () {
  const KEY = "workspace_dashboard_v1";

  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const daysAgo = (n) => new Date(Date.now() - n * 864e5).toISOString();
  const daysAhead = (n) => new Date(Date.now() + n * 864e5).toISOString();

  function seed() {
    return {
      profile: {
        name: "Noah Morgan",
        title: "Operations Lead",
        email: "",
        phone: "",
        location: "",
        role: "Admin",
        hourlyRate: 0,
        gmailClientId: "",
        gmailLastSync: null,
      },
      // ---- Personal ----
      applications: [],
      timeEntries: [],
      activeClocks: {}, // { memberId: { member, project, clockIn } }
      jobMarket: [],
      savedJobs: [],
      gmailSyncedIds: [],
      liveJobs: [],
      liveJobsFetched: null,
      // ---- Workspace ----
      sops: [],
      contracts: [],
      transactions: [],
      applicants: [],
      team: [],
      cleanSlate: true,
    };
  }

  let state = load();

  function load() {
    let s = null;
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) s = JSON.parse(raw);
    } catch (e) { /* ignore */ }
    if (!s) { s = seed(); persist(s); return s; }

    // One-time clean-slate cleanup: clear all the sample data while keeping
    // the user's own settings (profile, Gmail Client ID, live Adzuna jobs).
    if (!s.cleanSlate) {
      s.applications = [];
      s.timeEntries = [];
      s.activeClocks = {};
      s.jobMarket = [];
      s.savedJobs = [];
      s.gmailSyncedIds = [];
      if (s.profile) s.profile.gmailLastSync = null;
      s.sops = [];
      s.contracts = [];
      s.transactions = [];
      s.applicants = [];
      s.team = [];
      s.cleanSlate = true;
      persist(s);
    }
    return s;
  }
  function persist(s) {
    try { localStorage.setItem(KEY, JSON.stringify(s || state)); } catch (e) {}
  }

  const Store = {
    uid,
    get: () => state,
    save: () => persist(state),
    reset() { state = seed(); persist(state); },

    // Generic collection helpers
    add(coll, item) {
      item.id = item.id || uid();
      state[coll].unshift(item);
      persist(state);
      return item;
    },
    update(coll, id, patch) {
      const list = state[coll];
      const i = list.findIndex((x) => x.id === id);
      if (i > -1) { list[i] = { ...list[i], ...patch }; persist(state); return list[i]; }
      return null;
    },
    remove(coll, id) {
      state[coll] = state[coll].filter((x) => x.id !== id);
      persist(state);
    },
    find(coll, id) { return (state[coll] || []).find((x) => x.id === id); },

    setProfile(patch) { state.profile = { ...state.profile, ...patch }; persist(state); },

    setLiveJobs(jobs) { state.liveJobs = jobs || []; state.liveJobsFetched = new Date().toISOString(); persist(state); },

    // Time clock — per team member
    clockInMember(memberId, memberName, project) {
      if (!state.activeClocks) state.activeClocks = {};
      state.activeClocks[memberId] = { member: memberName, project: project || "General", clockIn: new Date().toISOString() };
      persist(state);
    },
    clockOutMember(memberId) {
      const a = state.activeClocks && state.activeClocks[memberId];
      if (!a) return null;
      const entry = { id: uid(), memberId, member: a.member, project: a.project, clockIn: a.clockIn, clockOut: new Date().toISOString() };
      state.timeEntries.unshift(entry);
      delete state.activeClocks[memberId];
      persist(state);
      return entry;
    },
  };

  window.Store = Store;
})();
