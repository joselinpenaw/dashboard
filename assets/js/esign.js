/* ============================================================
   Esign — render a document (PDF via pdf.js, or image) and let the
   admin PLACE fields on it; the employee fills them in place and signs.
   Field = { id, type, page, x, y, w, h }  (x/y/w/h are % of the page)
   ============================================================ */
(function () {
  const U = window.UI;
  const Esign = {};
  const TYPES = { name: "Full name", email: "Email", phone: "Phone", address: "Address", date: "Date", signature: "Signature", admin_sig: "Company signature", text: "Text" };

  function ensureWorker() {
    if (window.pdfjsLib && pdfjsLib.GlobalWorkerOptions)
      pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
  }
  function dataURLtoU8(d) {
    const b64 = (d || "").split(",")[1] || "";
    const bin = atob(b64); const u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    return u;
  }
  const isPdf = (c) => /\.pdf$/i.test(c.file_name || "") || (c.file_url || "").startsWith("data:application/pdf");
  const isImg = (c) => /\.(png|jpe?g|gif|webp|svg)$/i.test(c.file_name || "") || (c.file_url || "").startsWith("data:image");
  Esign.hasPlaced = (c) => !!(c.fields && c.fields.length && typeof c.fields[0] === "object" && "x" in c.fields[0]);

  async function renderPages(host, c) {
    host.innerHTML = "";
    const pages = [];
    if (!c.file_url) { host.innerHTML = `<div class="empty"><div class="em-ico">📄</div><p>No document uploaded for this contract.</p></div>`; return pages; }
    if (isPdf(c) && window.pdfjsLib) {
      ensureWorker();
      try {
        const pdf = await pdfjsLib.getDocument({ data: dataURLtoU8(c.file_url) }).promise;
        const width = Math.min(800, host.clientWidth || 800);
        for (let i = 1; i <= pdf.numPages; i++) {
          const page = await pdf.getPage(i);
          const base = page.getViewport({ scale: 1 });
          const vp = page.getViewport({ scale: width / base.width });
          const wrap = document.createElement("div");
          wrap.style.cssText = `position:relative;width:${vp.width}px;height:${vp.height}px;margin:0 auto 14px;background:#fff;box-shadow:0 2px 10px rgba(0,0,0,.3)`;
          const cv = document.createElement("canvas"); cv.width = vp.width; cv.height = vp.height; cv.style.cssText = "width:100%;height:100%;display:block";
          wrap.appendChild(cv); host.appendChild(wrap);
          await page.render({ canvasContext: cv.getContext("2d"), viewport: vp }).promise;
          pages.push(wrap);
        }
      } catch (e) {
        host.innerHTML = `<div class="empty"><div class="em-ico">⚠️</div><p>Couldn't render this PDF here (${U.esc(e.message || e)}).</p></div>`;
      }
    } else if (isImg(c)) {
      const wrap = document.createElement("div");
      wrap.style.cssText = "position:relative;max-width:800px;margin:0 auto 14px";
      const img = document.createElement("img"); img.src = c.file_url; img.style.cssText = "width:100%;display:block;border-radius:6px";
      wrap.appendChild(img); host.appendChild(wrap);
      await new Promise((res) => { img.complete ? res() : (img.onload = res); });
      pages.push(wrap);
    } else {
      host.innerHTML = `<div class="empty"><div class="em-ico">📄</div><p>Field placement needs a PDF or image. Re-upload the document as a PDF.</p></div>`;
    }
    return pages;
  }

  // drag-to-move + corner-resize for a placed field (updates f.x/y/w/h in %)
  function makeInteractive(el, f, pg) {
    el.style.cursor = "move";
    el.style.touchAction = "none";
    const handle = document.createElement("div");
    handle.style.cssText = "position:absolute;right:-7px;bottom:-7px;width:15px;height:15px;background:#2dd4ff;border:2px solid #fff;border-radius:3px;cursor:nwse-resize;touch-action:none;z-index:2";
    el.appendChild(handle);
    let mode = null, sx = 0, sy = 0, ox = 0, oy = 0, ow = 0, oh = 0, rect = null;
    const onMove = (e) => {
      if (!mode) return;
      const dx = ((e.clientX - sx) / rect.width) * 100, dy = ((e.clientY - sy) / rect.height) * 100;
      if (mode === "move") {
        f.x = Math.max(0, Math.min(100 - f.w, ox + dx)); f.y = Math.max(0, Math.min(100 - f.h, oy + dy));
        el.style.left = f.x + "%"; el.style.top = f.y + "%";
      } else {
        f.w = Math.max(4, Math.min(100 - f.x, ow + dx)); f.h = Math.max(2, Math.min(100 - f.y, oh + dy));
        el.style.width = f.w + "%"; el.style.height = f.h + "%";
      }
    };
    const onUp = () => { mode = null; window.removeEventListener("pointermove", onMove); window.removeEventListener("pointerup", onUp); };
    const start = (e, m) => {
      mode = m; sx = e.clientX; sy = e.clientY; ox = f.x; oy = f.y; ow = f.w; oh = f.h; rect = pg.getBoundingClientRect();
      e.preventDefault(); e.stopPropagation();
      window.addEventListener("pointermove", onMove); window.addEventListener("pointerup", onUp);
    };
    el.addEventListener("pointerdown", (e) => { if (e.target.closest("[data-rm]") || e.target === handle) return; start(e, "move"); });
    handle.addEventListener("pointerdown", (e) => start(e, "resize"));
  }

  // ---- Admin: place fields ----
  Esign.openEditor = function (c, onSave) {
    let fields = (c.fields || []).filter((f) => f && f.type && typeof f.x === "number").map((f) => ({ ...f }));
    let active = "signature";
    U.modal({
      title: "Place fields — " + c.title,
      body: `
        <div class="flex gap-8" id="esTools" style="flex-wrap:wrap;margin-bottom:10px">
          ${Object.keys(TYPES).map((t) => `<button class="chip" data-type="${t}" style="cursor:pointer">${TYPES[t]}</button>`).join("")}
          <span class="faint" id="esHint" style="font-size:12px;align-self:center">Pick a field above, then click on the document to place it.</span>
        </div>
        <div id="esHost" style="max-height:62vh;overflow:auto;background:var(--surface-2);border-radius:8px;padding:10px"></div>`,
      footer: `<button class="btn" data-modal-close>Cancel</button><button class="btn primary" id="esSave">Save fields</button>`,
      onMount: async (card) => {
        card.style.width = "min(920px, calc(100vw - 32px))";
        const host = card.querySelector("#esHost");
        const tools = card.querySelectorAll("#esTools [data-type]");
        const hint = card.querySelector("#esHint");
        const paint = () => {
          tools.forEach((b) => (b.style.cssText = b.dataset.type === active
            ? "background:var(--primary);color:#04121c;border-color:var(--primary);cursor:pointer;font-weight:700"
            : "cursor:pointer"));
          if (hint) hint.textContent = active ? `Click once on the document to drop the “${TYPES[active]}” field.` : "Pick a field above and click to place it. Drag a field to move it; drag its corner to resize.";
        };
        tools.forEach((b) => (b.onclick = () => { active = (active === b.dataset.type ? null : b.dataset.type); paint(); }));
        active = null; paint();
        const pages = await renderPages(host, c);
        const draw = () => pages.forEach((pg, idx) => {
          pg.querySelectorAll(".esf").forEach((x) => x.remove());
          fields.filter((f) => f.page === idx).forEach((f) => {
            const el = document.createElement("div");
            el.className = "esf";
            el.style.cssText = `position:absolute;left:${f.x}%;top:${f.y}%;width:${f.w}%;height:${f.h}%;background:rgba(45,212,255,.25);border:1px solid #2dd4ff;border-radius:4px;font-size:11px;color:#04121c;display:flex;align-items:center;justify-content:center;font-weight:700`;
            el.innerHTML = `<span style="pointer-events:none">${TYPES[f.type] || f.type}</span><span data-rm style="position:absolute;top:-9px;right:-9px;background:#ff4d5e;color:#fff;border-radius:50%;width:18px;height:18px;line-height:18px;text-align:center;cursor:pointer;font-size:11px;z-index:2">✕</span>`;
            el.querySelector("[data-rm]").onclick = (ev) => { ev.stopPropagation(); fields = fields.filter((x) => x.id !== f.id); draw(); };
            pg.appendChild(el);
            makeInteractive(el, f, pg);
          });
        });
        pages.forEach((pg, idx) => pg.addEventListener("click", (e) => {
          if (!active) return;                       // no tool selected → ignore clicks
          if (e.target.closest(".esf")) return;      // clicking an existing field → ignore
          const r = pg.getBoundingClientRect();
          const x = ((e.clientX - r.left) / r.width) * 100, y = ((e.clientY - r.top) / r.height) * 100;
          const big = active === "signature" || active === "address";
          const w = big ? 22 : 16, h = big ? 7 : 4.2;
          fields.push({ id: Math.random().toString(36).slice(2, 8), type: active, page: idx, x: Math.max(0, Math.min(100 - w, x - w / 2)), y: Math.max(0, Math.min(100 - h, y - h / 2)), w, h });
          active = null; paint();                    // de-select after placing → prevents duplicates
          draw();
        }));
        draw();
        card.querySelector("#esSave").onclick = () => { U.closeModal(); onSave(fields); };
      },
    });
  };

  // ---- Employee: fill + sign in place ----
  Esign.openSigner = function (c, profile, onSubmit) {
    const fields = (c.fields || []).filter((f) => f && f.type);
    const prefill = { name: profile.full_name || "", email: profile.email || "", phone: profile.phone || "", address: profile.address || "", date: new Date().toLocaleDateString() };
    const values = { ...(c.field_values || {}) }; // keep already-stamped values (e.g. company signature)
    U.modal({
      title: "Review & sign — " + c.title,
      body: `<div id="esHost" style="max-height:64vh;overflow:auto;background:var(--surface-2);border-radius:8px;padding:10px"></div>
        <p class="faint" style="font-size:12px;margin-top:8px">Complete the highlighted fields on the document, then sign &amp; submit.</p>`,
      footer: `<button class="btn" data-modal-close>Cancel</button><button class="btn primary" id="esSubmit">✍ Sign & submit</button>`,
      onMount: async (card) => {
        card.style.width = "min(920px, calc(100vw - 32px))";
        const host = card.querySelector("#esHost");
        const pages = await renderPages(host, c);
        fields.forEach((f) => {
          const pg = pages[f.page]; if (!pg) return;
          const el = document.createElement("div");
          el.style.cssText = `position:absolute;left:${f.x}%;top:${f.y}%;width:${f.w}%;height:${f.h}%`;
          if (f.type === "admin_sig") {
            const av = values[f.id];
            el.innerHTML = av ? `<img src="${av}" style="width:100%;height:100%;object-fit:contain;background:rgba(255,255,255,.9);border:1px solid #2dd4ff;border-radius:4px"/>` : `<div style="width:100%;height:100%;border:1px solid #2dd4ff;border-radius:4px;font-size:9px;color:#333;display:flex;align-items:center;justify-content:center;background:rgba(255,255,255,.9)">Company signature</div>`;
          } else if (f.type === "signature") {
            if (profile.signature_url) { values[f.id] = profile.signature_url; el.innerHTML = `<img src="${profile.signature_url}" style="width:100%;height:100%;object-fit:contain;background:rgba(255,255,255,.9);border:1px solid #2dd4ff;border-radius:4px"/>`; }
            else el.innerHTML = `<div style="width:100%;height:100%;border:1px dashed #ff4d5e;border-radius:4px;font-size:9px;color:#b00;display:flex;align-items:center;justify-content:center;text-align:center;background:rgba(255,255,255,.92)">Add signature in My Account</div>`;
          } else {
            const v = prefill[f.type] || ""; values[f.id] = v;
            el.innerHTML = `<input data-fid="${f.id}" value="${U.esc(v)}" placeholder="${TYPES[f.type] || ""}" style="width:100%;height:100%;border:1px solid #2dd4ff;border-radius:4px;background:rgba(255,255,255,.96);color:#111;font-size:12px;padding:2px 4px;box-sizing:border-box"/>`;
          }
          pg.appendChild(el);
        });
        host.querySelectorAll("input[data-fid]").forEach((i) => (i.oninput = () => (values[i.dataset.fid] = i.value)));
        card.querySelector("#esSubmit").onclick = async () => {
          if (fields.some((f) => f.type === "signature") && !profile.signature_url) { U.toast("Add your signature in My Account first", "error"); return; }
          U.closeModal();
          await onSubmit(values);
        };
      },
    });
  };

  // ---- Read-only signed view ----
  Esign.openViewer = function (c) {
    const fields = (c.fields || []).filter((f) => f && f.type);
    const vals = c.field_values || {};
    U.modal({
      title: c.title + " — signed",
      body: `<div id="esHost" style="max-height:68vh;overflow:auto;background:var(--surface-2);border-radius:8px;padding:10px"></div>`,
      footer: `<button class="btn primary" data-modal-close>Close</button>`,
      onMount: async (card) => {
        card.style.width = "min(920px, calc(100vw - 32px))";
        const host = card.querySelector("#esHost");
        const pages = await renderPages(host, c);
        fields.forEach((f) => {
          const pg = pages[f.page]; if (!pg) return;
          const v = vals[f.id]; const el = document.createElement("div");
          el.style.cssText = `position:absolute;left:${f.x}%;top:${f.y}%;width:${f.w}%;height:${f.h}%`;
          if ((f.type === "signature" || f.type === "admin_sig") && v) el.innerHTML = `<img src="${v}" style="width:100%;height:100%;object-fit:contain"/>`;
          else el.innerHTML = `<div style="font-size:12px;color:#111;background:rgba(255,235,0,.35);border-radius:3px;padding:1px 4px;display:inline-block">${U.esc(v || "")}</div>`;
          pg.appendChild(el);
        });
      },
    });
  };

  window.Esign = Esign;
})();
