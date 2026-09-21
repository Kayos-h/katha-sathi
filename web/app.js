/* Khata Sathi - app shell: auth, routing, nav, live sync, global search */
"use strict";

/* global API, Live, ico, toast, modal, escapeHtml, debounce, fmtMoney, fmtDate, avatarEl,
   Dashboard, People, Ledger, AddBill, Payment, Activity, Settings, BillMaker, Galla, LedgerView */

const App = {
  state: { has_account: false, store_name: "", seller_name: "" },
  views: {},
  current: null,
  currentParams: null,

  async boot() {
    this.registerViews();
    this.paintIcons();
    this.applyTheme(localStorage.getItem("bs_theme") || "light");
    window.addEventListener("bs-auth-expired", () => this.showAuth("login"));
    try {
      this.state = await API.get("/api/state");
    } catch (e) {
      document.body.innerHTML = '<div class="auth-wrap"><div class="panel panel-pad">Cannot reach the Khata Sathi server.<br>Start it again with <b>Khata Sathi.bat</b>.</div></div>';
      return;
    }
    if (!this.state.has_account) this.showAuth("setup");
    else if (!API.token) this.showAuth("login");
    else this.showApp();
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
    document.getElementById("side-user").textContent = "Seller: " + (this.state.seller_name || "");
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
    /* the phone's bottom bar: the five daily views + More (Settings/Activity
       live behind it — parity with the desktop sidebar, zero extra bars) */
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
    /* "ledger" + a person id opens the Ledger section with that person
       selected — one khata hub, every entry point lands there */
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
    if (["add", "billmaker", "pay"].includes(this.current)) {
      try {
        const galla = await API.get("/api/galla");
        if (!galla.open || galla.closed) {
          toast(galla.closed
            ? "Today's galla is closed. Start a fresh galla before recording more money."
            : "Start today's galla first, then bills and payments stay connected.",
            "warn", 5200);
          this.current = "galla";
          this.currentParams = {};
          if (location.hash !== "#galla") location.hash = "#galla";
        }
      } catch (e) {
        /* the view itself will show the real API error if the guard can't check */
      }
    }
    const v = this.views[this.current];
    document.getElementById("topbar-title").textContent = v.title;
    this.markNav();
    /* back arrow only on deep views (ledger/pay) at mobile */
    document.getElementById("btn-back").style.display = ["ledger", "pay"].includes(this.current) ? "" : "none";
    main.scrollTop = 0;
    try {
      await v.render(main, this.currentParams);
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
      /* light-touch refresh: only the visible view re-renders */
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
  showAuth(mode) {
    document.getElementById("app").classList.add("hidden");
    const wrap = document.getElementById("auth");
    wrap.classList.remove("hidden");
    const card = document.getElementById("auth-card");
    if (mode === "setup") {
      card.innerHTML =
        '<div class="auth-logo">K</div>' +
        '<div class="auth-title">Welcome to Khata Sathi</div>' +
        '<div class="auth-sub">Your bills, your khata — one place.<br>Set up the shop in 30 seconds.</div>' +
        '<div class="field"><label>Your name (the seller)</label><input class="input" id="su-name" placeholder="e.g. Durga"></div>' +
        '<div class="field"><label>Shop name (optional)</label><input class="input" id="su-store" placeholder="e.g. Durga Corner Store"></div>' +
        '<div class="field"><label>Choose a PIN (4-8 digits)</label><input class="input" id="su-pin" type="password" inputmode="numeric" placeholder="••••"></div>' +
        '<button class="btn primary lg block" id="su-go" style="margin-top:18px">Start Khata Sathi</button>' +
        '<div class="hint" style="margin-top:12px;text-align:center">One account for the shop. Buyers never need accounts.</div>';
      card.querySelector("#su-go").onclick = () => this.doSetup(card);
      card.querySelector("#su-pin").addEventListener("keydown", (e) => { if (e.key === "Enter") this.doSetup(card); });
      setTimeout(() => card.querySelector("#su-name").focus(), 80);
    } else {
      const seller = (this.state && this.state.seller_name) ? this.state.seller_name : "seller";
      card.innerHTML =
        '<div class="auth-logo">K</div>' +
        '<div class="auth-kicker">Khata Sathi</div>' +
        '<div class="auth-title">Welcome, ' + escapeHtml(seller) + '</div>' +
        '<div class="auth-sub" id="lg-who">Enter your PIN</div>' +
        '<div class="pin-dots" id="pin-dots">' + '<div class="pin-dot"></div>'.repeat(4) + "</div>" +
        '<div class="pin-pad" id="pin-pad"></div>' +
        '<button class="btn ghost block auth-reset" id="lg-reset">' + ico("edit") + "Reset PIN</button>";
      this.buildPinPad(card);
      card.querySelector("#lg-reset").onclick = () => this.showResetPin();
    }
  },

  async doSetup(card) {
    const name = card.querySelector("#su-name").value.trim();
    const store = card.querySelector("#su-store").value.trim();
    const pin = card.querySelector("#su-pin").value.trim();
    if (!name) { toast("Your name is required", "err"); return; }
    if (!/^\d{4,8}$/.test(pin)) { toast("PIN must be 4-8 digits", "err"); return; }
    try {
      const d = await API.post("/api/setup", { name, store_name: store, pin });
      API.saveToken(d.token);
      this.state = await API.get("/api/state");
      this.state.seller_name = name;
      this.showApp();
      toast("Welcome, " + name + "! Start by adding a bill.", "ok", 4200);
    } catch (e) { toast(e.message, "err"); }
  },

  buildPinPad(card) {
    let pin = "";
    const pad = card.querySelector("#pin-pad");
    const dots = card.querySelectorAll(".pin-dot");
    const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "clear", "0", "back"];
    pad.innerHTML = keys.map((k) =>
      '<button class="pin-key" data-k="' + k + '">' + (k === "clear" ? "C" : k === "back" ? "⌫" : k) + "</button>").join("");

    const paint = () => {
      dots.forEach((d, i) => {
        d.classList.toggle("on", i < Math.min(pin.length, 8));
      });
      while (dots.length < Math.min(pin.length, 8)) { /* up to 8 */ }
    };

    const submit = async () => {
      try {
        const d = await API.post("/api/login", { pin });
        API.saveToken(d.token);
        this.state = await API.get("/api/state");
        this.showApp();
      } catch (e) {
        card.querySelector(".auth-card, #auth-card") || card;
        pin = "";
        paint();
        const cardEl = document.getElementById("auth-card");
        cardEl.classList.add("pin-shake");
        setTimeout(() => cardEl.classList.remove("pin-shake"), 420);
        document.getElementById("lg-who").textContent = "Wrong PIN — try again";
      }
    };

    pad.addEventListener("click", async (e) => {
      const b = e.target.closest("[data-k]");
      if (!b) return;
      const k = b.getAttribute("data-k");
      if (k === "clear") pin = "";
      else if (k === "back") pin = pin.slice(0, -1);
      else if (pin.length < 8) pin += k;
      paint();
      if (pin.length === 4 || pin.length === 8) await submit(pin);
    });
    card.addEventListener("keydown", (e) => {
      if (/^[0-9]$/.test(e.key)) { if (pin.length < 8) { pin += e.key; paint(); if (pin.length === 4 || pin.length === 8) submit(pin); } }
      else if (e.key === "Backspace") { pin = pin.slice(0, -1); paint(); }
      else if (e.key === "Enter" && pin.length >= 4) submit(pin);
      else if (e.key === "Escape") { pin = ""; paint(); }
    });
    setTimeout(() => card.focus(), 60);
  },

  showResetPin() {
    const body = document.createElement("div");
    body.innerHTML =
      '<div class="hint auth-reset-copy">No email needed. This only changes the PIN saved on this laptop.</div>' +
      '<div class="field"><label>Seller name</label><input class="input" id="rp-name" autocomplete="name"></div>' +
      '<div class="field" style="margin-top:10px"><label>New PIN (4-8 digits)</label><input class="input" id="rp-pin" type="password" inputmode="numeric" maxlength="8"></div>' +
      '<div class="field" style="margin-top:10px"><label>Confirm new PIN</label><input class="input" id="rp-confirm" type="password" inputmode="numeric" maxlength="8"></div>';
    const save = async (close) => {
      const sellerName = body.querySelector("#rp-name").value.trim();
      const newPin = body.querySelector("#rp-pin").value.trim();
      const confirmPin = body.querySelector("#rp-confirm").value.trim();
      if (!sellerName) { toast("Seller name is required", "err"); return; }
      if (!/^\d{4,8}$/.test(newPin)) { toast("PIN must be 4-8 digits", "err"); return; }
      if (newPin !== confirmPin) { toast("PINs do not match", "err"); return; }
      try {
        const d = await API.post("/api/reset-pin", {
          seller_name: sellerName,
          new_pin: newPin,
          confirm_pin: confirmPin,
        });
        API.saveToken(d.token);
        this.state = await API.get("/api/state");
        close();
        this.showApp();
        toast("PIN reset");
      } catch (e) {
        toast(e.message, "err");
      }
    };
    const dlg = modal({
      title: "Reset PIN",
      body,
      buttons: [
        { label: "Cancel", cls: "ghost" },
        { label: "Reset PIN", cls: "primary", keepOpen: true, onClick: (_ov, close) => save(close) },
      ],
    });
    setTimeout(() => body.querySelector("#rp-name").focus(), 60);
    body.addEventListener("keydown", (e) => {
      if (e.key === "Enter") save(dlg.close);
    });
  },

  /* ---------- app ---------- */
  async showApp() {
    document.getElementById("auth").classList.add("hidden");
    const appEl = document.getElementById("app");
    appEl.classList.remove("hidden");
    if (!this.state.seller_name) {
      try {
        const seller = await API.get("/api/state");
        this.state = seller;
      } catch (e) { /* keep */ }
    }
    this.paintChrome();
    this.connectLive();
    const hash = (location.hash || "").replace("#", "");
    let start = ["dash", "people", "ledgerhub", "add", "billmaker", "galla", "activity", "settings"].includes(hash) ? hash : "dash";
    try {
      const galla = await API.get("/api/galla");
      if (!galla.open && start !== "galla") {
        start = "galla";
        toast("Start today's galla first so every bill and payment connects to the drawer.", "warn", 5200);
      }
    } catch (e) { /* keep requested start view */ }
    this.go(start);
  },

  /* ---------- More sheet (phone) ---------- */
  moreSheet() {
    /* Settings and Activity on the phone: same destinations the desktop
       sidebar has, in a bottom sheet the thumb can reach. */
    const body = document.createElement("div");
    body.className = "more-sheet";
    body.innerHTML =
      '<button class="more-item" data-v="activity">' + ico("clock") +
      '<div class="mi-mid">Activity<div class="mi-sub">every bill and payment</div></div></button>' +
      '<button class="more-item" data-v="settings">' + ico("gear") +
      '<div class="mi-mid">Settings<div class="mi-sub">shop, backup, demo data</div></div></button>' +
      '<button class="more-item" data-v="connect">' + ico("qr") +
      '<div class="mi-mid">Connect phone<div class="mi-sub">QR for this shop\'s address</div></div></button>' +
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
      '<div class="qr-steps">On the phone: join the same Wi-Fi as this laptop, then scan this QR with the camera (or type the address). Khata Sathi opens — "Add to Home Screen" makes it feel like an app.</div>' +
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

/* A new service worker took over (the shop's code was updated on the
   server): reload once so this device runs the fresh code immediately —
   stale JavaScript is how "it works on my laptop, not my phone" happens. */
let _swReloaded = false;
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (_swReloaded) return;   // exactly once per page life
    _swReloaded = true;
    if (App.current) location.reload();
  });
}

App.boot();
