/* ============================================================
   App — router, navigation, chrome
   ============================================================ */
(function () {
  const S = window.Store;
  const U = window.UI;

  const NAV = [
    { group: "Personal", items: [
      { id: "dashboard", label: "My Dashboard", icon: "🏠" },
      { id: "applications", label: "Job Applications", icon: "💼", badge: () => S.get().applications.filter((a) => a.status === "interview").length || "" },
      { id: "timetracker", label: "Time Tracker", icon: "⏱", badge: () => (window.DB && window.DB.active) ? (window.DB.timeEntries().filter((e) => !e.clock_out).length || "") : (Object.keys(S.get().activeClocks || {}).length || "") },
      { id: "insights", label: "Insights", icon: "📈" },
      { id: "jobsearch", label: "Job Search", icon: "🔍", badge: () => S.get().jobMarket.filter((j) => new Date(j.posted).toDateString() === new Date().toDateString()).length || "" },
      { id: "account", label: "My Account", icon: "👤" },
    ]},
    { group: "Workspace", items: [
      { id: "sops", label: "SOPs", icon: "📄", badge: () => S.get().sops.length },
      { id: "contracts", label: "Contracts", icon: "✍️", badge: () => S.get().contracts.filter((c) => c.status === "sent").length || "" },
      { id: "payroll", label: "Payroll & Expenses", icon: "💳", badge: () => S.get().transactions.filter((t) => t.status === "pending").length || "" },
      { id: "applicants", label: "Applicants", icon: "🧑‍💼", badge: () => S.get().applicants.filter((a) => !["hired", "rejected"].includes(a.stage)).length || "" },
      { id: "team", label: "Team", icon: "👥", badge: () => S.get().team.length },
    ]},
  ];

  let current = location.hash.replace("#", "") || "dashboard";

  // Employees only see these sections; admins (and no-login mode) see all.
  const EMPLOYEE_ROUTES = ["timetracker", "account", "contracts", "sops"];
  function allowedRoutes() {
    const A = window.Auth;
    if (A && A.enabled && A.user() && !A.isAdmin()) return EMPLOYEE_ROUTES;
    return null; // all
  }

  const App = {
    go(route) {
      if (!window.Views[route]) route = "dashboard";
      const allow = allowedRoutes();
      if (allow && !allow.includes(route)) route = allow[0];
      current = route;
      location.hash = route;
      this.render();
      if (window.innerWidth <= 900) this.closeSidebar();
      document.querySelector(".content").scrollTo?.(0, 0);
      window.scrollTo(0, 0);
    },
    rerender() { this.render(); },
    render() {
      const view = window.Views[current] || window.Views.dashboard;
      document.getElementById("pageTitle").textContent = view.title;
      const content = document.getElementById("content");
      let banner = "";
      if (window.DB && window.DB.active && window.DB.viewAs) {
        const t = window.DB.target();
        banner = `<div class="card card-pad" style="margin-bottom:16px;border-color:var(--warn);display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap">
          <div>👁 <strong>Viewing ${U.esc(window.DB.displayName(t))}'s account</strong> <span class="faint">(admin)</span></div>
          <button class="btn sm" id="exitViewAs">Exit view</button></div>`;
      }
      content.innerHTML = banner + view.render();
      view.mount?.(content);
      if (banner) { const b = document.getElementById("exitViewAs"); if (b) b.onclick = () => { window.DB.viewAs = null; this.go("team"); }; }
      this.renderNav();
      if (window.__refreshBell) window.__refreshBell();
    },
    renderNav() {
      const nav = document.getElementById("nav");
      const allow = allowedRoutes();
      nav.innerHTML = NAV.map((g) => {
        const items = g.items.filter((it) => !allow || allow.includes(it.id));
        if (!items.length) return "";
        return `
        <div class="nav-group">
          <div class="nav-group-label">${g.group}</div>
          ${items.map((it) => {
            const badge = it.badge ? it.badge() : "";
            return `<button class="nav-item ${current === it.id ? "active" : ""}" data-route="${it.id}">
              <span class="ni-icon">${it.icon}</span><span>${it.label}</span>
              ${badge !== "" && badge !== 0 ? `<span class="ni-badge">${badge}</span>` : ""}
            </button>`;
          }).join("")}
        </div>`;
      }).join("");
      nav.querySelectorAll("[data-route]").forEach((b) => (b.onclick = () => this.go(b.dataset.route)));
    },
    refreshSidebarUser() {
      const A = window.Auth;
      let name, role;
      if (A && A.enabled && A.profile()) {
        const pr = A.profile();
        name = pr.full_name || pr.email || "User";
        role = pr.role === "admin" ? "Admin" : "Employee";
      } else {
        const p = S.get().profile; name = p.name; role = p.role || "Member";
      }
      const av = document.getElementById("sidebarAvatar");
      const pic = A && A.profile() && A.profile().avatar_url;
      if (pic) av.innerHTML = `<img src="${pic}" alt="" style="width:100%;height:100%;object-fit:cover"/>`;
      else av.textContent = U.initials(name);
      document.getElementById("sidebarName").textContent = name;
      document.getElementById("sidebarRole").textContent = role;
    },
    refreshClockPill() {
      const n = (window.DB && window.DB.active)
        ? window.DB.timeEntries().filter((e) => !e.clock_out).length
        : Object.keys(S.get().activeClocks || {}).length;
      const pill = document.getElementById("clockPill");
      const text = document.getElementById("clockPillText");
      pill.classList.toggle("on", n > 0);
      text.textContent = n > 0 ? `${n} on the clock` : "Team clocked out";
      this.renderNav();
    },
    async runGmailSync() {
      const clientId = (S.get().profile.gmailClientId || "").trim();
      if (!clientId) {
        U.modal({
          title: "Connect Gmail",
          body: `<p class="muted">To sync, paste your Google OAuth Client ID (a one-time ~5 min setup). It's stored only in this browser.</p>
                 <div class="field" style="margin-top:14px"><label>Google OAuth Client ID</label><input id="gid" placeholder="xxxx.apps.googleusercontent.com"/></div>
                 <p class="faint" style="font-size:12px">Don't have one yet? Open <strong>My Account → Gmail sync</strong> for where to get it.</p>`,
          footer: `<button class="btn" data-modal-close>Cancel</button><button class="btn primary" id="saveGid">Save & continue</button>`,
          onMount: (card) => {
            card.querySelector("#saveGid").onclick = () => {
              const v = card.querySelector("#gid").value.trim();
              if (!v) { U.toast("Enter a Client ID", "error"); return; }
              S.setProfile({ gmailClientId: v });
              U.closeModal();
              App.runGmailSync();
            };
          },
        });
        return;
      }
      U.modal({
        title: "Syncing Gmail",
        body: `<div style="text-align:center;padding:8px">
                 <div id="gp" style="font-size:18px;font-weight:600">Starting…</div>
                 <p class="faint mt-16">A Google sign-in window may pop up — approve <strong>read-only</strong> access. If it's blocked, allow popups for this site.</p>
               </div>`,
        footer: `<button class="btn" data-modal-close>Run in background</button>`,
      });
      const prog = (m) => { const e = document.getElementById("gp"); if (e) e.textContent = m; };
      try {
        const res = await window.Gmail.sync({ onProgress: prog });
        U.closeModal();
        U.toast(`Gmail synced — ${res.added} added, ${res.updated} updated (${res.scanned} scanned)`, "success");
        this.render();
      } catch (e) {
        U.closeModal();
        if (e && e.message === "NO_CLIENT_ID") { this.runGmailSync(); return; }
        U.toast("Sync failed: " + (e && e.message ? e.message : e), "error");
      }
    },
    openSidebar() { document.getElementById("sidebar").classList.add("open"); document.getElementById("scrim").classList.add("show"); },
    closeSidebar() { document.getElementById("sidebar").classList.remove("open"); document.getElementById("scrim").classList.remove("show"); },
  };

  window.App = App;

  // ---- auth screen ----
  function renderAuth() {
    document.getElementById("app").style.display = "none";
    let mode = "signin";
    const host = document.createElement("div");
    host.id = "authScreen";
    host.style.cssText = "position:fixed;inset:0;display:grid;place-items:center;padding:20px;z-index:500";
    const draw = () => {
      host.innerHTML = `
        <div class="card" style="width:min(420px,100%)">
          <div class="card-pad">
            <div class="flex gap-12 center" style="margin-bottom:16px">
              <div class="brand-mark">◆</div>
              <div><div class="brand-name" style="color:var(--text);font-size:18px">Workspace</div>
              <div class="faint" style="font-size:12px">${mode === "signin" ? "Sign in to your workspace" : "Create your account"}</div></div>
            </div>
            <form id="authForm">
              ${mode === "signup" ? `<div class="field"><label>Full name</label><input id="afName" required/></div>` : ""}
              <div class="field"><label>Email</label><input id="afEmail" type="email" required/></div>
              <div class="field"><label>Password</label><input id="afPass" type="password" minlength="6" required/></div>
              <button class="btn primary" type="submit" style="width:100%">${mode === "signin" ? "Sign in" : "Sign up"}</button>
            </form>
            <div id="authMsg" style="font-size:12.5px;margin-top:10px;color:var(--text-faint)"></div>
            <div class="mt-16" style="text-align:center;font-size:13px">
              ${mode === "signin" ? `New here? <a href="#" id="authToggle" style="color:var(--primary)">Create an account</a>`
                                  : `Have an account? <a href="#" id="authToggle" style="color:var(--primary)">Sign in</a>`}
            </div>
          </div>
        </div>`;
      host.querySelector("#authToggle").onclick = (e) => { e.preventDefault(); mode = mode === "signin" ? "signup" : "signin"; draw(); };
      host.querySelector("#authForm").onsubmit = async (e) => {
        e.preventDefault();
        const msg = host.querySelector("#authMsg");
        msg.style.color = "var(--text-faint)"; msg.textContent = "Working…";
        const email = host.querySelector("#afEmail").value.trim();
        const pass = host.querySelector("#afPass").value;
        try {
          if (mode === "signup") {
            const name = host.querySelector("#afName").value.trim();
            await window.Auth.signUp(email, pass, name);
            if (!window.Auth.user()) { msg.style.color = "var(--success)"; msg.textContent = "Account created — check your email to confirm, then sign in."; mode = "signin"; return; }
          } else {
            await window.Auth.signIn(email, pass);
          }
          location.reload();
        } catch (err) { msg.style.color = "var(--danger)"; msg.textContent = (err && err.message) || String(err); }
      };
    };
    draw();
    document.body.appendChild(host);
  }

  function addBell() {
    const actions = document.querySelector(".topbar-actions");
    if (!actions || document.getElementById("notifBell")) return;
    const b = document.createElement("button");
    b.id = "notifBell"; b.className = "icon-btn"; b.title = "Notifications"; b.style.position = "relative";
    actions.insertBefore(b, actions.firstChild);
    b.onclick = openNotifs;
    refreshBell();
  }
  function refreshBell() {
    const b = document.getElementById("notifBell");
    if (!b) return;
    const n = (window.DB && window.DB.active) ? window.DB.unreadCount() : 0;
    b.innerHTML = `🔔${n ? `<span style="position:absolute;top:-3px;right:-3px;background:var(--danger);color:#fff;font-size:10px;font-weight:700;border-radius:10px;min-width:16px;height:16px;line-height:16px;text-align:center;padding:0 4px">${n}</span>` : ""}`;
  }
  window.__refreshBell = refreshBell;
  function openNotifs() {
    const list = (window.DB && window.DB.active) ? window.DB.notifications() : [];
    U.modal({
      title: "Notifications",
      body: list.length
        ? `<div class="list">${list.map((n) => `<div class="list-item"><div class="li-ico bg-${n.read ? "info" : "success"}">🔔</div><div class="li-text"><div class="li-title">${U.esc(n.message)}</div><div class="li-sub">${U.ago(n.created_at)}</div></div></div>`).join("")}</div>`
        : U.empty("🔔", "No notifications yet."),
      footer: `<button class="btn primary" data-modal-close>Close</button>`,
    });
    if (window.DB && window.DB.active && window.DB.unreadCount()) window.DB.markAllRead().then(refreshBell);
  }

  function addSignOut() {
    const f = document.querySelector(".sidebar-footer");
    if (!f || f.querySelector("#signOutBtn")) return;
    const b = document.createElement("button");
    b.id = "signOutBtn"; b.className = "btn ghost sm"; b.textContent = "Sign out";
    b.style.cssText = "width:100%;margin-top:8px";
    b.onclick = async () => { await window.Auth.signOut(); location.reload(); };
    f.appendChild(b);
  }

  // ---- init ----
  async function init() {
    // theme
    const savedTheme = localStorage.getItem("wd_theme") || "dark";
    document.documentElement.setAttribute("data-theme", savedTheme);
    document.getElementById("themeToggle").onclick = () => {
      const cur = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
      document.documentElement.setAttribute("data-theme", cur);
      localStorage.setItem("wd_theme", cur);
    };

    // auth gate
    if (window.Auth && window.Auth.enabled) {
      const loggedIn = await window.Auth.init();
      if (!loggedIn) { renderAuth(); return; }
      addSignOut();
      if (window.DB) await window.DB.load();
      addBell();
    }

    // clock pill click → time tracker
    document.getElementById("clockPill").onclick = () => App.go("timetracker");

    // mobile menu
    document.getElementById("menuToggle").onclick = () => {
      const open = document.getElementById("sidebar").classList.contains("open");
      open ? App.closeSidebar() : App.openSidebar();
    };
    document.getElementById("scrim").onclick = () => App.closeSidebar();

    // sidebar user chip → account
    document.querySelector(".user-chip").onclick = () => App.go("account");

    window.addEventListener("hashchange", () => {
      const r = location.hash.replace("#", "");
      if (r && r !== current) App.go(r);
    });

    App.refreshSidebarUser();
    App.refreshClockPill();
    App.go(current);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
