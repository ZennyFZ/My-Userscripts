// ==UserScript==
// @name         Lestrade's Trading Data Country Badges
// @namespace    https://lestrades.com/
// @version      1.1.0
// @author       Zenny
// @description  Show country flag + country name next to usernames in Trading data lists.
// @match        https://lestrades.com/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=lestrades.com
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  const CACHE_KEY = 'lt_country_cache_v1';
  const CACHE_TTL_MS = 1000 * 60 * 60 * 24 * 14;
  const BADGE_CLASS = 'tm-lt-country-badge';
  const BTN_CLASS = 'tm-lt-country-btn';
  const PROFILE_RE = /^\/@[^\/?#]+\/?$/i;
  const IS_GAME_PAGE = /^\/game\/\d+\/?/i.test(window.location.pathname);
  const MAX_CONCURRENT_FETCHES = 6;

  const inFlight = new Map();
  const fetchQueue = [];
  let activeFetches = 0;

  let cache = loadCache();
  let saveTimer = 0;
  let scanTimer = 0;
  let renderEnabled = false;
  let toggleBtn = null;

  if (!IS_GAME_PAGE) {
    return;
  }

  injectStyle();
  createToggleButton();

  document.addEventListener('click', (event) => {
    if (!renderEnabled) {
      return;
    }
    if (event.target.closest('a.show-more')) {
      setTimeout(queueScan, 80);
    }
  }, true);

  const observer = new MutationObserver((mutations) => {
    if (!renderEnabled) {
      return;
    }
    for (const mutation of mutations) {
      if (mutation.type === 'childList' && (mutation.addedNodes.length || mutation.removedNodes.length)) {
        queueScan();
        return;
      }
      if (mutation.type === 'attributes') {
        queueScan();
        return;
      }
    }
  });

  observer.observe(document.body, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['class', 'style']
  });

  function queueScan() {
    clearTimeout(scanTimer);
    scanTimer = window.setTimeout(scanAndDecorate, 120);
  }

  async function scanAndDecorate() {
    if (!renderEnabled) {
      return;
    }
    const links = collectTradingDataUserLinks();
    for (const link of links) {
      if (!renderEnabled) {
        return;
      }
      if (link.dataset.ltCountryProcessing === '1') {
        continue;
      }
      if (link.parentElement && link.parentElement.querySelector(`:scope > .${BADGE_CLASS}`)) {
        continue;
      }

      const profileUrl = toProfileUrl(link.getAttribute('href'));
      if (!profileUrl) {
        continue;
      }

      link.dataset.ltCountryProcessing = '1';

      try {
        const country = await getCountry(profileUrl);
        if (renderEnabled && country && link.isConnected) {
          attachBadge(link, country);
        }
      } catch (_) {
        // Ignore failures for individual profiles.
      } finally {
        delete link.dataset.ltCountryProcessing;
      }
    }
  }

  function createToggleButton() {
    toggleBtn = document.createElement('button');
    toggleBtn.type = 'button';
    toggleBtn.className = BTN_CLASS;
    toggleBtn.textContent = 'Show countries';
    toggleBtn.title = 'Show country flag + name in Trading data';
    toggleBtn.addEventListener('click', toggleRendering);
    document.body.appendChild(toggleBtn);
  }

  function toggleRendering() {
    renderEnabled = !renderEnabled;
    updateToggleButton();

    if (renderEnabled) {
      queueScan();
      return;
    }

    clearTimeout(scanTimer);
    fetchQueue.length = 0;
    removeAllBadges();
  }

  function updateToggleButton() {
    if (!toggleBtn) {
      return;
    }
    toggleBtn.textContent = renderEnabled ? 'Hide countries' : 'Show countries';
    toggleBtn.classList.toggle('is-on', renderEnabled);
  }

  function removeAllBadges() {
    document.querySelectorAll('.' + BADGE_CLASS).forEach((badge) => badge.remove());
    document.querySelectorAll('[data-lt-country-processing]').forEach((link) => {
      delete link.dataset.ltCountryProcessing;
    });
  }

  function collectTradingDataUserLinks() {
    const result = [];
    const seen = new Set();

    const tradingHeaders = Array.from(document.querySelectorAll('header.cat, h2, h3, h4, legend'))
      .filter((el) => /trading\s*data/i.test((el.textContent || '').trim()));

    for (const header of tradingHeaders) {
      let node = header.nextElementSibling;

      while (node) {
        if (node.matches('header.cat, h2, h3, h4')) {
          break;
        }

        node.querySelectorAll('a[href^="/@"]').forEach((link) => {
          if (!isVisible(link)) {
            return;
          }
          const profileUrl = toProfileUrl(link.getAttribute('href'));
          if (!profileUrl || seen.has(profileUrl + '|' + link.textContent)) {
            return;
          }
          seen.add(profileUrl + '|' + link.textContent);
          result.push(link);
        });

        node = node.nextElementSibling;
      }
    }

    if (!result.length) {
      document.querySelectorAll('#game .listUsers a[href^="/@"]').forEach((link) => {
        if (!isVisible(link)) {
          return;
        }
        const profileUrl = toProfileUrl(link.getAttribute('href'));
        if (!profileUrl || seen.has(profileUrl + '|' + link.textContent)) {
          return;
        }
        seen.add(profileUrl + '|' + link.textContent);
        result.push(link);
      });
    }

    return result;
  }

  function isVisible(element) {
    if (!element || !element.isConnected) {
      return false;
    }
    if (element.offsetParent === null) {
      return false;
    }
    const style = window.getComputedStyle(element);
    return style.display !== 'none' && style.visibility !== 'hidden';
  }

  function toProfileUrl(href) {
    if (!href) {
      return null;
    }

    let url;
    try {
      url = new URL(href, window.location.origin);
    } catch (_) {
      return null;
    }

    if (!PROFILE_RE.test(url.pathname)) {
      return null;
    }

    url.search = '';
    url.hash = '';
    url.pathname = url.pathname.replace(/\/+$/, '') + '/';
    return url.toString();
  }

  async function getCountry(profileUrl) {
    const now = Date.now();
    const cached = cache[profileUrl];

    if (cached && cached.expiresAt > now && cached.countryName && cached.flagUrl) {
      return cached;
    }

    if (inFlight.has(profileUrl)) {
      return inFlight.get(profileUrl);
    }

    const requestPromise = enqueueFetch(async () => {
      const response = await fetch(profileUrl, {
        credentials: 'same-origin'
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const html = await response.text();
      const parsed = parseCountryFromProfileHtml(html, profileUrl);
      if (!parsed) {
        return null;
      }

      const entry = {
        ...parsed,
        expiresAt: now + CACHE_TTL_MS
      };

      cache[profileUrl] = entry;
      saveCacheSoon();
      return entry;
    }).finally(() => {
      inFlight.delete(profileUrl);
    });

    inFlight.set(profileUrl, requestPromise);
    return requestPromise;
  }

  function enqueueFetch(task) {
    return new Promise((resolve, reject) => {
      fetchQueue.push({ task, resolve, reject });
      pumpFetchQueue();
    });
  }

  function pumpFetchQueue() {
    while (activeFetches < MAX_CONCURRENT_FETCHES && fetchQueue.length) {
      const next = fetchQueue.shift();
      activeFetches += 1;

      Promise.resolve()
        .then(next.task)
        .then(next.resolve, next.reject)
        .finally(() => {
          activeFetches -= 1;
          pumpFetchQueue();
        });
    }
  }

  function parseCountryFromProfileHtml(html, profileUrl) {
    const doc = new DOMParser().parseFromString(html, 'text/html');

    const locationDt = Array.from(doc.querySelectorAll('#detailedinfo dt, dt')).find((dt) => {
      const text = (dt.textContent || '').trim().replace(/:$/, '').toLowerCase();
      return text === 'location';
    });

    if (!locationDt || !locationDt.nextElementSibling) {
      return null;
    }

    const locationDd = locationDt.nextElementSibling;
    const flagImg = locationDd.querySelector('img[src*="/assets/flags/"]');
    if (!flagImg) {
      return null;
    }

    const rawFlagSrc = flagImg.getAttribute('src');
    if (!rawFlagSrc) {
      return null;
    }

    const flagUrl = new URL(rawFlagSrc, profileUrl).toString();

    const countryName = locationDd.textContent.replace(/\s+/g, ' ').trim();
    if (!countryName) {
      return null;
    }

    return {
      countryName,
      flagUrl
    };
  }

  function attachBadge(link, country) {
    if (!link.parentElement) {
      return;
    }

    const existing = link.parentElement.querySelector(`:scope > .${BADGE_CLASS}`);
    if (existing) {
      return;
    }

    const badge = document.createElement('span');
    badge.className = BADGE_CLASS;
    badge.title = country.countryName;

    const img = document.createElement('img');
    img.src = country.flagUrl;
    img.alt = country.countryName;
    img.loading = 'lazy';
    img.referrerPolicy = 'no-referrer';

    const text = document.createElement('span');
    text.textContent = country.countryName;

    badge.appendChild(img);
    badge.appendChild(text);

    link.insertAdjacentElement('afterend', badge);
  }

  function injectStyle() {
    const style = document.createElement('style');
    style.textContent = `
      .${BADGE_CLASS} {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        margin-left: 6px;
        font-size: 0.9em;
        line-height: 1;
        opacity: 0.95;
        vertical-align: middle;
      }

      .${BADGE_CLASS} img {
        width: 14px;
        height: 10px;
        border-radius: 2px;
        border: 1px solid rgba(0, 0, 0, 0.25);
        object-fit: cover;
        flex: 0 0 auto;
      }

      .${BTN_CLASS} {
        position: fixed;
        right: 16px;
        bottom: 16px;
        z-index: 99999;
        border: 1px solid rgba(0, 0, 0, 0.35);
        background: #2f3b4a;
        color: #fff;
        border-radius: 8px;
        padding: 7px 10px;
        font-size: 12px;
        line-height: 1.2;
        cursor: pointer;
        opacity: 0.95;
      }

      .${BTN_CLASS}.is-on {
        background: #1e6f46;
      }

      .${BTN_CLASS}:hover {
        opacity: 1;
      }
    `;
    document.head.appendChild(style);
  }

  function loadCache() {
    try {
      const parsed = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}');
      if (!parsed || typeof parsed !== 'object') {
        return {};
      }
      return parsed;
    } catch (_) {
      return {};
    }
  }

  function saveCacheSoon() {
    clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => {
      try {
        localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
      } catch (_) {
        // Ignore storage failures.
      }
    }, 400);
  }
})();
