// ==UserScript==
// @name         Green Man Gaming Bundle Key Copier
// @namespace    https://tampermonkey.net/
// @author       Zenny
// @version      1.0
// @description  Adds buttons to copy game names, Steam keys, and Name:Key pairs from Green Man Gaming bundle claim pages.
// @match        https://www.greenmangamingbundles.com/order-claim/*
// @grant        GM_setClipboard
// @icon         https://www.google.com/s2/favicons?sz=64&domain=greenmangaming.com
// ==/UserScript==

(function () {
    'use strict';

    const STEAM_KEY_REGEX = /\b[A-Z0-9]{5}-[A-Z0-9]{5}-[A-Z0-9]{5}\b/;

    function extractGames() {
        const results = [];
        const seenKeys = new Set();

        const allElements = document.querySelectorAll('body *');
        for (const el of allElements) {
            if (el.children.length === 0 && STEAM_KEY_REGEX.test(el.textContent.trim())) {
                const match = el.textContent.trim().match(STEAM_KEY_REGEX);
                const key = match ? match[0] : null;

                if (key && !seenKeys.has(key)) {
                    seenKeys.add(key);

                    let name = '';
                    let parent = el.parentElement;

                    for (let depth = 0; depth < 5 && parent && parent !== document.body; depth++) {
                        const heading = parent.querySelector('h2, h3, h4, [class*="title"]');
                        if (heading && !/YOUR CODES|BONUS|BUNDLE/i.test(heading.textContent)) {
                            // Extract only the first valid text line to drop whitespace and platform badges (like "Steam")
                            const lines = (heading.innerText || heading.textContent)
                                .split('\n')
                                .map(line => line.trim())
                                .filter(line => line && !/^(Steam|Epic|GOG|Ubisoft)$/i.test(line));

                            if (lines.length > 0) {
                                name = lines[0];
                                break;
                            }
                        }
                        parent = parent.parentElement;
                    }

                    results.push({ name: name || 'Unknown Game', key });
                }
            }
        }
        return results;
    }

    function copyToClipboard(text, btn, originalLabel) {
        if (typeof GM_setClipboard !== 'undefined') {
            GM_setClipboard(text, 'text');
        } else {
            navigator.clipboard.writeText(text);
        }

        btn.textContent = '✓ Copied!';
        btn.style.background = '#10b981';
        setTimeout(() => {
            btn.textContent = originalLabel;
            btn.style.background = '#2563eb';
        }, 1500);
    }

    function createUI() {
        if (document.getElementById('gmg-bundle-tools')) return;

        const container = document.createElement('div');
        container.id = 'gmg-bundle-tools';
        container.style.cssText = `
            position: fixed;
            bottom: 24px;
            right: 24px;
            z-index: 999999;
            display: flex;
            flex-direction: column;
            gap: 8px;
            background: #111827;
            padding: 14px;
            border-radius: 10px;
            box-shadow: 0 10px 25px rgba(0,0,0,0.5);
            border: 1px solid #374151;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        `;

        const title = document.createElement('div');
        title.textContent = 'Bundle Key Tools';
        title.style.cssText = 'color: #f9fafb; font-size: 12px; font-weight: bold; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 2px;';
        container.appendChild(title);

        const actions = [
            {
                label: '📋 Copy All Names',
                action: (games) => games.map(g => g.name).join('\n')
            },
            {
                label: '🔑 Copy All Keys',
                action: (games) => games.map(g => g.key).join('\n')
            },
            {
                label: '🎮 Copy Name: Key',
                action: (games) => games.map(g => `${g.name}: ${g.key}`).join('\n')
            }
        ];

        actions.forEach(({ label, action }) => {
            const btn = document.createElement('button');
            btn.textContent = label;
            btn.style.cssText = `
                background: #2563eb;
                color: #ffffff;
                border: none;
                border-radius: 6px;
                padding: 8px 14px;
                font-size: 13px;
                font-weight: 500;
                cursor: pointer;
                transition: background 0.15s ease;
                text-align: left;
            `;
            btn.onmouseenter = () => { if (btn.textContent === label) btn.style.background = '#1d4ed8'; };
            btn.onmouseleave = () => { if (btn.textContent === label) btn.style.background = '#2563eb'; };

            btn.onclick = () => {
                const games = extractGames();
                if (games.length === 0) {
                    alert('No revealed keys found on this page yet.');
                    return;
                }
                copyToClipboard(action(games), btn, label);
            };

            container.appendChild(btn);
        });

        document.body.appendChild(container);
    }

    window.addEventListener('load', createUI);
})();