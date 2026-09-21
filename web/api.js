/* Khata Sathi - API client + Cloud Sync Poller */
"use strict";

const API = {
  token: localStorage.getItem("bs_token") || "",

  async req(method, path, body, raw, ctype) {
    const headers = {};
    if (this.token) headers["Authorization"] = "Bearer " + this.token;
    let payload;
    if (raw !== undefined) {
      headers["Content-Type"] = ctype || "application/octet-stream";
      payload = raw;
    } else if (body !== undefined) {
      headers["Content-Type"] = "application/json";
      payload = JSON.stringify(body);
    }
    const resp = await fetch(path, { method, headers, body: payload });
    let data = {};
    try { data = await resp.json(); } catch (e) { /* non-json */ }
    if (resp.status === 401 && !path.startsWith("/api/auth/") && path !== "/api/login") {
      this.token = "";
      localStorage.removeItem("bs_token");
      window.dispatchEvent(new CustomEvent("bs-auth-expired"));
      throw new Error("Signed out - please sign in again");
    }
    if (!resp.ok) throw new Error(data.error || ("Error " + resp.status));
    return data;
  },

  get(path) { return this.req("GET", path); },
  async post(path, body) {
    const res = await this.req("POST", path, body);
    setTimeout(() => { if (typeof Live !== "undefined" && Live.pollNow) Live.pollNow(); }, 150);
    return res;
  },
  postRaw(path, bytes, ctype) { return this.req("POST", path, undefined, bytes, ctype); },

  saveToken(t) {
    this.token = t;
    localStorage.setItem("bs_token", t);
  },
};

/* ---------- Cloud Live Sync (Serverless Poller) ---------- */
const Live = {
  timer: null,
  handlers: {},
  lastId: 0,
  isPolling: false,

  on(kind, fn) {
    (this.handlers[kind] = this.handlers[kind] || []).push(fn);
  },

  async pollNow() {
    if (!API.token || this.isPolling) return;
    this.isPolling = true;
    try {
      const res = await API.get("/api/sync/poll?since=" + this.lastId);
      if (res && res.events && res.events.length > 0) {
        res.events.forEach((ev) => {
          if (ev.id > this.lastId) this.lastId = ev.id;
          (this.handlers[ev.kind] || []).forEach((fn) => {
            try { fn(ev.payload || {}); } catch (e) { console.warn("live handler", e); }
          });
          (this.handlers["*"] || []).forEach((fn) => {
            try { fn(ev.kind, ev.payload || {}); } catch (e) { console.warn("live handler", e); }
          });
        });
      } else if (res && res.latest_id !== undefined) {
        if (this.lastId === 0) {
          this.lastId = res.latest_id;
        }
      }
    } catch (e) {
      // transient network drop - keep retrying gracefully
    } finally {
      this.isPolling = false;
    }
  },

  connect() {
    this.disconnect();
    if (!API.token) return;
    // Initial sync fetch
    this.pollNow();
    // Adaptive background sync (every 10s when active)
    this.timer = setInterval(() => {
      if (!document.hidden) {
        this.pollNow();
      }
    }, 10000);

    // Instant sync when user switches back to the tab/app
    this._onVisibility = () => {
      if (!document.hidden) this.pollNow();
    };
    this._onFocus = () => {
      this.pollNow();
    };
    document.addEventListener("visibilitychange", this._onVisibility);
    window.addEventListener("focus", this._onFocus);
  },

  disconnect() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (this._onVisibility) document.removeEventListener("visibilitychange", this._onVisibility);
    if (this._onFocus) window.removeEventListener("focus", this._onFocus);
  },
};
