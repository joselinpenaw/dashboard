/* ============================================================
   UI — shared helpers: format, modal, toast, dom
   ============================================================ */
(function () {
  const UI = {};

  // ---- escaping & dom ----
  UI.esc = (s) =>
    String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  UI.el = (html) => {
    const t = document.createElement("template");
    t.innerHTML = html.trim();
    return t.content.firstElementChild;
  };

  // ---- formatting ----
  UI.money = (n, dec = 0) =>
    "$" + Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: dec, maximumFractionDigits: dec });

  UI.date = (iso) => {
    if (!iso) return "—";
    const d = new Date(iso);
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  };
  UI.dateShort = (iso) => {
    if (!iso) return "—";
    return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  };
  UI.time = (iso) => {
    if (!iso) return "—";
    return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  };
  UI.ago = (iso) => {
    if (!iso) return "—";
    const s = Math.floor((Date.now() - new Date(iso)) / 1000);
    if (s < 60) return "just now";
    const m = Math.floor(s / 60); if (m < 60) return m + "m ago";
    const h = Math.floor(m / 60); if (h < 24) return h + "h ago";
    const d = Math.floor(h / 24); if (d < 30) return d + "d ago";
    const mo = Math.floor(d / 30); if (mo < 12) return mo + "mo ago";
    return Math.floor(mo / 12) + "y ago";
  };
  UI.until = (iso) => {
    if (!iso) return "—";
    const d = Math.ceil((new Date(iso) - Date.now()) / 864e5);
    if (d === 0) return "today";
    if (d < 0) return Math.abs(d) + "d ago";
    return "in " + d + "d";
  };
  UI.hours = (ms) => {
    const h = ms / 36e5;
    return h.toFixed(1) + "h";
  };
  UI.dur = (ms) => {
    const total = Math.max(0, Math.floor(ms / 1000));
    const h = String(Math.floor(total / 3600)).padStart(2, "0");
    const m = String(Math.floor((total % 3600) / 60)).padStart(2, "0");
    const s = String(total % 60).padStart(2, "0");
    return `${h}:${m}:${s}`;
  };
  UI.fileSize = (b) => {
    if (b < 1024) return b + " B";
    if (b < 1048576) return (b / 1024).toFixed(0) + " KB";
    return (b / 1048576).toFixed(1) + " MB";
  };
  UI.initials = (name) =>
    String(name || "?").trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase();

  UI.cap = (s) => String(s || "").charAt(0).toUpperCase() + String(s || "").slice(1);

  UI.badge = (status) =>
    `<span class="badge b-${UI.esc(status)}">${UI.cap(status)}</span>`;

  // ---- toast ----
  UI.toast = (msg, type = "") => {
    const host = document.getElementById("toastHost");
    const t = UI.el(`<div class="toast ${type}">${type === "success" ? "✓ " : type === "error" ? "✕ " : ""}${UI.esc(msg)}</div>`);
    host.appendChild(t);
    setTimeout(() => { t.style.opacity = "0"; t.style.transform = "translateY(8px)"; t.style.transition = "all .25s"; }, 2600);
    setTimeout(() => t.remove(), 2900);
  };

  // ---- modal ----
  let onClose = null;
  UI.modal = ({ title, body, footer, onMount }) => {
    const host = document.getElementById("modalHost");
    const card = document.getElementById("modalCard");
    card.innerHTML = `
      <div class="m-head">
        <h3>${UI.esc(title)}</h3>
        <button class="icon-btn" data-modal-close style="margin-left:auto">✕</button>
      </div>
      <div class="m-body">${body}</div>
      ${footer ? `<div class="m-foot">${footer}</div>` : ""}`;
    host.classList.add("open");
    host.setAttribute("aria-hidden", "false");
    if (onMount) onMount(card);
    card.querySelectorAll("[data-modal-close]").forEach((b) => (b.onclick = UI.closeModal));
    document.getElementById("modalBackdrop").onclick = UI.closeModal;
  };
  UI.closeModal = () => {
    const host = document.getElementById("modalHost");
    host.classList.remove("open");
    host.setAttribute("aria-hidden", "true");
    document.getElementById("modalCard").innerHTML = "";
  };

  UI.confirm = (msg, onYes, { danger = true, yes = "Delete" } = {}) => {
    UI.modal({
      title: "Are you sure?",
      body: `<p class="muted">${UI.esc(msg)}</p>`,
      footer: `<button class="btn" data-modal-close>Cancel</button>
               <button class="btn ${danger ? "danger" : "primary"}" id="confirmYes">${UI.esc(yes)}</button>`,
      onMount: (card) => {
        card.querySelector("#confirmYes").onclick = () => { UI.closeModal(); onYes(); };
      },
    });
  };

  // Build a form from field defs, return values on submit
  UI.formModal = ({ title, fields, values = {}, submitLabel = "Save", onSubmit }) => {
    const fieldHtml = fields
      .map((f) => {
        const v = values[f.name] ?? f.value ?? "";
        if (f.type === "textarea")
          return `<div class="field"><label>${UI.esc(f.label)}</label><textarea name="${f.name}" placeholder="${UI.esc(f.placeholder || "")}">${UI.esc(v)}</textarea></div>`;
        if (f.type === "select")
          return `<div class="field"><label>${UI.esc(f.label)}</label><select name="${f.name}">${f.options
            .map((o) => `<option value="${UI.esc(o.value)}" ${String(v) === String(o.value) ? "selected" : ""}>${UI.esc(o.label)}</option>`)
            .join("")}</select></div>`;
        const t = f.type || "text";
        return `<div class="field"><label>${UI.esc(f.label)}</label><input type="${t}" name="${f.name}" placeholder="${UI.esc(f.placeholder || "")}" value="${UI.esc(v)}" ${f.required ? "required" : ""}/></div>`;
      });
    // group pairs marked with f.half into rows
    let body = "<form id='modalForm'>";
    for (let i = 0; i < fields.length; i++) {
      if (fields[i].half && fields[i + 1] && fields[i + 1].half) {
        body += `<div class="field-row">${fieldHtml[i]}${fieldHtml[i + 1]}</div>`;
        i++;
      } else body += fieldHtml[i];
    }
    body += "</form>";

    UI.modal({
      title,
      body,
      footer: `<button class="btn" data-modal-close>Cancel</button>
               <button class="btn primary" id="formSubmit">${UI.esc(submitLabel)}</button>`,
      onMount: (card) => {
        const form = card.querySelector("#modalForm");
        const submit = () => {
          const data = {};
          fields.forEach((f) => {
            const node = form.elements[f.name];
            data[f.name] = node ? node.value.trim() : "";
          });
          const missing = fields.find((f) => f.required && !data[f.name]);
          if (missing) { UI.toast("Please fill in " + missing.label, "error"); return; }
          UI.closeModal();
          onSubmit(data);
        };
        card.querySelector("#formSubmit").onclick = submit;
        form.onsubmit = (e) => { e.preventDefault(); submit(); };
        const first = form.querySelector("input,select,textarea");
        if (first) first.focus();
      },
    });
  };

  UI.empty = (icon, text, actionHtml = "") =>
    `<div class="empty"><div class="em-ico">${icon}</div><p>${UI.esc(text)}</p>${actionHtml}</div>`;

  window.UI = UI;

  // Global ESC to close modal
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") UI.closeModal();
  });
})();
