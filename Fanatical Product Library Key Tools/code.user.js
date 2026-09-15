// ==UserScript==
// @name         Fanatical Product Library Key Tools
// @namespace    local.fanatical.key-tools
// @version      1.0.0
// @author       Zenny
// @description  Reveal keys and copy product names/keys from the Fanatical product library.
// @match        https://www.fanatical.com/*/product-library*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=fanatical.com
// @grant        GM_setClipboard
// @run-at       document-idle
// ==/UserScript==

(function () {
  "use strict";

  const PANEL_ID = "tm-fanatical-key-tools";
  const KEY_RE = /\b(?:[A-Z0-9]{4,8}-){1,8}[A-Z0-9]{4,8}\b/g;
  const WAIT_AFTER_CLICK_MS = 250;

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function cleanText(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function getRows() {
    const fanaticalRows = [
      ...document.querySelectorAll(".key-list-container article, .new-order-item"),
    ];

    if (fanaticalRows.length) {
      return [...new Set(fanaticalRows)];
    }

    return [
      ...document.querySelectorAll("article, tr, li, .card, .row"),
    ].filter((row) => /reveal\s+key|redeem|key/i.test(row.textContent || ""));
  }

  function getName(row) {
    const source =
      row.querySelector(".name-icons-container") ||
      row.querySelector("[class*='name' i]") ||
      row.querySelector("h1, h2, h3, h4, a") ||
      row;

    const clone = source.cloneNode(true);
    clone
      .querySelectorAll("button, svg, img, .key-container, [class*='key' i]")
      .forEach((node) => node.remove());

    let name = cleanText(clone.textContent);
    name = name
      .replace(/\s*Bundle:\s*.*$/i, "")
      .replace(/\s*Purchased:\s*.*$/i, "")
      .replace(/\s*REVEAL\s*KEY.*$/i, "")
      .trim();

    return name;
  }

  function getKey(row) {
    const sources = [
      ...row.querySelectorAll(
        ".key-container, [class*='key' i], input, textarea, code, pre"
      ),
      row,
    ];

    for (const source of sources) {
      const candidates = [];

      if ("value" in source) {
        candidates.push(source.value);
      }

      candidates.push(source.getAttribute("value"));
      candidates.push(source.textContent);

      for (const candidate of candidates) {
        const text = cleanText(candidate).toUpperCase();
        const matches = text.match(KEY_RE) || [];
        const key = matches.find((match) => !/REVEAL|REDEEM/.test(match));
        if (key) {
          return key;
        }
      }
    }

    return "";
  }

  function getItems() {
    return getRows()
      .map((row) => ({
        row,
        name: getName(row),
        key: getKey(row),
      }))
      .filter((item) => item.name || item.key);
  }

  async function writeClipboard(text) {
    if (typeof GM_setClipboard === "function") {
      GM_setClipboard(text, "text");
      return;
    }

    await navigator.clipboard.writeText(text);
  }

  function getRevealButtons() {
    return [
      ...document.querySelectorAll(
        ".key-container button, button, [role='button'], input[type='button'], input[type='submit']"
      ),
    ].filter((button) => {
      const text = cleanText(
        button.innerText ||
          button.textContent ||
          button.value ||
          button.getAttribute("aria-label")
      );

      return /reveal\s+key/i.test(text) && !button.disabled;
    });
  }

  async function revealAllKeys() {
    const buttons = getRevealButtons();
    if (!buttons.length) {
      setStatus("No hidden keys found.");
      return;
    }

    setStatus(`Revealing ${buttons.length} key(s)...`);

    for (const button of buttons) {
      button.scrollIntoView({ block: "center", behavior: "instant" });
      button.click();
      await sleep(WAIT_AFTER_CLICK_MS);
      await clickConfirmRevealIfPresent();
    }

    await sleep(800);
    const revealed = getItems().filter((item) => item.key).length;
    setStatus(`Done. Found ${revealed} revealed key(s).`);
  }

  async function clickConfirmRevealIfPresent() {
    const confirm = [...document.querySelectorAll("button, [role='button']")]
      .filter((button) => {
        const text = cleanText(button.innerText || button.textContent);
        return /^(reveal|confirm|yes|ok)$/i.test(text) && !button.disabled;
      })
      .at(0);

    if (confirm) {
      confirm.click();
      await sleep(WAIT_AFTER_CLICK_MS);
    }
  }

  async function copyNames() {
    const names = getItems().map((item) => item.name).filter(Boolean);
    await copyLines(names, "name");
  }

  async function copyKeys() {
    const keys = getItems().map((item) => item.key).filter(Boolean);
    await copyLines(keys, "key");
  }

  async function copyNameKeyPairs() {
    const pairs = getItems()
      .filter((item) => item.name || item.key)
      .map((item) => `${item.name}:${item.key}`);

    await copyLines(pairs, "name:key pair");
  }

  async function copyLines(lines, label) {
    const uniqueLines = [...new Set(lines.filter(Boolean))];

    if (!uniqueLines.length) {
      setStatus(`No ${label}s found. Try "Reveal all keys" first.`);
      return;
    }

    await writeClipboard(uniqueLines.join("\n"));
    setStatus(`Copied ${uniqueLines.length} ${label}${uniqueLines.length === 1 ? "" : "s"}.`);
  }

  function setStatus(message) {
    const status = document.querySelector(`#${PANEL_ID} .tm-status`);
    if (status) {
      status.textContent = message;
    }
  }

  function addButton(panel, label, onClick) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.addEventListener("click", async () => {
      button.disabled = true;
      try {
        await onClick();
      } catch (error) {
        console.error("[Fanatical Key Tools]", error);
        setStatus(`Error: ${error.message || error}`);
      } finally {
        button.disabled = false;
      }
    });
    panel.appendChild(button);
  }

  function mountPanel() {
    if (document.getElementById(PANEL_ID)) {
      return;
    }

    const style = document.createElement("style");
    style.textContent = `
      #${PANEL_ID} {
        position: fixed;
        right: 16px;
        bottom: 16px;
        z-index: 2147483647;
        width: 220px;
        padding: 10px;
        border: 1px solid rgba(255,255,255,.18);
        border-radius: 8px;
        background: #12151c;
        box-shadow: 0 10px 30px rgba(0,0,0,.35);
        color: #f5f7fb;
        font: 12px/1.35 Arial, sans-serif;
      }
      #${PANEL_ID} .tm-title {
        margin: 0 0 8px;
        font-weight: 700;
      }
      #${PANEL_ID} button {
        display: block;
        width: 100%;
        margin: 6px 0 0;
        padding: 7px 8px;
        border: 0;
        border-radius: 6px;
        background: #2f7cf6;
        color: #fff;
        cursor: pointer;
        font: inherit;
        font-weight: 700;
        text-align: left;
      }
      #${PANEL_ID} button:hover {
        background: #4b8dff;
      }
      #${PANEL_ID} button:disabled {
        cursor: wait;
        opacity: .65;
      }
      #${PANEL_ID} .tm-status {
        margin-top: 8px;
        min-height: 16px;
        color: #b8c2d6;
      }
    `;

    const panel = document.createElement("div");
    panel.id = PANEL_ID;
    panel.innerHTML = `
      <div class="tm-title">Key Tools</div>
      <div class="tm-status">Ready.</div>
    `;

    addButton(panel, "Reveal all keys", revealAllKeys);
    addButton(panel, "Copy all names", copyNames);
    addButton(panel, "Copy all keys", copyKeys);
    addButton(panel, "Copy all name:key", copyNameKeyPairs);

    document.documentElement.append(style, panel);
  }

  mountPanel();
})();
