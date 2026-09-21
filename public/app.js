/* Khata Sathi - app shell: cloud auth, google sign-in, routing, nav, live sync, global search */
"use strict";

/* global API, Live, ico, toast, modal, escapeHtml, debounce, fmtMoney, fmtDate, avatarEl,
   Dashboard, People, Ledger, AddBill, Payment, Activity, Settings, BillMaker, Galla, LedgerView */

const GOOGLE_ICON_SVG = '<svg viewBox="0 0 24 24"><path fill="#4285F4" d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17z"/><path fill="#34A853" d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.1-6.72-4.93H1.25v3.15C3.26 21.36 7.34 24 12 24z"/><path fill="#FBBC05" d="M5.28 14.27c-.25-.72-.38-1.49-.38-2.27s.13-1.55.38-2.27V6.58H1.25C.45 8.18 0 9.98 0 12s.45 3.82 1.25 5.42l4.03-3.15z"/><path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.34 0 3.26 2.64 1.25 6.58l4.03 3.15c.95-2.83 3.6-4.98 6.72-4.98z"/></svg>';

const App = {
  state: { has_account: false, authenticated: false, user_id: null, store_name: "", seller_name: "" },
  views: {},
  current: null,
  currentParams: null,

  async boot() {
    this.registerViews();
    this.paintIcons();
    this.applyTheme(localStorage.getItem("bs_theme") || "light");
    window.addEventListener("bs-auth-expired", () => this.showAuth("login"));

    // Check for Google OAuth callback in URL hash or query params
    this.handleOAuthCallback();

    try {
      this.state = await API.get("/api/state");
    } catch (e) {
      document.body.innerHTML = '<div class="auth-wrap"><div class="panel panel-pad">Cannot reach the Khata Sathi cloud server.<br>Please check your internet connection.</div></div>';
      return;
    }

    if (!API.token && !this.state.authenticated) {
      this.showAuth("login");
    } else {
      this.showApp();
    }
  },

  handleOAuthCallback() {
    const hash = window.location.hash || "";
    const search = window.location.search || "";
    let accessToken = null;
    if (hash.includes("access_token=")) {
      const params = new URLSearchParams(hash.replace(/^#/, ""));
      accessToken = params.get("access_token");
    } else if (search.includes("access_token=")) {
      const params = new URLSearchParams(search);
      accessToken = params.get("access_token");
    }
    if (accessToken) {
      API.saveToken(accessToken);
      if (window.history && window.history.replaceState) {
        window.history.replaceState(null, "", window.location.pathname);
      }
    }
  },

  registerViews() {
    [Dashboard, People, Ledger, AddBill, BillMaker, Payment, Activity, Settings, Galla, LedgerView].forEach((v) => {
      this.views[v.id] = v;
    });
  },

  /* ---------- chrome ---------- */
  paintIcons() {
    document.querySelectorAll(".ico[data-icon]").forEach((el) => {
      const name = el.getAttribute("data-icon");
      el.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true">' + (ICONS[name] || ICONS.info) + "</svg>";
      el.removeAttribute("data-icon");
    });
  },

  applyTheme(t) {
    document.documentElement.setAttribute("data-theme", t);
    localStorage.setItem("bs_theme", t);
    document.querySelectorAll("[data-theme-label]").forEach((el) => (el.textContent = t === "dark" ? "Light mode" : "Dark mode"));
    const labels = document.querySelectorAll("#theme-label");
    labels.forEach((el) => (el.textContent = t === "dark" ? "Light mode" : "Dark mode"));
  },

  toggleTheme() {
    this.applyTheme(document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark");
    toast("Switched to " + (document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light") + " mode", "ok", 1600);
  },

  paintChrome() {
    document.getElementById("brand-store").textContent = this.state.store_name || "";
    document.getElementById("side-user").textContent = "Account: " + (this.state.seller_name || this.state.email || "Shop Owner");
    if (this._chromePainted) { this.markNav(); return; }
    this._chromePainted = true;
    const nav = document.getElementById("nav");
    const bottom = document.getElementById("bottom-nav");
    const navItems = [
      { v: "dash", label: "Dashboard", icon: "dash", mobile: true },
      { v: "people", label: "People", icon: "people", mobile: true },
      { v: "ledgerhub", label: "Ledger", icon: "bill", mobile: true },
      { v: "add", label: "Add bill", icon: "cam", mobile: true },
      { v: "billmaker", label: "Make bill", icon: "doc", mobile: true },
      { v: "galla", label: "Galla", icon: "wallet", mobile: true },
      { v: "activity", label: "Activity", icon: "clock", mobile: false },
      { v: "settings", label: "Settings", icon: "gear", mobile: false },
    ];
    nav.innerHTML = navItems.map((n) =>
      '<button class="nav-item" data-v="' + n.v + '">' + ico(n.icon) + "<span>" + n.label + "</span></button>").join("");

    bottom.innerHTML = '<div class="bn-row">' + navItems.filter((n) => n.mobile).map((n) =>
      '<button class="bn-item" data-v="' + n.v + '">' + ico(n.icon) + "<span>" + (n.v === "add" ? "Add" : n.label) + "</span></button>").join("") +
      '<button class="bn-item" data-v="more">' + ico("filter") + "<span>More</span></button></div>";

    nav.addEventListener("click", (e) => {
      const b = e.target.closest("[data-v]");
      if (b) this.go(b.getAttribute("data-v"));
    });
    bottom.addEventListener("click", (e) => {
      const b = e.target.closest("[data-v]");
      if (!b) return;
      if (b.getAttribute("data-v") === "more") { this.moreSheet(); return; }
      this.go(b.getAttribute("data-v"));
    });

    document.getElementById("btn-qr").onclick = () => this.qrDialog();
    document.getElementById("btn-qr-side").onclick = () => this.qrDialog();
    document.getElementById("btn-theme").onclick = () => this.toggleTheme();
    document.getElementById("btn-theme-side").onclick = () => this.toggleTheme();
    document.getElementById("btn-logout").onclick = () => {
      API.post("/api/logout", {}).catch(() => {});
      Live.disconnect();
      API.token = "";
      localStorage.removeItem("bs_token");
      this.showAuth("login");
    };
    document.getElementById("btn-back").onclick = () => {
      if (history.length > 1) history.back();
      else this.go("people");
    };

    /* global search */
    const gs = document.getElementById("global-search");
    const pop = document.getElementById("search-pop");
    gs.addEventListener("input", debounce(async () => {
      const q = gs.value.trim();
      if (!q) { pop.classList.remove("open"); return; }
      try {
        const d = await API.get("/api/search?q=" + encodeURIComponent(q));
        if (!d.results.length) {
          pop.innerHTML = '<div class="search-hit"><div><div class="sh-name">No match for "' + escapeHtml(q) + '"</div><div class="sh-sub">Add a bill with this name to create the account</div></div></div>';
        } else {
          pop.innerHTML = d.results.map((r) =>
            '<div class="search-hit" data-id="' + r.id + '">' + avatarEl(r.name, 30) +
            '<div><div class="sh-name">' + escapeHtml(r.name) + '</div><div class="sh-sub">' + (r.phone || r.open_count + " open bills") + "</div></div>" +
            '<div class="sh-bal money ' + (r.balance > 0.004 ? "neg" : "") + '">' + fmtMoney(r.balance) + "</div></div>").join("");
        }
        pop.classList.add("open");
        pop.querySelectorAll("[data-id]").forEach((hit) => {
          hit.onclick = () => { pop.classList.remove("open"); gs.value = ""; this.go("ledger", { id: hit.getAttribute("data-id") }); };
        });
      } catch (e) { /* silent */ }
    }, 140));
    gs.addEventListener("blur", () => setTimeout(() => pop.classList.remove("open"), 200));
    gs.addEventListener("focus", () => { if (gs.value.trim() && pop.innerHTML) pop.classList.add("open"); });
  },

  markNav() {
    document.querySelectorAll(".nav-item, .bn-item").forEach((b) => {
      b.classList.toggle("active", b.getAttribute("data-v") === this.current);
    });
  },

  /* ---------- routing ---------- */
  go(viewId, params) {
    if (!this.views[viewId]) viewId = "dash";
    if (viewId === "ledger" && params && params.id) {
      viewId = "ledgerhub";
      params = { person: params.id };
    }
    this.current = viewId;
    this.currentParams = params || {};
    const isTop = ["dash", "people", "ledgerhub", "add", "billmaker", "galla", "activity", "settings"].includes(viewId);
    location.hash = isTop ? "#" + viewId : location.hash;
    this.renderView();
  },

  async renderView() {
    const main = document.getElementById("main");
    const v = this.views[this.current];
    document.getElementById("topbar-title").textContent = v ? v.title : "Khata Sathi";
    this.markNav();
    document.getElementById("btn-back").style.display = ["ledger", "pay"].includes(this.current) ? "" : "none";
    main.scrollTop = 0;
    try {
      if (v) await v.render(main, this.currentParams);
    } catch (e) {
      main.innerHTML = '<div class="panel empty"><div class="e-ico">' + ico("warn") + '</div><div class="e-t">' + escapeHtml(e.message) + "</div></div>";
    }
    this.paintIcons();
  },

  refresh() {
    if (this.current) this.renderView();
  },

  /* ---------- live sync ---------- */
  connectLive() {
    Live.disconnect();
    Live.connect();
    ["people", "dash", "ledger", "galla", "*"].forEach((k) => Live.on(k, () => {
      if (this.current === "dash" && (k === "dash" || k === "*")) this.views.dash.load(document.getElementById("main"));
      if (this.current === "people" && (k === "people" || k === "*")) this.views.people.load(document.getElementById("main"));
      if (this.current === "ledgerhub" && (k === "ledger" || k === "people" || k === "*")) {
        const v = this.views.ledgerhub;
        v.render(document.getElementById("main"), { person: v.personId });
      }
      if (this.current === "activity" && (k === "*")) this.views.activity.load(document.getElementById("main"));
      if (this.current === "galla" && (k === "galla" || k === "*")) this.views.galla.load(document.getElementById("main"));
    }));
  },

  /* ---------- auth screens ---------- */
  showAuth(tab = "login") {
    document.getElementById("app").classList.add("hidden");
    const wrap = document.getElementById("auth");
    wrap.classList.remove("hidden");
    const card = document.getElementById("auth-card");

    card.innerHTML =
      '<div class="auth-logo">K</div>' +
      '<div class="auth-kicker">Khata Sathi Cloud</div>' +
      '<div class="auth-title">Your Bills & Khata</div>' +
      '<div class="auth-sub">Secure, multi-device cloud accounting for your shop.</div>' +
      '<button class="btn-google" id="btn-google-auth">' + GOOGLE_ICON_SVG + '<span>Continue with Google</span></button>' +
      '<div class="auth-divider">or continue with email</div>' +
      '<div class="auth-tabs">' +
      '<button class="auth-tab ' + (tab === "login" ? "active" : "") + '" id="tab-login">Sign In</button>' +
      '<button class="auth-tab ' + (tab === "signup" ? "active" : "") + '" id="tab-signup">Create Account</button>' +
      '</div>' +
      '<div id="auth-form-body"></div>';

    card.querySelector("#btn-google-auth").onclick = () => this.startGoogleOAuth();
    card.querySelector("#tab-login").onclick = () => this.renderAuthTab(card, "login");
    card.querySelector("#tab-signup").onclick = () => this.renderAuthTab(card, "signup");

    this.renderAuthTab(card, tab);
  },

  async startGoogleOAuth() {
    try {
      const d = await API.get("/api/auth/google-url");
      if (d.url) {
        window.location.href = d.url;
      }
    } catch (e) {
      toast("Could not start Google sign-in: " + e.message, "err");
    }
  },

  renderAuthTab(card, tab) {
    card.querySelectorAll(".auth-tab").forEach((b) => {
      b.classList.toggle("active", b.id === "tab-" + tab);
    });
    const form = card.querySelector("#auth-form-body");
    if (tab === "login") {
      form.innerHTML =
        '<div class="field"><label>Email address</label><input class="input" id="auth-email" type="email" placeholder="you@example.com" autocomplete="email"></div>' +
        '<div class="field" style="margin-top:12px"><label>Password</label><input class="input" id="auth-pass" type="password" placeholder="••••••••" autocomplete="current-password"></div>' +
        '<button class="btn primary lg block" id="auth-submit" style="margin-top:18px">Sign In</button>' +
        '<div class="auth-links">' +
        '<a class="auth-link" id="auth-forgot">Forgot password?</a>' +
        '<a class="auth-link" id="auth-switch-su">New shop? Sign up</a>' +
        '</div>';

      form.querySelector("#auth-submit").onclick = () => this.doLogin(card);
      form.querySelector("#auth-pass").addEventListener("keydown", (e) => { if (e.key === "Enter") this.doLogin(card); });
      form.querySelector("#auth-forgot").onclick = () => this.showForgotPassword();
      form.querySelector("#auth-switch-su").onclick = () => this.renderAuthTab(card, "signup");
      setTimeout(() => form.querySelector("#auth-email").focus(), 60);
    } else {
      form.innerHTML =
        '<div class="field"><label>Your name (Seller name)</label><input class="input" id="su-name" placeholder="e.g. Ramesh" autocomplete="name"></div>' +
        '<div class="field" style="margin-top:12px"><label>Shop name (optional)</label><input class="input" id="su-store" placeholder="e.g. Ramesh Kirana Store"></div>' +
        '<div class="field" style="margin-top:12px"><label>Email address</label><input class="input" id="su-email" type="email" placeholder="you@example.com" autocomplete="email"></div>' +
        '<div class="field" style="margin-top:12px"><label>Password (min 6 characters)</label><input class="input" id="su-pass" type="password" placeholder="••••••••" autocomplete="new-password"></div>' +
        '<button class="btn primary lg block" id="su-submit" style="margin-top:18px">Create Shop Account</button>' +
        '<div class="auth-links" style="justify-content:center">' +
        '<a class="auth-link" id="auth-switch-in">Already have an account? Sign in</a>' +
        '</div>';

      form.querySelector("#su-submit").onclick = () => this.doSignup(card);
      form.querySelector("#su-pass").addEventListener("keydown", (e) => { if (e.key === "Enter") this.doSignup(card); });
      form.querySelector("#auth-switch-in").onclick = () => this.renderAuthTab(card, "login");
      setTimeout(() => form.querySelector("#su-name").focus(), 60);
    }
  },

  async doLogin(card) {
    const email = card.querySelector("#auth-email").value.trim();
    const password = card.querySelector("#auth-pass").value.trim();
    if (!email) { toast("Enter your email address", "err"); return; }
    if (!password) { toast("Enter your password", "err"); return; }

    try {
      const d = await API.post("/api/auth/login", { email, password });
      API.saveToken(d.token);
      this.state = await API.get("/api/state");
      this.showApp();
      toast("Welcome back!", "ok");
    } catch (e) {
      toast(e.message || "Invalid email or password", "err");
    }
  },

  async doSignup(card) {
    const name = card.querySelector("#su-name").value.trim();
    const store = card.querySelector("#su-store").value.trim();
    const email = card.querySelector("#su-email").value.trim();
    const password = card.querySelector("#su-pass").value.trim();

    if (!name) { toast("Your name is required", "err"); return; }
    if (!email || !email.includes("@")) { toast("A valid email is required", "err"); return; }
    if (!password || password.length < 6) { toast("Password must be at least 6 characters", "err"); return; }

    try {
      const d = await API.post("/api/auth/signup", {
        seller_name: name,
        store_name: store,
        email,
        password,
      });
      API.saveToken(d.token);
      this.state = await API.get("/api/state");
      this.state.seller_name = name;
      this.showApp();
      toast("Welcome, " + name + "! Your shop is ready.", "ok", 4200);
    } catch (e) {
      toast(e.message, "err");
    }
  },

  showForgotPassword() {
    const body = document.createElement("div");
    body.innerHTML =
      '<div class="hint" style="margin-bottom:14px;line-height:1.5">Enter your email address. We will send you a link to reset your password.</div>' +
      '<div class="field"><label>Email address</label><input class="input" id="fp-email" type="email" placeholder="you@example.com" autocomplete="email"></div>';

    const send = async (close) => {
      const email = body.querySelector("#fp-email").value.trim();
      if (!email || !email.includes("@")) { toast("Enter a valid email", "err"); return; }
      try {
        await API.post("/api/auth/recover", { email });
        close();
        toast("Password reset instructions sent to " + email, "ok", 5000);
      } catch (e) {
        toast(e.message, "err");
      }
    };

    const dlg = modal({
      title: "Reset Password",
      body,
      buttons: [
        { label: "Cancel", cls: "ghost" },
        { label: "Send Reset Link", cls: "primary", keepOpen: true, onClick: (_ov, close) => send(close) },
      ],
    });
    setTimeout(() => body.querySelector("#fp-email").focus(), 60);
    body.addEventListener("keydown", (e) => { if (e.key === "Enter") send(dlg.close); });
  },

  /* ---------- app ---------- */
  async showApp() {
    document.getElementById("auth").classList.add("hidden");
    const appEl = document.getElementById("app");
    appEl.classList.remove("hidden");
    try {
      this.state = await API.get("/api/state");
    } catch (e) { /* keep */ }

    this.paintChrome();
    this.connectLive();
    const hash = (location.hash || "").replace("#", "");
    const start = ["dash", "people", "ledgerhub", "add", "billmaker", "galla", "activity", "settings"].includes(hash) ? hash : "dash";
    this.go(start);
  },

  /* ---------- More sheet (phone) ---------- */
  moreSheet() {
    const body = document.createElement("div");
    body.className = "more-sheet";
    body.innerHTML =
      '<button class="more-item" data-v="activity">' + ico("clock") +
      '<div class="mi-mid">Activity<div class="mi-sub">every bill and payment</div></div></button>' +
      '<button class="more-item" data-v="settings">' + ico("gear") +
      '<div class="mi-mid">Settings<div class="mi-sub">shop, backup, demo data</div></div></button>' +
      '<button class="more-item" data-v="connect">' + ico("qr") +
      '<div class="mi-mid">Connect phone<div class="mi-sub">QR for this shop\'s cloud URL</div></div></button>' +
      '<button class="more-item" data-v="theme">' + ico("moon") +
      '<div class="mi-mid"><span data-theme-label>' +
      (document.documentElement.getAttribute("data-theme") === "dark" ? "Light mode" : "Dark mode") +
      '</span><div class="mi-sub">rest your eyes at night</div></div></button>';
    modal({ title: "More", body });
    body.addEventListener("click", (e) => {
      const b = e.target.closest("[data-v]");
      if (!b) return;
      const v = b.getAttribute("data-v");
      if (v === "theme") {
        this.toggleTheme();
        const lbl = b.querySelector("[data-theme-label]");
        if (lbl) lbl.textContent = document.documentElement.getAttribute("data-theme") === "dark" ? "Light mode" : "Dark mode";
        return;
      }
      document.querySelector(".modal-overlay").remove();
      if (v === "connect") { this.qrDialog(); return; }
      this.go(v);
    });
  },

  /* ---------- QR dialog ---------- */
  qrDialog() {
    const body = document.createElement("div");
    body.innerHTML =
      '<div class="qr-box">' +
      '<div id="qr-holder" style="min-height:150px;display:flex;align-items:center;justify-content:center;color:var(--ink-3)">Loading QR…</div>' +
      '<div class="qr-url" id="qr-url"></div>' +
      '<div class="qr-steps">Scan this QR code with your phone camera or visit the URL above from any phone or device. Khata Sathi is cloud-hosted and works from anywhere — "Add to Home Screen" installs it as an app.</div>' +
      "</div>";
    modal({ title: "Connect the phone", body, buttons: [{ label: "Done", cls: "primary" }] });
    fetch("/api/qr", { headers: { Authorization: "Bearer " + API.token } })
      .then((r) => r.json())
      .then((res) => {
        body.querySelector("#qr-url").textContent = res.url || "";
        const holder = body.querySelector("#qr-holder");
        if (res.qr_png_b64) {
          holder.innerHTML = '<img src="data:image/png;base64,' + res.qr_png_b64 + '" alt="Scan to open Khata Sathi on the phone">';
        } else {
          holder.textContent = "QR unavailable — type the address above on the phone instead.";
        }
      })
      .catch(() => {
        body.querySelector("#qr-holder").textContent = "Could not load QR";
      });
  },
};

window.addEventListener("hashchange", () => {
  const hash = (location.hash || "").replace("#", "");
  if (App.current && ["dash", "people", "ledgerhub", "add", "billmaker", "galla", "activity", "settings"].includes(hash) && hash !== App.current) {
    App.go(hash);
  }
});

let _swReloaded = false;
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (_swReloaded) return;
    _swReloaded = true;
    if (App.current) location.reload();
  });
}

App.boot();
