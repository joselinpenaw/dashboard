// Vercel serverless function — daily job search via the Adzuna API.
// Env vars (Vercel → Settings → Environment Variables): ADZUNA_APP_ID, ADZUNA_APP_KEY
// Runs a targeted query per role term (more reliable than one broad OR query),
// keeps only remote roles, tags each by category, and de-dupes.

const SEARCHES = [
  { term: "sales development representative", cat: "sales", tag: "SDR" },
  { term: "business development representative", cat: "sales", tag: "BDR" },
  { term: "SDR", cat: "sales", tag: "SDR" },
  { term: "BDR", cat: "sales", tag: "BDR" },
  { term: "medical coder", cat: "coding", tag: "Medical Coding" },
  { term: "medical coding", cat: "coding", tag: "Medical Coding" },
  { term: "medical billing", cat: "coding", tag: "Medical Coding" },
  { term: "risk adjustment coder", cat: "coding", tag: "Medical Coding" },
  { term: "coding specialist", cat: "coding", tag: "Medical Coding" },
];

export default async function handler(req, res) {
  const appId = process.env.ADZUNA_APP_ID;
  const appKey = process.env.ADZUNA_APP_KEY;
  if (!appId || !appKey) {
    res.status(500).json({ error: "Adzuna keys not configured. Add ADZUNA_APP_ID and ADZUNA_APP_KEY in Vercel → Settings → Environment Variables." });
    return;
  }

  const q = req.query || {};
  const country = (q.country || "us").toLowerCase();
  const pagesPer = Math.min(parseInt(q.pages || "2", 10) || 2, 5);
  const isRemote = (s) => /remote|work from home|wfh|anywhere|telecommute|virtual|home[- ]?based/.test(s);
  // only keep jobs whose title/description genuinely match the category
  const CAT_RE = {
    sales: /\b(sdr|bdr|sales development|business development|inside sales|account executive)\b/i,
    coding: /\b(cod(er|ers|ing)|medical bill|cpc\b|ccs\b|icd|risk adjustment|health information|\bhim\b)\b/i,
  };

  const jobs = [];
  try {
    for (const s of SEARCHES) {
      for (let p = 1; p <= pagesPer; p++) {
        const url =
          `https://api.adzuna.com/v1/api/jobs/${country}/search/${p}` +
          `?app_id=${encodeURIComponent(appId)}&app_key=${encodeURIComponent(appKey)}` +
          `&results_per_page=50&what=${encodeURIComponent(s.term)}` +
          `&max_days_old=40&sort_by=date&content-type=application/json`;
        const r = await fetch(url);
        if (!r.ok) break;
        const data = await r.json();
        const results = data.results || [];
        for (const o of results) {
          const title = (o.title || "").toLowerCase();
          const loc = ((o.location && o.location.display_name) || "").toLowerCase();
          const desc = (o.description || "").toLowerCase();
          const text = (o.title || "") + " " + (o.description || "");
          if (!isRemote((title + " " + loc + " " + desc))) continue;
          if (CAT_RE[s.cat] && !CAT_RE[s.cat].test(text)) continue; // drop loosely-related results
          jobs.push({
            id: String(o.id),
            company: (o.company && o.company.display_name) || "—",
            role: o.title || "Role",
            location: (o.location && o.location.display_name) || "Remote",
            salary: o.salary_min
              ? "$" + Math.round(o.salary_min / 1000) + "k" + (o.salary_max && o.salary_max !== o.salary_min ? "–$" + Math.round(o.salary_max / 1000) + "k" : "")
              : "—",
            type: o.contract_time === "part_time" ? "Part-time" : (o.contract_type === "contract" ? "Contract" : "Full-time"),
            tags: ["Remote", s.tag],
            posted: o.created,
            applyUrl: o.redirect_url || "",
          });
        }
        if (results.length < 50) break;
      }
    }

    const seen = new Set();
    const unique = jobs.filter((j) => (seen.has(j.id) ? false : (seen.add(j.id), true)));
    const counts = {
      sales: unique.filter((j) => j.tags.includes("SDR") || j.tags.includes("BDR")).length,
      coding: unique.filter((j) => j.tags.includes("Medical Coding")).length,
    };

    res.setHeader("Cache-Control", "s-maxage=86400, stale-while-revalidate=43200");
    res.status(200).json({ jobs: unique, count: unique.length, counts, fetched: new Date().toISOString() });
  } catch (e) {
    res.status(502).json({ error: "Adzuna request failed: " + String(e && e.message ? e.message : e) });
  }
}
