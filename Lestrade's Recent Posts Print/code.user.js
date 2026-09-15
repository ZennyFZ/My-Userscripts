// ==UserScript==
// @name         Lestrade's Recent Posts Print
// @namespace    https://lestrades.com/
// @version      1.0.0
// @description  Add a Print link to topics in Recent Posts
// @author       Zenny
// @match        https://lestrades.com/
// @icon         https://www.google.com/s2/favicons?sz=64&domain=lestrades.com
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function initializeRecentPostsPrint(root, factory) {
  const api = factory();

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  if (root.document && root.location) {
    api.enhanceRecentPosts(root.document, root.location);
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function recentPostsPrintFactory() {
  "use strict";

  const HOME_ORIGIN = "https://lestrades.com";
  const RECENT_TOPIC_SELECTOR =
    'section.homehold table.homeposts td.latestp2 a[href]:not(.note)';
  const TOPIC_PATH_RE = /^\/(?!offer(?:\/|$)|game(?:\/|$)|@)[^/]+\/(\d+)(?:\/|$)/;

  function isHomePage(location) {
    return location?.origin === HOME_ORIGIN && location.pathname === "/";
  }

  function getTopicId(rawUrl, baseUrl) {
    try {
      const url = new URL(rawUrl, baseUrl);
      if (url.origin !== HOME_ORIGIN) return null;
      return url.pathname.match(TOPIC_PATH_RE)?.[1] ?? null;
    } catch {
      return null;
    }
  }

  function buildPrintUrl(topicId) {
    return `${HOME_ORIGIN}/?action=printpage;topic=${topicId}.0`;
  }

  function addStyle(document) {
    if (document.querySelector("#lt-recent-print-style")) return;

    const style = document.createElement("style");
    style.id = "lt-recent-print-style";
    style.textContent = `
      .lt-recent-print {
        display: inline-block;
        margin-left: 0.45em;
        padding: 0 4px;
        border: 1px solid currentColor;
        border-radius: 3px;
        color: inherit;
        font: inherit;
        font-size: 0.82em;
        line-height: 1.35;
        text-decoration: none;
        white-space: nowrap;
        opacity: 0.7;
      }

      .lt-recent-print:hover {
        text-decoration: none;
        opacity: 1;
      }

      .lt-recent-print:focus-visible {
        outline: 2px solid currentColor;
        outline-offset: 2px;
      }
    `;
    (document.head || document.documentElement).append(style);
  }

  function createPrintLink(document, topicId) {
    const printLink = document.createElement("a");
    printLink.className = "lt-recent-print";
    printLink.href = buildPrintUrl(topicId);
    printLink.target = "_blank";
    printLink.rel = "noopener noreferrer";
    printLink.textContent = "Print";
    printLink.title = "Open the print view page";
    printLink.setAttribute("aria-label", "Open topic print view in a new tab");
    return printLink;
  }

  function enhanceRecentPosts(document, location) {
    if (!document || !isHomePage(location)) return 0;

    let added = 0;
    for (const topicLink of document.querySelectorAll(RECENT_TOPIC_SELECTOR)) {
      if (topicLink.nextElementSibling?.classList.contains("lt-recent-print")) {
        continue;
      }

      const topicId = getTopicId(topicLink.href, location.origin);
      if (!topicId) continue;

      topicLink.after(createPrintLink(document, topicId));
      added += 1;
    }

    if (added > 0) addStyle(document);
    return added;
  }

  return {
    buildPrintUrl,
    enhanceRecentPosts,
    getTopicId,
    isHomePage,
  };
});
