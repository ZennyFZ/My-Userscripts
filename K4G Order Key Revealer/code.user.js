// ==UserScript==
// @name         K4G Order Key Revealer
// @namespace    local.k4g.keys
// @version      1.0.4
// @author       Zenny
// @description  Adds a small control panel on K4G order pages to reveal and copy purchased game keys.
// @match        https://k4g.com/order*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=k4g.com
// @grant        GM_setClipboard
// @run-at       document-idle
// ==/UserScript==

(function () {
  "use strict";

  const CONFIG = {
    clickDelayMs: 450,
    panelId: "k4g-key-revealer-panel",
    styleId: "k4g-key-revealer-style",
  };

  function textOf(node) {
    return (node.innerText || node.textContent || "").replace(/\s+/g, " ").trim();
  }

  function isVisible(el) {
    if (!el || !(el instanceof Element)) return false;
    const rect = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    return (
      rect.width > 0 &&
      rect.height > 0 &&
      style.display !== "none" &&
      style.visibility !== "hidden" &&
      Number(style.opacity || 1) > 0
    );
  }

  function addRevealCss() {
    if (document.getElementById(CONFIG.styleId)) return;

    const style = document.createElement("style");
    style.id = CONFIG.styleId;
    style.textContent = `
      [data-testid="ORDER_ITEM_KEYS_KEY_CONTAINER"] *,
      [class*="LibraryCard_key"] *,
      [class*="ViewKey"] * {
        filter: none !important;
        -webkit-filter: none !important;
        -webkit-text-security: none !important;
        text-security: none !important;
        user-select: text !important;
      }

      #${CONFIG.panelId} {
        position: fixed;
        z-index: 2147483647;
        right: 16px;
        bottom: 16px;
        display: flex;
        gap: 8px;
        align-items: center;
        padding: 10px;
        border: 1px solid rgba(15, 23, 42, 0.18);
        border-radius: 8px;
        background: #fff;
        color: #111827;
        font: 13px/1.3 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        box-shadow: 0 12px 30px rgba(15, 23, 42, 0.18);
      }

      #${CONFIG.panelId} button {
        border: 0;
        border-radius: 6px;
        padding: 8px 10px;
        background: #111827;
        color: #fff;
        cursor: pointer;
        font: inherit;
      }

      #${CONFIG.panelId} button.secondary {
        background: #eef2f7;
        color: #111827;
      }

      #${CONFIG.panelId} .status {
        max-width: 260px;
        color: #475569;
      }
    `;
    document.documentElement.appendChild(style);
  }

  function findKeyCards() {
    return Array.from(
      document.querySelectorAll('[data-testid="ORDER_ITEM_KEYS_KEY_CONTAINER"]')
    ).filter(isVisible);
  }

  function findViewButtons() {
    const scopedButtons = findKeyCards().flatMap((card) =>
      Array.from(card.querySelectorAll('button, [role="button"]'))
    );

    const fallbackButtons = Array.from(document.querySelectorAll('button, [role="button"]'));

    return Array.from(new Set([...scopedButtons, ...fallbackButtons])).filter((button) => {
      if (!isVisible(button)) return false;
      const label = textOf(button).toLowerCase();
      const classes = String(button.className || "").toLowerCase();
      return label === "view" || label.includes("view key") || classes.includes("viewkey");
    });
  }

  async function revealVisibleKeys() {
    addRevealCss();
    const buttons = findViewButtons();

    for (const button of buttons) {
      button.dispatchEvent(new MouseEvent("mouseover", { bubbles: true, cancelable: true }));
      button.click();
      await new Promise((resolve) => setTimeout(resolve, CONFIG.clickDelayMs));
    }

    const count = buttons.length;
    setStatus(count ? `Clicked ${count} VIEW button(s).` : "No VIEW buttons found.");
  }

  function collectVisibleKeys() {
    const found = new Set();
    const keyInputs = Array.from(document.querySelectorAll('input[class*="ViewKey_keyInput"]'));

    for (const input of keyInputs) {
      const value = String(input.value || input.getAttribute("value") || "").trim();
      if (value) found.add(value);
    }

    return Array.from(found);
  }

  async function writeClipboard(text) {
    if (typeof GM_setClipboard === "function") {
      GM_setClipboard(text, "text");
      return true;
    }

    if (typeof GM !== "undefined" && GM && typeof GM.setClipboard === "function") {
      await GM.setClipboard(text, "text");
      return true;
    }

    if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
      await navigator.clipboard.writeText(text);
      return true;
    }

    return false;
  }

  async function copyVisibleKeys() {
    addRevealCss();
    const keys = collectVisibleKeys();

    if (!keys.length) {
      setStatus("No key input found. Reveal keys first.");
      return;
    }

    const payload = keys.join("\n");
    try {
      const copied = await writeClipboard(payload);
      if (!copied) {
        window.prompt("Copy keys manually:", payload);
        setStatus(`Found ${keys.length} key(s), clipboard API unavailable.`);
        return;
      }
    } catch (error) {
      console.error("[K4G Key Revealer] Clipboard copy failed:", error);
      window.prompt("Copy keys manually:", payload);
      setStatus(`Found ${keys.length} key(s), clipboard copy was blocked.`);
      return;
    }

    setStatus(`Copied ${keys.length} key(s).`);
  }

  function setStatus(message) {
    const status = document.querySelector(`#${CONFIG.panelId} .status`);
    if (status) status.textContent = message;
  }

  function addPanel() {
    if (document.getElementById(CONFIG.panelId)) return;
    addRevealCss();

    const panel = document.createElement("div");
    panel.id = CONFIG.panelId;
    panel.innerHTML = `
      <button type="button" data-action="reveal" title="Clicks visible VIEW buttons. This may confirm K4G's no-refund disclaimer.">Reveal keys</button>
      <button type="button" class="secondary" data-action="copy">Copy keys</button>
      <button type="button" class="secondary" data-action="close" title="Hide panel">x</button>
      <span class="status">Ready.</span>
    `;

    panel.addEventListener("click", async (event) => {
      const action = event.target && event.target.getAttribute("data-action");
      if (action === "reveal") await revealVisibleKeys();
      if (action === "copy") await copyVisibleKeys();
      if (action === "close") panel.remove();
    });

    document.body.appendChild(panel);
  }

  addPanel();

  const observer = new MutationObserver(() => {
    addRevealCss();
    addPanel();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
})();