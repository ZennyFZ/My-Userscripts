// ==UserScript==
// @name         Lestrade's Quick Wishlist
// @namespace    https://lestrades.com/
// @version      1.0.0
// @description  Add games from another user's wishlist to your wishlist and set the quantity to unlimited.
// @author       Zenny
// @match        https://lestrades.com/@*/wishlist/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=lestrades.com
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(() => {
  'use strict';

  const BUTTON_CLASS = 'lt-quick-wishlist';
  const GAME_LINK_SELECTOR = 'tr.img a[href^="/game/"]';
  const GAME_PATH_PATTERN = /^\/game\/(\d+)\/$/;
  const WISHLIST_EDIT_PATTERN = /^\/wishlist\/edit\/(\d+)\/?$/;

  const style = document.createElement('style');
  style.textContent = `
    .${BUTTON_CLASS} {
      margin-left: 6px;
      padding: 2px 6px 3px;
      border: 0;
      border-radius: 6px;
      background: #3f4553;
      color: #fff;
      font: 600 12px/16px Inter, Arial, system-ui, sans-serif;
      vertical-align: 1px;
      cursor: pointer;
      transition: background-color 140ms ease, color 140ms ease;
    }

    .${BUTTON_CLASS}:hover:not(:disabled) {
      background: #555d70;
    }

    .${BUTTON_CLASS}:focus-visible {
      outline: 2px solid #abc7f2;
      outline-offset: 2px;
    }

    .${BUTTON_CLASS}:disabled {
      cursor: default;
      opacity: 0.72;
    }

    .${BUTTON_CLASS}[data-state="done"] {
      background: #4d672f;
      opacity: 1;
    }

    .${BUTTON_CLASS}[data-state="error"] {
      background: #7b4141;
      opacity: 1;
    }
  `;
  document.head.append(style);

  function parseHtml(html) {
    return new DOMParser().parseFromString(html, 'text/html');
  }

  async function fetchGameDocument(gameId) {
    const response = await fetch(`/game/${gameId}/`, {
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { Accept: 'text/html' },
    });

    if (!response.ok) {
      throw new Error(`Could not open the game page (HTTP ${response.status}).`);
    }

    return parseHtml(await response.text());
  }

  function findAddForm(gameDocument) {
    return [...gameDocument.querySelectorAll('form.addrem')].find((form) => {
      const action = new URL(form.getAttribute('action') || '', location.origin);
      return action.origin === location.origin
        && action.pathname === '/edit/'
        && form.querySelector('input[name="act"][value="add"]')
        && form.querySelector('input[name="list"][value="wishlist"]');
    });
  }

  function findWishlistItemId(gameDocument) {
    for (const form of gameDocument.querySelectorAll('form[action*="/wishlist/edit/"]')) {
      const action = new URL(form.getAttribute('action'), location.origin);
      const match = action.pathname.match(WISHLIST_EDIT_PATTERN);
      if (match) return match[1];
    }
    return null;
  }

  async function addToWishlist(gameId) {
    const initialDocument = await fetchGameDocument(gameId);
    const existingItemId = findWishlistItemId(initialDocument);

    if (existingItemId) {
      return setUnlimited(existingItemId);
    }

    const addForm = findAddForm(initialDocument);
    if (!addForm) {
      throw new Error('The add-to-wishlist form was not found. Try refreshing the page.');
    }

    const body = new URLSearchParams();
    for (const input of addForm.querySelectorAll('input[name]')) {
      if ((input.type === 'checkbox' || input.type === 'radio') && !input.checked) continue;
      body.append(input.name, input.value);
    }
    if (!body.has('disa')) body.set('disa', '');

    const addUrl = new URL(addForm.getAttribute('action'), location.origin);
    if (addUrl.origin !== location.origin) {
      throw new Error('Refused an unexpected off-site wishlist form.');
    }

    const addResponse = await fetch(addUrl, {
      method: 'POST',
      credentials: 'same-origin',
      redirect: 'follow',
      headers: {
        Accept: 'text/html',
        'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
      },
      body,
    });

    if (!addResponse.ok) {
      throw new Error(`LesTrades rejected the wishlist request (HTTP ${addResponse.status}).`);
    }

    let resultDocument = parseHtml(await addResponse.text());
    let wishlistItemId = findWishlistItemId(resultDocument);

    // Some server responses contain only a confirmation, so refresh the game data once.
    if (!wishlistItemId) {
      resultDocument = await fetchGameDocument(gameId);
      wishlistItemId = findWishlistItemId(resultDocument);
    }

    if (!wishlistItemId) {
      throw new Error('The game was added, but its wishlist item ID could not be found.');
    }

    return setUnlimited(wishlistItemId);
  }

  async function setUnlimited(wishlistItemId) {
    const response = await fetch(`/wishlist/edit/${wishlistItemId}/quantity/99`, {
      credentials: 'same-origin',
      cache: 'no-store',
      headers: {
        Accept: '*/*',
        'X-Requested-With': 'XMLHttpRequest',
      },
    });

    if (!response.ok) {
      throw new Error(`The game was added, but unlimited quantity failed (HTTP ${response.status}).`);
    }

    return wishlistItemId;
  }

  function markRowWishlisted(gameLink, button) {
    if (!gameLink.parentElement.querySelector(':scope > .twl')) {
      const marker = document.createElement('span');
      marker.className = 'twl';
      marker.textContent = '★';
      marker.title = 'In my wishlist';
      gameLink.before(marker, document.createTextNode('\u00a0'));
    }

    button.dataset.state = 'done';
    button.textContent = 'Added ∞';
    button.title = 'Added to your wishlist with unlimited quantity';
    button.disabled = true;
  }

  function createButton(gameLink, gameId) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = BUTTON_CLASS;
    button.textContent = '+ Wishlist';
    button.title = 'Add to my wishlist with unlimited quantity';
    button.setAttribute('aria-label', `Add ${gameLink.textContent.trim()} to my wishlist with unlimited quantity`);

    // Rows are wrapped in labels; prevent a button press from activating the row.
    button.addEventListener('mousedown', (event) => event.stopPropagation());
    button.addEventListener('click', async (event) => {
      event.preventDefault();
      event.stopPropagation();

      button.disabled = true;
      button.dataset.state = 'loading';
      button.textContent = 'Adding…';

      try {
        await addToWishlist(gameId);
        markRowWishlisted(gameLink, button);
      } catch (error) {
        console.error('[LesTrades Quick Wishlist]', error);
        button.disabled = false;
        button.dataset.state = 'error';
        button.textContent = 'Retry';
        button.title = error instanceof Error ? error.message : 'Wishlist request failed.';
      }
    });

    return button;
  }

  function addButtons() {
    for (const gameLink of document.querySelectorAll(GAME_LINK_SELECTOR)) {
      if (gameLink.dataset.quickWishlistProcessed === 'true') continue;
      gameLink.dataset.quickWishlistProcessed = 'true';

      const match = gameLink.getAttribute('href')?.match(GAME_PATH_PATTERN);
      const gameRow = gameLink.closest('tr');
      const isAlreadyWishlisted = Boolean(gameLink.parentElement.querySelector(':scope > .twl'));

      if (!match || !gameRow || isAlreadyWishlisted) continue;
      gameLink.after(createButton(gameLink, match[1]));
    }
  }

  let scanQueued = false;
  const observer = new MutationObserver(() => {
    if (scanQueued) return;
    scanQueued = true;
    requestAnimationFrame(() => {
      scanQueued = false;
      addButtons();
    });
  });

  addButtons();
  observer.observe(document.body, { childList: true, subtree: true });
})();
