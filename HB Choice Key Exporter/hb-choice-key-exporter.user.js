// ==UserScript==
// @name         Humble Choice Key and Gift Link Exporter
// @namespace    https://humblebundle.com/
// @author       Zenny
// @version      1.6.1
// @description  Collect game names and revealed Steam keys or Humble gift links; copy already-revealed keys separately.
// @match        https://www.humblebundle.com/membership/home*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=humblebundle.com
// @run-at       document-idle
// @noframes
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  const HOST_ID = 'humble-key-collector-panel';
  const TILE_SELECTOR = '.content-choice-tiles.js-content-choice-tiles .choice-content.js-open-choice-modal';
  const TILE_FALLBACK_SELECTOR = '.content-choice-tiles .choice-content.js-open-choice-modal';
  const REDEEMER_SELECTOR = '.js-key-redeemer';
  const KEY_PATTERN = /\b[A-Z0-9]{5}(?:-[A-Z0-9]{5}){2}\b/i;

  if (document.getElementById(HOST_ID)) return;

  const state = {
    running: false,
    stopRequested: false,
    rows: [],
    revealedRows: []
  };

  function isVisible(element) {
    if (!element || !element.isConnected) return false;
    const style = window.getComputedStyle(element);
    return style.display !== 'none' &&
      style.visibility !== 'hidden' &&
      element.getClientRects().length > 0;
  }

  function cleanText(element) {
    return (element && (element.innerText || element.textContent) || '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function getControlLabel(element) {
    if (!element) return '';
    return [
      cleanText(element),
      element.getAttribute && element.getAttribute('title'),
      element.getAttribute && element.getAttribute('aria-label')
    ].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
  }

  function getSteamKeyControlLabel(element) {
    if (!element || !element.cloneNode) return getControlLabel(element);
    const control = element.cloneNode(true);
    control.querySelectorAll(
      '.steam-redeem-button, .js-steam-redeem-button, a[href*="/account/registerkey"]'
    ).forEach((redeemLink) => redeemLink.remove());
    return getControlLabel(control);
  }

  function isBlizzardOrRedeemControl(element, labelOverride) {
    const label = labelOverride === undefined ? getControlLabel(element) : labelOverride;
    const isRedeemAction = /\bredeem(?:ed)?\b/i.test(label) &&
      !/\bmust be redeemed\b/i.test(label);
    const isSteamRedeemLink = element && element.matches && element.matches(
      '.steam-redeem-button, .js-steam-redeem-button, a[href*="/account/registerkey"]'
    );
    return isRedeemAction || isSteamRedeemLink || /blizzard|battle[\s.-]*net/i.test(label);
  }

  function isBlizzardContext(redeemer) {
    const rootText = cleanText(getModalRoot(redeemer));
    return /blizzard|battle[\s.-]*net/i.test(rootText);
  }

  function isSafeSteamKeyControl(element) {
    const isKeyField = element && element.matches && element.matches('.js-keyfield, .keyfield');
    const label = isKeyField ? getSteamKeyControlLabel(element) : getControlLabel(element);
    const hasExplicitSteamAction =
      /\b(?:get|reveal|show|view)\b.{0,24}\b(?:game on steam|steam key)\b/i.test(label) ||
      /\b(?:get|reveal|show|view)\b.{0,24}\bkey\b.{0,16}\bsteam\b/i.test(label);
    return !isBlizzardOrRedeemControl(element, label) && hasExplicitSteamAction;
  }

  function getTiles() {
    const exact = Array.from(document.querySelectorAll(TILE_SELECTOR)).filter(isVisible);
    if (exact.length) return exact;
    return Array.from(document.querySelectorAll(TILE_FALLBACK_SELECTOR)).filter(isVisible);
  }

  function getTileName(tile, index) {
    if (!tile) return 'Game #' + (index + 1);

    const isGeneric = (name) =>
      !name || name.length > 160 ||
      /\bUS\$\s*\d/i.test(name) ||
      /^(game(?:\s+#?\d+)?|details|more info|view|open|reveal|claim|steam key|get key|gift|learn more|download|play)$/i.test(name);
    const attributeSelector = '[data-title], [data-name], [aria-label], [title], img[alt]';
    const attributeCandidates = [tile, ...tile.querySelectorAll(attributeSelector)];

    for (const candidate of attributeCandidates) {
      if (candidate !== tile && !isVisible(candidate)) continue;
      const rawName = [
        candidate.getAttribute && candidate.getAttribute('data-title'),
        candidate.getAttribute && candidate.getAttribute('data-name'),
        candidate.getAttribute && candidate.getAttribute('aria-label'),
        candidate.getAttribute && candidate.getAttribute('title'),
        candidate.getAttribute && candidate.getAttribute('alt')
      ].find(Boolean) || '';
      const name = rawName.replace(/^(open|view|select)\s+/i, '').trim();
      if (!isGeneric(name)) return name;
    }

    const selector = 'div.title, .title, .game-title, .content-title, .choice-title, h1, h2, h3';
    const candidates = [];
    if (tile.matches && tile.matches(selector)) candidates.push(tile);
    candidates.push(...tile.querySelectorAll(selector));

    for (const candidate of candidates) {
      if (!isVisible(candidate)) continue;
      const name = cleanText(candidate);
      if (!isGeneric(name)) return name;
    }

    const textLines = String(tile.innerText || tile.textContent || '')
      .split(/\r?\n/)
      .map((line) => line.replace(/\s+/g, ' ').trim())
      .filter(Boolean);
    for (const line of textLines) {
      if (!isGeneric(line) && !/\b(?:reveal|redeem|gift|download|install)\b/i.test(line)) return line;
    }

    return 'Game #' + (index + 1);
  }

  function getVisibleRedeemer() {
    const exact = Array.from(document.querySelectorAll(REDEEMER_SELECTOR)).find(isVisible);
    if (exact) return exact;

    const fieldSelector = '.js-keyfield, .keyfield, .giftfield';
    const modalSelector =
      '[role="dialog"], .js-modal, .modal, .modal-window, .modal-container, ' +
      '.redeemer-modal, .js-redeemer-modal';
    const visibleModal = Array.from(document.querySelectorAll(modalSelector)).find((modal) =>
      isVisible(modal) &&
      Array.from(modal.querySelectorAll(fieldSelector)).some(isVisible)
    );
    if (visibleModal) return visibleModal;

    return Array.from(document.querySelectorAll(fieldSelector)).find(isVisible) || null;
  }

  function getModalRoot(redeemer) {
    if (!redeemer) return document;

    const closeSelector =
      'a.js-close-modal.close-modal.is-claimed, .js-close-modal.close-modal, .js-close-modal';
    let ancestor = redeemer.parentElement;
    for (let depth = 0; ancestor && depth < 12; depth += 1, ancestor = ancestor.parentElement) {
      const hasVisibleClose = Array.from(ancestor.querySelectorAll(closeSelector)).some(isVisible);
      const hasVisibleFields = Array.from(
        ancestor.querySelectorAll('.js-keyfield, .keyfield, .giftfield')
      ).some(isVisible);
      if (hasVisibleClose && hasVisibleFields) return ancestor;
    }

    const knownRoot = redeemer.closest(
      '[role="dialog"], .js-modal, .modal, .modal-window, .modal-container, .redeemer-modal, .js-redeemer-modal'
    );
    if (knownRoot) return knownRoot;

    let node = redeemer.parentElement;
    for (let depth = 0; node && depth < 7; depth += 1, node = node.parentElement) {
      if (node.querySelector('div.title, .giftfield, .js-keyfield')) return node;
    }
    return redeemer.parentElement || document;
  }

  function getGameName(redeemer, titlesBeforeOpen, fallbackName) {
    const heading = redeemer.matches('.heading-text')
      ? redeemer
      : redeemer.querySelector('.heading-text');

    if (heading && isVisible(heading)) {
      const headingName = cleanText(heading);
      if (headingName) return headingName;
    }

    const root = getModalRoot(redeemer);
    const titleSelector = 'div.title, .title, .game-title, .content-title';
    const localTitles = Array.from(root.querySelectorAll(titleSelector)).filter(isVisible);
    if (localTitles.length === 1) {
      const titleName = cleanText(localTitles[0]);
      if (titleName) return titleName;
    }

    const visibleTitles = Array.from(document.querySelectorAll(titleSelector)).filter(isVisible);
    if (fallbackName && !/^Game\s+#?\d+$/i.test(fallbackName)) return fallbackName;

    const newlyShownTitle = visibleTitles.find((title) => !titlesBeforeOpen.has(title));
    if (newlyShownTitle) {
      const titleName = cleanText(newlyShownTitle);
      if (titleName) return titleName;
    }

    const firstTitle = visibleTitles[0];
    return fallbackName || cleanText(firstTitle) || '(Could not read game name)';
  }

  function getGameNameForKeyField(redeemer, keyField, fallbackName) {
    const root = getModalRoot(redeemer);
    const titleSelectorGroups = [
      '.heading-text',
      'div.title, .title, .game-title, .content-title',
      'h1, h2, h3, h4, h5'
    ];
    let node = keyField;

    while (node && root.contains(node)) {
      for (const selector of titleSelectorGroups) {
        const candidates = [];
        if (node.matches && node.matches(selector)) candidates.push(node);
        candidates.push(...node.querySelectorAll(selector));
        const visibleTitles = Array.from(new Set(candidates.filter(isVisible)));

        if (visibleTitles.length) {
          if (visibleTitles.length === 1) {
            const titleName = cleanText(visibleTitles[0]);
            if (titleName && titleName.toLowerCase() !== String(fallbackName || '').toLowerCase()) {
              return titleName;
            }
          }
          break;
        }
      }
      if (node === root) break;
      node = node.parentElement;
    }

    return fallbackName;
  }

  function waitFor(readValue, timeoutMs, timeoutMessage, ignoreStop) {
    return new Promise((resolve, reject) => {
      const deadline = Date.now() + timeoutMs;
      let intervalId = null;
      let observer = null;
      let settled = false;

      function finish(error, value) {
        if (settled) return;
        settled = true;
        if (intervalId !== null) window.clearInterval(intervalId);
        if (observer) observer.disconnect();
        if (error) reject(error);
        else resolve(value);
      }

      function check() {
        if (state.stopRequested && !ignoreStop) {
          finish(new Error('Stopped by user.'));
          return;
        }

        let value = null;
        try {
          value = readValue();
        } catch (_) {
          value = null;
        }

        if (value) {
          finish(null, value);
          return;
        }
        if (Date.now() >= deadline) finish(new Error(timeoutMessage));
      }

      observer = new MutationObserver(check);
      observer.observe(document.documentElement, {
        subtree: true,
        childList: true,
        attributes: true,
        characterData: true
      });
      intervalId = window.setInterval(check, 200);
      check();
    });
  }

  function clickElement(element) {
    if (!element || !isVisible(element)) throw new Error('Could not find the control to click.');
    element.scrollIntoView({ block: 'center', inline: 'center' });
    element.click();
  }

  function findGiftField(redeemer) {
    const root = getModalRoot(redeemer);
    const selector = '.giftfield, .js-keyfield, .keyfield, button, a, [role="button"]';
    const candidates = [];
    if (redeemer.matches(selector)) candidates.push(redeemer);
    candidates.push(...root.querySelectorAll(selector));

    const giftLabelPattern =
      /\bgift\s+to\s+(?:a\s+)?friend\s+on\s+(?:blizzard|battle[\s.-]*net)\b/i;
    const matches = candidates.filter((element) =>
      isVisible(element) && giftLabelPattern.test(getControlLabel(element))
    );
    return matches.find((element) => element.classList.contains('giftfield')) ||
      matches.sort((left, right) =>
        getControlLabel(left).length - getControlLabel(right).length
      )[0] || null;
  }

  function findCreateGiftLinkButton(redeemer) {
    const selector =
      'button, a, input[type="button"], input[type="submit"], [role="button"]';
    const activeRedeemer = redeemer || getVisibleRedeemer();
    const modalRoot = getModalRoot(activeRedeemer);
    const roots = modalRoot === document ? [document] : [modalRoot, document];
    const labelPattern = /\bcreate\s+(?:a\s+)?gift\s+link\b/i;

    for (const root of roots) {
      const candidates = [];
      if (root.matches && root.matches(selector)) candidates.push(root);
      candidates.push(...root.querySelectorAll(selector));
      const match = candidates.find((element) =>
        isVisible(element) && labelPattern.test(getControlLabel(element))
      );
      if (match) return match;
    }
    return null;
  }

  function normalizeGiftLink(rawValue) {
    const value = String(rawValue || '').trim();
    if (!value) return null;

    let candidate = value.match(
      /https?:\/\/(?:www\.)?humblebundle\.com\/gift\?key=[^\s"'<>]+/i
    );
    if (candidate) {
      candidate = candidate[0].replace(/[.,;)\]}]+$/, '');
    } else {
      candidate = value.match(/(?:^|\s)(\/gift\?key=[^\s"'<>]+)/i);
      candidate = candidate ? candidate[1].replace(/[.,;)\]}]+$/, '') : value;
    }

    try {
      const url = new URL(candidate, location.origin);
      const hostIsHumble = /(^|\.)humblebundle\.com$/i.test(url.hostname);
      if (hostIsHumble && url.pathname === '/gift' && url.searchParams.get('key')) {
        return url.href;
      }
    } catch (_) {
      return null;
    }
    return null;
  }

  function extractGiftLink(redeemer) {
    if (!redeemer) return null;
    const root = getModalRoot(redeemer);
    const candidates = [root, ...root.querySelectorAll(
      'a[href], input, textarea, [data-clipboard-text], [data-copy-text], .giftfield, .keyfield-value'
    )];

    for (const element of candidates) {
      if (!isVisible(element)) continue;
      const directValues = [
        element.href,
        element.value,
        element.getAttribute && element.getAttribute('data-clipboard-text'),
        element.getAttribute && element.getAttribute('data-copy-text'),
        element.getAttribute && element.getAttribute('href')
      ];
      for (const value of directValues) {
        const link = normalizeGiftLink(value);
        if (link) return link;
      }
    }

    const text = root.innerText || root.textContent || '';
    const match = text.match(/https?:\/\/(?:www\.)?humblebundle\.com\/gift\?key=[^\s"'<>]+/i);
    return match ? normalizeGiftLink(match[0]) : null;
  }

  function findKeyFields(redeemer) {
    const root = getModalRoot(redeemer);
    const selector = '.js-keyfield, .keyfield';
    const candidates = [];
    if (root.matches && root.matches(selector)) candidates.push(root);
    candidates.push(...root.querySelectorAll(selector));

    return candidates.filter((element) => {
      if (!isVisible(element) || element.closest('.giftfield')) return false;
      if (extractGameKey(element)) return !element.querySelector(selector);

      const label = getSteamKeyControlLabel(element);
      if (/gift to friend on/i.test(label) || isBlizzardOrRedeemControl(element, label)) {
        return false;
      }
      if (!isSafeSteamKeyControl(element)) return false;
      return !element.querySelector(selector);
    });
  }

  function normalizeGameName(name) {
    return String(name || '').replace(/\s+/g, ' ').trim().toLowerCase();
  }

  function findKeyFieldForEntry(redeemer, entry, originalField) {
    const root = getModalRoot(redeemer);
    if (originalField && originalField.isConnected && root.contains(originalField)) {
      return originalField;
    }

    const fields = findKeyFields(redeemer);
    const matchingFields = fields.filter((field) =>
      normalizeGameName(getGameNameForKeyField(redeemer, field, entry.fallbackName)) ===
      entry.normalizedName
    );
    return matchingFields[entry.nameOccurrence] || fields[entry.fieldIndex] || null;
  }

  function extractGameKey(keyField) {
    if (!keyField || !isVisible(keyField)) return null;
    const elements = [
      keyField,
      ...keyField.querySelectorAll('.keyfield-value, input, textarea, [data-key]')
    ];
    const texts = [];

    for (const element of elements) {
      if (!isVisible(element)) continue;
      texts.push(element.value || '');
      texts.push(element.getAttribute && element.getAttribute('data-key') || '');
      texts.push(element.innerText || element.textContent || '');
    }

    const match = texts.join(' ').match(KEY_PATTERN);
    return match ? match[0] : null;
  }

  function collectVisibleKeys(root) {
    if (!root || !root.querySelectorAll) return [];

    const elements = [root, ...root.querySelectorAll('*')].filter((element) =>
      isVisible(element) && !(element.closest && element.closest('#' + HOST_ID))
    );
    const keysByValue = new Map();

    for (const element of elements) {
      const text = [
        typeof element.value === 'string' ? element.value : '',
        element.getAttribute && element.getAttribute('data-key') || '',
        element.getAttribute && element.getAttribute('data-clipboard-text') || '',
        element.getAttribute && element.getAttribute('data-copy-text') || '',
        element.innerText || element.textContent || ''
      ].filter(Boolean).join(' ');

      const matches = text.match(new RegExp(KEY_PATTERN.source, 'gi')) || [];
      for (const rawKey of matches) {
        const key = rawKey.toUpperCase();
        const score = text.length;
        const current = keysByValue.get(key);
        if (!current || score < current.score) {
          keysByValue.set(key, { key, element, score });
        }
      }
    }

    return Array.from(keysByValue.values()).map(({ key, element }) => ({ key, element }));
  }

  function dispatchEscape() {
    const eventOptions = {
      key: 'Escape',
      code: 'Escape',
      keyCode: 27,
      which: 27,
      bubbles: true
    };
    document.dispatchEvent(new KeyboardEvent('keydown', eventOptions));
    document.dispatchEvent(new KeyboardEvent('keyup', eventOptions));
  }

  async function closeCurrentModal() {
    const redeemer = getVisibleRedeemer();
    if (!redeemer) return true;

    const root = getModalRoot(redeemer);
    const closeSelectors =
      'button[aria-label*="close" i], [role="button"][aria-label*="close" i], ' +
      'a.js-close-modal.close-modal.is-claimed, .js-close-modal.close-modal.is-claimed, ' +
      'a.js-close-modal, .js-close-modal, .close-modal, ' +
      '.js-modal-close, .js-close, .modal-close, .close-button, .hb-close, .close';
    const exactCloseSelector = 'a.js-close-modal.close-modal.is-claimed';
    const closeButton =
      Array.from(root.querySelectorAll(exactCloseSelector)).find(isVisible) ||
      Array.from(document.querySelectorAll(exactCloseSelector)).find(isVisible) ||
      Array.from(root.querySelectorAll(closeSelectors)).find(isVisible) ||
      Array.from(document.querySelectorAll(closeSelectors)).find(isVisible);

    if (closeButton) {
      try {
        clickElement(closeButton);
      } catch (_) {
        dispatchEscape();
      }
    } else {
      dispatchEscape();
    }

    const closed = await waitFor(
      () => !getVisibleRedeemer(),
      3500,
      'The dialog did not close.',
      true
    ).then(() => true, () => false);

    if (closed) return true;

    dispatchEscape();
    return waitFor(
      () => !getVisibleRedeemer(),
      2500,
      'The dialog did not close.',
      true
    ).then(() => true, () => false);
  }

  function createPanel() {
    const host = document.createElement('div');
    host.id = HOST_ID;
    host.style.position = 'fixed';
    host.style.right = '16px';
    host.style.bottom = '16px';
    host.style.zIndex = '2147483647';
    document.documentElement.appendChild(host);

    const shadow = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = [
      ':host{font-family:Arial,sans-serif;color:#1f2937;}',
      '#panel{width:390px;max-height:70vh;background:#fff;border:1px solid #cbd5e1;border-radius:10px;box-shadow:0 8px 30px #0003;display:flex;flex-direction:column;overflow:hidden;}',
      'header{padding:12px 14px;background:#f3f4f6;font-size:14px;font-weight:700;}',
      '#status{margin:0;padding:10px 14px;font-size:12px;line-height:1.45;border-bottom:1px solid #e5e7eb;}',
      '.actions{padding:10px 12px;display:flex;flex-wrap:wrap;gap:7px;border-bottom:1px solid #e5e7eb;}',
      'button{border:0;border-radius:6px;padding:8px 10px;background:#2563eb;color:#fff;font-size:12px;cursor:pointer;}',
      'button.secondary{background:#475569;}',
      'button.danger{background:#b91c1c;}',
      'button:disabled{opacity:.5;cursor:not-allowed;}',
      '#progress{padding:6px 12px;color:#475569;font-size:11px;}',
      '#table-wrap{overflow:auto;min-height:32px;}',
      'table{width:100%;border-collapse:collapse;font-size:12px;}',
      'th,td{text-align:left;vertical-align:top;padding:7px 9px;border-top:1px solid #e5e7eb;overflow-wrap:anywhere;}',
      'th{position:sticky;top:0;background:#f8fafc;}',
      'td.value{font-family:Consolas,monospace;}',
      'tr.error td{color:#b91c1c;}'
    ].join('\n');

    const content = document.createElement('div');
    content.id = 'panel';
    content.innerHTML =
      '<header>Humble Bundle: Key / Gift Link Collector</header>' +
      '<p id="status">Start Scan keeps the original reveal and gift-link flow. Copy All Revealed only reads keys already shown.</p>' +
      '<div class="actions">' +
        '<button id="start">Start Scan</button>' +
        '<button id="copy-revealed" class="secondary">Copy All Revealed</button>' +
        '<button id="stop" class="danger" disabled>Stop</button>' +
        '<button id="copy" class="secondary" disabled>Copy TSV</button>' +
        '<button id="download" class="secondary" disabled>Download TXT</button>' +
        '<button id="clear" class="secondary">Clear Results</button>' +
      '</div>' +
      '<div id="progress">Not started.</div>' +
      '<div id="table-wrap"><table><thead><tr><th>Game Name</th><th>Game Key/Gift Link</th></tr></thead>' +
      '<tbody id="rows"></tbody></table></div>';

    shadow.append(style, content);
    return { host, shadow };
  }

  const panel = createPanel();
  const statusNode = panel.shadow.querySelector('#status');
  const progressNode = panel.shadow.querySelector('#progress');
  const rowsNode = panel.shadow.querySelector('#rows');
  const startButton = panel.shadow.querySelector('#start');
  const copyRevealedButton = panel.shadow.querySelector('#copy-revealed');
  const stopButton = panel.shadow.querySelector('#stop');
  const copyButton = panel.shadow.querySelector('#copy');
  const downloadButton = panel.shadow.querySelector('#download');
  const clearButton = panel.shadow.querySelector('#clear');

  function exportText() {
    const lines = [];
    for (const row of state.rows) {
      lines.push(
        String(row.name || '').replace(/[\t\r\n]+/g, ' ') +
        '\t' +
        String(row.value || '').replace(/[\t\r\n]+/g, ' ')
      );
    }
    return lines.join('\r\n');
  }

  function renderRows() {
    rowsNode.replaceChildren();

    for (const row of state.rows) {
      const tr = document.createElement('tr');
      if (row.error) tr.className = 'error';

      const nameCell = document.createElement('td');
      nameCell.textContent = row.name || '(Could not read game name)';

      const valueCell = document.createElement('td');
      valueCell.className = 'value';
      valueCell.textContent = row.value || '';

      tr.append(nameCell, valueCell);
      rowsNode.appendChild(tr);
    }

    copyButton.disabled = state.rows.length === 0;
    downloadButton.disabled = state.rows.length === 0;
    copyRevealedButton.disabled = state.running;
  }

  async function copyResults() {
    const text = exportText();
    try {
      await navigator.clipboard.writeText(text);
      statusNode.textContent = 'Copied TSV results to the clipboard.';
    } catch (_) {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.left = '-10000px';
      document.body.appendChild(textarea);
      textarea.select();
      const copied = document.execCommand('copy');
      textarea.remove();
      statusNode.textContent = copied
        ? 'Copied TSV results to the clipboard.'
        : 'Could not copy. Select and copy the results table.';
    }
  }

  function downloadResults() {
    const blob = new Blob([exportText()], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'humble-membership-keys-' +
      new Date().toISOString().slice(0, 10) + '.txt';
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1500);
    statusNode.textContent = 'Downloaded the TSV-formatted TXT file.';
  }

  function exportRevealedText() {
    const lines = [];
    for (const row of state.revealedRows) {
      lines.push(
        String(row.name || '').replace(/[\t\r\n]+/g, ' ') +
        '\t' +
        String(row.value || '').replace(/[\t\r\n]+/g, ' ')
      );
    }
    return lines.join('\r\n');
  }

  async function writeClipboardText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (_) {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.left = '-10000px';
      document.body.appendChild(textarea);
      textarea.select();
      const copied = document.execCommand('copy');
      textarea.remove();
      return copied;
    }
  }

  async function copyAllRevealed() {
    if (state.running) return;

    if (state.revealedRows.length) {
      const copied = await writeClipboardText(exportRevealedText());
      statusNode.textContent = copied
        ? 'Copied ' + state.revealedRows.length + ' already-revealed keys and existing gift links.'
        : 'Clipboard copy failed. Click Copy All Revealed again to retry the saved results.';
      return;
    }

    let tiles;
    try {
      tiles = getTiles();
    } catch (cause) {
      statusNode.textContent = 'Could not inspect game tiles: ' +
        (cause && cause.message || 'Unknown page error.');
      return;
    }
    if (!tiles.length) {
      statusNode.textContent =
        'No game tiles found. Make sure this is the Humble Choice Membership page.';
      return;
    }

    state.running = true;
    state.stopRequested = false;
    state.revealedRows = [];
    startButton.disabled = true;
    copyRevealedButton.disabled = true;
    stopButton.disabled = false;
    progressNode.textContent = 'Found ' + tiles.length + ' game tiles.';

    let skipped = 0;
    let copySucceeded = false;
    let scanError = '';

    try {
      for (let index = 0; index < tiles.length; index += 1) {
        if (state.stopRequested) break;

        if (getVisibleRedeemer()) {
          const closed = await closeCurrentModal();
          if (!closed) throw new Error('Could not close the open game dialog.');
        }

        let tile = tiles[index];
        if (!tile || !tile.isConnected) tile = getTiles()[index];
        if (!tile) {
          skipped += 1;
          continue;
        }

        const fallbackName = getTileName(tile, index);
        const titlesBeforeOpen = new Set(
          Array.from(document.querySelectorAll('div.title, .title, .game-title')).filter(isVisible)
        );

        try {
          statusNode.textContent =
            'Reading already-revealed keys and existing gift links from game ' + (index + 1) + '/' + tiles.length + '. No reveal or gift action will be performed.';
          clickElement(tile);

          const redeemer = await waitFor(
            getVisibleRedeemer,
            15000,
            'Could not find the game details after opening the tile.'
          );
          const gameName = getGameName(redeemer, titlesBeforeOpen, fallbackName);
          const giftLink = extractGiftLink(redeemer);
          const keyEntries = collectVisibleKeys(getModalRoot(redeemer));
          const foundExistingItem = Boolean(giftLink || keyEntries.length);

          if (giftLink && !state.revealedRows.some((row) => row.value === giftLink)) {
            state.revealedRows.push({ name: gameName, value: giftLink });
          }

          for (const entry of keyEntries) {
            const key = entry.key.toUpperCase();
            if (state.revealedRows.some((row) => row.value === key)) continue;
            const name = getGameNameForKeyField(redeemer, entry.element, gameName) || gameName;
            state.revealedRows.push({ name, value: key });
          }
          if (!foundExistingItem) skipped += 1;
        } catch (cause) {
          if (!state.stopRequested) skipped += 1;
        }

        if (getVisibleRedeemer()) {
          const closed = await closeCurrentModal();
          if (!closed) throw new Error('Could not close the game dialog to continue.');
        }

        progressNode.textContent = 'Processed ' + (index + 1) + '/' + tiles.length + ' game tiles.';
      }

      if (state.revealedRows.length) {
        copySucceeded = await writeClipboardText(exportRevealedText());
      }
    } catch (cause) {
      scanError = cause && cause.message || 'Unexpected scan error.';
    } finally {
      const wasStopped = state.stopRequested;
      state.running = false;
      startButton.disabled = false;
      copyRevealedButton.disabled = false;
      stopButton.disabled = true;

      if (scanError) {
        statusNode.textContent = 'Scan stopped: ' + scanError + '. Found ' +
          state.revealedRows.length + ' revealed keys so far.';
      } else if (wasStopped) {
        statusNode.textContent = 'Stopped. Found ' + state.revealedRows.length +
          ' revealed keys; skipped ' + skipped + ' tiles.';
      } else if (!state.revealedRows.length) {
        statusNode.textContent = 'No already-revealed Steam keys or existing gift links found. Skipped ' + skipped + ' tiles.';
      } else if (copySucceeded) {
        statusNode.textContent = 'Copied ' + state.revealedRows.length +
          ' already-revealed keys and existing gift links. Skipped ' + skipped + ' tiles.';
      } else {
        statusNode.textContent = 'Found ' + state.revealedRows.length +
          ' revealed keys, but clipboard copy failed. Click Copy All Revealed again to retry.';
      }
      state.stopRequested = false;
      renderRows();
    }
  }

  async function processTile(tile, index, total) {
    let fallbackName = 'Game #' + (index + 1);
    const rows = [];
    const titlesBeforeOpen = new Set(
      Array.from(document.querySelectorAll('div.title')).filter(isVisible)
    );

    try {
      if (!tile || !tile.isConnected) {
        tile = getTiles()[index];
      }
      if (!tile) throw new Error('Could not find this game tile.');
      fallbackName = getTileName(tile, index);

      statusNode.textContent =
        'Opening game ' + (index + 1) + '/' + total + ' to collect its name and key/link.';
      clickElement(tile);

      let redeemer = await waitFor(
        getVisibleRedeemer,
        15000,
        'Could not find .js-key-redeemer after opening the game tile.'
      );

      const gameName = getGameName(redeemer, titlesBeforeOpen, fallbackName);
      let processedAny = false;

      const giftField = findGiftField(redeemer);
      if (giftField) {
        try {
          let giftLink = extractGiftLink(redeemer);
          if (!giftLink) {
            clickElement(giftField);
            const createGiftLinkButton = await waitFor(
              () => findCreateGiftLinkButton(getVisibleRedeemer()),
              15000,
              'Timed out waiting for the Create gift link button.'
            );
            clickElement(createGiftLinkButton);
            giftLink = await waitFor(
              () => extractGiftLink(getVisibleRedeemer()),
              45000,
              'Timed out waiting for the gift link.'
            );
          }
          rows.push({ name: gameName, value: giftLink, error: false });
          processedAny = true;
        } catch (cause) {
          if (!state.stopRequested) {
            rows.push({
              name: gameName,
              value: 'Error: ' + (cause && cause.message || 'Could not create the gift link.'),
              error: true
            });
            processedAny = true;
          }
        }
      } else if (isBlizzardContext(redeemer)) {
        rows.push({
          name: gameName,
          value: 'Blizzard/Battle.net detected without a gift-link control. Nothing was clicked.',
          error: true
        });
        processedAny = true;
      } else {
        const keyFields = findKeyFields(redeemer);
        const nameOccurrences = new Map();
        const keyEntries = keyFields.map((field, fieldIndex) => {
          const name = getGameNameForKeyField(redeemer, field, gameName);
          const normalizedName = normalizeGameName(name);
          const nameOccurrence = nameOccurrences.get(normalizedName) || 0;
          nameOccurrences.set(normalizedName, nameOccurrence + 1);
          return {
            field,
            fieldIndex,
            name,
            normalizedName,
            nameOccurrence,
            fallbackName: gameName
          };
        });

        for (const entry of keyEntries) {
          if (state.stopRequested) break;

          try {
            const currentRedeemer = getVisibleRedeemer() || redeemer;
            let keyField = findKeyFieldForEntry(currentRedeemer, entry, entry.field);
            if (!keyField) throw new Error('Could not find this key field.');

            let key = extractGameKey(keyField);
            if (!key) {
              if (!isSafeSteamKeyControl(keyField)) {
                throw new Error('Refusing to click a non-Steam or redemption control.');
              }
              if (!keyField.classList.contains('enabled')) {
                throw new Error('Key field is not enabled and no key was found.');
              }
              clickElement(keyField);
              key = await waitFor(() => {
                const currentRedeemer = getVisibleRedeemer() || redeemer;
                const currentField = findKeyFieldForEntry(currentRedeemer, entry, keyField);
                return extractGameKey(currentField);
              }, 60000, 'Timed out waiting for the game key.');
            }

            rows.push({ name: entry.name, value: key, error: false });
            processedAny = true;
          } catch (cause) {
            if (state.stopRequested) break;
            rows.push({
              name: entry.name,
              value: 'Error: ' + (cause && cause.message || 'Could not process this key field.'),
              error: true
            });
            processedAny = true;
          }
        }

        if (!processedAny && !state.stopRequested) {
          throw new Error('No Blizzard gift field or safe Steam key field was found. Nothing was clicked.');
        }
      }
    } catch (cause) {
      if (!state.stopRequested) {
        rows.push({
          name: fallbackName,
          value: 'Error: ' + (cause && cause.message || 'Could not process this game tile.'),
          error: true
        });
      }
    }

    await closeCurrentModal();
    return rows;
  }

  async function runCollection() {
    if (state.running) return;

    let tiles;
    try {
      tiles = getTiles();
    } catch (cause) {
      statusNode.textContent = 'Could not inspect game tiles: ' +
        (cause && cause.message || 'Unknown page error.');
      return;
    }

    if (!tiles.length) {
      statusNode.textContent =
        'No game tiles found. Make sure this is the Humble Choice Membership page.';
      return;
    }

    state.running = true;
    state.stopRequested = false;
    state.rows = [];
    state.revealedRows = [];
    renderRows();
    startButton.disabled = true;
    copyRevealedButton.disabled = true;
    stopButton.disabled = false;
    progressNode.textContent = 'Found ' + tiles.length + ' game tiles.';

    try {
      for (let index = 0; index < tiles.length; index += 1) {
        if (state.stopRequested) break;

        if (getVisibleRedeemer()) {
          const closed = await closeCurrentModal();
          if (!closed) {
            state.rows.push({
              name: '(Dialog still open)',
              value: 'Error: could not close the dialog to continue.',
              error: true
            });
            renderRows();
            break;
          }
        }

        const rows = await processTile(tiles[index], index, tiles.length);
        if (rows.length) {
          state.rows.push(...rows);
          renderRows();
        }

        progressNode.textContent = 'Processed ' +
          Math.min(index + 1, tiles.length) + '/' + tiles.length + ' game tiles.';

        if (state.stopRequested) break;
      }
    } catch (cause) {
      if (!state.stopRequested) {
        state.rows.push({
          name: '(Scan)',
          value: 'Error: ' + (cause && cause.message || 'Unexpected scan error.'),
          error: true
        });
        renderRows();
      }
    } finally {
      const wasStopped = state.stopRequested;
      state.running = false;
      startButton.disabled = false;
      copyRevealedButton.disabled = false;
      stopButton.disabled = true;

      const successes = state.rows.filter((row) => !row.error).length;
      const failures = state.rows.length - successes;
      if (wasStopped) {
        statusNode.textContent = 'Stopped. Collected ' + successes +
          ' items; ' + failures + ' failed.';
      } else {
        statusNode.textContent = 'Complete. Collected ' + successes +
          ' items; ' + failures + ' failed. Use Copy TSV or Download TXT to export.';
      }
      state.stopRequested = false;
    }
  }

  startButton.addEventListener('click', runCollection);
  copyRevealedButton.addEventListener('click', copyAllRevealed);
  stopButton.addEventListener('click', () => {
    state.stopRequested = true;
    statusNode.textContent = 'Stopping after the current step...';
  });
  copyButton.addEventListener('click', copyResults);
  downloadButton.addEventListener('click', downloadResults);
  clearButton.addEventListener('click', () => {
    if (state.running) return;
    state.rows = [];
    state.revealedRows = [];
    renderRows();
    progressNode.textContent = 'Results cleared.';
    statusNode.textContent = 'Click "Start Scan" to run again.';
  });
})();