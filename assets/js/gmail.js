/* ============================================================
   Gmail — in-browser, read-only sync for Job Applications.
   Uses Google Identity Services (token flow) + Gmail REST API.
   No backend: the access token lives only in memory for the session.
   ============================================================ */
(function () {
  const S = window.Store;
  const SCOPE = "https://www.googleapis.com/auth/gmail.readonly";

  function gisReady() {
    return window.google && google.accounts && google.accounts.oauth2;
  }

  // Pop the Google consent screen and resolve with an access token.
  function getToken(clientId, scope) {
    return new Promise((resolve, reject) => {
      if (!gisReady())
        return reject(new Error("Google sign-in didn't load. Check your connection, then retry."));
      try {
        const client = google.accounts.oauth2.initTokenClient({
          client_id: clientId,
          scope: scope || SCOPE,
          callback: (resp) => {
            if (resp && resp.access_token) resolve(resp.access_token);
            else reject(new Error("Authorization was cancelled."));
          },
          error_callback: (err) =>
            reject(new Error(err && err.message ? err.message : "Authorization error.")),
        });
        client.requestAccessToken({ prompt: "" });
      } catch (e) {
        reject(e);
      }
    });
  }

  async function api(url, token) {
    const r = await fetch(url, { headers: { Authorization: "Bearer " + token } });
    if (r.status === 401 || r.status === 403)
      throw new Error("Gmail denied access. Check the OAuth Client ID, that Gmail API is enabled, and that you're a test user.");
    if (!r.ok) throw new Error("Gmail API error " + r.status);
    return r.json();
  }

  // ---- classification heuristics ----
  const RX = {
    rejected: /unfortunately|we regret|regret to inform|not (be )?moving forward|won'?t be moving forward|decided (not|to not)|other candidates|move forward with other|position (has been|was) filled|not be (proceeding|progressing)|not selected|will not be progressing|pursue other candidates|after careful (consideration|review)/i,
    offer: /pleased to offer|excited to offer|offer letter|extend (you )?an offer|job offer|formally offer|happy to offer|offer of employment/i,
    interview: /interview|phone screen|technical screen|schedule (a|some) time|set up a (call|time|chat)|your availability|next steps|like to (chat|talk|speak|meet|connect)|video call|hiring manager would|recruiter (call|chat|screen)/i,
    applied: /thank you for applying|thanks for applying|application (has been )?received|we(?:'| ha)ve received your application|successfully (applied|submitted)|application (was )?submitted|received your application|application confirmation|thank you for your (interest|application)|we got your application/i,
  };

  function classify(text) {
    if (RX.rejected.test(text)) return "rejected";
    if (RX.offer.test(text)) return "offer";
    if (RX.interview.test(text)) return "interview";
    if (RX.applied.test(text)) return "applied";
    return null; // not a job email we recognize
  }

  function getHeader(headers, name) {
    const h = headers.find((x) => x.name.toLowerCase() === name.toLowerCase());
    return h ? h.value : "";
  }

  const ATS = /(greenhouse|lever|workday|myworkday|icims|smartrecruiters|ashbyhq|jobvite|taleo|bamboohr|gmail|googlemail|noreply|no-reply|linkedin|indeed|ziprecruiter|hire|recruit)/i;

  function parseCompany(from, subject) {
    let name = from.replace(/<[^>]*>/, "").replace(/["']/g, "").trim();
    const domMatch = from.match(/<[^@]*@([^>]+)>/) || from.match(/@([^\s>]+)/) || [];
    const domain = (domMatch[1] || "").toLowerCase();
    let company = name
      .replace(/\b(careers?|recruiting|recruitment|talent|hr|jobs?|hiring|team|notifications?|no-?reply|the|via .*)\b/gi, "")
      .replace(/[|@•·].*$/, "")
      .replace(/\s*-\s*.*$/, "")
      .trim();
    if ((!company || company.length < 2) && domain && !ATS.test(domain)) company = domain.split(".")[0];
    if (!company || company.length < 2) {
      const m = subject.match(/\bat\s+([A-Z][\w&.\- ]{1,40})/);
      if (m) company = m[1].trim();
    }
    company = company.replace(/\s{2,}/g, " ").trim();
    return company ? company.replace(/\b\w/g, (c) => c.toUpperCase()) : (domain || "Unknown");
  }

  function parseRole(subject) {
    const m =
      subject.match(/apply(?:ing)? (?:to|for)(?: the)?\s+(.+?)(?:\s+(?:at|with|position|role)\b|[-|]|$)/i) ||
      subject.match(/application (?:for|to)(?: the)?\s+(.+?)(?:\s+(?:at|with|position|role)\b|[-|]|$)/i) ||
      subject.match(/your\s+(.+?)\s+application/i);
    if (m) {
      const r = m[1].trim();
      if (r.length > 2 && r.length < 60) return r.replace(/\b\w/g, (c) => c.toUpperCase());
    }
    return "";
  }

  const RANK = { applied: 1, interview: 2, offer: 3, rejected: 3 };

  async function sync({ onProgress } = {}) {
    const clientId = (S.get().profile.gmailClientId || "").trim();
    if (!clientId) throw new Error("NO_CLIENT_ID");

    onProgress && onProgress("Requesting Google authorization…");
    const token = await getToken(clientId);

    onProgress && onProgress("Searching your inbox…");
    const q = encodeURIComponent(
      'newer_than:1y (subject:(application OR applying OR interview OR offer OR "thank you for applying") OR "your application" OR "application received" OR "we received your application" OR "regret to inform" OR "pleased to offer")'
    );
    const list = await api(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=100&q=${q}`,
      token
    );
    const ids = (list.messages || []).map((m) => m.id);

    const synced = new Set(S.get().gmailSyncedIds || []);
    const apps = S.get().applications;
    let added = 0, updated = 0;

    for (let i = 0; i < ids.length; i++) {
      const id = ids[i];
      onProgress && onProgress(`Reading message ${i + 1} of ${ids.length}…`);
      if (synced.has(id)) continue;
      synced.add(id);
      let msg;
      try {
        msg = await api(
          `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`,
          token
        );
      } catch (e) {
        continue;
      }
      const headers = (msg.payload && msg.payload.headers) || [];
      const from = getHeader(headers, "From");
      const subject = getHeader(headers, "Subject");
      const dateStr = getHeader(headers, "Date");
      const snippet = msg.snippet || "";
      const status = classify(subject + " " + snippet);
      if (!status) continue;

      const company = parseCompany(from, subject);
      const role = parseRole(subject) || (subject || "").slice(0, 50) || "Unknown role";
      const when = dateStr ? new Date(dateStr).toISOString() : new Date().toISOString();

      const existing = apps.find(
        (a) => a.company && a.company.toLowerCase() === company.toLowerCase()
      );
      if (existing) {
        const advance = (RANK[status] || 0) >= (RANK[existing.status] || 0);
        if (advance) {
          S.update("applications", existing.id, {
            status,
            notes: (existing.notes ? existing.notes + "\n" : "") + "Gmail: " + subject,
          });
          updated++;
        }
      } else {
        S.add("applications", {
          company, role, status, location: "", salary: "", source: "Gmail",
          applied: when, notes: "Imported from Gmail: " + subject, interviewDate: null,
        });
        added++;
      }
    }

    S.get().gmailSyncedIds = [...synced];
    S.get().profile.gmailLastSync = new Date().toISOString();
    S.save();
    return { added, updated, scanned: ids.length };
  }

  // Send an email FROM the signed-in Google account (no backend).
  async function sendEmail(to, subject, text) {
    const clientId = (S.get().profile.gmailClientId || "").trim();
    if (!clientId) throw new Error("NO_CLIENT_ID");
    const token = await getToken(clientId, "https://www.googleapis.com/auth/gmail.send");
    const mime = `To: ${to}\r\nSubject: ${subject}\r\nContent-Type: text/plain; charset="UTF-8"\r\n\r\n${text}`;
    const raw = btoa(unescape(encodeURIComponent(mime))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const r = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
      method: "POST",
      headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
      body: JSON.stringify({ raw }),
    });
    if (!r.ok) { const t = await r.text(); throw new Error("Gmail send " + r.status + ": " + t.slice(0, 160)); }
    return r.json();
  }

  window.Gmail = { sync, sendEmail };
})();
