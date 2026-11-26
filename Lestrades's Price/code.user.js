// ==UserScript==
// @name         Lestrade's Prices Experiment
// @namespace    https://lestrades.com
// @version      1.15
// @description  Integrates GG.Deals prices on Lestrades.com with caching, rate limiting, one-click price lookups, and AdGuard Worker Tab support.
// @match        https://lestrades.com/*
// @match        https://gg.deals/*
// @connect      gg.deals
// @grant        GM_xmlhttpRequest
// @grant        GM_cookie
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_registerMenuCommand
// @grant        GM_addStyle
// @grant        GM_openInTab
// @grant        unsafeWindow
// @run-at       document-end
// @homepageURL  https://github.com/ZennyFZ/Lestrades-Prices-Experiment
// @supportURL   https://lestrades.com/general/358/script-help-retrieve-gg-deals-prices/
// @downloadURL  https://github.com/ZennyFZ/Lestrades-Prices-Experiment/raw/refs/heads/main/Lestrades-Prices.user.js
// @updateURL    https://github.com/ZennyFZ/Lestrades-Prices-Experiment/raw/refs/heads/main/Lestrades-Prices.user.js
// ==/UserScript==

(function () {
  "use strict";

  const COOKIE_CACHE_KEY = "gg_cf_clearance_cache";
  const COOKIE_NAME = "cf_clearance";
  const GG_ORIGIN = "https://gg.deals";
  const LESTRADES_ORIGIN = "https://lestrades.com";
  const GG_PARTITION_KEY = { topLevelSite: GG_ORIGIN };

  const WORKER_QUEUE_KEY = "gg_worker_queue";
  const WORKER_RESULTS_KEY = "gg_worker_results";
  const WORKER_HEARTBEAT_KEY = "gg_worker_heartbeat";
  const PANEL_POS_KEY = "gg_panel_position";
  const WORKER_IDLE_CLOSE_MS = 30000;

  const REQUEST_INTERVAL_MS = 6000;
  const AUTO_CHECK_COUNT = 0; // number of prices to automatically check every page load. CAREFUL this will almost certainly rate limit you immediately.
  const CACHE_DURATION = 7 * 24 * 60 * 60 * 1000; // one week
  const SHOW_CACHED_IMMEDIATELY = true; // load items from the cache
  const ITEMS_PER_PAGE = 50; // items per page in the cache view
  const MONTH_MS = 30 * 24 * 60 * 60 * 1000;
  const GAME_NAME_WIDTH = 70; // width of game names for making cache view look nicer
  const ICON_URL =
    "R0lGODlhEAAQALMAAAAQGACU3hBS/2tze3N7e4R71pScnL3GxsZznNbe3t7e3u8YMe/v7////////wCS2yH5BAEAAA8ALAAAAAAQABAAAARM8MlJq704W8ApBxUwKAP4iKR5Kg2jgADrmkDTGF3N4N3ZHBzeL5gb1hoLBPBY0uImjYLgBoC+TglbI8Fh2bgTVEkiVPf7Z7NmzW4/IgA7";
  const PRICE_NOLD = "No LD";
  const PRICE_EMPTY = "Empty";
  const PRICE_ERROR = "Error";
  const PRICE_TIMEOUT = "Timeout";

  const scriptHandler =
    typeof GM_info !== "undefined" ? String(GM_info.scriptHandler || "") : "";
  const browserName =
    typeof GM_info !== "undefined" && GM_info.platform
      ? String(GM_info.platform.browserName || "")
      : "";
  const userAgent =
    typeof navigator !== "undefined" ? String(navigator.userAgent || "") : "";
  const isFirefox = /firefox/i.test(browserName) || /firefox/i.test(userAgent);
  const hasGMCookie =
    typeof GM_cookie !== "undefined" && typeof GM_cookie.list === "function";

  function supportsCookieCache() {
    return /tampermonkey|violentmonkey/i.test(scriptHandler) && hasGMCookie;
  }

  const USE_WORKER_TAB = !supportsCookieCache();

  // ---------------------------------------------------------------------------
  // Base64 UTF-8 helpers for compact URL hash job passing
  // ---------------------------------------------------------------------------
  function encodeJobsToHash(jobs) {
    const compact = jobs.map((j) => ({
      i: j.id,
      a: j.appId,
      n: j.gameName || "",
    }));
    const bytes = new TextEncoder().encode(JSON.stringify(compact));
    let bin = "";
    for (let k = 0; k < bytes.length; k++) {
      bin += String.fromCharCode(bytes[k]);
    }
    return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  function decodeJobsFromHash(hashStr) {
    try {
      const m = String(hashStr || "").match(/jobs=([A-Za-z0-9\-_]+)/);
      if (!m) return [];
      let b64 = m[1].replace(/-/g, "+").replace(/_/g, "/");
      while (b64.length % 4) b64 += "=";
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let k = 0; k < bin.length; k++) {
        bytes[k] = bin.charCodeAt(k);
      }
      const parsed = JSON.parse(new TextDecoder().decode(bytes));
      if (!Array.isArray(parsed)) return [];
      return parsed
        .filter((item) => item && item.i && item.a)
        .map((item) => ({
          id: String(item.i),
          appId: String(item.a),
          url: gg_URL(String(item.a)),
          drm: String(item.a).split("|")[1] || "steam",
          gameName: String(item.n || item.a),
        }));
    } catch (e) {
      return [];
    }
  }

  // ---------------------------------------------------------------------------
  // GG.Deals Entrypoint (Cookie Capture for TM/VM OR Worker Tab for AdGuard)
  // ---------------------------------------------------------------------------
  if (location.hostname === "gg.deals") {
    if (!USE_WORKER_TAB) {
      void captureGGCookie();
    } else if (new URLSearchParams(location.search).has("lestrades_worker")) {
      runGGWorker();
    }
    return;
  }

  if (location.hostname !== "lestrades.com") return;

  // ---------------------------------------------------------------------------
  // Lestrades.com Entrypoint
  // ---------------------------------------------------------------------------
  let cachedPrices = GM_getValue("cachedPrices", {});
  if (typeof cachedPrices !== "object" || cachedPrices === null) {
    cachedPrices = {};
  }

  pruneOldEntries();

  if (typeof GM_registerMenuCommand === "function") {
    GM_registerMenuCommand("View Cached Prices", viewCachedPrices);
    GM_registerMenuCommand("Clear Cached Prices", clearCachedPrices);
    GM_registerMenuCommand("Soft load (only missing)", softLoad);
    GM_registerMenuCommand("Hard load (refresh all)", hardLoad);
  }

  let requestQueue = [];
  if (!USE_WORKER_TAB) {
    setTimeout(execRequest, 1000);
  }

  const pendingWorkerJobs = new Map();
  let workerWin = null;
  let workerPollTimer = null;

  let appItems = [];
  let freshApps = [];

  if (USE_WORKER_TAB) {
    window.addEventListener("message", handleWorkerMessage);
  }

  window.addEventListener("load", init);

  function init() {
    // 1) Normal /game/ links scanning
    scanLestrades();

    // 2) Auto-load if desired
    maybeAutoLoadFresh();

    // 3) Compact draggable floating control button
    createControlPanel();
  }

  // ---------------------------------------------------------------------------
  // Cookie helpers (Tampermonkey / Violentmonkey)
  // ---------------------------------------------------------------------------
  function listCookies(details) {
    if (!supportsCookieCache()) {
      return Promise.resolve([]);
    }

    return new Promise((resolve, reject) => {
      try {
        GM_cookie.list(details, (cookies, error) => {
          if (error) reject(error);
          else resolve(Array.isArray(cookies) ? cookies : []);
        });
      } catch (e) {
        reject(e);
      }
    });
  }

  async function captureGGCookie() {
    if (!supportsCookieCache()) return;

    try {
      const partitioned = await listCookies({
        url: location.href,
        name: COOKIE_NAME,
        partitionKey: GG_PARTITION_KEY,
      }).catch(() => []);
      const ordinary = await listCookies({
        url: location.href,
        name: COOKIE_NAME,
      }).catch(() => []);
      const cookie =
        partitioned.find((item) => item?.name === COOKIE_NAME && item.value) ||
        ordinary.find((item) => item?.name === COOKIE_NAME && item.value);

      if (!cookie) return;

      GM_setValue(COOKIE_CACHE_KEY, {
        value: cookie.value,
        updatedAt: Date.now(),
        expirationDate: cookie.expirationDate ?? null,
        topLevelSite: cookie.partitionKey?.topLevelSite || "unpartitioned",
      });
    } catch (e) {
      console.log("unable to get partitioned cookie:", e);
    }
  }

  function getCachedCookieHeader() {
    let cached;
    try {
      cached = GM_getValue(COOKIE_CACHE_KEY, null);
    } catch (e) {
      return "";
    }

    if (!cached || typeof cached.value !== "string" || !cached.value) return "";

    if (cached.expirationDate !== null && cached.expirationDate !== undefined) {
      const expirationDate = Number(cached.expirationDate);
      if (
        Number.isFinite(expirationDate) &&
        expirationDate * 1000 <= Date.now()
      ) {
        console.log("cloudflare cookie expired");
        return "";
      }
    }

    return COOKIE_NAME + "=" + cached.value;
  }

  function prepareGGRequest(request) {
    const prepared = { ...request };
    if (!supportsCookieCache()) return prepared;

    const cookieHeader = getCachedCookieHeader();
    if (!cookieHeader) return prepared;

    if (/tampermonkey/i.test(scriptHandler)) {
      prepared.cookie = cookieHeader;
    } else {
      prepared.headers = { ...(prepared.headers || {}), Cookie: cookieHeader };
    }

    // Dont remove this line or else the script for Violentmonkey on Firefox will be broken!!
    // Firefox cookie behaviour is different from Chrome
    if (/violentmonkey/i.test(scriptHandler) && isFirefox) {
      prepared.anonymous = true;
    }
    return prepared;
  }

  // ---------------------------------------------------------------------------
  // Direct Request Queue (Tampermonkey / Violentmonkey)
  // ---------------------------------------------------------------------------
  function execRequest() {
    if (requestQueue.length) {
      const request = requestQueue.shift();
      try {
        GM_xmlhttpRequest(prepareGGRequest(request));
      } catch (e) {
        if (typeof request.onerror === "function") request.onerror(e);
      }
    }
    updatePanelStatus();
    setTimeout(
      execRequest,
      REQUEST_INTERVAL_MS + Math.floor(Math.random() * 300),
    );
  }

  function queueGMRequest(req) {
    requestQueue.push(req);
    updatePanelStatus();
  }

  // ---------------------------------------------------------------------------
  // Same-Origin Worker Tab Queue (AdGuard / Managers without GM_cookie)
  // Uses URL hash + window.postMessage (primary) + GM_setValue (fallback)
  // ---------------------------------------------------------------------------
  function getStoredArray(key) {
    try {
      const val = GM_getValue(key, []);
      return Array.isArray(val) ? val : [];
    } catch (e) {
      return [];
    }
  }

  function getStoredObject(key) {
    try {
      const val = GM_getValue(key, {});
      return typeof val === "object" && val !== null && !Array.isArray(val)
        ? val
        : {};
    } catch (e) {
      return {};
    }
  }

  function setButtonLoading(btnId) {
    if (!btnId) return;
    const btn = document.getElementById(btnId + "_after");
    if (btn) btn.textContent = " (...)";
  }

  function enqueueWorkerBatch(items) {
    if (!items || !items.length) return;

    const newJobs = [];
    const gmQueue = getStoredArray(WORKER_QUEUE_KEY);

    items.forEach((item) => {
      const { appId, btnId, gameName } = item;
      const alreadyPending = Array.from(pendingWorkerJobs.values()).some(
        (p) => p.appId === appId && p.btnId === btnId,
      );
      if (alreadyPending) return;

      setButtonLoading(btnId);

      const jobId = `job_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const job = {
        id: jobId,
        appId,
        url: gg_URL(appId),
        drm: appId.split("|")[1] || "steam",
        gameName: gameName || appId,
        createdAt: Date.now(),
      };
      pendingWorkerJobs.set(jobId, { appId, btnId, gameName: job.gameName });
      newJobs.push(job);
      gmQueue.push(job);
    });

    if (!newJobs.length) return;

    // Fallback storage write in case GM storage is shared
    GM_setValue(WORKER_QUEUE_KEY, gmQueue);

    // If an active worker window reference exists, send jobs immediately via postMessage
    if (workerWin && !workerWin.closed) {
      try {
        workerWin.postMessage(
          { type: "LESTRADES_ENQUEUE", jobs: newJobs },
          GG_ORIGIN,
        );
      } catch (e) {
        openWorkerWithJobs(newJobs);
      }
    } else {
      openWorkerWithJobs(newJobs);
    }

    startWorkerResultPolling();
    updatePanelStatus();
  }

  function openWorkerWithJobs(jobs) {
    const hashPayload = encodeJobsToHash(jobs);
    const workerUrl = `${GG_ORIGIN}/?lestrades_worker=1#jobs=${hashPayload}`;

    // Prefer window.open so window.opener is available on gg.deals for cross-origin postMessage
    try {
      const win = window.open(workerUrl, "lestrades_gg_worker");
      if (win) {
        workerWin = win;
        return;
      }
    } catch (e) {
      // Fallback below
    }

    if (typeof GM_openInTab === "function") {
      try {
        GM_openInTab(workerUrl, { active: false, insert: true });
      } catch (e) {
        // Ignore
      }
    }
  }

  function handleWorkerMessage(event) {
    if (event.origin !== GG_ORIGIN) return;
    const data = event.data;
    if (!data || typeof data !== "object") return;

    if (data.type === "LESTRADES_PRICE_RESULT" && data.jobId) {
      applyWorkerResult(data.jobId, data);
    }
  }

  function applyWorkerResult(jobId, res) {
    const meta = pendingWorkerJobs.get(jobId);
    if (!meta) return;

    storeInCache(
      meta.appId,
      res.price,
      res.gameTitle || meta.gameName,
      meta.btnId,
      res.shortUrl || "",
    );
    pendingWorkerJobs.delete(jobId);
    updatePanelStatus();

    if (pendingWorkerJobs.size === 0 && workerPollTimer) {
      clearInterval(workerPollTimer);
      workerPollTimer = null;
    }
  }

  function startWorkerResultPolling() {
    if (workerPollTimer) return;
    workerPollTimer = setInterval(pollWorkerResults, 700);
  }

  function pollWorkerResults() {
    const results = getStoredObject(WORKER_RESULTS_KEY);
    let resultsChanged = false;

    for (const jobId of Array.from(pendingWorkerJobs.keys())) {
      const res = results[jobId];
      if (!res) continue;
      applyWorkerResult(jobId, res);
      delete results[jobId];
      resultsChanged = true;
    }

    if (resultsChanged) {
      const now = Date.now();
      for (const [id, r] of Object.entries(results)) {
        if (now - (r?.updatedAt || 0) > 10 * 60 * 1000) {
          delete results[id];
        }
      }
      GM_setValue(WORKER_RESULTS_KEY, results);
    }

    if (pendingWorkerJobs.size === 0 && workerPollTimer) {
      clearInterval(workerPollTimer);
      workerPollTimer = null;
    }
  }

  function isCloudflareChallenge(status, htmlText) {
    if (status === 403 || status === 503) {
      if (
        /just a moment|cf-browser-verification|challenge-platform|turnstile/i.test(
          htmlText || "",
        )
      ) {
        return true;
      }
    }
    return false;
  }

  function runGGWorker() {
    let lastJobAt = Date.now();
    let isProcessing = false;
    const localQueue = [];
    const seenJobIds = new Set();

    const addJobsToLocalQueue = (jobs) => {
      if (!Array.isArray(jobs)) return;
      jobs.forEach((j) => {
        if (!j || !j.id || seenJobIds.has(j.id)) return;
        seenJobIds.add(j.id);
        localQueue.push(j);
      });
    };

    // 1) Read jobs passed directly in URL hash (#jobs=...)
    const hashJobs = decodeJobsFromHash(location.hash);
    if (hashJobs.length) {
      addJobsToLocalQueue(hashJobs);
      try {
        history.replaceState(
          null,
          "",
          location.pathname + location.search,
        );
      } catch (e) {
        // Ignore
      }
    }

    // 2) Listen for additional jobs pushed from Lestrades via postMessage
    window.addEventListener("message", (event) => {
      if (event.origin !== LESTRADES_ORIGIN) return;
      const data = event.data;
      if (data && data.type === "LESTRADES_ENQUEUE" && Array.isArray(data.jobs)) {
        addJobsToLocalQueue(data.jobs);
        lastJobAt = Date.now();
        setBannerMsg(`Queued ${localQueue.length} item(s)...`);
      }
    });

    const banner = document.createElement("div");
    banner.id = "lestrades-gg-worker-banner";
    banner.style.cssText = [
      "position:fixed",
      "bottom:16px",
      "right:16px",
      "z-index:999999",
      "background:#1e222a",
      "color:#f1f5f9",
      "border:1px solid #475569",
      "border-radius:8px",
      "padding:10px 14px",
      "font-family:system-ui,-apple-system,sans-serif",
      "font-size:12px",
      "box-shadow:0 4px 16px rgba(0,0,0,0.45)",
      "max-width:300px",
    ].join(";");
    banner.innerHTML =
      '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:4px;">' +
      '<span style="font-weight:600;">Lestrade\'s Prices Worker</span>' +
      '<button id="lestrades-worker-close" type="button" style="background:#334155;color:#f1f5f9;border:none;border-radius:4px;padding:2px 6px;cursor:pointer;font-size:11px;">Close</button>' +
      "</div>" +
      '<div id="lestrades-worker-msg">Starting...</div>';
    document.body.appendChild(banner);

    const closeBtn = document.getElementById("lestrades-worker-close");
    if (closeBtn) {
      closeBtn.addEventListener("click", () => window.close());
    }

    const setBannerMsg = (msg) => {
      const el = document.getElementById("lestrades-worker-msg");
      if (el) el.textContent = msg;
    };

    const beat = () => GM_setValue(WORKER_HEARTBEAT_KEY, Date.now());
    beat();
    const beatTimer = setInterval(beat, 2000);

    const sendResultBack = (jobId, payload) => {
      // Primary: cross-origin postMessage directly to opener tab on Lestrades
      if (window.opener && !window.opener.closed) {
        try {
          window.opener.postMessage(
            { type: "LESTRADES_PRICE_RESULT", jobId, ...payload },
            LESTRADES_ORIGIN,
          );
        } catch (e) {
          // Fallback below
        }
      }

      // Fallback: also write to GM storage
      const results = getStoredObject(WORKER_RESULTS_KEY);
      results[jobId] = { ...payload, updatedAt: Date.now() };
      GM_setValue(WORKER_RESULTS_KEY, results);
    };

    const processNext = async () => {
      if (isProcessing) return;

      // Also pull any jobs from GM storage if shared
      const gmQueue = getStoredArray(WORKER_QUEUE_KEY);
      if (gmQueue.length) {
        addJobsToLocalQueue(gmQueue);
        GM_setValue(WORKER_QUEUE_KEY, []);
      }

      if (!localQueue.length) {
        if (Date.now() - lastJobAt > WORKER_IDLE_CLOSE_MS) {
          setBannerMsg("Done! You can return to Lestrades.");
          clearInterval(beatTimer);
          GM_setValue(WORKER_HEARTBEAT_KEY, 0);
          window.close();
          return;
        }
        setBannerMsg("Idle (waiting for jobs on Lestrades...)");
        setTimeout(processNext, 1000);
        return;
      }

      isProcessing = true;
      const job = localQueue.shift();
      setBannerMsg(`Fetching ${job.appId} (${localQueue.length} left)...`);

      const shortUrlFrom = (finalUrl) =>
        (finalUrl || "")
          .replace(/.*gg\.deals\/(us\/|steam\/)*/g, "")
          .replace(/\/$/, "");

      try {
        const resp = await fetch(job.url, {
          method: "GET",
          credentials: "same-origin",
        });
        const htmlText = await resp.text();

        if (isCloudflareChallenge(resp.status, htmlText)) {
          localQueue.unshift(job);
          setBannerMsg(
            "Cloudflare check detected! Please verify this tab to continue.",
          );
          isProcessing = false;
          setTimeout(processNext, REQUEST_INTERVAL_MS);
          return;
        }

        let price;
        let gameTitle = job.gameName;
        let shortUrl = shortUrlFrom(resp.url || job.url);

        if (resp.status >= 400) {
          price = resp.status;
        } else {
          const doc = new DOMParser().parseFromString(htmlText, "text/html");
          price = await getPricesFromDOM(doc, job.drm || "steam", htmlText);
          const nameElem = doc.querySelector(
            'a[itemprop="item"].active span[itemprop="name"]',
          );
          if (nameElem) gameTitle = nameElem.textContent.trim();
        }

        sendResultBack(job.id, { price, gameTitle, shortUrl });
        lastJobAt = Date.now();
        setBannerMsg(
          localQueue.length
            ? `Updated ${job.appId}. ${localQueue.length} left...`
            : `Done (${job.appId}: ${price}). Return to Lestrades!`,
        );
      } catch (e) {
        sendResultBack(job.id, {
          price: PRICE_ERROR,
          gameTitle: job.gameName,
          shortUrl: "",
        });
        lastJobAt = Date.now();
      } finally {
        isProcessing = false;
        setTimeout(
          processNext,
          REQUEST_INTERVAL_MS + Math.floor(Math.random() * 300),
        );
      }
    };

    setTimeout(processNext, 400);
  }

  // ---------------------------------------------------------------------------
  // 1) Scanning for app IDs across Lestrade's
  // ---------------------------------------------------------------------------
  function scanLestrades() {
    if (
      document.URL.match(/\/(matches|library|blacklist)\b/g) &&
      !document.URL.match(/[?&]gg/g)
    )
      return;
    const gameLinks = document.querySelectorAll(
      "a[data-appid], a[data-subid], a[data-ggu]",
    );
    if (gameLinks.length > 200 && !document.URL.match(/[?&]gg/g)) return;
    gameLinks.forEach(async (link) => {
      if (link.id == "gg-priority") return; // We're doing this silently below.
      const gameName = link.innerText || document.title;
      const btnId = `ggdeals_btn_${Math.random().toString(36).substr(2, 9)}`;
      const ggu = link.getAttribute("data-ggu") || "";
      let appId = link.getAttribute("data-appid")
        ? "app/" + link.getAttribute("data-appid")
        : link.getAttribute("data-subid")
          ? "sub/" + link.getAttribute("data-subid")
          : ggu.includes("/")
            ? ggu
            : "game/" + ggu;
      appId += link.getAttribute("data-store")
        ? "|" + link.getAttribute("data-store")
        : "";
      link.removeAttribute("data-appid");
      link.removeAttribute("data-subid");
      link.removeAttribute("data-ggu");

      const container = document.createElement("span");
      container.classList.add("ggdeals-price-container");
      container.innerHTML = `
                <a id="${btnId}" class="gg-btn">
                    <img src="data:image/gif;base64,${ICON_URL}" title="GG.Deals: Click to load/update price info!">
                </a>
                <small id="${btnId}_after"></small>`;
      link.insertAdjacentElement("afterend", container);

      appItems.push({ appId, btnId, gameName });

      // Always refetch on click
      const btnElem = document.getElementById(btnId);
      btnElem.addEventListener("click", async () => {
        (typeof unsafeWindow !== "undefined" ? unsafeWindow : window)._ignor_clic =
          true;
        await fetchItemPrice(appId, btnId, gameName);
      });

      // Show cached if fresh or mark as needed
      const cached = cachedPrices[appId];
      if (SHOW_CACHED_IMMEDIATELY && cached && isCacheFresh(cached.timestamp)) {
        link_me(btnId, gg_URL(appId), cached.price);
      } else if (!cached) {
        freshApps.push({ btnId, appId: appId });
      } else if (!isCacheFresh(cached.timestamp)) {
        freshApps.push({ btnId, appId: appId });
      }
    });

    // Auto-fetch the single priority entry on any page -- but only after 5 seconds, to avoid overloading the server.
    // Note that the website only asks for Steam apps (and not packages), to save time and sanity.
    if (document.querySelector("#gg-priority")) {
      setTimeout(() => {
        const ggu = document
          .querySelector("#gg-priority")
          .getAttribute("data-ggu");
        fetchItemPrice(
          ggu
            ? ggu.includes("/")
              ? ggu
              : "game/" + ggu
            : "app/" +
                document
                  .querySelector("#gg-priority")
                  .getAttribute("data-appid"),
        );
      }, 5000);
    }
  }

  // ---------------------------------------------------------------------------
  // 2) Auto-load logic
  // ---------------------------------------------------------------------------
  function maybeAutoLoadFresh() {
    if (AUTO_CHECK_COUNT > 0 && freshApps.length > 0) {
      const limit = Math.min(AUTO_CHECK_COUNT, freshApps.length);
      for (let i = 0; i < limit; i++) {
        setTimeout(() => {
          const elem = document.getElementById(freshApps[i].btnId);
          if (elem) elem.click();
        }, 500 * i);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // 3) Compact Draggable On-Page Control Button (Clear of Mobile Bottom Nav)
  // ---------------------------------------------------------------------------
  function createControlPanel() {
    if (document.getElementById("lestrades-gg-panel")) return;

    const wrapper = document.createElement("div");
    wrapper.id = "lestrades-gg-panel";
    wrapper.style.cssText = [
      "position:fixed",
      "z-index:99999",
      "font-family:system-ui,-apple-system,sans-serif",
      "font-size:12px",
      "touch-action:none",
      "user-select:none",
    ].join(";");

    const toggleBtn = document.createElement("button");
    toggleBtn.type = "button";
    toggleBtn.title = "GG Prices (drag to move)";
    toggleBtn.style.cssText = [
      "display:flex",
      "align-items:center",
      "justify-content:center",
      "gap:5px",
      "background:rgba(30,34,42,0.88)",
      "color:#f1f5f9",
      "border:1px solid #475569",
      "border-radius:999px",
      "padding:6px 10px",
      "cursor:grab",
      "box-shadow:0 3px 10px rgba(0,0,0,0.35)",
      "font-weight:600",
      "font-size:11px",
      "backdrop-filter:blur(4px)",
    ].join(";");
    toggleBtn.innerHTML = `<img src="data:image/gif;base64,${ICON_URL}" alt="" style="width:14px;height:14px;pointer-events:none;"> <span style="pointer-events:none;">GG</span>`;

    const menuBox = document.createElement("div");
    menuBox.id = "lestrades-gg-menu";
    menuBox.style.cssText = [
      "display:none",
      "position:absolute",
      "flex-direction:column",
      "gap:6px",
      "background:#1e222a",
      "color:#f1f5f9",
      "border:1px solid #475569",
      "border-radius:10px",
      "padding:10px",
      "min-width:205px",
      "box-shadow:0 8px 24px rgba(0,0,0,0.45)",
    ].join(";");

    const statusLine = document.createElement("div");
    statusLine.id = "lestrades-gg-status";
    statusLine.style.cssText =
      "font-size:11px;color:#94a3b8;padding-bottom:4px;border-bottom:1px solid #334155;";
    menuBox.appendChild(statusLine);

    const actions = [
      { label: "Soft load (only missing)", onClick: softLoad },
      { label: "Hard load (refresh all)", onClick: hardLoad },
      { label: "View Cached Prices", onClick: viewCachedPrices },
      { label: "Clear Cached Prices", onClick: clearCachedPrices },
    ];

    actions.forEach((act) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = act.label;
      btn.style.cssText = [
        "background:#334155",
        "color:#f8fafc",
        "border:none",
        "border-radius:6px",
        "padding:6px 10px",
        "text-align:left",
        "cursor:pointer",
        "font-size:12px",
      ].join(";");
      btn.addEventListener("mouseenter", () => {
        btn.style.background = "#475569";
      });
      btn.addEventListener("mouseleave", () => {
        btn.style.background = "#334155";
      });
      btn.addEventListener("click", () => {
        menuBox.style.display = "none";
        act.onClick();
      });
      menuBox.appendChild(btn);
    });

    wrapper.appendChild(toggleBtn);
    wrapper.appendChild(menuBox);
    document.body.appendChild(wrapper);

    const clampPosition = (x, y) => {
      const rect = toggleBtn.getBoundingClientRect();
      const w = rect.width || 56;
      const h = rect.height || 30;
      const margin = 8;
      const maxX = Math.max(margin, window.innerWidth - w - margin);
      const maxY = Math.max(margin, window.innerHeight - h - margin);
      return {
        x: Math.min(Math.max(margin, x), maxX),
        y: Math.min(Math.max(margin, y), maxY),
      };
    };

    const positionMenu = () => {
      const rect = wrapper.getBoundingClientRect();
      const openUp = rect.top > window.innerHeight / 2;
      const alignRight = rect.left > window.innerWidth / 2;
      menuBox.style.top = openUp ? "auto" : "calc(100% + 8px)";
      menuBox.style.bottom = openUp ? "calc(100% + 8px)" : "auto";
      menuBox.style.left = alignRight ? "auto" : "0";
      menuBox.style.right = alignRight ? "0" : "auto";
    };

    const applyPosition = (x, y) => {
      const pos = clampPosition(x, y);
      wrapper.style.left = `${pos.x}px`;
      wrapper.style.top = `${pos.y}px`;
      wrapper.style.right = "auto";
      wrapper.style.bottom = "auto";
      positionMenu();
      return pos;
    };

    // Load saved position or default above Lestrades's mobile bottom navigation bar
    const savedPos = getStoredObject(PANEL_POS_KEY);
    if (
      typeof savedPos.x === "number" &&
      typeof savedPos.y === "number" &&
      Number.isFinite(savedPos.x) &&
      Number.isFinite(savedPos.y)
    ) {
      applyPosition(savedPos.x, savedPos.y);
    } else {
      const rect = toggleBtn.getBoundingClientRect();
      const defaultX = window.innerWidth - (rect.width || 56) - 12;
      const defaultY = window.innerHeight - (rect.height || 30) - 78;
      applyPosition(defaultX, defaultY);
    }

    // Drag & tap handling (works on both mobile touch & desktop mouse)
    let isPointerDown = false;
    let dragged = false;
    let startX = 0;
    let startY = 0;
    let originX = 0;
    let originY = 0;

    toggleBtn.addEventListener("pointerdown", (e) => {
      isPointerDown = true;
      dragged = false;
      startX = e.clientX;
      startY = e.clientY;
      const rect = wrapper.getBoundingClientRect();
      originX = rect.left;
      originY = rect.top;
      toggleBtn.style.cursor = "grabbing";
      if (toggleBtn.setPointerCapture) {
        try {
          toggleBtn.setPointerCapture(e.pointerId);
        } catch (err) {
          // Ignore
        }
      }
    });

    toggleBtn.addEventListener("pointermove", (e) => {
      if (!isPointerDown) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      if (!dragged && Math.hypot(dx, dy) > 6) {
        dragged = true;
        menuBox.style.display = "none";
      }
      if (dragged) {
        applyPosition(originX + dx, originY + dy);
      }
    });

    const finishPointer = (e) => {
      if (!isPointerDown) return;
      isPointerDown = false;
      toggleBtn.style.cursor = "grab";
      if (dragged) {
        const rect = wrapper.getBoundingClientRect();
        GM_setValue(PANEL_POS_KEY, { x: Math.round(rect.left), y: Math.round(rect.top) });
      } else {
        const isOpen = menuBox.style.display === "flex";
        positionMenu();
        menuBox.style.display = isOpen ? "none" : "flex";
        updatePanelStatus();
      }
      if (toggleBtn.releasePointerCapture && e && e.pointerId !== undefined) {
        try {
          toggleBtn.releasePointerCapture(e.pointerId);
        } catch (err) {
          // Ignore
        }
      }
    };

    toggleBtn.addEventListener("pointerup", finishPointer);
    toggleBtn.addEventListener("pointercancel", () => {
      isPointerDown = false;
      toggleBtn.style.cursor = "grab";
    });

    // Close menu when tapping outside
    document.addEventListener("pointerdown", (e) => {
      if (!wrapper.contains(e.target)) {
        menuBox.style.display = "none";
      }
    });

    window.addEventListener("resize", () => {
      const rect = wrapper.getBoundingClientRect();
      applyPosition(rect.left, rect.top);
    });

    updatePanelStatus();
  }

  function updatePanelStatus() {
    const statusEl = document.getElementById("lestrades-gg-status");
    if (!statusEl) return;

    const modeLabel = USE_WORKER_TAB ? "Worker Tab (AdGuard)" : "Direct (Cookie)";
    const pendingCount = USE_WORKER_TAB
      ? pendingWorkerJobs.size
      : requestQueue.length;
    statusEl.textContent =
      pendingCount > 0
        ? `${modeLabel} • Queued: ${pendingCount}`
        : `${modeLabel} • Ready`;
  }

  // ---------------------------------------------------------------------------
  // Cache View & Actions
  // ---------------------------------------------------------------------------
  function link_me(btnId, link, text) {
    const btn = document.getElementById(btnId + "_after");
    if (btn)
      btn.innerHTML =
        ' (<a href="' +
        link +
        '" target="_blank" style="text-decoration:none;">' +
        ((text + "").indexOf("|") >= 0
          ? text.split("|")[0] + " " + text.split("|")[1] / 100
          : text) +
        "</a>)";
  }

  function viewCachedPrices() {
    const now = Date.now();
    const allEntries = Object.entries(cachedPrices).map(([key, data]) => {
      return {
        gameName: data.name || key,
        price: data.price,
        ageStr: formatAge(now - data.timestamp),
        url: gg_URL(data.appid),
        appid: data.appid || key,
      };
    });

    // Sort by gameName alphabetically
    allEntries.sort((a, b) => a.gameName.localeCompare(b.gameName));
    showPagedPopup(allEntries);
  }

  function showPagedPopup(allEntries) {
    let currentPage = 0;
    let filteredEntries = [...allEntries];
    const totalPages = () => Math.ceil(filteredEntries.length / ITEMS_PER_PAGE);

    const overlay = document.createElement("div");
    overlay.style = `
        position: fixed; top:0; left:0; width:100%; height:100%;
        background-color: rgba(0,0,0,0.7); z-index:999999; display:flex;
        align-items:center; justify-content:center;
    `;

    const popup = document.createElement("div");
    popup.style = `
        background:#333; color:#fff; padding:20px; border-radius:8px; width:80%;
        max-height:80%; overflow-y:auto; box-sizing:border-box; position:relative;
        font-family: monospace;
    `;

    const closeXButton = document.createElement("button");
    closeXButton.textContent = "✖";
    closeXButton.style = `
        position:absolute; top:10px; right:10px; background:transparent; color:#fff;
        border:none; font-size:20px; cursor:pointer;
    `;
    closeXButton.addEventListener("click", () =>
      document.body.removeChild(overlay),
    );
    popup.appendChild(closeXButton);

    const h1 = document.createElement("h1");
    h1.textContent = `Cached Prices (${filteredEntries.length} cached items)`;
    h1.style.marginTop = "0";
    h1.style.paddingRight = "30px";
    popup.appendChild(h1);

    // Search bar
    const searchDiv = document.createElement("div");
    searchDiv.style.marginBottom = "10px";
    const searchInput = document.createElement("input");
    searchInput.type = "text";
    searchInput.placeholder = "Search game name or appid...";
    searchInput.style.marginRight = "5px";

    const searchButton = document.createElement("button");
    searchButton.textContent = "Search";
    searchButton.style.marginRight = "5px";

    const clearButton = document.createElement("button");
    clearButton.textContent = "Reset";

    searchButton.addEventListener("click", () => {
      const query = searchInput.value.trim().toLowerCase();
      if (query) {
        filteredEntries = allEntries.filter(
          (e) =>
            e.gameName.toLowerCase().includes(query) ||
            (e.appid && e.appid.toString().includes(query)),
        );
      } else {
        filteredEntries = [...allEntries];
      }
      currentPage = 0;
      renderPage();
      h1.textContent = `Cached Prices (${filteredEntries.length} cached items)`;
    });

    clearButton.addEventListener("click", () => {
      searchInput.value = "";
      filteredEntries = [...allEntries];
      currentPage = 0;
      renderPage();
      h1.textContent = `Cached Prices (${filteredEntries.length} cached items)`;
    });

    searchDiv.appendChild(searchInput);
    searchDiv.appendChild(searchButton);
    searchDiv.appendChild(clearButton);
    popup.appendChild(searchDiv);

    const resultsDiv = document.createElement("div");
    popup.appendChild(resultsDiv);

    const paginationDiv = document.createElement("div");
    paginationDiv.style.marginTop = "10px";

    const prevButton = document.createElement("button");
    prevButton.textContent = "Previous";
    prevButton.style.marginRight = "5px";

    const nextButton = document.createElement("button");
    nextButton.textContent = "Next";

    prevButton.addEventListener("click", () => {
      if (currentPage > 0) {
        currentPage--;
        renderPage();
      }
    });
    nextButton.addEventListener("click", () => {
      if (currentPage < totalPages() - 1) {
        currentPage++;
        renderPage();
      }
    });

    paginationDiv.appendChild(prevButton);
    paginationDiv.appendChild(nextButton);
    popup.appendChild(paginationDiv);

    const closeButton = document.createElement("button");
    closeButton.textContent = "Close";
    closeButton.style = `
        margin-top:10px; background:#555; color:#fff; border:none;
        padding:5px 10px; cursor:pointer;
    `;
    closeButton.addEventListener("click", () => {
      document.body.removeChild(overlay);
    });
    popup.appendChild(closeButton);

    overlay.appendChild(popup);
    document.body.appendChild(overlay);

    function renderPage() {
      resultsDiv.innerHTML = "";
      const start = currentPage * ITEMS_PER_PAGE;
      const end = start + ITEMS_PER_PAGE;
      const pageItems = filteredEntries.slice(start, end);
      if (!pageItems.length) {
        resultsDiv.innerHTML = "No results.";
        return;
      }
      const lines = pageItems.map((e) =>
        formatLine(e.gameName, e.price, e.ageStr, e.url, e.appid),
      );
      resultsDiv.innerHTML = `<pre>${lines.join("\n")}</pre>`;
    }

    renderPage();
  }

  function formatLine(gameName, price, ageStr, url, appid) {
    let fullName = padRight(gameName, GAME_NAME_WIDTH);
    // Reserve space for AppID block: 9 chars "[1230530]" or "[       ]"
    fullName += appid ? ` [${appid}]` : ` [       ]`;

    return `${fullName} ${price} (Age: ${ageStr}) <a href="${url}" target="_blank">GG Deals</a>`;
  }

  function padRight(str, length) {
    return str.length < length ? str + " ".repeat(length - str.length) : str;
  }

  function clearCachedPrices() {
    if (confirm("Are you sure you want to clear the price cache?")) {
      cachedPrices = {};
      GM_setValue("cachedPrices", cachedPrices);
      alert("Price cache cleared.");
    }
  }

  function softLoad() {
    const missingItems = appItems.filter((item) => {
      const cached = cachedPrices[item.appId];
      return (
        !SHOW_CACHED_IMMEDIATELY ||
        !cached ||
        !isCacheFresh(cached.timestamp) ||
        [PRICE_ERROR, PRICE_TIMEOUT, PRICE_EMPTY, PRICE_NOLD].includes(
          cached.price,
        )
      );
    });

    if (USE_WORKER_TAB) {
      enqueueWorkerBatch(missingItems);
      return;
    }

    missingItems.forEach((item) => {
      const elem = document.getElementById(item.btnId);
      if (elem) elem.click();
    });
  }

  function hardLoad() {
    if (USE_WORKER_TAB) {
      enqueueWorkerBatch(appItems);
      return;
    }

    appItems.forEach(async (item) => {
      const { appId, btnId, gameName } = item;
      await fetchItemPrice(appId, btnId, gameName);
    });
  }

  // ---------------------------------------------------------------------------
  // Storing in cache & syncing back to Lestrades
  // ---------------------------------------------------------------------------
  function storeInCache(appId, priceInfo, gameTitle, btnId, gameURL) {
    cachedPrices[appId] = {
      price: priceInfo,
      name: gameTitle || appId,
      appid: appId,
      timestamp: Date.now(),
    };
    GM_setValue("cachedPrices", cachedPrices);

    if (document.querySelector("#wedge")) {
      const pageWin =
        typeof unsafeWindow !== "undefined" ? unsafeWindow : window;
      const sessVar = pageWin.we_sessvar;
      const sessId = pageWin.we_sessid;
      const body =
        "gg=" +
        encodeURIComponent(priceInfo) +
        (appId.includes(gameURL) ? "" : "&url=" + encodeURIComponent(gameURL)) +
        "&app=" +
        encodeURIComponent(appId) +
        (sessVar && sessId
          ? "&" + encodeURIComponent(sessVar) + "=" + encodeURIComponent(sessId)
          : "");

      // Same-origin fetch ensures Lestrades login/session cookies are sent on AdGuard too
      fetch("https://lestrades.com/?action=ajax;sa=gg", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
      }).catch((e) => console.log("Lestrades sync failed:", e));
    }

    if (btnId) link_me(btnId, gg_URL(appId), priceInfo);
  }

  // ---------------------------------------------------------------------------
  // HTML Fetching & Price Parsing (Works in both Direct GM & Same-Origin Worker)
  // ---------------------------------------------------------------------------
  async function GM_fetch_html(request) {
    if (location.hostname === "gg.deals") {
      const resp = await fetch(request.url, {
        method: request.method || "GET",
        credentials: "same-origin",
        headers: {
          "X-Requested-With": "XMLHttpRequest",
          "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        },
        body: request.data,
      });
      if (resp.status !== 200) throw `Invalid status: ${resp.status}`;
      const text = await resp.text();
      return new DOMParser().parseFromString(text || "", "text/html");
    }

    const response = await new Promise((resolve, reject) => {
      GM_xmlhttpRequest(
        prepareGGRequest({
          method: request.method || "GET",
          headers: {
            "X-Requested-With": "XMLHttpRequest",
            "Content-type": "application/x-www-form-urlencoded; charset=UTF-8",
          },
          url: request.url,
          data: request.data,
          onload: resolve,
          onerror: reject,
        }),
      );
    });
    if (response.status !== 200) throw `Invalid status: ${response.status}`;
    return new DOMParser().parseFromString(
      response.responseText || "",
      "text/html",
    );
  }

  async function getPricesFromChunk(url, drm, csrf) {
    const doc = await GM_fetch_html({
      method: "POST",
      url: `https://gg.deals${url}`,
      data: `gg_csrf=${csrf}`,
    });
    return doc.querySelectorAll(
      `.similar-deals-container:has(svg.svg-drm-${drm}) :is(.price-inner, .price-text, .price)`,
    );
  }

  // Get currency + selected price for the requested DRM; Steam keys outrank Altergift offers.
  async function getPricesFromDOM(doc, drm, txt) {
    drm = drm || "steam";
    const currency = txt.match('"priceCurrency":"([^"]+)"');
    if (!currency) return PRICE_NOLD; // Likely no prices available!
    let csrf = doc
        .querySelector('[name="csrf-token"]')
        ?.getAttribute("content"),
      purl = "";
    let p1 = doc.querySelectorAll(
      `#official-stores .similar-deals-container:has(svg.svg-drm-${drm}) :is(.price-inner, .price-text, .price)`,
    );
    let p2 = doc.querySelectorAll(
      `#keyshops .similar-deals-container:has(svg.svg-drm-${drm}) :is(.price-inner, .price-text, .price)`,
    );
    try {
      if (
        !p1.length &&
        doc.querySelector("#official-stores") &&
        (purl = doc
          .querySelector("#official-stores button.btn-show-more")
          ?.getAttribute("data-url"))
      )
        p1 = await getPricesFromChunk(purl, drm, csrf);
      if (
        !p2.length &&
        doc.querySelector("#keyshops") &&
        (purl = doc
          .querySelector("#keyshops button.btn-show-more")
          ?.getAttribute("data-url"))
      )
        p2 = await getPricesFromChunk(purl, drm, csrf);
    } catch (e) {
      console.log(e.error, purl);
    }
    const officialPrices = Array.from(p1);
    const keyshopPrices = Array.from(p2);
    let candidatePrices = officialPrices.concat(keyshopPrices);

    if (drm.toLowerCase() === "steam") {
      // GG.Deals Steam keyshops expose only Key or Altergift offers.
      const steamKeyPrices = keyshopPrices.filter((el) => {
        const offer = el.closest(".similar-deals-container");
        return !/\baltergift\b/i.test(offer?.textContent || "");
      });
      if (steamKeyPrices.length) candidatePrices = steamKeyPrices;
    }

    // GG prices always have 2 decimal digits, so remove all non-digit chars to get cents.
    const price = Math.min(
      ...candidatePrices.map((el) => el.textContent.replace(/[^\d]/g, "")),
    );
    if (/\d+/.test(price)) return (currency[1] || "LTS") + "|" + price;
    return PRICE_EMPTY;
  }

  // ---------------------------------------------------------------------------
  // Fetch logic (always fresh on manual click)
  // ---------------------------------------------------------------------------
  async function fetchItemPrice(appId, btnId, gameName) {
    if (USE_WORKER_TAB) {
      enqueueWorkerBatch([{ appId, btnId, gameName }]);
      return;
    }

    setButtonLoading(btnId);

    const my_short_url = (r) =>
      (r.finalUrl || "")
        .replace(/.*gg\.deals\/(us\/|steam\/)*/g, "")
        .replace(/\/$/, "");

    queueGMRequest({
      method: "GET",
      url: gg_URL(appId),
      onload: async (response) => {
        let price, gameTitle;
        if (response.status >= 400) price = response.status;
        else {
          const parser = new DOMParser();
          const doc = parser.parseFromString(
            response.responseText,
            "text/html",
          );
          price = await getPricesFromDOM(
            doc,
            appId.split("|")[1] || "steam",
            response.responseText,
          );
          let nameElem = doc.querySelector(
            'a[itemprop="item"].active span[itemprop="name"]',
          );
          gameTitle = nameElem ? nameElem.textContent.trim() : gameName;
        }

        storeInCache(appId, price, gameTitle, btnId, my_short_url(response));
      },
      onerror: (response) =>
        storeInCache(
          appId,
          PRICE_ERROR,
          gameName,
          btnId,
          my_short_url(response),
        ),
      ontimeout: (response) =>
        storeInCache(
          appId,
          PRICE_TIMEOUT,
          gameName,
          btnId,
          my_short_url(response),
        ),
    });
  }

  // ---------------------------------------------------------------------------
  // URL helper
  // ---------------------------------------------------------------------------
  function gg_URL(appId) {
    const url = appId.split("|")[0];
    if (url.match(/^(app|sub)\/\d+$/g))
      return `https://gg.deals/us/steam/${url}/`;
    return `https://gg.deals/us/${url}/`;
  }

  // ---------------------------------------------------------------------------
  // Freshness / pruning
  // ---------------------------------------------------------------------------
  function isCacheFresh(timestamp) {
    return Date.now() - timestamp < CACHE_DURATION;
  }

  function pruneOldEntries() {
    const now = Date.now();
    let changed = false;
    for (const [key, data] of Object.entries(cachedPrices)) {
      if (now - data.timestamp > MONTH_MS) {
        delete cachedPrices[key];
        changed = true;
      }
    }
    if (changed) {
      GM_setValue("cachedPrices", cachedPrices);
    }
  }

  function formatAge(ms) {
    const ageInDays = ms / (1000 * 60 * 60 * 24);
    const ageInHours = ageInDays * 24;
    const ageInMinutes = ageInHours * 60;

    if (ageInHours < 1) {
      return `${ageInMinutes.toFixed(2)} minutes`;
    } else if (ageInHours < 24) {
      return `${ageInHours.toFixed(2)} hours`;
    }
    return `${ageInDays.toFixed(2)} days`;
  }
})();
