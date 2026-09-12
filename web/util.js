/* Khata Sathi - utilities: icons, formatting, Devanagari digits, toasts, modals */
"use strict";

/* ---------- icons (inline SVG, no dependency) ---------- */
const ICONS = {
  dash: '<path d="M3 13h8V3H3v10zm10 8h8V11h-8v10zM3 21h8v-6H3v6zM13 3v6h8V3h-8z"/>',
  people: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  cam: '<path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/>',
  wallet: '<path d="M21 12V7H5a2 2 0 0 1 0-4h14v4"/><path d="M3 5v14a2 2 0 0 0 2 2h16v-5"/><path d="M18 12a2 2 0 0 0 0 4h4v-4z"/>',
  clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.08a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h.08a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.08a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
  doc: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M16 13H8"/><path d="M16 17H8"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  back: '<path d="M19 12H5M12 19l-7-7 7-7"/>',
  qr: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3h-3zM21 14v.01M14 21v.01M21 21v.01M17.5 17.5h.01"/>',
  moon: '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>',
  sun: '<circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/>',
  out: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/>',
  check: '<path d="M20 6L9 17l-5-5"/>',
  x: '<path d="M18 6L6 18M6 6l12 12"/>',
  warn: '<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><path d="M12 9v4M12 17h.01"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>',
  bill: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M16 13H8"/><path d="M16 17H8"/>',
  money: '<circle cx="12" cy="12" r="10"/><path d="M12 6v12M15.5 9.5c-.5-1-1.5-1.5-3.5-1.5s-3 .8-3 2 1 1.8 3 2.2 3 1 3 2.2-1.2 2-3 2-3-.5-3.5-1.5"/>',
  undo: '<path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6.36 2.64L3 13"/>',
  trash: '<path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/>',
  edit: '<path d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z"/>',
  share: '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.59 13.51l6.83 3.98M15.41 6.51l-6.82 3.98"/>',
  dl: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5 5 5-5"/><path d="M12 15V3"/>',
  up: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M17 8l-5-5-5 5"/><path d="M12 3v12"/>',
  bell: '<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>',
  send: '<path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4z"/>',
  phone: '<rect x="5" y="2" width="14" height="20" rx="2"/><path d="M12 18h.01"/>',
  filter: '<path d="M22 3H2l8 9.46V19l4 2v-8.54z"/>',
  chart: '<path d="M18 20V10M12 20V4M6 20v-6"/>',
  eye: '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>',
  merge: '<path d="M8 3v4a4 4 0 0 0 4 4h8"/><path d="M16 21v-4a4 4 0 0 0-4-4H4"/><path d="M18 7l2-2-2-2"/><path d="M18 17l2 2-2 2"/>',
  camera_retake: '<path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/>',
  whatsapp: '<path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2z"/><path d="M8.5 8.5c.3-.7.6-.7.9-.7h.6c.2 0 .5 0 .7.5l1 2.3c.2.4 0 .7-.2 1l-.5.6c-.2.2-.4.4-.1.8.3.4 1.1 1.4 2.2 1.9.5.3.8.3 1.1-.1l.5-.7c.2-.3.5-.3.8-.2l2.1 1c.3.2.5.3.5.6 0 1.1-1 2.2-2.1 2.3-1 .1-2.2.1-4.4-1.3-2.4-1.5-3.5-3.8-3.7-4.5-.2-.7-.4-1.6-.3-2.2 0-.6.2-1 .3-1.3z" fill="currentColor" stroke="none"/>',
  minus: '<path d="M5 12h14"/>',
};

function ico(name) {
  const p = ICONS[name] || ICONS.info;
  return '<span class="ico"><svg viewBox="0 0 24 24" aria-hidden="true">' + p + '</svg></span>';
}

/* ---------- Devanagari digits <-> ASCII ---------- */
const DEV_MAP = { "०": "0", "१": "1", "२": "2", "३": "3", "४": "4", "५": "5", "६": "6", "७": "7", "८": "8", "९": "9" };

function devToAscii(s) {
  return String(s).replace(/[०-९]/g, (d) => DEV_MAP[d]);
}

function toAmountFloat(s) {
  let t = devToAscii(String(s || "")).replace(/[रूRs,\s]/g, "");
  // "1.2.3" is a typo, not 1.2 — refuse instead of silently reading it wrong
  if ((t.match(/\./g) || []).length > 1) return null;
  const f = parseFloat(t);
  return isNaN(f) ? null : f;
}

/* ---------- money + date format ---------- */
function fmtMoney(v, signed) {
  const f = Math.round((parseFloat(v) || 0) * 100) / 100;
  const abs = Math.abs(f);
  const str = abs.toLocaleString("en-IN", { minimumFractionDigits: f % 1 ? 2 : 0, maximumFractionDigits: 2 });
  const sign = f < 0 ? "-" : (signed && f > 0 ? "+" : "");
  return sign + "रू " + str;
}

function fmtDate(iso) {
  if (!iso) return "";
  const d = new Date(iso + (iso.length === 10 ? "T00:00:00" : ""));
  if (isNaN(d)) return iso;
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function fmtDateTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d)) return iso;
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" }) + ", " +
    d.toLocaleTimeString("en-GB", { hour: "numeric", minute: "2-digit" });
}

function timeAgo(iso) {
  const d = new Date(iso);
  const s = (Date.now() - d.getTime()) / 1000;
  if (isNaN(s)) return "";
  if (s < 60) return "just now";
  if (s < 3600) return Math.floor(s / 60) + "m ago";
  if (s < 86400) return Math.floor(s / 3600) + "h ago";
  const days = Math.floor(s / 86400);
  if (days < 30) return days + "d ago";
  return fmtDate(iso);
}

function daysSince(iso) {
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86400000));
}

function initials(name) {
  const parts = String(name).trim().split(/\s+/);
  let s = (parts[0] || "?").charAt(0);
  if (parts.length > 1) s += parts[parts.length - 1].charAt(0);
  return s.toUpperCase();
}

const AVATAR_HUES = [244, 160, 12, 348, 208, 268, 20, 100, 320, 52];
function avatarBg(name) {
  let h = 0;
  for (const ch of String(name)) h = (h * 31 + ch.codePointAt(0)) % 997;
  return AVATAR_HUES[h % AVATAR_HUES.length];
}

function avatarEl(name, size) {
  const hue = avatarBg(name);
  const s = size || 34;
  return '<div class="avatar" style="width:' + s + 'px;height:' + s + 'px;' +
    'background:hsl(' + hue + ',62%,88%);color:hsl(' + hue + ',52%,32%)">' + escapeHtml(initials(name)) + '</div>';
}

/* ---------- escape ---------- */
function escapeHtml(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

/* ---------- toasts ---------- */
function toast(msg, kind, ms) {
  const wrap = document.getElementById("toasts");
  const el = document.createElement("div");
  el.className = "toast " + (kind || "ok");
  const ic = kind === "err" ? "warn" : (kind === "warn" ? "warn" : "check");
  el.innerHTML = '<span class="t-ico">' + (kind === "err" || kind === "warn" ? ico("warn") : ico("check")) + '</span><span>' + escapeHtml(msg) + "</span>";
  wrap.appendChild(el);
  const life = ms || (kind === "err" ? 5200 : 3000);
  setTimeout(() => { el.classList.add("out"); setTimeout(() => el.remove(), 260); }, life);
}

/* ---------- modal ---------- */
function modal(opts) {
  const root = document.getElementById("modal-root");
  /* one dialog at a time, always: a new modal replaces any open one.
     Stacked overlays were the "close it three times" bug — never again. */
  const prev = root.querySelector(".modal-overlay");
  if (prev) prev.remove();
  const ov = document.createElement("div");
  ov.className = "modal-overlay";
  ov.innerHTML =
    '<div class="modal' + (opts.wide ? " wide" : "") + '">' +
    '<div class="modal-head"><div class="modal-title">' + (opts.title || "") + '</div>' +
    '<button class="icon-btn modal-x" data-x>' + ico("x") + '</button></div>' +
    '<div class="modal-body"></div>' +
    (opts.buttons ? '<div class="modal-foot"></div>' : "") +
    "</div>";
  root.appendChild(ov);
  const body = ov.querySelector(".modal-body");
  if (typeof opts.body === "string") body.innerHTML = opts.body;
  else if (opts.body) body.appendChild(opts.body);
  let escHandler = null;
  const close = () => {
    ov.remove();
    if (escHandler) document.removeEventListener("keydown", escHandler);
    if (opts.onClose) opts.onClose();
  };
  ov.querySelector("[data-x]").onclick = close;
  ov.addEventListener("mousedown", (e) => { if (e.target === ov && opts.dismissable !== false) close(); });
  escHandler = (e) => { if (e.key === "Escape") close(); };
  if (opts.dismissable !== false) document.addEventListener("keydown", escHandler);
  if (opts.buttons) {
    const foot = ov.querySelector(".modal-foot");
    opts.buttons.forEach((b) => {
      const btn = document.createElement("button");
      btn.className = "btn " + (b.cls || "");
      btn.innerHTML = (b.icon ? ico(b.icon) : "") + escapeHtml(b.label);
      btn.onclick = () => {
        if (b.keepOpen !== true) close();
        if (b.onClick) b.onClick(ov, close);
      };
      foot.appendChild(btn);
    });
  }
  return { el: ov, close, body };
}

/* ---------- confirm (money-app style: always ask) ---------- */
function confirmModal(title, msg, okLabel, onOk, danger) {
  modal({
    title: title,
    body: '<div style="font-size:14px;color:var(--ink-2);line-height:1.55">' + msg + "</div>",
    buttons: [
      { label: "Cancel", cls: "ghost" },
      { label: okLabel || "Confirm", cls: danger ? "danger" : "primary", onClick: onOk },
    ],
  });
}

/* ---------- lightbox ---------- */
function lightbox(src) {
  const lb = document.getElementById("lightbox");
  document.getElementById("lightbox-img").src = src;
  lb.classList.remove("hidden");
  lb.onclick = () => lb.classList.add("hidden");
}

/* ---------- debounce ---------- */
function debounce(fn, ms) {
  let t;
  return function () {
    clearTimeout(t);
    const args = arguments;
    t = setTimeout(() => fn.apply(this, args), ms);
  };
}

/* ---------- WhatsApp share (mobile + desktop) ----------
   Mobile: native share sheet with the PDF as a file — WhatsApp is one tap.
   Desktop: download the PDF, then open WhatsApp Web's chat picker.
   Both get a text copy on the clipboard as the fallback. */
async function whatsappShare(pdfUrl, text, filenameHint) {
  let file = null;
  try {
    const resp = await fetch(pdfUrl, { headers: { Authorization: "Bearer " + API.token } });
    if (resp.ok) {
      const buf = await resp.arrayBuffer();
      const name = filenameHint || "bill.pdf";
      file = new File([buf], name, { type: "application/pdf" });
    }
  } catch (e) { /* fall through to text-only */ }

  const nav = navigator;
  if (nav.share && file && nav.canShare && nav.canShare({ files: [file] })) {
    try {
      await nav.share({ files: [file], title: name_of(text), text: text });
      return "shared";
    } catch (e) {
      if (e.name === "AbortError") return "cancelled";
      /* fall through to link route */
    }
  }

  /* desktop / no native share: download + WhatsApp Web */
  const a = document.createElement("a");
  a.href = pdfUrl;
  a.setAttribute("download", "");
  document.body.appendChild(a);
  a.click();
  a.remove();
  try {
    await navigator.clipboard.writeText(text);
  } catch (e) { /* best effort */ }
  const phoneMatch = text.match(/(?:^|\s)(\+?\d{8,14})(?=\s|$)/);
  let url = "https://web.whatsapp.com/send";
  if (phoneMatch) url += "?phone=" + encodeURIComponent(phoneMatch[1]);
  let opened = false;
  try { opened = window.open(url, "_blank"); } catch (e) { /* popup blocked */ }
  if (!opened) {
    /* popup blocked: tell the user plainly */
    toast("PDF downloaded — open web.whatsapp.com to send it (text copied)", "warn", 5200);
  } else {
    toast("PDF downloaded · WhatsApp Web opened · bill text copied", "ok", 4200);
  }
  return "desktop";
}

function name_of(text) {
  const m = text.match(/for ([^\n·]+)/i);
  return m ? m[1].trim() : "Bill PDF";
}
