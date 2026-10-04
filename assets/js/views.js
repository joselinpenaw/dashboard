/* ============================================================
   Views — one entry per route. Each: {title, subtitle, render(), mount(root)}
   ============================================================ */
(function () {
  const S = window.Store;
  const U = window.UI;
  const Views = {};

  // shared small builders -------------------------------------------------
  const stat = ({ label, value, icon, tone = "primary", trend }) => `
    <div class="stat">
      <div class="stat-top">
        <span class="stat-label">${U.esc(label)}</span>
        <span class="stat-ico bg-${tone}">${icon}</span>
      </div>
      <span class="stat-value">${value}</span>
      ${trend ? `<span class="stat-trend ${trend.dir === "down" ? "trend-down" : "trend-up"}">${trend.dir === "down" ? "▼" : "▲"} ${U.esc(trend.text)}</span>` : ""}
    </div>`;

  const rowActions = (id, edit = true) => `
    <div class="flex gap-8 nowrap">
      ${edit ? `<button class="btn sm ghost" data-act="edit" data-id="${id}">Edit</button>` : ""}
      <button class="btn sm ghost" data-act="del" data-id="${id}" style="color:var(--danger)">Delete</button>
    </div>`;

  const barChart = (data) => {
    const max = Math.max(1, ...data.map((d) => d.value));
    return `<div class="chart">${data
      .map(
        (d) => `<div class="bar-col">
          <span class="col-val">${d.value}</span>
          <div class="col-fill" style="height:${(d.value / max) * 100}%"></div>
          <span class="col-label">${U.esc(d.label)}</span>
        </div>`
      )
      .join("")}</div>`;
  };

  // ---- import parsing (CSV or pasted email subjects) ----
  function normStatus(s) {
    s = (s || "").toLowerCase();
    if (/reject|declin|unfortunate|regret|not (be )?moving|filled|other candidate|not selected/.test(s)) return "rejected";
    if (/offer/.test(s)) return "offer";
    if (/interview|screen|phone|onsite|next step/.test(s)) return "interview";
    if (/appl|submit/.test(s)) return "applied";
    return null;
  }
  function parseImport(text) {
    const lines = (text || "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (!lines.length) return [];
    const out = [];
    let startIdx = 0, cols = null;
    if (lines[0].toLowerCase().includes("company")) { cols = lines[0].split(",").map((c) => c.trim().toLowerCase()); startIdx = 1; }
    const dataLines = lines.slice(startIdx);
    const isCSV = dataLines.filter((l) => l.includes(",")).length >= Math.max(1, Math.ceil(dataLines.length / 2));
    for (let i = startIdx; i < lines.length; i++) {
      const line = lines[i];
      if (isCSV && line.includes(",")) {
        const parts = line.split(",").map((p) => p.trim());
        if (cols) {
          const rec = {}; cols.forEach((c, idx) => (rec[c] = parts[idx] || ""));
          out.push({ company: rec.company, role: rec.role || rec.position || rec.title || "", status: normStatus(rec.status) || "applied", location: rec.location || "", salary: rec.salary || "", applied: rec.date ? new Date(rec.date).toISOString() : null });
        } else {
          out.push({ company: parts[0], role: parts[1] || "", status: normStatus(parts[2]) || "applied", applied: parts[3] ? new Date(parts[3]).toISOString() : null });
        }
      } else {
        const status = normStatus(line) || "applied";
        let company = "", role = "";
        const m = line.match(/(?:from|at|@|with|—|-)\s+([A-Z][\w&.\- ]{1,40})\s*$/);
        if (m) company = m[1].trim();
        const rm = line.match(/(?:applying (?:to|for)|application (?:for|to)|for|to)\s+(?:the\s+)?([A-Za-z][\w\/ ]{2,40}?)(?:\s+(?:at|with|position|role)\b|$)/i);
        if (rm) role = rm[1].trim();
        if (!company) { const cm = line.match(/\b([A-Z][a-zA-Z]+(?:\s[A-Z][a-zA-Z]+)?)\b/); company = cm ? cm[1] : line.slice(0, 24); }
        out.push({ company, role, status, applied: null });
      }
    }
    return out.filter((r) => r.company);
  }

  /* =========================================================
     1. MY DASHBOARD
  ========================================================= */
  let dashRange = "today"; // today | 7 | 15 | 30
  const fmtDur = (ms) => { const m = Math.round(ms / 60000); if (m < 60) return m + "m"; return (m / 60).toFixed(1) + "h"; };
  Views.dashboard = {
    title: "My Dashboard",
    render() {
      const prof = (window.Auth && window.Auth.profile && window.Auth.profile()) || S.get().profile;
      const firstName = U.esc(((prof.full_name || prof.name || "there").split(" ")[0]));
      const now = new Date();
      const dateStr = now.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
      const rangeDays = dashRange === "today" ? 1 : Number(dashRange);
      const since = dashRange === "today" ? new Date(new Date().setHours(0, 0, 0, 0)) : new Date(Date.now() - rangeDays * 864e5);
      const inRange = (iso) => iso && new Date(iso) >= since;
      const rangeLabel = dashRange === "today" ? "Today" : dashRange + " days";
      const dbOn = window.DB && window.DB.active;

      const apps = S.get().applications || [];
      const appsIn = apps.filter((a) => inRange(a.applied));
      const offers = appsIn.filter((a) => a.status === "offer").length;
      const interviews = appsIn.filter((a) => a.status === "interview").length;

      const timeMs = dbOn
        ? window.DB.timeEntries().filter((e) => e.clock_out && inRange(e.clock_in)).reduce((s, e) => s + (new Date(e.clock_out) - new Date(e.clock_in)), 0)
        : (S.get().timeEntries || []).filter((e) => e.clockOut && inRange(e.clockIn)).reduce((s, e) => s + (new Date(e.clockOut) - new Date(e.clockIn)), 0);

      const contracts = dbOn ? window.DB.contracts() : (S.get().contracts || []);
      const pending = contracts.filter((c) => ["invited", "draft", "sent"].includes(c.status));
      const sopsCount = dbOn ? window.DB.sops().length : (S.get().sops || []).length;

      const kpi = (label, value, sub, icon, tone) => `
        <div class="stat"><div class="stat-top"><span class="stat-label">${label}</span><span class="stat-ico bg-${tone}">${icon}</span></div>
          <span class="stat-value">${value}</span><span class="faint" style="font-size:12.5px">${sub}</span></div>`;

      const recent = [...apps].sort((a, b) => new Date(b.applied) - new Date(a.applied)).slice(0, 6);
      const nameOf = (c) => dbOn ? (window.DB.profile(c.assigned_to) ? window.DB.displayName(window.DB.profile(c.assigned_to)) : (c.party || "—")) : (c.assignedTo || c.party || "—");

      return `
      <div class="page-head">
        <div class="ph-text">
          <div class="faint" style="font-size:13px;font-weight:600;letter-spacing:.02em">${dateStr}</div>
          <h1>Welcome back, ${firstName}</h1>
          <p>Here's what's happening across your workspace.</p>
        </div>
        <div class="ph-actions"><button class="btn" data-go="applications">View applications</button></div>
      </div>

      <div class="flex gap-8" id="dashRange" style="margin-bottom:18px;flex-wrap:wrap">
        ${[["today", "Today"], ["7", "7 days"], ["15", "15 days"], ["30", "30 days"]].map(([v, l]) => `<button class="chip" data-range="${v}" style="${dashRange === v ? "background:var(--primary);color:#04121c;border-color:var(--primary);font-weight:700;cursor:pointer" : "cursor:pointer"}">${l}</button>`).join("")}
      </div>

      <div class="grid cols-4">
        ${kpi(`Applications (${rangeLabel})`, appsIn.length, `${offers} offers, ${interviews} interviews`, "💼", "primary")}
        ${kpi(`Time tracked (${rangeLabel})`, fmtDur(timeMs), "Across all projects", "⏱", "info")}
        ${kpi("Contracts pending", pending.length, "Awaiting signature", "✍️", "warn")}
        ${kpi("SOPs available", sopsCount, "Company playbooks", "📄", "success")}
      </div>

      <div class="grid cols-2 mt-24">
        <div class="card">
          <div class="card-head"><h3>Recent application activity</h3><div class="ch-actions"><button class="btn sm ghost" data-go="applications">View all</button></div></div>
          <div class="card-pad">
            ${recent.length ? `<div class="list">${recent.map((a) => `
              <div class="list-item">
                <div class="avatar" style="width:38px;height:38px;font-size:12px;border-radius:10px">${U.initials(a.company)}</div>
                <div class="li-text"><div class="li-title">${U.esc(a.company)}</div><div class="li-sub">${U.esc(a.role || "Role not specified")}</div></div>
                <div class="flex gap-12 center"><span class="li-time">${U.ago(a.applied)}</span>${U.badge(a.status)}</div>
              </div>`).join("")}</div>`
              : U.empty("💼", "No applications yet. Sync Gmail or add one.")}
          </div>
        </div>

        <div style="display:flex;flex-direction:column;gap:24px">
          <div class="card">
            <div class="card-head"><h3>Pending contracts</h3><div class="ch-actions"><button class="btn sm ghost" data-go="contracts">View all</button></div></div>
            <div class="card-pad">
              ${pending.length ? `<div class="list">${pending.slice(0, 5).map((c) => `
                <div class="list-item">
                  <div class="li-ico bg-warn">📄</div>
                  <div class="li-text"><div class="li-title">${U.esc(c.title)}</div><div class="li-sub">Assigned to ${U.esc(nameOf(c))} · ${U.ago(c.sent_at || c.created_at || c.sent || c.due)}</div></div>
                  ${U.badge(c.status)}
                </div>`).join("")}</div>`
                : U.empty("📄", "No pending contracts.")}
            </div>
          </div>
          <div class="card">
            <div class="card-head"><h3>Quick links</h3></div>
            <div class="card-pad flex gap-8" style="flex-wrap:wrap">
              <button class="btn" data-go="timetracker">⏱ Track time</button>
              <button class="btn" data-go="jobsearch">🔍 Find jobs</button>
              <button class="btn" data-go="sops">📄 Read SOPs</button>
            </div>
          </div>
        </div>
      </div>`;
    },
    mount(root) {
      root.querySelectorAll("[data-go]").forEach((b) => (b.onclick = () => window.App.go(b.dataset.go)));
      root.querySelectorAll("[data-range]").forEach((b) => (b.onclick = () => { dashRange = b.dataset.range; window.App.rerender(); }));
    },
  };

  /* =========================================================
     2. JOB APPLICATIONS
  ========================================================= */
  const APP_STATUSES = ["applied", "interview", "offer", "rejected"];
  let appFilter = "all";
  Views.applications = {
    title: "Job Applications",
    render() {
      const d = S.get();
      const counts = APP_STATUSES.reduce((m, s) => ((m[s] = d.applications.filter((a) => a.status === s).length), m), {});
      const list = appFilter === "all" ? d.applications : d.applications.filter((a) => a.status === appFilter);

      return `
      <div class="page-head">
        <div class="ph-text"><h1>Job Applications</h1><p>Track every application from applied to offer.</p></div>
        <div class="ph-actions">
          <button class="btn" id="importApp">⬆ Import</button>
          <button class="btn" id="syncGmail">⟳ Sync Gmail</button>
          <button class="btn primary" id="addApp">＋ Add application</button>
        </div>
      </div>

      <div class="grid cols-4">
        ${stat({ label: "Applied", value: counts.applied, icon: "📨", tone: "info" })}
        ${stat({ label: "Interviewing", value: counts.interview, icon: "🗣", tone: "warn" })}
        ${stat({ label: "Offers", value: counts.offer, icon: "🎉", tone: "success" })}
        ${stat({ label: "Rejected", value: counts.rejected, icon: "🚫", tone: "danger" })}
      </div>

      <div class="card mt-24">
        <div class="card-head">
          <div class="flex gap-8" id="filters">
            ${["all", ...APP_STATUSES].map((s) => `<button class="chip ${appFilter === s ? "" : ""}" data-filter="${s}" style="${appFilter === s ? "background:var(--primary);color:#fff;border-color:var(--primary)" : ""}">${s === "all" ? "All" : U.cap(s)}</button>`).join("")}
          </div>
        </div>
        <div class="table-wrap">
          <table class="tbl">
            <thead><tr><th>Company</th><th>Role</th><th>Status</th><th>Location</th><th>Salary</th><th>Applied</th><th></th></tr></thead>
            <tbody>
              ${list.length ? list.map((a) => `
                <tr>
                  <td><div class="row-main">${U.esc(a.company)}</div><div class="row-sub">${U.esc(a.source || "")}</div></td>
                  <td>${U.esc(a.role)}</td>
                  <td>${U.badge(a.status)}${a.interviewDate && new Date(a.interviewDate) > Date.now() ? `<div class="row-sub">📅 ${U.dateShort(a.interviewDate)}</div>` : ""}</td>
                  <td class="muted">${U.esc(a.location || "—")}</td>
                  <td class="muted">${U.esc(a.salary || "—")}</td>
                  <td class="muted nowrap">${U.ago(a.applied)}</td>
                  <td>${rowActions(a.id)}</td>
                </tr>`).join("")
                : `<tr><td colspan="7">${U.empty("💼", "No applications in this view.")}</td></tr>`}
            </tbody>
          </table>
        </div>
      </div>`;
    },
    mount(root) {
      const open = (app) => {
        U.formModal({
          title: app ? "Edit application" : "Add application",
          submitLabel: app ? "Save changes" : "Add application",
          values: app || {},
          fields: [
            { name: "company", label: "Company", required: true, half: true },
            { name: "role", label: "Role", required: true, half: true },
            { name: "status", label: "Status", type: "select", options: APP_STATUSES.map((s) => ({ value: s, label: U.cap(s) })), half: true },
            { name: "source", label: "Source", placeholder: "LinkedIn, Referral…", half: true },
            { name: "location", label: "Location", half: true },
            { name: "salary", label: "Salary", placeholder: "$140k", half: true },
            { name: "interviewDate", label: "Interview date", type: "date", half: true },
            { name: "applied", label: "Date applied", type: "date", value: new Date().toISOString().slice(0, 10), half: true },
            { name: "notes", label: "Notes", type: "textarea" },
          ],
          onSubmit: (data) => {
            data.applied = data.applied ? new Date(data.applied).toISOString() : new Date().toISOString();
            data.interviewDate = data.interviewDate ? new Date(data.interviewDate).toISOString() : null;
            if (app) { S.update("applications", app.id, data); U.toast("Application updated", "success"); }
            else { S.add("applications", data); U.toast("Application added", "success"); }
            window.App.rerender();
          },
        });
      };
      root.querySelector("#addApp").onclick = () => open(null);
      root.querySelector("#syncGmail").onclick = () => window.App.runGmailSync();
      root.querySelector("#importApp").onclick = () => {
        U.modal({
          title: "Import applications",
          body: `
            <p class="muted" style="margin-bottom:10px">Paste one application per line. Two formats work:</p>
            <p class="faint" style="font-size:12px;margin-bottom:12px;line-height:1.6">
              • <b>CSV:</b> Company, Role, Status, Date<br>
              • <b>Email subjects:</b> just paste them — we'll guess the status (applied / interview / offer / rejected)</p>
            <div class="field"><textarea id="impText" style="min-height:150px" placeholder="Stripe, Product Manager, interview, 2026-05-01&#10;Notion, Operations Lead, offer&#10;Thank you for applying to Linear&#10;Unfortunately we won't be moving forward - Airbnb"></textarea></div>
            <div class="field"><label>…or upload a .csv / .txt file</label><input type="file" id="impFile" accept=".csv,.txt"/></div>`,
          footer: `<button class="btn" data-modal-close>Cancel</button><button class="btn primary" id="impRun">Import</button>`,
          onMount: (card) => {
            const ta = card.querySelector("#impText");
            card.querySelector("#impFile").onchange = (e) => {
              const f = e.target.files[0]; if (!f) return;
              const r = new FileReader(); r.onload = () => { ta.value = r.result; }; r.readAsText(f);
            };
            card.querySelector("#impRun").onclick = () => {
              const rows = parseImport(ta.value);
              if (!rows.length) { U.toast("Nothing to import — check the format", "error"); return; }
              const apps = S.get().applications;
              let added = 0;
              rows.forEach((r) => {
                const dup = apps.find((a) => a.company.toLowerCase() === r.company.toLowerCase() && (a.role || "").toLowerCase() === (r.role || "").toLowerCase());
                if (dup) return;
                S.add("applications", { company: r.company, role: r.role || "—", status: r.status, location: r.location || "", salary: r.salary || "", source: "Import", applied: r.applied || new Date().toISOString(), notes: "Imported", interviewDate: null });
                added++;
              });
              U.closeModal();
              U.toast(`Imported ${added} application(s)`, "success");
              window.App.rerender();
            };
          },
        });
      };
      root.querySelectorAll("#filters [data-filter]").forEach((b) => (b.onclick = () => { appFilter = b.dataset.filter; window.App.rerender(); }));
      root.querySelectorAll('[data-act="edit"]').forEach((b) => (b.onclick = () => open(S.find("applications", b.dataset.id))));
      root.querySelectorAll('[data-act="del"]').forEach((b) => (b.onclick = () =>
        U.confirm("Delete this application?", () => { S.remove("applications", b.dataset.id); U.toast("Deleted"); window.App.rerender(); })));
    },
  };

  /* =========================================================
     3. TIME TRACKER
  ========================================================= */
  Views.timetracker = {
    title: "Time Tracker",
    render() {
      if (window.DB && window.DB.active) return timetrackerDB();
      const d = S.get();
      const active = d.activeClocks || {};
      // team members excluding the admin (the signed-in profile)
      const members = d.team.filter((m) => m.name !== d.profile.name);
      const isToday = (iso) => new Date(iso).toDateString() === new Date().toDateString();
      const memberMs = (name, todayOnly) =>
        d.timeEntries
          .filter((e) => e.member === name && (!todayOnly || isToday(e.clockIn)))
          .reduce((s, e) => s + (new Date(e.clockOut) - new Date(e.clockIn)), 0);

      const todayMs = d.timeEntries.filter((e) => isToday(e.clockIn)).reduce((s, e) => s + (new Date(e.clockOut) - new Date(e.clockIn)), 0);
      const weekMs = d.timeEntries.filter((e) => Date.now() - new Date(e.clockIn) < 7 * 864e5).reduce((s, e) => s + (new Date(e.clockOut) - new Date(e.clockIn)), 0);
      const activeCount = Object.keys(active).length;

      return `
      <div class="page-head">
        <div class="ph-text"><h1>Time Tracker</h1><p>Clock your team in and out and review everyone's logged hours.</p></div>
      </div>

      <div class="grid cols-4">
        ${stat({ label: "On the clock now", value: activeCount, icon: "🟢", tone: "success" })}
        ${stat({ label: "Team hours today", value: U.hours(todayMs), icon: "📆", tone: "primary" })}
        ${stat({ label: "Team hours this week", value: U.hours(weekMs), icon: "📊", tone: "info" })}
        ${stat({ label: "Team members", value: members.length, icon: "👥", tone: "warn" })}
      </div>

      <div class="card mt-24">
        <div class="card-head"><h3>Team — clock in / out</h3></div>
        <div class="card-pad">
          ${members.length ? `<div class="grid cols-3">
            ${members.map((m) => {
              const a = active[m.id];
              return `<div class="card card-pad" style="gap:12px;display:flex;flex-direction:column">
                <div class="flex gap-12 center">
                  <div class="avatar">${U.initials(m.name)}</div>
                  <div style="min-width:0">
                    <div class="row-main">${U.esc(m.name)}</div>
                    <div class="row-sub">${U.esc(m.title || m.dept || "")}</div>
                  </div>
                  <span class="badge ${a ? "b-active" : "b-draft"}" style="margin-left:auto">${a ? "Active" : "Off"}</span>
                </div>
                <div class="flex between center">
                  <div>
                    <div class="faint" style="font-size:11px;text-transform:uppercase;letter-spacing:.05em">${a ? "Elapsed" : "Today"}</div>
                    <div class="row-main" style="font-family:var(--mono);font-size:18px" ${a ? `data-since="${a.clockIn}"` : ""}>${a ? U.dur(Date.now() - new Date(a.clockIn)) : U.hours(memberMs(m.name, true))}</div>
                  </div>
                  ${a
                    ? `<button class="btn danger sm" data-clockout="${m.id}">⏹ Clock out</button>`
                    : `<button class="btn primary sm" data-clockin="${m.id}" data-name="${U.esc(m.name)}">▶ Clock in</button>`}
                </div>
                ${a ? `<div class="faint" style="font-size:12px">${U.esc(a.project)} · since ${U.time(a.clockIn)}</div>` : ""}
              </div>`;
            }).join("")}
          </div>` : U.empty("👥", "No team members yet. Add them in the Team section.")}
        </div>
      </div>

      <div class="card mt-24">
        <div class="card-head"><h3>Timesheet</h3><div class="ch-actions"><span class="chip">${d.timeEntries.length} entries</span></div></div>
        <div class="table-wrap">
          <table class="tbl">
            <thead><tr><th>Member</th><th>Project</th><th>Date</th><th>Clock in</th><th>Clock out</th><th>Duration</th><th></th></tr></thead>
            <tbody>
              ${d.timeEntries.length ? d.timeEntries.map((e) => `
                <tr>
                  <td><div class="flex gap-8 center"><div class="avatar" style="width:26px;height:26px;font-size:10px">${U.initials(e.member || "?")}</div><span class="row-main">${U.esc(e.member || "—")}</span></div></td>
                  <td class="muted">${U.esc(e.project)}</td>
                  <td class="muted nowrap">${U.dateShort(e.clockIn)}</td>
                  <td class="muted">${U.time(e.clockIn)}</td>
                  <td class="muted">${U.time(e.clockOut)}</td>
                  <td class="row-main nowrap">${U.hours(new Date(e.clockOut) - new Date(e.clockIn))}</td>
                  <td><button class="btn sm ghost" data-act="del" data-id="${e.id}" style="color:var(--danger)">Delete</button></td>
                </tr>`).join("")
                : `<tr><td colspan="7">${U.empty("⏱", "No time logged yet. Clock a team member in to get started.")}</td></tr>`}
            </tbody>
          </table>
        </div>
      </div>`;
    },
    mount(root) {
      if (window.DB && window.DB.active) return timetrackerDBMount(root);
      root.querySelectorAll("[data-clockin]").forEach((b) => (b.onclick = () => {
        const id = b.dataset.clockin, name = b.dataset.name;
        U.formModal({
          title: "Clock in — " + name,
          submitLabel: "Clock in",
          fields: [{ name: "project", label: "What are they working on?", placeholder: "e.g. Client onboarding", value: "General" }],
          onSubmit: (data) => { S.clockInMember(id, name, data.project || "General"); U.toast(name + " clocked in", "success"); window.App.rerender(); window.App.refreshClockPill(); },
        });
      }));
      root.querySelectorAll("[data-clockout]").forEach((b) => (b.onclick = () => {
        const e = S.clockOutMember(b.dataset.clockout);
        U.toast((e ? e.member : "Member") + " clocked out", "success"); window.App.rerender(); window.App.refreshClockPill();
      }));
      root.querySelectorAll('[data-act="del"]').forEach((b) => (b.onclick = () =>
        U.confirm("Delete this time entry?", () => { S.remove("timeEntries", b.dataset.id); U.toast("Deleted"); window.App.rerender(); })));

      // live elapsed timers for active members
      clearInterval(window.__ctTimer);
      const cells = root.querySelectorAll("[data-since]");
      if (cells.length) {
        window.__ctTimer = setInterval(() => {
          cells.forEach((c) => { c.textContent = U.dur(Date.now() - new Date(c.dataset.since)); });
        }, 1000);
      }
    },
  };

  /* =========================================================
     4. INSIGHTS
  ========================================================= */
  Views.insights = {
    title: "Insights",
    render() {
      const d = S.get();
      const total = d.applications.length || 1;
      const counts = APP_STATUSES.reduce((m, s) => ((m[s] = d.applications.filter((a) => a.status === s).length), m), {});
      const offerRate = Math.round((counts.offer / total) * 100);
      const interviewRate = Math.round(((counts.interview + counts.offer) / total) * 100);

      // last 6 weeks of hours
      const weeks = [];
      for (let w = 5; w >= 0; w--) {
        const start = Date.now() - (w + 1) * 7 * 864e5;
        const end = Date.now() - w * 7 * 864e5;
        const ms = d.timeEntries
          .filter((e) => { const t = new Date(e.clockIn).getTime(); return t >= start && t < end; })
          .reduce((s, e) => s + (new Date(e.clockOut) - new Date(e.clockIn)), 0);
        weeks.push({ label: w === 0 ? "This wk" : w + "w ago", value: Math.round(ms / 36e5) });
      }

      const donut = [
        { label: "Applied", value: counts.applied, color: "var(--info)" },
        { label: "Interview", value: counts.interview, color: "var(--warn)" },
        { label: "Offer", value: counts.offer, color: "var(--success)" },
        { label: "Rejected", value: counts.rejected, color: "var(--danger)" },
      ];
      let acc = 0;
      const seg = donut.map((s) => { const start = acc / total * 360; acc += s.value; const end = acc / total * 360; return `${s.color} ${start}deg ${end}deg`; }).join(", ");

      // expense breakdown
      const expCats = {};
      d.transactions.filter((t) => t.type === "expense").forEach((t) => (expCats[t.category] = (expCats[t.category] || 0) + t.amount));
      const expData = Object.entries(expCats).map(([label, value]) => ({ label, value: Math.round(value) }));

      return `
      <div class="page-head"><div class="ph-text"><h1>Insights</h1><p>Analytics across your job search, time, and finances.</p></div></div>

      <div class="grid cols-4">
        ${stat({ label: "Offer rate", value: offerRate + "%", icon: "🎯", tone: "success" })}
        ${stat({ label: "Interview rate", value: interviewRate + "%", icon: "📈", tone: "primary" })}
        ${stat({ label: "Total applications", value: d.applications.length, icon: "💼", tone: "info" })}
        ${stat({ label: "Avg hrs / week", value: (weeks.reduce((s, w) => s + w.value, 0) / 6).toFixed(1), icon: "⏱", tone: "warn" })}
      </div>

      <div class="grid cols-2 mt-24">
        <div class="card">
          <div class="card-head"><h3>Hours logged — last 6 weeks</h3></div>
          <div class="card-pad">${barChart(weeks)}</div>
        </div>
        <div class="card">
          <div class="card-head"><h3>Application funnel</h3></div>
          <div class="card-pad flex gap-16 center" style="flex-wrap:wrap">
            <div style="width:150px;height:150px;border-radius:50%;background:conic-gradient(${seg});position:relative;flex-shrink:0">
              <div style="position:absolute;inset:24px;border-radius:50%;background:var(--surface);display:grid;place-items:center;text-align:center">
                <div><div style="font-size:22px;font-weight:800">${total}</div><div class="faint" style="font-size:11px">total</div></div>
              </div>
            </div>
            <div class="legend" style="flex:1;min-width:140px">
              ${donut.map((s) => `<div class="legend-item"><span class="legend-dot" style="background:${s.color}"></span>${s.label}<span style="margin-left:auto;font-weight:700">${s.value}</span></div>`).join("")}
            </div>
          </div>
        </div>
      </div>

      <div class="card mt-24">
        <div class="card-head"><h3>Expenses by category</h3></div>
        <div class="card-pad">${expData.length ? barChart(expData) : U.empty("💳", "No expenses recorded.")}</div>
      </div>`;
    },
    mount() {},
  };

  /* =========================================================
     5. JOB SEARCH
  ========================================================= */
  let jobQuery = "", jobType = "all", jobCategory = "all";
  let jobsLoading = false;
  const JOB_CATS = [
    { id: "all", label: "All roles" },
    { id: "sales", label: "SDR / BDR", tags: ["SDR", "BDR"] },
    { id: "coding", label: "Medical Coding", tags: ["Medical Coding"] },
  ];
  const jobInCat = (j) => {
    if (jobCategory === "all") return true;
    const cat = JOB_CATS.find((c) => c.id === jobCategory);
    return cat && (j.tags || []).some((t) => cat.tags.includes(t));
  };
  Views.jobsearch = {
    title: "Job Search",
    render() {
      const d = S.get();
      const live = d.liveJobs && d.liveJobs.length;
      const source = live ? d.liveJobs : d.jobMarket;
      const savedIds = new Set(d.savedJobs.map((j) => j.id));
      const q = jobQuery.toLowerCase();
      const catCount = (id) => source.filter((j) => { const c = JOB_CATS.find((x) => x.id === id); return id === "all" || (c && (j.tags || []).some((t) => c.tags.includes(t))); }).length;
      const list = source.filter((j) =>
        jobInCat(j) &&
        (jobType === "all" || j.type === jobType) &&
        (!q || (j.role + j.company + j.location + (j.tags || []).join(" ")).toLowerCase().includes(q)));

      return `
      <div class="page-head">
        <div class="ph-text"><h1>Job Search</h1><p>Remote SDR / BDR and medical coding roles${live ? ", live from Adzuna" : ""}. Save any role straight into your applications.</p></div>
        <div class="ph-actions"><button class="btn primary" id="refreshJobs">${jobsLoading ? "Searching…" : "⟳ Refresh from Adzuna"}</button></div>
      </div>

      <div class="card card-pad">
        <div class="flex gap-8" style="flex-wrap:wrap;margin-bottom:14px">
          ${JOB_CATS.map((c) => `<button class="chip" data-cat="${c.id}" style="${jobCategory === c.id ? "background:var(--primary);color:#04121c;border-color:var(--primary);font-weight:700" : "cursor:pointer"}">${c.label} · ${catCount(c.id)}</button>`).join("")}
        </div>
        <div class="flex gap-12 center" style="flex-wrap:wrap">
          <input class="search-input" id="jobSearch" placeholder="🔍 Filter role, company, location…" value="${U.esc(jobQuery)}"/>
          <select class="field" id="jobType" style="padding:10px 12px;border:1px solid var(--border);border-radius:10px;background:var(--surface);color:var(--text)">
            ${["all", "Full-time", "Contract", "Part-time"].map((t) => `<option value="${t}" ${jobType === t ? "selected" : ""}>${t === "all" ? "All types" : t}</option>`).join("")}
          </select>
          <span class="chip">${list.length} results</span>
        </div>
        <div class="faint mt-8" id="jobStatus" style="font-size:12px">
          ${live
            ? `🟢 Live · ${d.liveJobs.length} remote SDR/BDR roles · updated ${U.ago(d.liveJobsFetched)}`
            : "Showing sample roles. Click Refresh to pull live jobs (needs Adzuna keys on your Vercel site)."}
        </div>
      </div>

      <div class="grid cols-2 mt-24">
        ${list.length ? list.map((j) => `
          <div class="card card-pad">
            <div class="flex between center">
              <div class="flex gap-12 center">
                <div class="avatar" style="border-radius:11px">${U.esc((j.company || "?")[0])}</div>
                <div><div class="row-main" style="font-size:15px">${U.esc(j.role)}</div><div class="row-sub">${U.esc(j.company)} · ${U.esc(j.location)}</div></div>
              </div>
              ${j.posted && new Date(j.posted).toDateString() === new Date().toDateString() ? `<span class="badge b-offer">New</span>` : ""}
            </div>
            <div class="flex gap-8 mt-16" style="flex-wrap:wrap">
              <span class="chip">${U.esc(j.type)}</span>
              <span class="chip">💰 ${U.esc(j.salary)}</span>
              ${(j.tags || []).map((t) => `<span class="chip">${U.esc(t)}</span>`).join("")}
            </div>
            <div class="flex between center mt-16">
              <span class="faint" style="font-size:12px">Posted ${U.ago(j.posted)}</span>
              <div class="flex gap-8">
                ${j.applyUrl ? `<a class="btn sm" href="${U.esc(j.applyUrl)}" target="_blank" rel="noopener">Apply ↗</a>` : ""}
                <button class="btn ${savedIds.has(j.id) ? "" : "primary"} sm" data-save="${j.id}" ${savedIds.has(j.id) ? "disabled" : ""}>
                  ${savedIds.has(j.id) ? "✓ Saved" : "＋ Save"}
                </button>
              </div>
            </div>
          </div>`).join("")
          : `<div style="grid-column:1/-1">${U.empty("🔍", "No jobs match your filter.")}</div>`}
      </div>`;
    },
    mount(root) {
      const search = root.querySelector("#jobSearch");
      let t;
      search.oninput = () => { clearTimeout(t); t = setTimeout(() => { jobQuery = search.value; window.App.rerender(); const s = document.getElementById("jobSearch"); if (s) { s.focus(); s.setSelectionRange(s.value.length, s.value.length); } }, 220); };
      root.querySelector("#jobType").onchange = (e) => { jobType = e.target.value; window.App.rerender(); };
      root.querySelectorAll("[data-cat]").forEach((b) => (b.onclick = () => { jobCategory = b.dataset.cat; window.App.rerender(); }));

      const fetchLiveJobs = async (force) => {
        const d = S.get();
        const fresh = d.liveJobsFetched && (Date.now() - new Date(d.liveJobsFetched) < 24 * 36e5);
        if (!force && fresh && d.liveJobs.length) return;
        if (jobsLoading) return;
        jobsLoading = true;
        const note = document.getElementById("jobStatus");
        if (note) note.textContent = "Searching Adzuna for remote SDR/BDR roles…";
        try {
          const r = await fetch("/api/jobs?country=us");
          if (!r.ok) throw new Error(r.status === 404 ? "not-deployed" : "HTTP " + r.status);
          const data = await r.json();
          if (data.error) throw new Error(data.error);
          jobsLoading = false;
          S.setLiveJobs(data.jobs || []);
          U.toast(`Found ${data.count} remote SDR/BDR roles`, "success");
          window.App.rerender();
        } catch (e) {
          jobsLoading = false;
          const n = document.getElementById("jobStatus");
          if (n) n.textContent = e.message === "not-deployed"
            ? "Live search runs on your Vercel site — open your Vercel production URL (the /api endpoint isn't on github.io)."
            : "Couldn't load live jobs: " + e.message;
        }
      };

      root.querySelector("#refreshJobs").onclick = () => fetchLiveJobs(true);

      root.querySelectorAll("[data-save]").forEach((b) => (b.onclick = () => {
        const id = b.dataset.save;
        const job = [...S.get().liveJobs, ...S.get().jobMarket].find((j) => String(j.id) === String(id));
        if (!job) return;
        S.get().savedJobs.push({ id: job.id });
        S.save();
        S.add("applications", {
          company: job.company, role: job.role, status: "applied", location: job.location,
          salary: job.salary, source: "Job Search", applied: new Date().toISOString(),
          notes: "Saved from Job Search" + (job.applyUrl ? "\n" + job.applyUrl : ""), interviewDate: null,
        });
        U.toast("Saved to Job Applications", "success");
        window.App.rerender();
      }));

      // auto-refresh once a day when the page is opened
      fetchLiveJobs(false);
    },
  };

  /* =========================================================
     6. MY ACCOUNT
  ========================================================= */
  Views.account = {
    title: "My Account",
    render() {
      if (window.DB && window.DB.active) return accountDB();
      const p = S.get().profile;
      return `
      <div class="page-head"><div class="ph-text"><h1>My Account</h1><p>Manage your profile and preferences.</p></div></div>

      <div class="grid cols-2">
        <div class="card card-pad" style="text-align:center">
          <div class="avatar" style="width:84px;height:84px;font-size:30px;margin:0 auto 14px">${U.initials(p.name)}</div>
          <div class="row-main" style="font-size:18px">${U.esc(p.name)}</div>
          <div class="muted">${U.esc(p.title)}</div>
          <div class="flex gap-8 center mt-16" style="justify-content:center;flex-wrap:wrap">
            <span class="chip">📍 ${U.esc(p.location || "—")}</span>
            <span class="chip">${U.esc(p.role)}</span>
          </div>
        </div>

        <div class="card">
          <div class="card-head"><h3>Profile details</h3></div>
          <div class="card-pad">
            <form id="profileForm">
              <div class="field-row">
                <div class="field"><label>Full name</label><input name="name" value="${U.esc(p.name)}"/></div>
                <div class="field"><label>Job title</label><input name="title" value="${U.esc(p.title)}"/></div>
              </div>
              <div class="field-row">
                <div class="field"><label>Email</label><input type="email" name="email" value="${U.esc(p.email)}"/></div>
                <div class="field"><label>Phone</label><input name="phone" value="${U.esc(p.phone)}"/></div>
              </div>
              <div class="field-row">
                <div class="field"><label>Location</label><input name="location" value="${U.esc(p.location)}"/></div>
                <div class="field"><label>Hourly rate ($)</label><input type="number" name="hourlyRate" value="${U.esc(p.hourlyRate)}"/></div>
              </div>
              <button class="btn primary" type="submit">Save changes</button>
            </form>
          </div>
        </div>
      </div>
      ${gmailCardHtml(p)}
      <div class="card mt-24">
        <div class="card-head"><h3>Data & preferences</h3></div>
        <div class="card-pad flex between center" style="flex-wrap:wrap;gap:12px">
          <div><div class="row-main">Reset workspace data</div><div class="row-sub">Restore all sections to the original sample data.</div></div>
          <button class="btn danger" id="resetData">Reset all data</button>
        </div>
      </div>`;
    },
    mount(root) {
      if (window.DB && window.DB.active) return accountDBMount(root);
      root.querySelector("#profileForm").onsubmit = (e) => {
        e.preventDefault();
        const f = e.target;
        S.setProfile({
          name: f.name.value.trim(), title: f.title.value.trim(), email: f.email.value.trim(),
          phone: f.phone.value.trim(), location: f.location.value.trim(), hourlyRate: Number(f.hourlyRate.value) || 0,
        });
        U.toast("Profile saved", "success");
        window.App.refreshSidebarUser();
      };
      bindGmailCard(root);
      root.querySelector("#resetData").onclick = () =>
        U.confirm("This will erase your changes and restore sample data. Continue?", () => {
          S.reset(); U.toast("Workspace reset", "success"); window.App.rerender(); window.App.refreshSidebarUser(); window.App.refreshClockPill();
        }, { yes: "Reset" });
    },
  };

  // Gmail settings card (admin/local only) — shared markup + handlers
  function gmailCardHtml(p) {
    return `
      <div class="card mt-24">
        <div class="card-head"><h3>Gmail sync</h3>${p.gmailLastSync ? `<div class="ch-actions"><span class="chip">Last sync ${U.ago(p.gmailLastSync)}</span></div>` : ""}</div>
        <div class="card-pad">
          <p class="muted" style="margin-bottom:14px">Auto-import your job applications, interviews, rejections and offers from Gmail. Read-only. Paste the Google OAuth Client ID you created (stored only in this browser).</p>
          <div class="field"><label>Google OAuth Client ID</label><input id="gmailClientId" placeholder="xxxxxxxx.apps.googleusercontent.com" value="${U.esc(p.gmailClientId || "")}"/></div>
          <div class="flex gap-8" style="flex-wrap:wrap">
            <button class="btn" id="saveGmailId">Save Client ID</button>
            <button class="btn primary" id="syncGmailNow">⟳ Sync now</button>
          </div>
        </div>
      </div>`;
  }
  function bindGmailCard(root) {
    const save = root.querySelector("#saveGmailId");
    if (!save) return;
    save.onclick = () => { S.setProfile({ gmailClientId: root.querySelector("#gmailClientId").value.trim() }); U.toast("Client ID saved", "success"); };
    root.querySelector("#syncGmailNow").onclick = () => { S.setProfile({ gmailClientId: root.querySelector("#gmailClientId").value.trim() }); window.App.runGmailSync(); };
  }

  // ---- Account in logged-in (Supabase) mode ----
  function accountDB() {
    const me = window.DB.me();
    const p = window.DB.target() || me;
    const viewing = !!(window.DB.viewAs && p.id !== me.id);
    const canEditRole = window.DB.isAdmin();
    return `
      <div class="page-head"><div class="ph-text"><h1>${viewing ? U.esc(window.DB.displayName(p)) + "'s account" : "My Account"}</h1>
        <p>${viewing ? "Viewing this member's profile (admin)." : "Your personal information — kept in your workspace."}</p></div></div>

      <div class="grid cols-2">
        <div class="card card-pad" style="text-align:center">
          <div class="avatar" id="avatarBox" title="Click to change photo" style="width:88px;height:88px;font-size:30px;margin:0 auto 10px;cursor:pointer">
            ${p.avatar_url ? `<img src="${U.esc(p.avatar_url)}" alt="" style="width:100%;height:100%;object-fit:cover"/>` : U.initials(window.DB.displayName(p))}
          </div>
          <input type="file" id="avatarInput" accept="image/*" style="display:none"/>
          <div style="margin-bottom:8px"><button class="btn sm ghost" id="changePhoto">📷 Change photo</button></div>
          <div class="row-main" style="font-size:18px">${U.esc(window.DB.displayName(p))}</div>
          <div class="muted">${U.esc(p.title || "")}</div>
          <div class="flex gap-8 center mt-16" style="justify-content:center;flex-wrap:wrap">
            <span class="chip">📍 ${U.esc(p.location || "—")}</span>
            ${p.id_number ? `<span class="chip">🪪 ${U.esc(p.id_number)}</span>` : ""}
            <span class="badge b-${p.role === "admin" ? "active" : "review"}">${U.cap(p.role || "employee")}</span>
          </div>
        </div>

        <div class="card">
          <div class="card-head"><h3>Profile details</h3></div>
          <div class="card-pad">
            <form id="profileFormDB">
              <div class="field-row">
                <div class="field"><label>Full name</label><input name="full_name" value="${U.esc(p.full_name || "")}"/></div>
                <div class="field"><label>Job title</label><input name="title" value="${U.esc(p.title || "")}"/></div>
              </div>
              <div class="field-row">
                <div class="field"><label>Email</label><input value="${U.esc(p.email || "")}" disabled/></div>
                <div class="field"><label>Phone</label><input name="phone" value="${U.esc(p.phone || "")}"/></div>
              </div>
              <div class="field-row">
                <div class="field"><label>Location</label><input name="location" value="${U.esc(p.location || "")}"/></div>
                <div class="field"><label>Department</label><input name="dept" value="${U.esc(p.dept || "")}"/></div>
              </div>
              <div class="field"><label>ID number</label><input name="id_number" placeholder="e.g. EMP-001 or government ID" value="${U.esc(p.id_number || "")}"/></div>
              <div class="field"><label>Home address</label><textarea name="address" placeholder="Street, city, state, ZIP">${U.esc(p.address || "")}</textarea></div>
              ${canEditRole ? `<div class="field-row">
                <div class="field"><label>Role</label><select name="role"><option value="employee" ${p.role === "employee" ? "selected" : ""}>Employee</option><option value="admin" ${p.role === "admin" ? "selected" : ""}>Admin</option></select></div>
                <div class="field"><label>Status</label><select name="status"><option value="active" ${p.status === "active" ? "selected" : ""}>Active</option><option value="away" ${p.status === "away" ? "selected" : ""}>Away</option></select></div>
              </div>` : ""}
              <button class="btn primary" type="submit">Save changes</button>
            </form>
          </div>
        </div>
      </div>
      ${!viewing ? `<div class="card mt-24"><div class="card-head"><h3>My signature</h3></div>
        <div class="card-pad">
          <p class="muted" style="margin-bottom:10px">Draw your signature — it's applied automatically when you sign contracts.</p>
          ${p.signature_url ? `<div style="margin-bottom:10px"><span class="faint" style="font-size:12px">Current:</span><br><img src="${U.esc(p.signature_url)}" style="max-height:80px;background:#fff;border:1px solid var(--border);border-radius:8px;padding:6px"/></div>` : ""}
          <canvas id="sigPad" width="500" height="160" style="width:100%;max-width:500px;height:160px;background:#fff;border:1px dashed var(--border-strong);border-radius:8px;touch-action:none;cursor:crosshair;display:block"></canvas>
          <div class="flex gap-8 mt-8" style="flex-wrap:wrap"><button class="btn" id="sigClear">Clear</button><button class="btn" id="sigUpload">⬆ Upload image</button><button class="btn primary" id="sigSave">Save drawn signature</button><input type="file" id="sigFile" accept="image/*" style="display:none"/></div>
        </div></div>` : ""}
      ${(window.DB.isAdmin() && !viewing) ? gmailCardHtml(S.get().profile) : ""}
      ${(window.DB.isAdmin() && !viewing) ? `<div class="card mt-24"><div class="card-head"><h3>Automatic email (Gmail)</h3></div>
        <div class="card-pad">
          <p class="muted" style="margin-bottom:12px">Connect your Gmail once so contract sends, invites, and reminders go out automatically — no clicking each time. Uses the same Google Client ID from Gmail sync above.</p>
          <button class="btn primary" id="connectGmailSend">🔗 Connect Gmail for sending</button>
          <p class="faint" id="connectGmailMsg" style="font-size:12px;margin-top:8px"></p>
        </div></div>` : ""}`;
  }
  function accountDBMount(root) {
    const cv = root.querySelector("#sigPad");
    if (cv) {
      const ctx = cv.getContext("2d");
      ctx.lineWidth = 2.5; ctx.lineCap = "round"; ctx.strokeStyle = "#111";
      let drawing = false, has = false;
      const pos = (e) => { const r = cv.getBoundingClientRect(); const t = e.touches ? e.touches[0] : e; return { x: (t.clientX - r.left) * (cv.width / r.width), y: (t.clientY - r.top) * (cv.height / r.height) }; };
      const start = (e) => { drawing = true; has = true; const pt = pos(e); ctx.beginPath(); ctx.moveTo(pt.x, pt.y); e.preventDefault(); };
      const move = (e) => { if (!drawing) return; const pt = pos(e); ctx.lineTo(pt.x, pt.y); ctx.stroke(); e.preventDefault(); };
      const end = () => { drawing = false; };
      cv.addEventListener("mousedown", start); cv.addEventListener("mousemove", move); window.addEventListener("mouseup", end);
      cv.addEventListener("touchstart", start, { passive: false }); cv.addEventListener("touchmove", move, { passive: false }); cv.addEventListener("touchend", end);
      root.querySelector("#sigClear").onclick = () => { ctx.clearRect(0, 0, cv.width, cv.height); has = false; };
      root.querySelector("#sigSave").onclick = async () => {
        if (!has) { U.toast("Draw your signature first", "error"); return; }
        const url = cv.toDataURL("image/png");
        await window.DB.updateProfile(window.DB.me().id, { signature_url: url });
        if (window.Auth) await window.Auth.reloadProfile();
        U.toast("Signature saved", "success");
        window.App.rerender();
      };
      const sf = root.querySelector("#sigFile"), su = root.querySelector("#sigUpload");
      if (su && sf) {
        su.onclick = () => sf.click();
        sf.onchange = (e) => {
          const f = e.target.files[0]; if (!f) return;
          const rd = new FileReader();
          rd.onload = () => {
            const img = new Image();
            img.onload = async () => {
              const max = 500, sc = Math.min(1, max / img.width);
              const cw = Math.round(img.width * sc), ch = Math.round(img.height * sc);
              const cn = document.createElement("canvas"); cn.width = cw; cn.height = ch;
              cn.getContext("2d").drawImage(img, 0, 0, cw, ch);
              await window.DB.updateProfile(window.DB.me().id, { signature_url: cn.toDataURL("image/png") });
              if (window.Auth) await window.Auth.reloadProfile();
              U.toast("Signature uploaded", "success");
              window.App.rerender();
            };
            img.src = rd.result;
          };
          rd.readAsDataURL(f);
        };
      }
    }
    const p = window.DB.target();
    const inp = root.querySelector("#avatarInput");
    const pick = () => inp.click();
    const box = root.querySelector("#avatarBox");
    if (box) box.onclick = pick;
    const cp = root.querySelector("#changePhoto");
    if (cp) cp.onclick = pick;
    if (inp) inp.onchange = (e) => {
      const f = e.target.files[0]; if (!f) return;
      const rd = new FileReader();
      rd.onload = () => {
        const img = new Image();
        img.onload = async () => {
          const max = 256, sc = Math.min(1, max / Math.max(img.width, img.height));
          const cw = Math.round(img.width * sc), ch = Math.round(img.height * sc);
          const cv = document.createElement("canvas"); cv.width = cw; cv.height = ch;
          cv.getContext("2d").drawImage(img, 0, 0, cw, ch);
          const url = cv.toDataURL("image/jpeg", 0.85);
          await window.DB.updateProfile(p.id, { avatar_url: url });
          if (window.Auth) await window.Auth.reloadProfile();
          U.toast("Photo updated", "success");
          window.App.refreshSidebarUser();
          window.App.rerender();
        };
        img.src = rd.result;
      };
      rd.readAsDataURL(f);
    };
    root.querySelector("#profileFormDB").onsubmit = async (e) => {
      e.preventDefault();
      const f = e.target;
      const patch = { full_name: f.full_name.value.trim(), title: f.title.value.trim(), phone: f.phone.value.trim(), location: f.location.value.trim(), dept: f.dept.value.trim(), id_number: f.id_number.value.trim(), address: f.address.value.trim() };
      if (f.role) patch.role = f.role.value;
      if (f.status) patch.status = f.status.value;
      await window.DB.updateProfile(p.id, patch);
      if (window.Auth) await window.Auth.reloadProfile();
      U.toast("Profile saved", "success");
      window.App.refreshSidebarUser();
      window.App.rerender();
    };
    bindGmailCard(root);

    const cg = root.querySelector("#connectGmailSend");
    if (cg) cg.onclick = () => {
      const cid = (S.get().profile.gmailClientId || "").trim();
      const msg = root.querySelector("#connectGmailMsg");
      if (!cid) { U.toast("Add your Google Client ID in the Gmail sync card first", "error"); return; }
      if (!(window.google && google.accounts && google.accounts.oauth2)) { U.toast("Google library not loaded — check your connection", "error"); return; }
      const codeClient = google.accounts.oauth2.initCodeClient({
        client_id: cid,
        scope: "https://www.googleapis.com/auth/gmail.send",
        ux_mode: "popup",
        callback: async (resp) => {
          if (!resp || !resp.code) { if (msg) msg.textContent = "Authorization cancelled."; return; }
          if (msg) msg.textContent = "Connecting…";
          try {
            const { data } = await window.Auth.client().auth.getSession();
            const token = data.session && data.session.access_token;
            const r = await fetch("/api/gmail-connect", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + (token || "") }, body: JSON.stringify({ code: resp.code }) });
            const j = await r.json().catch(() => ({}));
            if (!r.ok) throw new Error(j.error || "HTTP " + r.status);
            U.toast("Gmail connected — emails now send automatically ✓", "success");
            if (msg) { msg.style.color = "var(--success)"; msg.textContent = "Connected. Contract sends, invites and reminders will email automatically."; }
          } catch (e) { if (msg) { msg.style.color = "var(--danger)"; msg.textContent = "Connect failed: " + (e.message || e); } }
        },
      });
      codeClient.requestCode();
    };
  }

  /* =========================================================
     7. SOPs (document hosting)
  ========================================================= */
  const KNOWN_DOCS = {
    "onboarding-checklist.pdf": "assets/docs/onboarding-checklist.pdf",
    "expense-policy.pdf": "assets/docs/expense-policy.pdf",
    "brand-guide.pdf": "assets/docs/brand-guide.pdf",
  };
  const docSrc = (s) => (s && (s.dataUrl || s.url || KNOWN_DOCS[(s.fileName || "").toLowerCase()])) || "";
  let sopSelected = null;
  Views.sops = {
    title: "SOPs",
    render() {
      if (window.DB && window.DB.active) return sopsDB();
      const d = S.get();
      const docs = d.sops;
      return `
      <div class="page-head">
        <div class="ph-text"><h1>SOPs & Documents</h1><p>Upload and host your standard operating procedures. Click a document to open it.</p></div>
        <div class="ph-actions"><button class="btn primary" id="uploadDoc">⬆ Upload document</button></div>
      </div>

      <div class="dropzone" id="dropzone">
        <div class="dz-ico">📁</div>
        <div><strong>Drag & drop files here</strong> or click to browse</div>
        <div class="faint" style="font-size:12px;margin-top:4px">PDFs open in a viewer · stored locally in this workspace</div>
        <input type="file" id="fileInput" multiple style="display:none"/>
      </div>

      <div class="card mt-24">
        <div class="card-head"><h3>Document library</h3><div class="ch-actions"><span class="chip">${docs.length} files</span></div></div>
        <div class="table-wrap">
          <table class="tbl">
            <thead><tr><th>Document</th><th>Category</th><th>Version</th><th>Size</th><th>Uploaded by</th><th>Date</th><th></th></tr></thead>
            <tbody>
              ${docs.length ? docs.map((s) => `
                <tr ${docSrc(s) ? `data-open="${s.id}" style="cursor:pointer"` : ""}>
                  <td><div class="flex gap-12 center"><div class="li-ico bg-info">${fileIcon(s.fileName)}</div>
                    <div><div class="row-main">${U.esc(s.title)}</div><div class="row-sub">${U.esc(s.fileName)}</div></div></div></td>
                  <td><span class="chip">${U.esc(s.category)}</span></td>
                  <td class="muted">${U.esc(s.version)}</td>
                  <td class="muted nowrap">${U.fileSize(s.size)}</td>
                  <td class="muted">${U.esc(s.uploadedBy)}</td>
                  <td class="muted nowrap">${U.dateShort(s.uploaded)}</td>
                  <td>
                    <div class="flex gap-8 nowrap">
                      ${docSrc(s) ? `<button class="btn sm" data-view="${s.id}">Open</button>` : ""}
                      <button class="btn sm ghost" data-act="edit" data-id="${s.id}">Edit</button>
                      <button class="btn sm ghost" data-act="del" data-id="${s.id}" style="color:var(--danger)">Delete</button>
                    </div>
                  </td>
                </tr>`).join("")
                : `<tr><td colspan="7">${U.empty("📄", "No documents yet. Upload your first SOP.")}</td></tr>`}
            </tbody>
          </table>
        </div>
      </div>`;
    },
    mount(root) {
      if (window.DB && window.DB.active) return sopsDBMount(root);
      const fileInput = root.querySelector("#fileInput");
      const dz = root.querySelector("#dropzone");
      const addFiles = (files) => {
        const arr = [...files]; if (!arr.length) return;
        const LIMIT = 3 * 1024 * 1024; // ~3MB browser-storage cap for inline viewing
        let pending = arr.length, firstRec = null, tooBig = 0;
        arr.forEach((f) => {
          const base = {
            title: f.name.replace(/\.[^.]+$/, "").replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
            category: "Uncategorized", version: "v1.0", fileName: f.name, size: f.size,
            uploadedBy: S.get().profile.name, uploaded: new Date().toISOString(),
          };
          const finish = (extra) => {
            const rec = S.add("sops", { ...base, ...extra });
            if (!firstRec) firstRec = rec;
            if (--pending === 0) {
              U.toast(arr.length + " file(s) uploaded" + (tooBig ? ` · ${tooBig} too large to preview` : ""), tooBig ? "" : "success");
              window.App.rerender();
              if (firstRec && docSrc(firstRec)) openViewer(firstRec); // auto-open the uploaded doc
            }
          };
          if (f.size < LIMIT) {
            const r = new FileReader();
            r.onload = () => finish({ dataUrl: r.result });
            r.onerror = () => finish({});
            r.readAsDataURL(f);
          } else { tooBig++; finish({}); }
        });
      };
      dz.onclick = () => fileInput.click();
      fileInput.onchange = (e) => addFiles(e.target.files);
      dz.ondragover = (e) => { e.preventDefault(); dz.classList.add("drag"); };
      dz.ondragleave = () => dz.classList.remove("drag");
      dz.ondrop = (e) => { e.preventDefault(); dz.classList.remove("drag"); addFiles(e.dataTransfer.files); };

      function openViewer(s) {
        if (!s) return;
        const src = docSrc(s);
        const ext = (s.fileName || "").split(".").pop().toLowerCase();
        const isPdf = ext === "pdf" && src;
        const isImg = ["png", "jpg", "jpeg", "gif", "webp", "svg"].includes(ext) && src;
        let body;
        if (isPdf) body = `<iframe src="${U.esc(src)}#view=FitH" title="${U.esc(s.title)}" style="width:100%;height:72vh;border:1px solid var(--border);border-radius:8px;background:#fff"></iframe>`;
        else if (isImg) body = `<div style="text-align:center"><img src="${U.esc(src)}" alt="${U.esc(s.title)}" style="max-width:100%;max-height:72vh;border-radius:8px"/></div>`;
        else body = `<div class="empty"><div class="em-ico">${fileIcon(s.fileName)}</div><p>This is a ${ext ? U.esc(ext.toUpperCase()) + " " : ""}file — browsers can't preview it inline.${src ? " Use the button below to download / open it." : " Re-upload the file to view it here."}</p></div>`;
        U.modal({
          title: s.title,
          body,
          footer: `${src ? `<a class="btn" href="${U.esc(src)}" ${isPdf || isImg ? 'target="_blank" rel="noopener"' : `download="${U.esc(s.fileName || "document")}"`}>↗ ${isPdf || isImg ? "Open in new tab" : "Download"}</a>` : ""}<button class="btn primary" data-modal-close>Close</button>`,
          onMount: (card) => { if (isPdf || isImg) card.style.width = "min(980px, calc(100vw - 32px))"; },
        });
      }
      root.querySelectorAll("[data-view]").forEach((b) => (b.onclick = (e) => { e.stopPropagation(); openViewer(S.find("sops", b.dataset.view)); }));
      root.querySelectorAll("[data-open]").forEach((tr) => (tr.onclick = (e) => {
        if (e.target.closest("[data-act]") || e.target.closest("[data-view]")) return;
        openViewer(S.find("sops", tr.dataset.open));
      }));
      root.querySelector("#uploadDoc").onclick = () => openDocForm(null);
      root.querySelectorAll('[data-act="edit"]').forEach((b) => (b.onclick = () => openDocForm(S.find("sops", b.dataset.id))));
      root.querySelectorAll('[data-act="del"]').forEach((b) => (b.onclick = () =>
        U.confirm("Delete this document?", () => { S.remove("sops", b.dataset.id); U.toast("Deleted"); window.App.rerender(); })));

      function openDocForm(doc) {
        U.formModal({
          title: doc ? "Edit document" : "Add document",
          submitLabel: doc ? "Save" : "Add",
          values: doc || {},
          fields: [
            { name: "title", label: "Title", required: true },
            { name: "category", label: "Category", type: "select", options: ["Operations", "HR", "Finance", "Marketing", "Legal", "Uncategorized"].map((c) => ({ value: c, label: c })), half: true },
            { name: "version", label: "Version", placeholder: "v1.0", half: true },
            { name: "fileName", label: "File name", placeholder: "document.pdf", required: true },
          ],
          onSubmit: (data) => {
            if (doc) { S.update("sops", doc.id, data); U.toast("Updated", "success"); }
            else { S.add("sops", { ...data, size: 102400, uploadedBy: S.get().profile.name, uploaded: new Date().toISOString() }); U.toast("Added", "success"); }
            window.App.rerender();
          },
        });
      }
    },
  };
  const fileIcon = (name = "") => {
    const e = name.split(".").pop().toLowerCase();
    if (["pdf"].includes(e)) return "📕";
    if (["doc", "docx"].includes(e)) return "📘";
    if (["xls", "xlsx", "csv"].includes(e)) return "📗";
    if (["png", "jpg", "jpeg", "gif"].includes(e)) return "🖼";
    return "📄";
  };

  /* =========================================================
     8. CONTRACTS
  ========================================================= */
  Views.contracts = {
    title: "Contracts",
    render() {
      if (window.DB && window.DB.active) return contractsDB();
      const d = S.get();
      const totalValue = d.contracts.filter((c) => c.status === "signed").reduce((s, c) => s + c.value, 0);
      return `
      <div class="page-head">
        <div class="ph-text"><h1>Contracts</h1><p>Upload a contract, assign it to an employee, and send them an invite to sign.</p></div>
        <div class="ph-actions"><button class="btn primary" id="addContract">⬆ Upload contract</button></div>
      </div>

      <div class="grid cols-4">
        ${stat({ label: "Total contracts", value: d.contracts.length, icon: "📄", tone: "primary" })}
        ${stat({ label: "Awaiting signature", value: d.contracts.filter((c) => c.status === "invited").length, icon: "✍️", tone: "info" })}
        ${stat({ label: "Signed", value: d.contracts.filter((c) => c.status === "signed").length, icon: "✅", tone: "success" })}
        ${stat({ label: "Signed value", value: U.money(totalValue), icon: "💰", tone: "warn" })}
      </div>

      <div class="card mt-24">
        <div class="card-head"><h3>All contracts</h3></div>
        <div class="table-wrap">
          <table class="tbl">
            <thead><tr><th>Contract</th><th>Assigned to</th><th>Value</th><th>Status</th><th>Sent</th><th>Due</th><th></th></tr></thead>
            <tbody>
              ${d.contracts.length ? d.contracts.map((c) => `
                <tr>
                  <td><div class="row-main">${U.esc(c.title)}</div>${c.fileName ? `<div class="row-sub">📎 ${U.esc(c.fileName)}</div>` : ""}</td>
                  <td>${c.assignedTo ? `<div class="row-main">${U.esc(c.assignedTo)}</div><div class="row-sub">${U.esc(c.assignedEmail || c.party || "")}</div>` : `<span class="muted">${U.esc(c.party || "—")}</span>`}</td>
                  <td class="muted">${c.value ? U.money(c.value) : "—"}</td>
                  <td>${U.badge(c.status)}</td>
                  <td class="muted nowrap">${c.sent ? U.dateShort(c.sent) : "—"}</td>
                  <td class="muted nowrap">${U.dateShort(c.due)}</td>
                  <td>
                    <div class="flex gap-8 nowrap">
                      ${c.status === "draft" || c.status === "expired" ? `<button class="btn sm" data-invite="${c.id}">✉️ Invite</button>` : ""}
                      ${c.status === "invited" ? `<button class="btn sm" data-resend="${c.id}">Resend</button><button class="btn sm" data-sign="${c.id}">Mark signed</button>` : ""}
                      <button class="btn sm ghost" data-act="edit" data-id="${c.id}">Edit</button>
                      <button class="btn sm ghost" data-act="del" data-id="${c.id}" style="color:var(--danger)">Delete</button>
                    </div>
                  </td>
                </tr>`).join("")
                : `<tr><td colspan="7">${U.empty("📄", "No contracts yet. Upload one to get started.")}</td></tr>`}
            </tbody>
          </table>
        </div>
      </div>`;
    },
    mount(root) {
      if (window.DB && window.DB.active) return contractsDBMount(root);
      const team = S.get().team;
      const open = (c) => {
        U.modal({
          title: c ? "Edit contract" : "Upload contract",
          body: `
            <div class="field"><label>Contract title</label><input id="cTitle" value="${U.esc(c ? c.title : "")}" placeholder="e.g. Employment Agreement"/></div>
            <div class="field"><label>Assign to employee</label>
              <select id="cAssign">${team.map((m) => `<option value="${U.esc(m.name)}" data-email="${U.esc(m.email || "")}" ${c && c.assignedTo === m.name ? "selected" : ""}>${U.esc(m.name)}${m.email ? " — " + U.esc(m.email) : ""}</option>`).join("")}</select>
            </div>
            <div class="field-row">
              <div class="field"><label>Value ($)</label><input id="cValue" type="number" value="${c ? c.value : ""}" placeholder="0"/></div>
              <div class="field"><label>Due date</label><input id="cDue" type="date" value="${c && c.due ? new Date(c.due).toISOString().slice(0, 10) : ""}"/></div>
            </div>
            <div class="field"><label>Contract file</label><input id="cFile" type="file" accept=".pdf,.doc,.docx"/>
              <div class="faint" id="cFileName" style="font-size:12px;margin-top:4px">${c && c.fileName ? "Current: " + U.esc(c.fileName) : "PDF or Word document"}</div>
            </div>`,
          footer: `<button class="btn" data-modal-close>Cancel</button><button class="btn primary" id="cSave">${c ? "Save" : "Upload"}</button>`,
          onMount: (card) => {
            let fileName = c ? c.fileName : "";
            card.querySelector("#cFile").onchange = (e) => {
              const f = e.target.files[0]; if (f) { fileName = f.name; card.querySelector("#cFileName").textContent = "Selected: " + f.name; }
            };
            card.querySelector("#cSave").onclick = () => {
              const title = card.querySelector("#cTitle").value.trim();
              if (!title) { U.toast("Enter a contract title", "error"); return; }
              const sel = card.querySelector("#cAssign");
              const assignedTo = sel.value;
              const assignedEmail = sel.options[sel.selectedIndex] ? sel.options[sel.selectedIndex].dataset.email : "";
              const value = Number(card.querySelector("#cValue").value) || 0;
              const dueV = card.querySelector("#cDue").value;
              const due = dueV ? new Date(dueV).toISOString() : new Date().toISOString();
              const rec = { title, assignedTo, assignedEmail, party: assignedTo, value, due, fileName };
              if (c) { S.update("contracts", c.id, rec); U.toast("Contract updated", "success"); }
              else { S.add("contracts", { ...rec, status: "draft", sent: null }); U.toast("Contract uploaded", "success"); }
              U.closeModal(); window.App.rerender();
            };
          },
        });
      };

      const invite = (c) => {
        const profile = S.get().profile;
        const subject = encodeURIComponent(`Action required: please sign "${c.title}"`);
        const body = encodeURIComponent(
          `Hi ${c.assignedTo || ""},\n\n` +
          `You've been sent a contract to review and sign: "${c.title}".\n` +
          (c.fileName ? `Document: ${c.fileName}\n` : "") +
          (c.value ? `Value: ${U.money(c.value)}\n` : "") +
          `\nPlease review and reply to this email to confirm your signature.\n\n` +
          `Thanks,\n${profile.name}${profile.title ? "\n" + profile.title : ""}`
        );
        window.location.href = `mailto:${encodeURIComponent(c.assignedEmail || "")}?subject=${subject}&body=${body}`;
        S.update("contracts", c.id, { status: "invited", sent: new Date().toISOString() });
        U.toast("Invite opened in your email app ✉️", "success");
        window.App.rerender();
      };

      root.querySelector("#addContract").onclick = () => open(null);
      root.querySelectorAll("[data-invite]").forEach((b) => (b.onclick = () => {
        const c = S.find("contracts", b.dataset.invite);
        if (!c.assignedEmail) { U.toast("This employee has no email — add one in Team", "error"); return; }
        invite(c);
      }));
      root.querySelectorAll("[data-resend]").forEach((b) => (b.onclick = () => invite(S.find("contracts", b.dataset.resend))));
      root.querySelectorAll("[data-sign]").forEach((b) => (b.onclick = () => {
        S.update("contracts", b.dataset.sign, { status: "signed" }); U.toast("Marked as signed ✅", "success"); window.App.rerender();
      }));
      root.querySelectorAll('[data-act="edit"]').forEach((b) => (b.onclick = () => open(S.find("contracts", b.dataset.id))));
      root.querySelectorAll('[data-act="del"]').forEach((b) => (b.onclick = () =>
        U.confirm("Delete this contract?", () => { S.remove("contracts", b.dataset.id); U.toast("Deleted"); window.App.rerender(); })));
    },
  };

  /* =========================================================
     9. PAYROLL & EXPENSES
  ========================================================= */
  let txFilter = "all";
  Views.payroll = {
    title: "Payroll & Expenses",
    render() {
      const d = S.get();
      const payroll = d.transactions.filter((t) => t.type === "payroll").reduce((s, t) => s + t.amount, 0);
      const expenses = d.transactions.filter((t) => t.type === "expense").reduce((s, t) => s + t.amount, 0);
      const pending = d.transactions.filter((t) => t.status === "pending").reduce((s, t) => s + t.amount, 0);
      const list = txFilter === "all" ? d.transactions : d.transactions.filter((t) => t.type === txFilter);

      return `
      <div class="page-head">
        <div class="ph-text"><h1>Payroll & Expenses</h1><p>Run payroll and track every expense in one place.</p></div>
        <div class="ph-actions"><button class="btn primary" id="addTx">＋ Add transaction</button></div>
      </div>

      <div class="grid cols-3">
        ${stat({ label: "Payroll (total)", value: U.money(payroll), icon: "👛", tone: "primary" })}
        ${stat({ label: "Expenses (total)", value: U.money(expenses), icon: "🧾", tone: "info" })}
        ${stat({ label: "Pending approval", value: U.money(pending), icon: "⏳", tone: "warn" })}
      </div>

      <div class="card mt-24">
        <div class="card-head">
          <div class="flex gap-8">
            ${["all", "payroll", "expense"].map((t) => `<button class="chip" data-txf="${t}" style="${txFilter === t ? "background:var(--primary);color:#fff;border-color:var(--primary)" : ""}">${t === "all" ? "All" : U.cap(t)}</button>`).join("")}
          </div>
        </div>
        <div class="table-wrap">
          <table class="tbl">
            <thead><tr><th>Description</th><th>Type</th><th>Category</th><th>Amount</th><th>Status</th><th>Date</th><th></th></tr></thead>
            <tbody>
              ${list.length ? list.map((t) => `
                <tr>
                  <td class="row-main">${U.esc(t.desc)}</td>
                  <td><span class="chip">${U.cap(t.type)}</span></td>
                  <td class="muted">${U.esc(t.category)}</td>
                  <td class="row-main nowrap">${U.money(t.amount)}</td>
                  <td>${U.badge(t.status)}</td>
                  <td class="muted nowrap">${U.dateShort(t.date)}</td>
                  <td>
                    <div class="flex gap-8 nowrap">
                      ${t.status === "pending" ? `<button class="btn sm" data-approve="${t.id}">Approve</button>` : ""}
                      <button class="btn sm ghost" data-act="del" data-id="${t.id}" style="color:var(--danger)">Delete</button>
                    </div>
                  </td>
                </tr>`).join("")
                : `<tr><td colspan="7">${U.empty("💳", "No transactions yet.")}</td></tr>`}
            </tbody>
          </table>
        </div>
      </div>`;
    },
    mount(root) {
      root.querySelectorAll("[data-txf]").forEach((b) => (b.onclick = () => { txFilter = b.dataset.txf; window.App.rerender(); }));
      root.querySelector("#addTx").onclick = () => {
        U.formModal({
          title: "Add transaction",
          submitLabel: "Add",
          fields: [
            { name: "desc", label: "Description", required: true },
            { name: "type", label: "Type", type: "select", options: [{ value: "expense", label: "Expense" }, { value: "payroll", label: "Payroll" }], half: true },
            { name: "amount", label: "Amount ($)", type: "number", required: true, half: true },
            { name: "category", label: "Category", placeholder: "Software, Travel…", half: true },
            { name: "status", label: "Status", type: "select", options: ["pending", "approved", "paid"].map((s) => ({ value: s, label: U.cap(s) })), half: true },
          ],
          onSubmit: (data) => {
            S.add("transactions", { ...data, amount: Number(data.amount) || 0, category: data.category || "General", date: new Date().toISOString() });
            U.toast("Transaction added", "success"); window.App.rerender();
          },
        });
      };
      root.querySelectorAll("[data-approve]").forEach((b) => (b.onclick = () => {
        S.update("transactions", b.dataset.approve, { status: "approved" }); U.toast("Approved", "success"); window.App.rerender();
      }));
      root.querySelectorAll('[data-act="del"]').forEach((b) => (b.onclick = () =>
        U.confirm("Delete this transaction?", () => { S.remove("transactions", b.dataset.id); U.toast("Deleted"); window.App.rerender(); })));
    },
  };

  /* =========================================================
     10. APPLICANTS (hiring pipeline)
  ========================================================= */
  const STAGES = ["review", "screening", "interview", "offer", "hired", "rejected"];
  Views.applicants = {
    title: "Applicants",
    render() {
      const d = S.get();
      const byStage = STAGES.reduce((m, s) => ((m[s] = d.applicants.filter((a) => a.stage === s)), m), {});
      return `
      <div class="page-head">
        <div class="ph-text"><h1>Applicants</h1><p>Track candidates through your hiring pipeline.</p></div>
        <div class="ph-actions"><button class="btn primary" id="addApplicant">＋ Add applicant</button></div>
      </div>

      <div class="grid cols-4">
        ${stat({ label: "Total applicants", value: d.applicants.length, icon: "🧑‍💼", tone: "primary" })}
        ${stat({ label: "In interview", value: byStage.interview.length, icon: "🗣", tone: "warn" })}
        ${stat({ label: "Offers out", value: byStage.offer.length, icon: "🤝", tone: "info" })}
        ${stat({ label: "Hired", value: byStage.hired.length, icon: "🎉", tone: "success" })}
      </div>

      <div class="card mt-24">
        <div class="card-head"><h3>Candidate pipeline</h3></div>
        <div class="table-wrap">
          <table class="tbl">
            <thead><tr><th>Candidate</th><th>Role</th><th>Stage</th><th>Rating</th><th>Applied</th><th></th></tr></thead>
            <tbody>
              ${d.applicants.length ? d.applicants.map((a) => `
                <tr>
                  <td><div class="flex gap-12 center"><div class="avatar" style="width:32px;height:32px;font-size:12px">${U.initials(a.name)}</div>
                    <div><div class="row-main">${U.esc(a.name)}</div><div class="row-sub">${U.esc(a.email)}</div></div></div></td>
                  <td class="muted">${U.esc(a.role)}</td>
                  <td>
                    <select class="badge b-${a.stage}" data-stage="${a.id}" style="border:none;cursor:pointer;padding:4px 8px;border-radius:30px;font-weight:600">
                      ${STAGES.map((s) => `<option value="${s}" ${a.stage === s ? "selected" : ""}>${U.cap(s)}</option>`).join("")}
                    </select>
                  </td>
                  <td style="color:var(--warn)">${"★".repeat(a.rating)}<span class="faint">${"★".repeat(5 - a.rating)}</span></td>
                  <td class="muted nowrap">${U.ago(a.applied)}</td>
                  <td><button class="btn sm ghost" data-act="del" data-id="${a.id}" style="color:var(--danger)">Delete</button></td>
                </tr>`).join("")
                : `<tr><td colspan="6">${U.empty("🧑‍💼", "No applicants yet.")}</td></tr>`}
            </tbody>
          </table>
        </div>
      </div>`;
    },
    mount(root) {
      root.querySelector("#addApplicant").onclick = () => {
        U.formModal({
          title: "Add applicant",
          submitLabel: "Add",
          fields: [
            { name: "name", label: "Full name", required: true, half: true },
            { name: "email", label: "Email", type: "email", half: true },
            { name: "role", label: "Role applying for", required: true, half: true },
            { name: "stage", label: "Stage", type: "select", options: STAGES.map((s) => ({ value: s, label: U.cap(s) })), half: true },
            { name: "rating", label: "Rating (1–5)", type: "number", value: 3 },
          ],
          onSubmit: (data) => {
            S.add("applicants", { ...data, rating: Math.max(1, Math.min(5, Number(data.rating) || 3)), applied: new Date().toISOString() });
            U.toast("Applicant added", "success"); window.App.rerender();
          },
        });
      };
      root.querySelectorAll("[data-stage]").forEach((sel) => (sel.onchange = () => {
        S.update("applicants", sel.dataset.stage, { stage: sel.value }); U.toast("Stage updated", "success"); window.App.rerender();
      }));
      root.querySelectorAll('[data-act="del"]').forEach((b) => (b.onclick = () =>
        U.confirm("Remove this applicant?", () => { S.remove("applicants", b.dataset.id); U.toast("Removed"); window.App.rerender(); })));
    },
  };

  /* =========================================================
     11. TEAM
  ========================================================= */
  Views.team = {
    title: "Team",
    render() {
      if (window.DB && window.DB.active) return teamDB();
      const d = S.get();
      const depts = [...new Set(d.team.map((t) => t.dept))];
      return `
      <div class="page-head">
        <div class="ph-text"><h1>Team</h1><p>Your people, departments, and contact info.</p></div>
        <div class="ph-actions"><button class="btn primary" id="addMember">＋ Add member</button></div>
      </div>

      <div class="grid cols-4">
        ${stat({ label: "Team size", value: d.team.length, icon: "👥", tone: "primary" })}
        ${stat({ label: "Departments", value: depts.length, icon: "🏢", tone: "info" })}
        ${stat({ label: "Active", value: d.team.filter((t) => t.status === "active").length, icon: "🟢", tone: "success" })}
        ${stat({ label: "Away", value: d.team.filter((t) => t.status === "away").length, icon: "🌙", tone: "warn" })}
      </div>

      <div class="grid cols-3 mt-24">
        ${d.team.map((m) => `
          <div class="card card-pad">
            <div class="flex between center">
              <div class="flex gap-12 center">
                <div class="avatar" style="width:46px;height:46px;font-size:16px">${U.initials(m.name)}</div>
                <div><div class="row-main">${U.esc(m.name)}</div><div class="row-sub">${U.esc(m.title)}</div></div>
              </div>
              <span class="badge b-${m.status === "active" ? "active" : "pending"}">${U.cap(m.status)}</span>
            </div>
            <div class="flex gap-8 mt-16" style="flex-wrap:wrap">
              <span class="chip">🏢 ${U.esc(m.dept)}</span>
              ${m.email ? `<span class="chip">✉️ ${U.esc(m.email)}</span>` : ""}
              ${m.invited ? `<span class="chip" style="color:var(--success)">✓ Invited</span>` : ""}
            </div>
            <div class="flex between center mt-16">
              <span class="faint" style="font-size:12px">Joined ${U.date(m.joined)}</span>
              <div class="flex gap-8">
                ${m.email ? `<button class="btn sm" data-invite="${m.id}">${m.invited ? "Resend" : "✉ Invite"}</button>` : ""}
                <button class="btn sm ghost" data-act="edit" data-id="${m.id}">Edit</button>
                <button class="btn sm ghost" data-act="del" data-id="${m.id}" style="color:var(--danger)">Remove</button>
              </div>
            </div>
          </div>`).join("")}
      </div>`;
    },
    mount(root) {
      if (window.DB && window.DB.active) return teamDBMount(root);
      const sendInvite = (m) => {
        if (!m || !m.email) { U.toast("Add an email first", "error"); return; }
        const p = S.get().profile;
        const url = location.origin + location.pathname;
        const su = encodeURIComponent(`${p.name} invited you to the Workspace dashboard`);
        const body = encodeURIComponent(
          `Hi ${m.name || ""},\n\n${p.name} has added you to the team Workspace dashboard.\n\nOpen it here:\n${url}\n\nThanks,\n${p.name}`
        );
        // Open Gmail's compose window, pre-filled, sent from the admin's own Gmail.
        window.open(`https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(m.email)}&su=${su}&body=${body}`, "_blank");
        S.update("team", m.id, { invited: true, invitedAt: new Date().toISOString() });
        U.toast("Invite opened in Gmail — hit Send", "success");
        window.App.rerender();
      };

      const open = (m) => {
        U.formModal({
          title: m ? "Edit member" : "Add team member",
          submitLabel: m ? "Save" : "Add & invite",
          values: m || {},
          fields: [
            { name: "name", label: "Full name", required: true, half: true },
            { name: "title", label: "Title", half: true },
            { name: "dept", label: "Department", type: "select", options: ["Operations", "Finance", "Marketing", "Design", "Engineering", "Sales", "Support"].map((c) => ({ value: c, label: c })), half: true },
            { name: "status", label: "Status", type: "select", options: [{ value: "active", label: "Active" }, { value: "away", label: "Away" }], half: true },
            { name: "email", label: "Email (invite sent here)", type: "email" },
          ],
          onSubmit: (data) => {
            if (m) { S.update("team", m.id, data); U.toast("Updated", "success"); window.App.rerender(); }
            else {
              const rec = S.add("team", { ...data, joined: new Date().toISOString() });
              U.toast("Member added", "success");
              window.App.rerender();
              if (rec.email) sendInvite(rec); // auto-send the join invite
            }
          },
        });
      };
      root.querySelector("#addMember").onclick = () => open(null);
      root.querySelectorAll("[data-invite]").forEach((b) => (b.onclick = () => sendInvite(S.find("team", b.dataset.invite))));
      root.querySelectorAll('[data-act="edit"]').forEach((b) => (b.onclick = () => open(S.find("team", b.dataset.id))));
      root.querySelectorAll('[data-act="del"]').forEach((b) => (b.onclick = () =>
        U.confirm("Remove this team member?", () => { S.remove("team", b.dataset.id); U.toast("Removed"); window.App.rerender(); })));
    },
  };

  // ---- SOPs in logged-in (Supabase) mode ----
  function sopViewer(s) {
    const src = s.file_url || "";
    const ext = (s.file_name || "").split(".").pop().toLowerCase();
    const isPdf = ext === "pdf" && src;
    const isImg = ["png", "jpg", "jpeg", "gif", "webp", "svg"].includes(ext) && src;
    let body;
    if (isPdf) body = `<iframe src="${U.esc(src)}#view=FitH" style="width:100%;height:72vh;border:1px solid var(--border);border-radius:8px;background:#fff"></iframe>`;
    else if (isImg) body = `<div style="text-align:center"><img src="${U.esc(src)}" style="max-width:100%;max-height:72vh;border-radius:8px"/></div>`;
    else body = `<div class="empty"><div class="em-ico">${fileIcon(s.file_name)}</div><p>${src ? "Preview not available for this type — use the button below." : "No file attached."}</p></div>`;
    U.modal({
      title: s.title,
      body,
      footer: `${src ? `<a class="btn" href="${U.esc(src)}" ${isPdf || isImg ? 'target="_blank" rel="noopener"' : `download="${U.esc(s.file_name || "document")}"`}>↗ ${isPdf || isImg ? "Open in new tab" : "Download"}</a>` : ""}<button class="btn primary" data-modal-close>Close</button>`,
      onMount: (card) => { if (isPdf || isImg) card.style.width = "min(980px, calc(100vw - 32px))"; },
    });
  }
  function sopsDB() {
    const admin = window.DB.isAdmin();
    const docs = window.DB.sops();
    const nameOf = (id) => { const p = window.DB.profile(id); return p ? window.DB.displayName(p) : "—"; };

    if (!admin) {
      return `
        <div class="page-head"><div class="ph-text"><h1>SOPs & Documents</h1><p>Documents shared with you — click to read.</p></div></div>
        <div class="grid cols-3">
          ${docs.length ? docs.map((s) => `
            <div class="card card-pad" data-opensop="${s.id}" style="cursor:pointer">
              <div class="flex gap-12 center">
                <div class="li-ico bg-info">${fileIcon(s.file_name)}</div>
                <div style="min-width:0"><div class="row-main">${U.esc(s.title)}</div><div class="row-sub">${U.esc(s.category || "")} · ${U.esc(s.version || "")}</div></div>
              </div>
              <div class="flex between center mt-16"><span class="faint" style="font-size:12px">${U.ago(s.created_at)}</span><button class="btn sm" data-opensop="${s.id}">Open</button></div>
            </div>`).join("")
            : `<div style="grid-column:1/-1">${U.empty("📄", "No documents have been shared with you yet.")}</div>`}
        </div>`;
    }

    return `
      <div class="page-head">
        <div class="ph-text"><h1>SOPs & Documents</h1><p>Upload a document and assign it to a person — they'll only see it if it's assigned to them.</p></div>
        <div class="ph-actions"><button class="btn primary" id="uploadSop">⬆ Upload document</button></div>
      </div>
      <div class="card mt-8">
        <div class="card-head"><h3>Document library</h3><div class="ch-actions"><span class="chip">${docs.length} files</span></div></div>
        <div class="table-wrap"><table class="tbl">
          <thead><tr><th>Document</th><th>Category</th><th>Assigned to</th><th>Date</th><th></th></tr></thead>
          <tbody>${docs.length ? docs.map((s) => `
            <tr>
              <td><div class="flex gap-12 center"><div class="li-ico bg-info">${fileIcon(s.file_name)}</div><div><div class="row-main">${U.esc(s.title)}</div><div class="row-sub">${U.esc(s.file_name || "")}</div></div></div></td>
              <td><span class="chip">${U.esc(s.category || "—")}</span></td>
              <td>${s.assigned_to ? U.esc(nameOf(s.assigned_to)) : '<span class="faint">Admin only</span>'}</td>
              <td class="muted nowrap">${U.dateShort(s.created_at)}</td>
              <td><div class="flex gap-8 nowrap">
                ${s.file_url ? `<button class="btn sm" data-opensop="${s.id}">Open</button>` : ""}
                <button class="btn sm ghost" data-delsop="${s.id}" style="color:var(--danger)">Delete</button>
              </div></td>
            </tr>`).join("")
            : `<tr><td colspan="5">${U.empty("📄", "No documents yet. Upload one and assign it to a team member.")}</td></tr>`}
          </tbody></table></div>
      </div>`;
  }
  function sopsDBMount(root) {
    root.querySelectorAll("[data-opensop]").forEach((b) => (b.onclick = (e) => {
      e.stopPropagation();
      const s = window.DB.sops().find((x) => x.id === b.dataset.opensop);
      if (s) sopViewer(s);
    }));
    const up = root.querySelector("#uploadSop");
    if (!up) return;
    up.onclick = () => {
      const people = window.DB.profiles().filter((p) => p.role !== "admin");
      U.modal({
        title: "Upload document",
        body: `
          <div class="field"><label>Title</label><input id="sTitle" placeholder="e.g. Safety Procedure"/></div>
          <div class="field-row">
            <div class="field"><label>Category</label><input id="sCat" placeholder="HR, Ops…"/></div>
            <div class="field"><label>Version</label><input id="sVer" placeholder="v1.0" value="v1.0"/></div>
          </div>
          <div class="field"><label>Assign to</label>
            <select id="sAssign"><option value="">— Admin only (not shared) —</option>${people.map((p) => `<option value="${p.id}">${U.esc(window.DB.displayName(p))}${p.email ? " — " + U.esc(p.email) : ""}</option>`).join("")}</select>
          </div>
          <div class="field"><label>File</label><input type="file" id="sFile" accept=".pdf,.doc,.docx,image/*"/>
            <div class="faint" id="sFileName" style="font-size:12px;margin-top:4px">PDF, Word, or image (up to ~3MB)</div></div>`,
        footer: `<button class="btn" data-modal-close>Cancel</button><button class="btn primary" id="sSave">Upload</button>`,
        onMount: (card) => {
          let fileName = "", fileUrl = "";
          card.querySelector("#sFile").onchange = (e) => {
            const f = e.target.files[0]; if (!f) return;
            if (f.size > 3 * 1024 * 1024) { card.querySelector("#sFileName").textContent = "Too large (max ~3MB) — will be listed without preview."; fileName = f.name; fileUrl = ""; return; }
            const r = new FileReader();
            r.onload = () => { fileName = f.name; fileUrl = r.result; card.querySelector("#sFileName").textContent = "Selected: " + f.name; };
            r.readAsDataURL(f);
          };
          card.querySelector("#sSave").onclick = async () => {
            const title = card.querySelector("#sTitle").value.trim();
            if (!title) { U.toast("Enter a title", "error"); return; }
            const rec = {
              title, category: card.querySelector("#sCat").value.trim() || "General",
              version: card.querySelector("#sVer").value.trim() || "v1.0",
              file_name: fileName || null, file_url: fileUrl || null,
              assigned_to: card.querySelector("#sAssign").value || null,
              uploaded_by: window.DB.displayName(window.DB.me()),
            };
            U.closeModal();
            await window.DB.addSop(rec);
            U.toast("Document uploaded", "success");
            window.App.rerender();
          };
        },
      });
    };
    root.querySelectorAll("[data-delsop]").forEach((b) => (b.onclick = () =>
      U.confirm("Delete this document?", async () => { await window.DB.removeSop(b.dataset.delsop); U.toast("Deleted"); window.App.rerender(); })));
  }

  // Monday 00:00 of the current week
  function startOfWeek(d = new Date()) {
    const x = new Date(d); x.setHours(0, 0, 0, 0);
    x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
    return x;
  }
  // avatar image (or initials) for a Supabase profile
  function dbAvatar(p) {
    return p && p.avatar_url
      ? `<img src="${U.esc(p.avatar_url)}" alt="" style="width:100%;height:100%;object-fit:cover"/>`
      : U.initials(window.DB.displayName(p));
  }

  // ---- Time Tracker in logged-in (Supabase) mode ----
  function timetrackerDB() {
    const me = window.DB.me();
    const admin = window.DB.isAdmin();
    const single = !admin || !!window.DB.viewAs;     // employees & admin-viewing-as see one person
    const target = window.DB.target();
    const entries = window.DB.timeEntries();
    const people = single ? [target] : window.DB.profiles().filter((p) => p.role !== "admin");
    const isToday = (iso) => new Date(iso).toDateString() === new Date().toDateString();
    const dur = (e) => (e.clock_out ? new Date(e.clock_out) : new Date()) - new Date(e.clock_in);
    const personEntries = (uid) => entries.filter((e) => e.user_id === uid);
    const scope = single ? personEntries(target.id) : entries.filter((e) => people.some((p) => p.id === e.user_id));
    const done = scope.filter((e) => e.clock_out);
    const todayMs = done.filter((e) => isToday(e.clock_in)).reduce((s, e) => s + dur(e), 0);
    const weekMs = done.filter((e) => Date.now() - new Date(e.clock_in) < 7 * 864e5).reduce((s, e) => s + dur(e), 0);
    const activeCount = scope.filter((e) => !e.clock_out).length;

    const stats = single
      ? `${stat({ label: "Status", value: activeCount ? "On the clock" : "Off", icon: "🟢", tone: activeCount ? "success" : "warn" })}
         ${stat({ label: "Hours today", value: U.hours(todayMs), icon: "📆", tone: "primary" })}
         ${stat({ label: "Hours this week", value: U.hours(weekMs), icon: "📊", tone: "info" })}
         ${stat({ label: "Entries", value: done.length, icon: "🧾", tone: "warn" })}`
      : `${stat({ label: "On the clock now", value: activeCount, icon: "🟢", tone: "success" })}
         ${stat({ label: "Team hours today", value: U.hours(todayMs), icon: "📆", tone: "primary" })}
         ${stat({ label: "Team hours this week", value: U.hours(weekMs), icon: "📊", tone: "info" })}
         ${stat({ label: "Team members", value: people.length, icon: "👥", tone: "warn" })}`;

    const cards = people.map((p) => {
      const act = window.DB.activeEntryFor(p.id);
      const todMs = personEntries(p.id).filter((e) => e.clock_out && isToday(e.clock_in)).reduce((s, e) => s + dur(e), 0);
      return `<div class="card card-pad" style="display:flex;flex-direction:column;gap:12px">
        <div class="flex gap-12 center">
          <div class="avatar">${dbAvatar(p)}</div>
          <div style="min-width:0"><div class="row-main">${U.esc(window.DB.displayName(p))}${p.id === me.id ? ' <span class="faint">(you)</span>' : ""}</div><div class="row-sub">${U.esc(p.title || p.dept || "")}</div></div>
          <span class="badge ${act ? "b-active" : "b-draft"}" style="margin-left:auto">${act ? "Active" : "Off"}</span>
        </div>
        <div class="flex between center">
          <div><div class="faint" style="font-size:11px;text-transform:uppercase;letter-spacing:.05em">${act ? "Elapsed" : "Today"}</div>
            <div class="row-main" style="font-family:var(--mono);font-size:18px" ${act ? `data-since="${act.clock_in}"` : ""}>${act ? U.dur(Date.now() - new Date(act.clock_in)) : U.hours(todMs)}</div></div>
          ${act ? `<button class="btn danger sm" data-clockout="${act.id}">⏹ Clock out</button>`
                : `<button class="btn primary sm" data-clockin="${p.id}" data-name="${U.esc(window.DB.displayName(p))}">▶ Clock in</button>`}
        </div>
        ${act ? `<div class="faint" style="font-size:12px">${U.esc(act.project || "")} · since ${U.time(act.clock_in)}</div>` : ""}
      </div>`;
    }).join("");

    const rows = scope.map((e) => {
      const p = window.DB.profile(e.user_id);
      return `<tr>
        ${single ? "" : `<td><div class="flex gap-8 center"><div class="avatar" style="width:26px;height:26px;font-size:10px">${dbAvatar(p)}</div><span class="row-main">${U.esc(window.DB.displayName(p))}</span></div></td>`}
        <td class="muted">${U.esc(e.project || "—")}</td>
        <td class="muted nowrap">${U.dateShort(e.clock_in)}</td>
        <td class="muted">${U.time(e.clock_in)}</td>
        <td class="muted">${e.clock_out ? U.time(e.clock_out) : '<span style="color:var(--success)">active</span>'}</td>
        <td class="row-main nowrap">${e.clock_out ? U.hours(dur(e)) : "—"}</td>
        <td>${(admin || e.user_id === me.id) ? `<button class="btn sm ghost" data-deltime="${e.id}" style="color:var(--danger)">Delete</button>` : ""}</td>
      </tr>`;
    }).join("");

    // ---- weekly timesheet ----
    const ws = startOfWeek(); const wsISO = ws.toISOString().slice(0, 10);
    const weISO = new Date(ws.getTime() + 6 * 864e5).toISOString().slice(0, 10);
    const allTs = window.DB.timesheets() || [];
    let tsBlock = "";
    if (single) {
      const isMe = target.id === me.id;
      const weekHours = personEntries(target.id).filter((e) => e.clock_out && new Date(e.clock_in) >= ws && new Date(e.clock_in) < new Date(ws.getTime() + 7 * 864e5)).reduce((s, e) => s + dur(e), 0) / 36e5;
      const myTs = allTs.filter((t) => t.user_id === target.id);
      const thisTs = myTs.find((t) => t.week_start === wsISO);
      tsBlock = `<div class="card mt-24"><div class="card-head"><h3>Weekly timesheet</h3><div class="ch-actions"><span class="chip">Week of ${U.dateShort(ws.toISOString())}</span></div></div>
        <div class="card-pad">
          <div class="flex between center" style="flex-wrap:wrap;gap:12px">
            <div><div class="faint" style="font-size:12px;text-transform:uppercase;letter-spacing:.05em">This week</div><div class="row-main" style="font-size:20px;font-family:var(--mono)">${weekHours.toFixed(1)}h</div>
              <div class="mt-8">${thisTs ? U.badge(thisTs.status) : '<span class="chip">Not submitted</span>'}</div></div>
            ${isMe ? `<button class="btn primary" data-submitts data-week="${wsISO}" data-end="${weISO}" data-hours="${weekHours.toFixed(2)}">${thisTs ? "Resubmit this week" : "Submit this week"}</button>` : ""}
          </div>
          ${myTs.length ? `<div class="table-wrap mt-16"><table class="tbl"><thead><tr><th>Week of</th><th>Hours</th><th>Status</th><th>Submitted</th></tr></thead>
            <tbody>${myTs.map((t) => `<tr><td class="row-main nowrap">${U.dateShort(t.week_start)}</td><td class="muted">${Number(t.hours).toFixed(1)}h</td><td>${U.badge(t.status)}</td><td class="muted nowrap">${U.ago(t.submitted_at)}</td></tr>`).join("")}</tbody></table></div>` : ""}
        </div></div>`;
    } else {
      const submitted = allTs.filter((t) => t.status === "submitted");
      tsBlock = `<div class="card mt-24"><div class="card-head"><h3>Submitted timesheets</h3><div class="ch-actions"><span class="chip">${submitted.length} pending</span></div></div>
        <div class="table-wrap"><table class="tbl"><thead><tr><th>Member</th><th>Week of</th><th>Hours</th><th>Status</th><th>Submitted</th><th></th></tr></thead>
          <tbody>${allTs.length ? allTs.map((t) => { const p = window.DB.profile(t.user_id); return `<tr>
            <td><div class="flex gap-8 center"><div class="avatar" style="width:26px;height:26px;font-size:10px">${dbAvatar(p)}</div><span class="row-main">${U.esc(window.DB.displayName(p))}</span></div></td>
            <td class="muted nowrap">${U.dateShort(t.week_start)}</td>
            <td class="row-main">${Number(t.hours).toFixed(1)}h</td>
            <td>${U.badge(t.status)}</td>
            <td class="muted nowrap">${U.ago(t.submitted_at)}</td>
            <td><div class="flex gap-8 nowrap">${t.status === "submitted" ? `<button class="btn sm" data-approvets="${t.id}">Approve</button><button class="btn sm ghost" data-rejectts="${t.id}" style="color:var(--danger)">Reject</button>` : ""}</div></td>
          </tr>`; }).join("") : `<tr><td colspan="6">${U.empty("🗓", "No timesheets submitted yet.")}</td></tr>`}</tbody></table></div></div>`;
    }

    return `
      <div class="page-head"><div class="ph-text"><h1>Time Tracker</h1><p>${single ? "Clock in and out, and submit your weekly timesheet." : "Clock your team in and out, review hours, and approve weekly timesheets."}</p></div></div>
      <div class="grid cols-4">${stats}</div>
      <div class="card mt-24"><div class="card-head"><h3>${single ? "Your clock" : "Team — clock in / out"}</h3></div>
        <div class="card-pad"><div class="grid cols-3">${cards}</div></div></div>
      ${tsBlock}
      ${!single ? `<div class="card mt-24"><div class="card-head"><h3>Departments</h3><div class="ch-actions"><button class="btn sm primary" id="addDept">＋ Add department</button></div></div>
        <div class="card-pad"><p class="muted" style="margin-bottom:10px;font-size:13px">These are the options people choose from when they clock in.</p>
        <div class="flex gap-8" style="flex-wrap:wrap">${(window.DB.departments() || []).map((d) => `<span class="chip">${U.esc(d.name)} <span data-deldept="${d.id}" title="Remove" style="cursor:pointer;color:var(--danger);margin-left:4px">✕</span></span>`).join("") || '<span class="faint">No departments yet — add one.</span>'}</div></div></div>` : ""}
      <div class="card mt-24"><div class="card-head"><h3>Timesheet</h3><div class="ch-actions"><span class="chip">${scope.length} entries</span></div></div>
        <div class="table-wrap"><table class="tbl"><thead><tr>${single ? "" : "<th>Member</th>"}<th>Department</th><th>Date</th><th>In</th><th>Out</th><th>Duration</th><th></th></tr></thead>
        <tbody>${scope.length ? rows : `<tr><td colspan="${single ? 6 : 7}">${U.empty("⏱", "No time logged yet. Clock in to get started.")}</td></tr>`}</tbody></table></div></div>`;
  }
  function timetrackerDBMount(root) {
    const subBtn = root.querySelector("[data-submitts]");
    if (subBtn) subBtn.onclick = async () => {
      try {
        await window.DB.submitTimesheet({ week_start: subBtn.dataset.week, week_end: subBtn.dataset.end, hours: Number(subBtn.dataset.hours) || 0 });
        U.toast("Timesheet submitted — your admin was notified", "success"); window.App.rerender();
      } catch (e) { U.toast("Couldn't submit: " + (e.message || e), "error"); }
    };
    root.querySelectorAll("[data-approvets]").forEach((b) => (b.onclick = async () => { await window.DB.reviewTimesheet(b.dataset.approvets, "approved"); U.toast("Approved", "success"); window.App.rerender(); }));
    root.querySelectorAll("[data-rejectts]").forEach((b) => (b.onclick = async () => { await window.DB.reviewTimesheet(b.dataset.rejectts, "rejected"); U.toast("Rejected"); window.App.rerender(); }));

    const addDeptBtn = root.querySelector("#addDept");
    if (addDeptBtn) addDeptBtn.onclick = () => U.formModal({
      title: "Add department", submitLabel: "Add",
      fields: [{ name: "name", label: "Department name", required: true, placeholder: "e.g. Customer Support" }],
      onSubmit: async (d) => { await window.DB.addDepartment(d.name); U.toast("Department added", "success"); window.App.rerender(); },
    });
    root.querySelectorAll("[data-deldept]").forEach((x) => (x.onclick = () =>
      U.confirm("Remove this department?", async () => { await window.DB.removeDepartment(x.dataset.deldept); U.toast("Removed"); window.App.rerender(); })));

    root.querySelectorAll("[data-clockin]").forEach((b) => (b.onclick = () => {
      const id = b.dataset.clockin, name = b.dataset.name;
      const deps = (window.DB.departments && window.DB.departments()) || [];
      const fields = deps.length
        ? [{ name: "project", label: "What are you working on? (department)", type: "select", options: deps.map((d) => ({ value: d.name, label: d.name })) }]
        : [{ name: "project", label: "What are you working on?", placeholder: "e.g. Client onboarding", value: "General" }];
      U.formModal({
        title: "Clock in — " + name,
        submitLabel: "Clock in",
        fields,
        onSubmit: async (data) => { await window.DB.clockIn(id, data.project || "General"); U.toast("Clocked in", "success"); window.App.rerender(); window.App.refreshClockPill(); },
      });
    }));
    root.querySelectorAll("[data-clockout]").forEach((b) => (b.onclick = async () => {
      await window.DB.clockOut(b.dataset.clockout); U.toast("Clocked out", "success"); window.App.rerender(); window.App.refreshClockPill();
    }));
    root.querySelectorAll("[data-deltime]").forEach((b) => (b.onclick = () =>
      U.confirm("Delete this time entry?", async () => { await window.DB.removeTimeEntry(b.dataset.deltime); U.toast("Deleted"); window.App.rerender(); })));
    clearInterval(window.__ctTimer);
    const cells = root.querySelectorAll("[data-since]");
    if (cells.length) window.__ctTimer = setInterval(() => { cells.forEach((c) => { c.textContent = U.dur(Date.now() - new Date(c.dataset.since)); }); }, 1000);
  }

  // ---- Contracts in logged-in (Supabase) mode ----
  // stamp the admin's saved signature into any "Company signature" fields
  function stampAdminSig(existing, fields) {
    const sig = (window.DB.me() && window.DB.me().signature_url) || "";
    const fv = { ...(existing || {}) };
    (fields || []).forEach((f) => { if (f.type === "admin_sig") fv[f.id] = sig; });
    return fv;
  }
  const CFIELDS = ["name", "email", "phone", "address", "date", "signature"];
  const CFLABEL = { name: "Full name", email: "Email", phone: "Phone", address: "Address", date: "Date", signature: "Signature" };
  function fileBody(src, name) {
    const ext = (name || "").split(".").pop().toLowerCase();
    if (ext === "pdf" && src) return `<iframe src="${U.esc(src)}#view=FitH" style="width:100%;height:60vh;border:1px solid var(--border);border-radius:8px;background:#fff"></iframe>`;
    if (["png", "jpg", "jpeg", "gif", "webp", "svg"].includes(ext) && src) return `<div style="text-align:center"><img src="${U.esc(src)}" style="max-width:100%;max-height:60vh;border-radius:8px"/></div>`;
    return `<div class="empty"><div class="em-ico">${fileIcon(name)}</div><p>${src ? "Preview not available for this file type — use Open below." : "No document attached."}</p></div>`;
  }
  function openSignContract(c) {
    const me = window.DB.me();
    const signed = c.status === "signed";
    const fields = (c.fields && c.fields.length) ? c.fields : ["name", "signature", "date"];
    const vals = signed ? (c.field_values || {}) : { name: me.full_name || "", email: me.email || "", phone: me.phone || "", address: me.address || "", date: new Date().toLocaleDateString() };
    const sig = signed ? (c.field_values && c.field_values.signature) : me.signature_url;
    const fieldForm = fields.map((k) => {
      if (k === "signature") return `<div class="field"><label>Signature</label>${sig ? `<img src="${U.esc(sig)}" style="max-height:70px;background:#fff;border:1px solid var(--border);border-radius:8px;padding:6px"/>` : `<div class="faint">No signature on file.${signed ? "" : " Add one in My Account first."}</div>`}</div>`;
      return `<div class="field"><label>${CFLABEL[k] || k}</label><input data-fk="${k}" value="${U.esc(vals[k] || "")}" ${signed ? "disabled" : ""}/></div>`;
    }).join("");
    U.modal({
      title: signed ? c.title + " — signed" : "Review & sign: " + c.title,
      body: `${fileBody(c.file_url, c.file_name)}<div class="mt-16"><div class="card-head" style="padding:0 0 8px"><h3>${signed ? "Submitted details" : "Complete & sign"}</h3></div>${fieldForm}</div>`,
      footer: signed ? `<button class="btn primary" data-modal-close>Close</button>` : `<button class="btn" data-modal-close>Cancel</button><button class="btn primary" id="doSign">✍ Sign & submit</button>`,
      onMount: (card) => {
        card.style.width = "min(900px, calc(100vw - 32px))";
        const ds = card.querySelector("#doSign");
        if (ds) ds.onclick = async () => {
          if (fields.includes("signature") && !me.signature_url) { U.toast("Add your signature in My Account first", "error"); return; }
          const fv = {};
          card.querySelectorAll("[data-fk]").forEach((i) => (fv[i.dataset.fk] = i.value.trim()));
          if (fields.includes("signature")) fv.signature = me.signature_url;
          U.closeModal();
          await window.DB.signContract(c, fv);
          U.toast("Signed ✓ — your admin was notified", "success");
          window.App.rerender();
        };
      },
    });
  }
  function openContractUpload() {
    const people = window.DB.profiles().filter((p) => p.role !== "admin");
    U.modal({
      title: "Upload contract",
      body: `
        <div class="field"><label>Contract title</label><input id="cTitle" placeholder="e.g. Employment Agreement"/></div>
        <div class="field"><label>Assign to</label><select id="cAssign">${people.map((p) => `<option value="${p.id}">${U.esc(window.DB.displayName(p))}${p.email ? " — " + U.esc(p.email) : ""}</option>`).join("")}</select></div>
        <div class="field-row"><div class="field"><label>Value ($)</label><input id="cValue" type="number" placeholder="0"/></div><div class="field"><label>Due date</label><input id="cDue" type="date"/></div></div>
        <div class="field"><label>Document (PDF or image)</label><input type="file" id="cFile" accept=".pdf,image/*"/></div>
        <div id="cPrev" class="mt-8"></div>
        <p class="faint" style="font-size:12px">After uploading, you'll place the signer's fields directly on the document.</p>`,
      footer: `<button class="btn" data-modal-close>Cancel</button><button class="btn primary" id="cSave">Upload & place fields</button>`,
      onMount: (card) => {
        card.style.width = "min(820px, calc(100vw - 32px))";
        let fileName = "", fileUrl = "";
        card.querySelector("#cFile").onchange = (e) => {
          const f = e.target.files[0]; if (!f) return;
          if (f.size > 3 * 1024 * 1024) { U.toast("File too large (max ~3MB)", "error"); return; }
          const r = new FileReader();
          r.onload = () => { fileName = f.name; fileUrl = r.result; card.querySelector("#cPrev").innerHTML = fileBody(fileUrl, fileName); };
          r.readAsDataURL(f);
        };
        card.querySelector("#cSave").onclick = async () => {
          const title = card.querySelector("#cTitle").value.trim();
          if (!title) { U.toast("Enter a title", "error"); return; }
          if (!people.length) { U.toast("Add a team member first", "error"); return; }
          const dueV = card.querySelector("#cDue").value;
          const rec = {
            title, assigned_to: card.querySelector("#cAssign").value,
            value: Number(card.querySelector("#cValue").value) || 0, status: "draft",
            file_name: fileName || null, file_url: fileUrl || null, fields: [],
            due: dueV ? new Date(dueV).toISOString() : null,
          };
          let created;
          try { created = await window.DB.addContract(rec); }
          catch (e) { U.toast("Couldn't save contract: " + (e.message || e), "error"); return; }
          U.closeModal();
          window.App.rerender();
          if (created && created.file_url && window.Esign) {
            Esign.openEditor(created, async (fields) => { try { await window.DB.updateContract(created.id, { fields, field_values: stampAdminSig(created.field_values, fields) }); U.toast("Contract ready — fields placed", "success"); window.App.rerender(); } catch (e) { U.toast("Couldn't save fields: " + (e.message || e), "error"); } });
          } else U.toast("Contract created (no document attached)", "success");
        };
      },
    });
  }
  function contractsDB() {
    const admin = window.DB.isAdmin();
    const list = window.DB.contracts();
    const nameOf = (id) => { const p = window.DB.profile(id); return p ? window.DB.displayName(p) : "—"; };

    if (!admin) {
      return `
        <div class="page-head"><div class="ph-text"><h1>Contracts</h1><p>Documents assigned to you — review, complete the fields, and sign.</p></div></div>
        <div class="grid cols-2">
          ${list.length ? list.map((c) => `
            <div class="card card-pad">
              <div class="flex between center">
                <div class="row-main" style="font-size:15px">${U.esc(c.title)}</div>
                ${U.badge(c.status)}
              </div>
              <div class="flex gap-8 mt-16" style="flex-wrap:wrap">
                ${c.file_name ? `<span class="chip">📎 ${U.esc(c.file_name)}</span>` : ""}
                ${c.value ? `<span class="chip">💰 ${U.money(c.value)}</span>` : ""}
                ${c.due ? `<span class="chip">Due ${U.dateShort(c.due)}</span>` : ""}
              </div>
              <div class="flex between center mt-16">
                <span class="faint" style="font-size:12px">${c.status === "signed" ? "Signed " + U.ago(c.signed_at) : "Awaiting your signature"}</span>
                <button class="btn ${c.status === "signed" ? "" : "primary"} sm" data-reviewsign="${c.id}">${c.status === "signed" ? "View" : "Review & sign"}</button>
              </div>
            </div>`).join("")
            : `<div style="grid-column:1/-1">${U.empty("📄", "No contracts assigned to you yet.")}</div>`}
        </div>`;
    }

    const totalSigned = list.filter((c) => c.status === "signed").reduce((s, c) => s + (Number(c.value) || 0), 0);
    return `
      <div class="page-head">
        <div class="ph-text"><h1>Contracts</h1><p>Upload a document, preview it, choose the fields the signer fills, and assign it.</p></div>
        <div class="ph-actions"><button class="btn primary" id="addContract">⬆ Upload contract</button></div>
      </div>
      <div class="grid cols-4">
        ${stat({ label: "Total", value: list.length, icon: "📄", tone: "primary" })}
        ${stat({ label: "Awaiting signature", value: list.filter((c) => c.status === "invited").length, icon: "✍️", tone: "info" })}
        ${stat({ label: "Signed", value: list.filter((c) => c.status === "signed").length, icon: "✅", tone: "success" })}
        ${stat({ label: "Signed value", value: U.money(totalSigned), icon: "💰", tone: "warn" })}
      </div>
      <div class="card mt-24"><div class="card-head"><h3>All contracts</h3></div>
        <div class="table-wrap"><table class="tbl">
          <thead><tr><th>Contract</th><th>Assigned to</th><th>Value</th><th>Status</th><th>Sent</th><th>Signed</th><th></th></tr></thead>
          <tbody>${list.length ? list.map((c) => `
            <tr>
              <td><div class="row-main">${U.esc(c.title)}</div>${c.file_name ? `<div class="row-sub">📎 ${U.esc(c.file_name)}</div>` : ""}</td>
              <td>${U.esc(nameOf(c.assigned_to))}</td>
              <td class="muted">${c.value ? U.money(c.value) : "—"}</td>
              <td>${U.badge(c.status)}</td>
              <td class="muted nowrap">${c.sent_at ? U.dateShort(c.sent_at) : "—"}</td>
              <td class="muted nowrap">${c.signed_at ? U.dateShort(c.signed_at) : "—"}</td>
              <td><div class="flex gap-8 nowrap">
                ${c.file_url ? `<button class="btn sm ghost" data-placefields="${c.id}">Place fields</button>` : ""}
                ${c.status === "signed" ? `<button class="btn sm" data-viewsigned="${c.id}">View signed</button>` : (c.file_url ? `<button class="btn sm ghost" data-preview="${c.id}">Preview</button>` : "")}
                ${(c.status === "draft" || c.status === "expired") ? `<button class="btn sm primary" data-invite="${c.id}">📨 Send to sign</button>` : ""}
                ${c.status === "invited" ? `<button class="btn sm" data-invite="${c.id}">Resend</button>` : ""}
                <button class="btn sm ghost" data-del="${c.id}" style="color:var(--danger)">Delete</button>
              </div></td>
            </tr>`).join("")
            : `<tr><td colspan="7">${U.empty("📄", "No contracts yet. Upload one and assign it to a team member.")}</td></tr>`}
          </tbody></table></div></div>`;
  }
  function contractsDBMount(root) {
    const find = (id) => window.DB.contracts().find((x) => x.id === id);
    const placed = (c) => window.Esign && window.Esign.hasPlaced(c);
    root.querySelectorAll("[data-reviewsign]").forEach((b) => (b.onclick = () => {
      const c = find(b.dataset.reviewsign);
      if (c.status === "signed") { placed(c) ? Esign.openViewer(c) : openSignContract(c); return; }
      if (placed(c)) Esign.openSigner(c, window.DB.me(), async (vals) => { await window.DB.signContract(c, vals); U.toast("Signed ✓ — your admin was notified", "success"); window.App.rerender(); });
      else openSignContract(c);
    }));
    root.querySelectorAll("[data-viewsigned]").forEach((b) => (b.onclick = () => {
      const c = find(b.dataset.viewsigned);
      placed(c) ? Esign.openViewer(c) : openSignContract(c);
    }));
    root.querySelectorAll("[data-placefields]").forEach((b) => (b.onclick = () => {
      const c = find(b.dataset.placefields);
      Esign.openEditor(c, async (fields) => { await window.DB.updateContract(c.id, { fields, field_values: stampAdminSig(c.field_values, fields) }); U.toast("Fields saved", "success"); window.App.rerender(); });
    }));
    root.querySelectorAll("[data-preview]").forEach((b) => (b.onclick = () => {
      const c = find(b.dataset.preview);
      U.modal({ title: c.title, body: fileBody(c.file_url, c.file_name), footer: `${c.file_url ? `<a class="btn" href="${U.esc(c.file_url)}" target="_blank" rel="noopener">↗ Open</a>` : ""}<button class="btn primary" data-modal-close>Close</button>`, onMount: (card) => { card.style.width = "min(900px, calc(100vw - 32px))"; } });
    }));

    const addBtn = root.querySelector("#addContract");
    if (!addBtn) return;
    addBtn.onclick = openContractUpload;
    root.querySelectorAll("[data-invite]").forEach((b) => (b.onclick = async () => {
      const c = find(b.dataset.invite);
      const p = window.DB.profile(c.assigned_to);
      if (!p || !p.email) { U.toast("That member has no email on file (add one on their account)", "error"); return; }
      const me = window.DB.me(); const url = location.origin + location.pathname;
      const subject = `Please sign: ${c.title}`;
      const text = `Hi ${window.DB.displayName(p)},\n\nYou have a contract to review and sign: "${c.title}".\n\nSign in and open Contracts:\n${url}\n\nThanks,\n${window.DB.displayName(me)}`;
      const markSent = async () => { await window.DB.updateContract(c.id, { status: "invited", sent_at: new Date().toISOString() }); window.App.rerender(); };
      // Send automatically from the server (Resend); fall back to a Gmail compose window only if that's not set up.
      try {
        await window.DB.sendEmail({ to: p.email, subject, text });
        await markSent();
        U.toast("Email sent to " + p.email, "success");
      } catch (e) {
        window.open(`https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(p.email)}&su=${encodeURIComponent(subject)}&body=${encodeURIComponent(text)}`, "_blank");
        await markSent();
        U.toast("Auto-send not set up (" + (e.message || e) + ") — opened Gmail instead", "");
      }
    }));
    root.querySelectorAll("[data-del]").forEach((b) => (b.onclick = () =>
      U.confirm("Delete this contract?", async () => { await window.DB.removeContract(b.dataset.del); U.toast("Deleted"); window.App.rerender(); })));
  }

  // ---- Team in logged-in (Supabase) mode ----
  function teamDB() {
    const me = window.DB.me();
    const list = window.DB.profiles();
    const admins = list.filter((p) => p.role === "admin").length;
    return `
      <div class="page-head">
        <div class="ph-text"><h1>Team</h1><p>Everyone in your workspace. Use “View as” to open a member's account.</p></div>
        <div class="ph-actions"><button class="btn primary" id="addEmployee">＋ Add employee</button><button class="btn" id="invitePeople">✉ Invite (self sign-up)</button></div>
      </div>

      <div class="grid cols-4">
        ${stat({ label: "People", value: list.length, icon: "👥", tone: "primary" })}
        ${stat({ label: "Admins", value: admins, icon: "🛡", tone: "info" })}
        ${stat({ label: "Employees", value: list.length - admins, icon: "🧑‍💼", tone: "warn" })}
        ${stat({ label: "Active", value: list.filter((p) => (p.status || "active") === "active").length, icon: "🟢", tone: "success" })}
      </div>

      <div class="grid cols-3 mt-24">
        ${list.length ? list.map((m) => `
          <div class="card card-pad">
            <div class="flex between center">
              <div class="flex gap-12 center">
                <div class="avatar" style="width:46px;height:46px;font-size:16px">${dbAvatar(m)}</div>
                <div><div class="row-main">${U.esc(window.DB.displayName(m))}${m.id === me.id ? ' <span class="faint">(you)</span>' : ""}</div><div class="row-sub">${U.esc(m.title || m.dept || m.email || "")}</div></div>
              </div>
              <span class="badge b-${m.role === "admin" ? "active" : "review"}">${U.cap(m.role || "employee")}</span>
            </div>
            <div class="flex gap-8 mt-16" style="flex-wrap:wrap">
              ${m.dept ? `<span class="chip">🏢 ${U.esc(m.dept)}</span>` : ""}
              ${m.email ? `<span class="chip">✉️ ${U.esc(m.email)}</span>` : ""}
              <span class="chip">${U.cap(m.status || "active")}</span>
            </div>
            <div class="flex between center mt-16">
              <span class="faint" style="font-size:12px">Joined ${U.date(m.created_at)}</span>
              <div class="flex gap-8">
                <button class="btn sm" data-editmember="${m.id}">Edit</button>
                ${m.id !== me.id ? `<button class="btn sm ghost" data-viewas="${m.id}">View as</button>
                  <button class="btn sm ghost" data-login="${m.id}">Login & password</button>
                  <button class="btn sm ghost" data-role="${m.id}" data-to="${m.role === "admin" ? "employee" : "admin"}">${m.role === "admin" ? "Make employee" : "Make admin"}</button>
                  <button class="btn sm ghost" data-remove="${m.id}" style="color:var(--danger)">Remove</button>` : ""}
              </div>
            </div>
          </div>`).join("")
          : `<div style="grid-column:1/-1">${U.empty("👥", "No one's joined yet. Invite someone to sign up.")}</div>`}
      </div>`;
  }
  function teamDBMount(root) {
    root.querySelector("#invitePeople").onclick = () => {
      U.formModal({
        title: "Invite someone",
        submitLabel: "Send invite",
        fields: [
          { name: "email", label: "Their email", type: "email", required: true, half: true },
          { name: "name", label: "Their name", half: true },
        ],
        onSubmit: async (data) => {
          const me = window.DB.me();
          const url = location.origin + location.pathname;
          const subject = `${window.DB.displayName(me)} invited you to the Workspace dashboard`;
          const text = `Hi ${data.name || ""},\n\nYou've been invited to join the team Workspace dashboard.\n\nCreate your account here:\n${url}\n\nThanks,\n${window.DB.displayName(me)}`;
          try {
            await window.DB.sendEmail({ to: data.email, subject, text });
            U.toast("Invite sent to " + data.email, "success");
          } catch (e) {
            window.open(`https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(data.email)}&su=${encodeURIComponent(subject)}&body=${encodeURIComponent(text)}`, "_blank");
            U.toast("Auto-send not set up (" + (e.message || e) + ") — opened Gmail instead", "");
          }
        },
      });
    };
    const addEmp = root.querySelector("#addEmployee");
    if (addEmp) addEmp.onclick = () => U.formModal({
      title: "Add employee",
      submitLabel: "Create account",
      values: { role: "employee" },
      fields: [
        { name: "full_name", label: "Full name", half: true },
        { name: "email", label: "Login email", type: "email", required: true, half: true },
        { name: "password", label: "Temporary password", required: true, half: true },
        { name: "role", label: "Role", type: "select", options: [{ value: "employee", label: "Employee" }, { value: "admin", label: "Admin" }], half: true },
      ],
      onSubmit: async (data) => {
        try { await window.DB.adminCreateUser(data); U.toast("Account created for " + data.email, "success"); window.App.rerender(); }
        catch (e) { U.toast("Couldn't create: " + (e.message || e), "error"); }
      },
    });
    root.querySelectorAll("[data-login]").forEach((b) => (b.onclick = () => {
      const m = window.DB.profile(b.dataset.login);
      U.formModal({
        title: "Login & password — " + window.DB.displayName(m),
        submitLabel: "Update login",
        values: { email: m.email || "" },
        fields: [
          { name: "email", label: "Login email", type: "email" },
          { name: "password", label: "New password (blank = keep current)", type: "password" },
        ],
        onSubmit: async (data) => {
          try { await window.DB.adminUpdateUser(m.id, { email: data.email, password: data.password }); U.toast("Login updated", "success"); window.App.rerender(); }
          catch (e) { U.toast("Couldn't update: " + (e.message || e), "error"); }
        },
      });
    }));
    root.querySelectorAll("[data-editmember]").forEach((b) => (b.onclick = () => {
      const m = window.DB.profile(b.dataset.editmember);
      U.formModal({
        title: "Edit " + window.DB.displayName(m),
        submitLabel: "Save",
        values: { full_name: m.full_name || "", title: m.title || "", email: m.email || "", dept: m.dept || "", id_number: m.id_number || "", phone: m.phone || "", location: m.location || "", role: m.role || "employee", status: m.status || "active", address: m.address || "" },
        fields: [
          { name: "full_name", label: "Full name", half: true },
          { name: "title", label: "Title", half: true },
          { name: "email", label: "Contact email", type: "email", half: true },
          { name: "dept", label: "Department", half: true },
          { name: "id_number", label: "ID number", half: true },
          { name: "phone", label: "Phone", half: true },
          { name: "location", label: "Location", half: true },
          { name: "role", label: "Role", type: "select", options: [{ value: "employee", label: "Employee" }, { value: "admin", label: "Admin" }], half: true },
          { name: "status", label: "Status", type: "select", options: [{ value: "active", label: "Active" }, { value: "away", label: "Away" }], half: true },
          { name: "address", label: "Address", type: "textarea" },
        ],
        onSubmit: async (data) => {
          try {
            await window.DB.updateProfile(m.id, data);
            if (m.id === window.DB.me().id && window.Auth) await window.Auth.reloadProfile();
            U.toast("Saved", "success"); window.App.refreshSidebarUser(); window.App.rerender();
          } catch (e) { U.toast("Couldn't save: " + (e.message || e), "error"); }
        },
      });
    }));
    root.querySelectorAll("[data-viewas]").forEach((b) => (b.onclick = () => {
      window.DB.viewAs = b.dataset.viewas;
      U.toast("Viewing " + window.DB.displayName(window.DB.profile(b.dataset.viewas)) + "'s account", "success");
      window.App.go("account");
    }));
    root.querySelectorAll("[data-role]").forEach((b) => (b.onclick = async () => {
      await window.DB.updateProfile(b.dataset.role, { role: b.dataset.to });
      U.toast("Role updated", "success"); window.App.rerender();
    }));
    root.querySelectorAll("[data-remove]").forEach((b) => (b.onclick = () =>
      U.confirm("Remove this person from the workspace? (Their login still exists but they lose access to data.)", async () => {
        await window.DB.removeProfile(b.dataset.remove); U.toast("Removed"); window.App.rerender();
      })));
  }

  window.Views = Views;
})();
