// ==UserScript==
// @name         Xbox/Microsoft Redeem Code Checker
// @namespace    codex.local.xbox-redeem-checker
// @version      2.1.0
// @author       Zenny
// @description  Batch-check your own Xbox/Microsoft redeem codes, capture product names after Next, and stop before final confirmation/redeem.
// @match        https://www.xbox.com/*/redeem*
// @match        https://redeem.microsoft.com/*
// @match        https://www.microsoft.com/*/redeem*
// @match        https://account.microsoft.com/*redeem*
// @match        https://account.microsoft.com/billing/redeem*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=xbox.com
// @grant        GM_setClipboard
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_addValueChangeListener
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  const app = {
    running: false,
    stopRequested: false,
    originalUrl: location.href,
    results: [],
    delayMs: 3200,
    settleMs: 1200,
    waitMs: 9000,
    clickNextIfNeeded: true,
    payloadId: '',
    handledPayloadId: '',
    seenResultIds: new Set(),
    resultWaiters: new Map(),
    singleRunFromController: false,
    resumeIndex: 0,
    sessionId: '',
  };

  const IS_TOP = window.self === window.top;
  const STORAGE = {
    payload: 'xrc_payload_v1',
    result: 'xrc_result_v1',
    session: 'xrc_session_v1',
  };
  const VERSION = '2.1.0';

  const SELECTORS = {
    codeInput: [
      'input[name*="code" i]',
      'input[id*="code" i]',
      'input[aria-label*="code" i]',
      'input[placeholder*="code" i]',
      'input[name*="token" i]',
      'input[id*="token" i]',
      'input[aria-label*="token" i]',
      'input[placeholder*="token" i]',
      'input[type="text"]',
      'textarea',
    ].join(','),
    messages: [
      '[role="alert"]',
      '[aria-live]',
      '[data-testid*="error" i]',
      '[class*="error" i]',
      '[id*="error" i]',
      '.ms-TextField-errorMessage',
      '.c-alert',
      '.alert',
    ].join(','),
  };

  const ERROR_WORDS = [
    'already redeemed',
    'already been redeemed',
    'already used',
    'invalid',
    'not valid',
    'not recognized',
    "doesn't work",
    'does not work',
    'cannot be redeemed',
    "can't be redeemed",
    'could not be redeemed',
    'different region',
    'different country',
    'different market',
    'purchased in a different region',
    'not available in your region',
    'geo restricted',
    'expired',
    'try again',
    'something went wrong',
    'contact the seller',
    'check the instructions',
  ];

  const CONFIRM_WORDS = [
    'confirm',
    'redeem',
    'review',
    'add to your account',
    'will be added',
    'ready to redeem',
    'you are about to',
    "you're about to",
  ];

  const FIRST_STEP_BUTTONS = ['next', 'continue', 'submit'];
  const FINAL_BUTTONS = ['confirm', 'redeem', 'buy', 'purchase', 'place order'];
  const CLOSE_BUTTONS = ['close', 'cancel', 'back', 'go back', 'not now'];
  const REOPEN_BUTTONS = ['redeem now', 'redeem xbox code or gift card now', 'redeem a code', 'redeem code'];
  const PRODUCT_SKIP_WORDS = [
    'confirm',
    'redeem',
    'next',
    'continue',
    'cancel',
    'close',
    'back',
    'code',
    'microsoft',
    'xbox',
    'ready to redeem',
    'you are about to',
    "you're about to",
    'will be added',
    'add to your account',
    'here is what you get',
    'store terms',
    'usage rules',
    'no refunds',
    'terms',
    'privacy',
  ];

  function css(el, prop) {
    return getComputedStyle(el).getPropertyValue(prop);
  }

  function isVisible(el) {
    if (!el || !(el instanceof HTMLElement)) return false;
    if (el.disabled || el.getAttribute('aria-disabled') === 'true') return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && css(el, 'visibility') !== 'hidden' && css(el, 'display') !== 'none';
  }

  function isScriptUi(el) {
    return Boolean(el?.closest?.('#xrc-panel, #xrc-show'));
  }

  function textOf(el) {
    return [
      el.innerText,
      el.textContent,
      el.value,
      el.getAttribute('aria-label'),
      el.getAttribute('title'),
      el.getAttribute('name'),
      el.getAttribute('id'),
    ].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
  }

  function lowerText(el) {
    return textOf(el).toLowerCase();
  }

  function normalizeCode(raw) {
    return String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  }

  function parseCodes(raw) {
    const seen = new Set();
    return String(raw || '')
      .split(/[\s,;|]+/)
      .map(normalizeCode)
      .filter(Boolean)
      .filter((code) => {
        if (seen.has(code)) return false;
        seen.add(code);
        return true;
      });
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function gmGet(key, fallback = null) {
    try {
      return typeof GM_getValue === 'function' ? GM_getValue(key, fallback) : fallback;
    } catch (_) {
      return fallback;
    }
  }

  function gmSet(key, value) {
    try {
      if (typeof GM_setValue === 'function') GM_setValue(key, value);
    } catch (_) {
      // Ignore storage failures; direct in-frame operation still works.
    }
  }

  function gmListen(key, callback) {
    try {
      if (typeof GM_addValueChangeListener === 'function') {
        GM_addValueChangeListener(key, (_name, _oldValue, newValue, remote) => callback(newValue, remote));
      }
    } catch (_) {
      // Listener support varies by userscript manager.
    }
  }

  function makeId(prefix) {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }

  function maskCode(code) {
    const normalized = normalizeCode(code);
    if (normalized.length < 10) return normalized;
    return `${normalized.slice(0, 5)}...${normalized.slice(-5)}`;
  }

  function saveSession(patch = {}) {
    if (!IS_TOP) return;
    const existing = gmGet(STORAGE.session, {}) || {};
    gmSet(STORAGE.session, {
      ...existing,
      ...patch,
      version: VERSION,
      updatedAt: Date.now(),
    });
  }

  function clearSession() {
    if (IS_TOP) gmSet(STORAGE.session, null);
  }

  function restoreResults(rows) {
    if (!Array.isArray(rows)) return;
    app.results = rows;
    app.seenResultIds = new Set(rows.map((row) => row.id).filter(Boolean));
    renderResults();
  }

  async function waitFor(predicate, timeoutMs, intervalMs = 250) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const value = predicate();
      if (value) return value;
      await sleep(intervalMs);
    }
    return null;
  }

  function findCodeInput() {
    const inputs = [...document.querySelectorAll(SELECTORS.codeInput)]
      .filter((el) => isVisible(el) && !isScriptUi(el));
    if (!inputs.length) return null;

    const likely = inputs.find((el) => /code|token|25/.test(lowerText(el)));
    if (likely) return likely;

    return inputs.find((el) => {
      const max = Number(el.getAttribute('maxlength') || 0);
      return max === 0 || max >= 25;
    }) || inputs[0];
  }

  function hasRedeemFrame() {
    return [...document.querySelectorAll('iframe')].some((frame) => {
      const haystack = [
        frame.name,
        frame.title,
        frame.id,
        frame.src,
        frame.getAttribute('aria-label'),
      ].filter(Boolean).join(' ').toLowerCase();
      const rect = frame.getBoundingClientRect();
      return rect.width > 80 && rect.height > 80 && haystack.includes('redeem');
    });
  }

  function nativeSetValue(el, value) {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    setter.call(el, value);
    el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function fillCode(input, code) {
    input.focus();
    nativeSetValue(input, '');
    nativeSetValue(input, code);
    input.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'Enter' }));
  }

  function candidateButtons() {
    return [
      ...document.querySelectorAll('button, input[type="button"], input[type="submit"], a, a[role="button"], [role="button"]'),
    ].filter((el) => isVisible(el) && !isScriptUi(el));
  }

  function findFirstStepButton() {
    const buttons = candidateButtons();
    return buttons.find((button) => {
      const text = lowerText(button);
      return FIRST_STEP_BUTTONS.some((word) => text === word || text.includes(word));
    }) || null;
  }

  function hasFinalActionButton() {
    return candidateButtons().some((button) => {
      const text = lowerText(button);
      return FINAL_BUTTONS.some((word) => text === word || text.includes(word));
    });
  }

  function findCloseButton() {
    return [
      ...document.querySelectorAll([
        'button[aria-label*="close" i]',
        'button[title*="close" i]',
        'button[class*="close" i]',
        '[role="button"][aria-label*="close" i]',
        '[role="button"][title*="close" i]',
        '[role="button"][class*="close" i]',
      ].join(',')),
    ].find((button) => isVisible(button) && !isScriptUi(button)) || null;
  }

  function findButtonByWords(words, options = {}) {
    const { exact = false } = options;
    return candidateButtons().find((button) => {
      const text = lowerText(button);
      return words.some((word) => exact ? text === word : text === word || text.includes(word));
    }) || null;
  }

  function visibleDialogRoots() {
    const roots = [
      ...document.querySelectorAll('[role="dialog"], [aria-modal="true"], [data-testid*="dialog" i], [class*="dialog" i], [class*="modal" i]'),
    ].filter((el) => isVisible(el) && !isScriptUi(el));
    return roots.length ? roots : [document.body];
  }

  function textLinesFrom(root) {
    const clone = root.cloneNode(true);
    clone.querySelectorAll('#xrc-panel, #xrc-show, button, input, textarea, select, script, style, noscript').forEach((el) => el.remove());
    return clone.innerText
      .split(/\n+/)
      .map((line) => line.replace(/\s+/g, ' ').trim())
      .filter(Boolean);
  }

  function scoreProductLine(line) {
    const lower = line.toLowerCase();
    if (line.length < 3 || line.length > 140) return -100;
    if (/^[A-Z0-9]{25}$/.test(line.replace(/[^A-Z0-9]/gi, '').toUpperCase())) return -100;
    if (PRODUCT_SKIP_WORDS.some((word) => lower.includes(word))) return -80;

    let score = 0;
    if (/[a-zA-Z]/.test(line)) score += 10;
    if (/\d/.test(line)) score += 2;
    if (/[(:\-]/.test(line)) score += 2;
    if (line.length >= 8 && line.length <= 80) score += 6;
    if (/game|edition|pack|bundle|ultimate|standard|deluxe|premium|dlc|add-on/i.test(line)) score += 7;
    return score;
  }

  function cleanProductLine(line) {
    const normalized = String(line || '').replace(/\s+/g, ' ').trim();
    const joinedWords = normalized.match(/^(.{3,80}?[a-z0-9])([A-Z][a-z].*)$/);
    if (joinedWords && joinedWords[1].includes(' ')) return joinedWords[1].trim();
    return normalized;
  }

  function findProductName() {
    const roots = visibleDialogRoots();

    const prioritySelectors = [
      '[data-testid*="product" i]',
      '[class*="product" i]',
      '[data-testid*="title" i]',
      '[class*="title" i]',
      '[role="heading"]',
      'h1',
      'h2',
      'h3',
    ].join(',');

    const priorityLines = roots.flatMap((root) => (
      [...root.querySelectorAll(prioritySelectors)]
        .filter((el) => isVisible(el) && !isScriptUi(el))
        .flatMap(textLinesFrom)
    ));

    const allLines = roots.flatMap(textLinesFrom);
    const candidates = [...priorityLines, ...allLines]
      .map(cleanProductLine)
      .map((line) => ({ line, score: scoreProductLine(line) }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score || b.line.length - a.line.length);

    return candidates[0]?.line || '';
  }

  function pageText() {
    const clone = document.body.cloneNode(true);
    clone.querySelectorAll('#xrc-panel, #xrc-show').forEach((el) => el.remove());
    return clone.innerText.replace(/\s+/g, ' ').trim();
  }

  function findErrorMessage() {
    const messages = [...document.querySelectorAll(SELECTORS.messages)].filter(isVisible);
    const candidates = messages
      .filter((message) => !message.closest('script, style, noscript'))
      .map(textOf)
      .filter(Boolean)
      .filter((message) => message.length < 600);

    const messageHit = candidates.find((message) => ERROR_WORDS.some((word) => message.toLowerCase().includes(word)));
    if (messageHit) return messageHit;

    const visibleLines = textLinesFrom(document.body)
      .filter((message) => message.length < 600);
    const visibleHit = visibleLines.find((message) => ERROR_WORDS.some((word) => message.toLowerCase().includes(word)));
    if (visibleHit) return visibleHit;

    return '';
  }

  function looksLikeConfirmation() {
    const input = findCodeInput();
    const body = pageText().toLowerCase();
    const hasConfirmCopy = CONFIRM_WORDS.some((word) => body.includes(word));
    return (hasFinalActionButton() && !input) || (hasFinalActionButton() && hasConfirmCopy);
  }

  async function waitForOutcome(previousUrl) {
    await sleep(app.settleMs);

    const outcome = await waitFor(() => {
      if (looksLikeConfirmation()) {
        const product = findProductName();
        return {
          status: 'looks_valid_confirmation',
          product,
          detail: product
            ? `Reached confirmation for: ${product}. Script did not click the final Redeem button.`
            : 'Reached a confirmation/redeem screen. Script did not click the final button.',
        };
      }
      if (location.href !== previousUrl && !findCodeInput()) {
        const product = findProductName();
        return {
          status: 'looks_valid_navigation',
          product,
          detail: product
            ? `Navigated to a valid-code screen for: ${product}. Script did not click final confirmation.`
            : `Navigated to ${location.href}. Script did not click final confirmation.`,
        };
      }
      const error = findErrorMessage();
      if (error) return { status: 'invalid_or_used', detail: error };
      return null;
    }, app.waitMs);

    if (outcome) return outcome;

    if (!findCodeInput() || hasFinalActionButton()) {
      const product = findProductName();
      return {
        status: 'looks_valid_no_error',
        product,
        detail: product
          ? `No error appeared; detected product: ${product}. No final redeem clicked.`
          : 'No error appeared and the entry form changed/disappeared. Treating as likely valid; no final redeem clicked.',
      };
    }

    return { status: 'no_error_timeout', detail: 'No error was detected before timeout. Review manually or increase wait time.' };
  }

  async function waitForInlineOutcome() {
    await sleep(app.settleMs);

    const error = await waitFor(() => findErrorMessage(), app.waitMs);
    if (error) return { status: 'invalid_or_used', detail: error };

    return {
      status: 'looks_valid_no_error',
      detail: 'No inline error appeared after entering the code. The script did not click Next/Confirm/Redeem.',
    };
  }

  async function returnToEntryPage() {
    if (location.href !== app.originalUrl) {
      history.back();
      await waitFor(() => findCodeInput(), 7000);
      if (!findCodeInput()) {
        location.assign(app.originalUrl);
        await waitFor(() => findCodeInput(), 12000);
      }
    }
  }

  async function closeRedeemSurface() {
    const closeButton = findCloseButton() || findButtonByWords(CLOSE_BUTTONS);
    if (closeButton && !FINAL_BUTTONS.some((word) => lowerText(closeButton).includes(word))) {
      closeButton.click();
      await sleep(900);
      return true;
    }

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
    await sleep(900);
    return true;
  }

  async function openRedeemSurface() {
    const existingInput = findCodeInput();
    if (existingInput || hasRedeemFrame()) return true;

    const redeemNow = await waitFor(() => findButtonByWords(REOPEN_BUTTONS), app.waitMs);
    if (!redeemNow) return false;

    redeemNow.click();
    return Boolean(await waitFor(() => findCodeInput() || hasRedeemFrame(), 12000));
  }

  async function ensureRedeemSurfaceOpen() {
    if (findCodeInput()) return { ok: true, detail: 'Code input is already visible.' };
    if (await openRedeemSurface()) return { ok: true, detail: 'Opened Redeem now and found the code input.' };
    return { ok: false, detail: 'Could not find the redeem code input or open Redeem now.' };
  }

  async function resetRedeemSurfaceAfterValidCode() {
    await closeRedeemSurface();

    if (await openRedeemSurface()) return { ok: true, detail: 'Closed the confirmation panel and reopened Redeem now.' };

    if (location.href !== app.originalUrl) {
      await returnToEntryPage();
      if (findCodeInput()) return { ok: true, detail: 'Returned to the code entry page.' };
    }

    return { ok: Boolean(findCodeInput()), detail: 'Could not find Redeem now after closing the panel.' };
  }

  function clearCodeInput() {
    const input = findCodeInput();
    if (!input) return;
    input.focus();
    nativeSetValue(input, '');
  }

  function addResult(code, status, detail, product = '') {
    const row = { id: makeId('row'), time: new Date().toISOString(), code, status, product, detail };
    app.seenResultIds.add(row.id);
    app.results.push(row);
    renderResults();
    if (!IS_TOP && app.payloadId) {
      gmSet(STORAGE.result, { payloadId: app.payloadId, row });
    }
    return row;
  }

  function receiveSyncedResult(message) {
    if (!message?.row || !message?.payloadId) return;
    if (message.payloadId !== app.payloadId && !app.resultWaiters.has(message.payloadId)) return;
    if (app.seenResultIds.has(message.row.id)) return;
    app.seenResultIds.add(message.row.id);
    app.results.push(message.row);
    renderResults();
    setStatus(`Received result for ${maskCode(message.row.code)}: ${message.row.status}`);
    const waiter = app.resultWaiters.get(message.payloadId);
    if (waiter) {
      app.resultWaiters.delete(message.payloadId);
      waiter(message.row);
    }
  }

  function csvEscape(value) {
    const text = String(value ?? '');
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  }

  function resultsCsv() {
    const header = ['time', 'code', 'status', 'product', 'detail'];
    const rows = app.results.map((row) => header.map((key) => csvEscape(row[key])).join(','));
    return [header.join(','), ...rows].join('\n');
  }

  function downloadCsv() {
    const blob = new Blob([resultsCsv()], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `xbox-redeem-check-${new Date().toISOString().replace(/[:.]/g, '-')}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function copyCsv() {
    const csv = resultsCsv();
    if (typeof GM_setClipboard === 'function') {
      GM_setClipboard(csv, 'text');
    } else {
      navigator.clipboard.writeText(csv);
    }
    setStatus('Copied CSV to clipboard.');
  }

  function statusClass(status) {
    if (status.startsWith('looks_valid')) return 'ok';
    if (status === 'invalid_or_used' || status === 'invalid_format') return 'bad';
    return 'warn';
  }

  function renderResults() {
    const tbody = document.getElementById('xrc-results');
    if (!tbody) return;
    tbody.innerHTML = app.results.slice(-80).reverse().map((row) => `
      <tr>
        <td>${escapeHtml(row.code)}</td>
        <td class="${statusClass(row.status)}">${escapeHtml(row.status)}</td>
        <td>${escapeHtml(row.product || '').slice(0, 160)}</td>
        <td>${escapeHtml(row.detail).slice(0, 220)}</td>
      </tr>
    `).join('');
    document.getElementById('xrc-count').textContent = String(app.results.length);
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    }[char]));
  }

  function setStatus(message) {
    const el = document.getElementById('xrc-status');
    if (el) el.textContent = message;
  }

  function hydrateControlsFromPayload(payload) {
    if (!payload) return;
    if (IS_TOP) return;
    const codesEl = document.getElementById('xrc-codes');
    const delayEl = document.getElementById('xrc-delay');
    const waitEl = document.getElementById('xrc-wait');
    const nextEl = document.getElementById('xrc-click-next');
    const ownedEl = document.getElementById('xrc-owned');
    if (codesEl && payload.codesText && !codesEl.value.trim()) codesEl.value = payload.codesText;
    if (delayEl && payload.delayMs) delayEl.value = String(payload.delayMs);
    if (waitEl && payload.waitMs) waitEl.value = String(payload.waitMs);
    if (nextEl && typeof payload.clickNextIfNeeded === 'boolean') nextEl.checked = payload.clickNextIfNeeded;
    if (ownedEl && payload.fromController) ownedEl.checked = true;
    app.singleRunFromController = Boolean(payload.singleRun);
  }

  function waitForSyncedResult(payloadId, timeoutMs) {
    return new Promise((resolve) => {
      const wrappedResolve = (row) => {
        window.clearTimeout(timeout);
        resolve(row);
      };
      const timeout = window.setTimeout(() => {
        if (app.resultWaiters.get(payloadId) === wrappedResolve) {
          app.resultWaiters.delete(payloadId);
          resolve(null);
        }
      }, timeoutMs);
      app.resultWaiters.set(payloadId, wrappedResolve);
    });
  }

  async function dispatchCodeToRedeemFrame(code, index, total) {
    const payloadId = makeId('payload');
    app.payloadId = payloadId;
    const resultPromise = waitForSyncedResult(payloadId, Math.max(30000, app.waitMs + 22000));
    const payload = {
      id: payloadId,
      codesText: code,
      delayMs: app.delayMs,
      waitMs: app.waitMs,
      clickNextIfNeeded: app.clickNextIfNeeded,
      fromController: true,
      singleRun: true,
      createdAt: Date.now(),
    };
    gmSet(STORAGE.payload, payload);
    setStatus(`Checking ${index}/${total}: ${maskCode(code)}`);

    if (!hasRedeemFrame()) {
      const opened = await openRedeemSurface();
      if (!opened) {
        app.resultWaiters.delete(payloadId);
        return { ok: false, row: null, detail: 'Could not open Redeem now. Click Redeem now manually and try again.' };
      }
    }

    const row = await resultPromise;
    if (!row) {
      return { ok: false, row: null, detail: `Timed out waiting for the redeem frame to return a result for ${maskCode(code)}.` };
    }

    return { ok: true, row, detail: 'Received result from the redeem frame.' };
  }

  async function runTopControlledBatch(codes, startIndex = 0) {
    const codesText = document.getElementById('xrc-codes').value;
    app.sessionId = app.sessionId || makeId('session');
    gmSet(STORAGE.payload, null);
    saveSession({
      active: true,
      id: app.sessionId,
      codesText,
      delayMs: app.delayMs,
      waitMs: app.waitMs,
      clickNextIfNeeded: app.clickNextIfNeeded,
      nextIndex: startIndex,
      results: app.results,
      createdAt: gmGet(STORAGE.session, {})?.createdAt || Date.now(),
    });
    setStatus(`Running from top panel: ${startIndex}/${codes.length}`);

    for (let index = startIndex; index < codes.length; index += 1) {
      if (app.stopRequested) break;

      const code = codes[index];
      if (code.length !== 25) {
        addResult(code, 'invalid_format', `Expected 25 alphanumeric characters after removing dashes/spaces; got ${code.length}.`);
        saveSession({ nextIndex: index + 1, results: app.results });
        continue;
      }

      const dispatched = await dispatchCodeToRedeemFrame(code, index + 1, codes.length);
      if (!dispatched.ok) {
        addResult(code, 'needs_manual', dispatched.detail);
        saveSession({ active: false, nextIndex: index, results: app.results });
        break;
      }

      if (dispatched.row.status.startsWith('looks_valid')) {
        setStatus(`Valid code found${dispatched.row.product ? `: ${dispatched.row.product}` : ''}. Reloading page to reset the redeem modal...`);
      } else {
        setStatus(`Recorded ${maskCode(code)} as ${dispatched.row.status}. Reloading page to reset the redeem modal...`);
      }

      saveSession({ active: true, nextIndex: index + 1, results: app.results });

      if (!app.stopRequested && index < codes.length - 1) {
        await sleep(app.delayMs);
        location.reload();
        return { reloading: true };
      }
    }

    saveSession({ active: false, nextIndex: codes.length, results: app.results, completedAt: Date.now() });
    setStatus(app.stopRequested ? 'Stopped.' : 'Done.');
    return { reloading: false };
  }

  async function dispatchBatchToRedeemFrame(codesText) {
    app.payloadId = makeId('payload');
    const payload = {
      id: app.payloadId,
      codesText,
      delayMs: app.delayMs,
      waitMs: app.waitMs,
      clickNextIfNeeded: app.clickNextIfNeeded,
      fromController: true,
      singleRun: false,
      createdAt: Date.now(),
    };
    gmSet(STORAGE.payload, payload);
    setStatus('Opening Redeem now and handing the batch to the redeem frame...');

    const opened = await openRedeemSurface();
    if (!opened) {
      setStatus('Could not open Redeem now. Click Redeem now manually; the frame should pick up the saved batch.');
      return false;
    }

    setStatus('Redeem frame opened. Waiting for results from the frame...');
    return true;
  }

  async function maybeStartFromPayload(payload) {
    if (IS_TOP || !payload?.id || payload.id === app.handledPayloadId) return;
    if (Date.now() - Number(payload.createdAt || 0) > 15 * 60 * 1000) return;
    app.handledPayloadId = payload.id;
    app.payloadId = payload.id;
    hydrateControlsFromPayload(payload);
    gmSet(STORAGE.payload, null);
    await waitFor(() => findCodeInput(), 12000);
    if (!findCodeInput()) {
      setStatus('Waiting for the redeem code input in this frame...');
      return;
    }
    setStatus('Received batch from the top panel. Starting inside the redeem frame...');
    runChecks();
  }

  async function maybeResumeTopSession() {
    if (!IS_TOP) return;
    const session = gmGet(STORAGE.session, null);
    if (!session?.active) return;
    if (Date.now() - Number(session.updatedAt || session.createdAt || 0) > 2 * 60 * 60 * 1000) {
      saveSession({ active: false, expiredAt: Date.now() });
      return;
    }

    const codesEl = document.getElementById('xrc-codes');
    const delayEl = document.getElementById('xrc-delay');
    const waitEl = document.getElementById('xrc-wait');
    const nextEl = document.getElementById('xrc-click-next');
    const ownedEl = document.getElementById('xrc-owned');

    if (codesEl) codesEl.value = session.codesText || '';
    if (delayEl && session.delayMs) delayEl.value = String(session.delayMs);
    if (waitEl && session.waitMs) waitEl.value = String(session.waitMs);
    if (nextEl && typeof session.clickNextIfNeeded === 'boolean') nextEl.checked = session.clickNextIfNeeded;
    if (ownedEl) ownedEl.checked = true;

    restoreResults(session.results || []);
    app.sessionId = session.id || makeId('session');
    app.resumeIndex = Math.max(0, Number(session.nextIndex || 0));

    const total = parseCodes(session.codesText || '').length;
    if (!total || app.resumeIndex >= total) {
      saveSession({ active: false, completedAt: Date.now() });
      setStatus('Done.');
      return;
    }

    setStatus(`Resuming after page reset: ${app.resumeIndex}/${total}`);
    await sleep(1200);
    if (!app.running) runChecks();
  }

  async function runChecks() {
    if (app.running) return;

    const owned = document.getElementById('xrc-owned').checked;
    if (!owned) {
      setStatus('Tick the ownership checkbox before starting.');
      return;
    }

    const codes = parseCodes(document.getElementById('xrc-codes').value);
    app.delayMs = Math.max(1500, Number(document.getElementById('xrc-delay').value || 3200));
    app.waitMs = Math.max(3000, Number(document.getElementById('xrc-wait').value || 9000));
    app.clickNextIfNeeded = document.getElementById('xrc-click-next').checked;
    app.originalUrl = location.href;
    app.stopRequested = false;
    app.running = true;
    toggleRunningUi(true);

    if (!codes.length) {
      setStatus('Paste at least one code first.');
      app.running = false;
      toggleRunningUi(false);
      return;
    }

    if (IS_TOP && !app.resumeIndex) {
      app.results = [];
      app.seenResultIds = new Set();
      app.sessionId = makeId('session');
      renderResults();
      clearSession();
    }

    if (IS_TOP && !findCodeInput()) {
      const topRun = await runTopControlledBatch(codes, app.resumeIndex || 0);
      if (topRun?.reloading) return;
      app.resumeIndex = 0;
      app.running = false;
      toggleRunningUi(false);
      return;
    }

    setStatus(`Running: 0/${codes.length}`);

    for (let index = 0; index < codes.length; index += 1) {
      if (app.stopRequested) break;

      const code = codes[index];
      setStatus(`Checking ${index + 1}/${codes.length}: ${maskCode(code)}`);

      if (code.length !== 25) {
        addResult(code, 'invalid_format', `Expected 25 alphanumeric characters after removing dashes/spaces; got ${code.length}.`);
        continue;
      }

      const opened = await ensureRedeemSurfaceOpen();
      if (!opened.ok) {
        addResult(code, 'needs_manual', opened.detail);
        break;
      }

      const input = await waitFor(() => findCodeInput(), 10000);
      if (!input) {
        addResult(code, 'needs_manual', 'Could not find the code input. Make sure you are signed in and on the page that contains the 25-character code field.');
        break;
      }

      fillCode(input, code);
      await sleep(350);

      const inlineError = await waitFor(() => findErrorMessage(), Math.min(1800, app.waitMs), 200);
      if (inlineError) {
        addResult(code, 'invalid_or_used', inlineError);
        clearCodeInput();
        if (app.singleRunFromController) {
          await closeRedeemSurface();
          break;
        }
        if (!app.stopRequested && index < codes.length - 1) {
          await sleep(app.delayMs);
        }
        continue;
      }

      if (!app.clickNextIfNeeded) {
        const outcome = await waitForInlineOutcome();
        addResult(code, outcome.status, outcome.detail, outcome.product || '');
        clearCodeInput();
        if (!app.stopRequested && index < codes.length - 1) {
          await sleep(app.delayMs);
        }
        continue;
      }

      const nextButton = await waitFor(() => findFirstStepButton(), app.waitMs);
      if (!nextButton) {
        const error = findErrorMessage();
        if (error) {
          addResult(code, 'invalid_or_used', error);
          clearCodeInput();
          if (app.singleRunFromController) {
            await closeRedeemSurface();
            break;
          }
          if (!app.stopRequested && index < codes.length - 1) {
            await sleep(app.delayMs);
          }
          continue;
        }
        addResult(code, 'needs_manual', 'Could not find a Next/Continue button after filling the code.');
        break;
      }

      const previousUrl = location.href;
      nextButton.click();
      const outcome = await waitForOutcome(previousUrl);
      const row = addResult(code, outcome.status, outcome.detail, outcome.product || '');

      if (app.singleRunFromController && !outcome.status.startsWith('looks_valid')) {
        await closeRedeemSurface();
        break;
      }

      if (outcome.status.startsWith('looks_valid')) {
        setStatus(`Valid code found${outcome.product ? `: ${outcome.product}` : ''}. Closing panel and reopening Redeem now...`);
        if (app.singleRunFromController) {
          await closeRedeemSurface();
          break;
        }
        const reset = await resetRedeemSurfaceAfterValidCode();
        if (!reset.ok && index < codes.length - 1) {
          row.detail = `${row.detail} Reset failed: ${reset.detail}`;
          renderResults();
          setStatus(reset.detail);
          break;
        }
      }

      if (!app.stopRequested && index < codes.length - 1) {
        await sleep(app.delayMs);
      }
    }

    app.running = false;
    toggleRunningUi(false);
    setStatus(app.stopRequested ? 'Stopped.' : 'Done.');
  }

  function stopChecks() {
    app.stopRequested = true;
    saveSession({ active: false, stoppedAt: Date.now() });
    setStatus('Stopping after current check...');
  }

  function toggleRunningUi(running) {
    document.getElementById('xrc-start').disabled = running;
    document.getElementById('xrc-stop').disabled = !running;
  }

  function buildUi() {
    if (document.getElementById('xrc-panel')) return;
    const style = document.createElement('style');
    style.textContent = `
      #xrc-panel {
        position: fixed;
        z-index: 2147483647;
        right: 16px;
        bottom: 16px;
        width: min(460px, calc(100vw - 32px));
        max-height: calc(100vh - 32px);
        overflow: auto;
        font: 13px/1.35 system-ui, -apple-system, Segoe UI, sans-serif;
        color: #111;
        background: #fff;
        border: 1px solid #d0d0d0;
        box-shadow: 0 16px 48px rgba(0, 0, 0, .22);
      }
      #xrc-panel * { box-sizing: border-box; }
      #xrc-panel header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 8px;
        padding: 10px 12px;
        border-bottom: 1px solid #e5e5e5;
        background: #f7f7f7;
        font-weight: 700;
      }
      #xrc-panel button {
        min-height: 32px;
        border: 1px solid #999;
        background: #f7f7f7;
        color: #111;
        padding: 5px 9px;
        cursor: pointer;
      }
      #xrc-panel button.primary {
        border-color: #107c10;
        background: #107c10;
        color: #fff;
      }
      #xrc-panel button:disabled { opacity: .55; cursor: not-allowed; }
      #xrc-panel textarea {
        width: 100%;
        min-height: 120px;
        resize: vertical;
        font: 12px/1.35 ui-monospace, SFMono-Regular, Consolas, monospace;
      }
      #xrc-panel input[type="number"] {
        width: 92px;
      }
      #xrc-panel main { padding: 12px; display: grid; gap: 10px; }
      #xrc-panel .row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
      #xrc-panel label { display: flex; gap: 6px; align-items: center; }
      #xrc-status {
        padding: 8px;
        background: #f2f6ff;
        border: 1px solid #cddaf7;
      }
      #xrc-panel table {
        width: 100%;
        border-collapse: collapse;
        table-layout: fixed;
      }
      #xrc-panel th, #xrc-panel td {
        border-top: 1px solid #ececec;
        padding: 6px;
        vertical-align: top;
        word-break: break-word;
      }
      #xrc-panel th { text-align: left; background: #fafafa; }
      #xrc-panel .ok { color: #107c10; font-weight: 700; }
      #xrc-panel .bad { color: #a80000; font-weight: 700; }
      #xrc-panel .warn { color: #8a5a00; font-weight: 700; }
    `;
    document.head.appendChild(style);

    const panel = document.createElement('section');
    panel.id = 'xrc-panel';
    if (!IS_TOP) panel.style.display = 'none';
    panel.innerHTML = `
      <header>
        <span>Redeem Code Checker v${VERSION}${IS_TOP ? '' : ' Worker'}</span>
        <button id="xrc-hide" type="button" title="Hide panel">Hide</button>
      </header>
      <main>
        <label style="align-items:flex-start">
          <input id="xrc-owned" type="checkbox">
          <span>I confirm these are my own codes. Do not use this for guessing or third-party codes.</span>
        </label>
        <label style="align-items:flex-start">
          <input id="xrc-click-next" type="checkbox" checked>
          <span>Click Next, capture the game name if valid, close the panel, then reopen Redeem now. Never clicks final Redeem.</span>
        </label>
        <textarea id="xrc-codes" spellcheck="false" placeholder="Paste one or many 25-character codes here. Dashes/spaces are OK."></textarea>
        <div class="row">
          <label>Delay <input id="xrc-delay" type="number" min="1500" step="500" value="3200"> ms</label>
          <label>Wait <input id="xrc-wait" type="number" min="3000" step="500" value="9000"> ms</label>
          <span>Results: <b id="xrc-count">0</b></span>
        </div>
        <div class="row">
          <button id="xrc-start" class="primary" type="button">Start</button>
          <button id="xrc-stop" type="button" disabled>Stop</button>
          <button id="xrc-copy" type="button">Copy CSV</button>
          <button id="xrc-download" type="button">Download CSV</button>
        </div>
        <div id="xrc-status">Ready. Next mode captures the game name, closes the confirmation panel, and reopens Redeem now without clicking final Redeem.</div>
        <table>
          <thead>
            <tr><th style="width:30%">Code</th><th style="width:22%">Status</th><th style="width:24%">Product</th><th>Detail</th></tr>
          </thead>
          <tbody id="xrc-results"></tbody>
        </table>
      </main>
    `;
    document.body.appendChild(panel);

    document.getElementById('xrc-start').addEventListener('click', runChecks);
    document.getElementById('xrc-stop').addEventListener('click', stopChecks);
    document.getElementById('xrc-copy').addEventListener('click', copyCsv);
    document.getElementById('xrc-download').addEventListener('click', downloadCsv);
    document.getElementById('xrc-hide').addEventListener('click', () => {
      panel.style.display = 'none';
      showButton.style.display = 'block';
    });

    const showButton = document.createElement('button');
    showButton.id = 'xrc-show';
    showButton.type = 'button';
    showButton.textContent = 'Redeem Checker';
    showButton.style.cssText = 'display:none;position:fixed;right:16px;bottom:16px;z-index:2147483647;min-height:34px;padding:6px 10px;border:1px solid #999;background:#fff;color:#111;box-shadow:0 8px 28px rgba(0,0,0,.2);';
    showButton.addEventListener('click', () => {
      panel.style.display = 'block';
      showButton.style.display = 'none';
    });
    document.body.appendChild(showButton);

    if (!IS_TOP) hydrateControlsFromPayload(gmGet(STORAGE.payload, null));
  }

  buildUi();
  gmListen(STORAGE.payload, (payload) => {
    maybeStartFromPayload(payload);
  });
  gmListen(STORAGE.result, (message, remote) => {
    if (IS_TOP && remote) receiveSyncedResult(message);
  });
  maybeStartFromPayload(gmGet(STORAGE.payload, null));
  maybeResumeTopSession();
})();
