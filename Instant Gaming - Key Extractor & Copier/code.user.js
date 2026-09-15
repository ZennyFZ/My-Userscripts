// ==UserScript==
// @name         Instant Gaming - Key Extractor & Copier
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  Reveals all keys on Instant Gaming orders and provides options to copy names, keys, or both.
// @author       Zenny
// @match        https://www.instant-gaming.com/*/my-orders/*
// @match        https://www.instant-gaming.com/my-orders/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=instant-gaming.com
// @grant        GM_setClipboard
// ==/UserScript==

(function () {
    'use strict';

    // Inject Custom CSS Styles
    const style = document.createElement('style');
    style.innerHTML = `
        #ig-extract-btn {
            position: fixed;
            bottom: 25px;
            right: 25px;
            z-index: 999999;
            background: linear-gradient(135deg, #ff5400, #ff0055);
            color: #fff;
            border: none;
            padding: 14px 22px;
            font-size: 15px;
            font-weight: bold;
            border-radius: 50px;
            cursor: pointer;
            box-shadow: 0 6px 20px rgba(255, 84, 0, 0.4);
            transition: all 0.2s ease-in-out;
            display: flex;
            align-items: center;
            gap: 8px;
        }
        #ig-extract-btn:hover {
            transform: translateY(-2px);
            box-shadow: 0 8px 25px rgba(255, 84, 0, 0.6);
        }
        .ig-dialog-overlay {
            position: fixed;
            top: 0; left: 0; width: 100vw; height: 100vh;
            background: rgba(0, 0, 0, 0.75);
            backdrop-filter: blur(5px);
            z-index: 1000000;
            display: flex;
            justify-content: center;
            align-items: center;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        }
        .ig-dialog-card {
            background: #181b20;
            color: #eceff4;
            width: 90%;
            max-width: 650px;
            max-height: 85vh;
            border-radius: 16px;
            box-shadow: 0 20px 40px rgba(0,0,0,0.6);
            border: 1px solid #2e3440;
            display: flex;
            flex-direction: column;
            overflow: hidden;
            animation: igPop 0.25s cubic-bezier(0.175, 0.885, 0.32, 1.275);
        }
        @keyframes igPop {
            from { transform: scale(0.9); opacity: 0; }
            to { transform: scale(1); opacity: 1; }
        }
        .ig-dialog-header {
            padding: 20px 24px;
            background: #21252d;
            border-bottom: 1px solid #2e3440;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        .ig-dialog-header h3 {
            margin: 0;
            font-size: 18px;
            color: #fff;
        }
        .ig-dialog-close {
            background: transparent;
            border: none;
            color: #d8dee9;
            font-size: 24px;
            cursor: pointer;
            line-height: 1;
        }
        .ig-dialog-close:hover { color: #ff5400; }
        .ig-dialog-body {
            padding: 20px 24px;
            overflow-y: auto;
            flex: 1;
        }
        .ig-actions-bar {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
            gap: 10px;
            margin-bottom: 20px;
        }
        .ig-btn-action {
            background: #2e3440;
            color: #eceff4;
            border: 1px solid #4c566a;
            padding: 10px 14px;
            border-radius: 8px;
            font-size: 13px;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.15s ease;
            text-align: center;
        }
        .ig-btn-action:hover {
            background: #ff5400;
            border-color: #ff5400;
            color: #fff;
        }
        .ig-item-row {
            background: #21252d;
            border: 1px solid #2e3440;
            border-radius: 8px;
            padding: 12px 16px;
            margin-bottom: 10px;
            display: flex;
            justify-content: space-between;
            align-items: center;
            gap: 15px;
        }
        .ig-item-info {
            display: flex;
            flex-direction: column;
            gap: 4px;
            overflow: hidden;
        }
        .ig-item-title {
            font-weight: bold;
            font-size: 14px;
            color: #eceff4;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }
        .ig-item-key {
            font-family: monospace;
            font-size: 14px;
            color: #a3be8c;
            letter-spacing: 0.5px;
        }
    `;
    document.head.appendChild(style);

    // Create & Attach Main Trigger Button
    const triggerBtn = document.createElement('button');
    triggerBtn.id = 'ig-extract-btn';
    triggerBtn.innerHTML = `🔑 Reveal & Extract Keys`;
    document.body.appendChild(triggerBtn);

    triggerBtn.addEventListener('click', async () => {
        triggerBtn.innerText = '⏳ Revealing...';
        triggerBtn.disabled = true;

        // 1. Click all "Reveal my code" buttons
        const revealButtons = Array.from(document.querySelectorAll('.display .button, a.button'))
            .filter(btn => btn.textContent.toLowerCase().includes('reveal'));

        revealButtons.forEach(btn => btn.click());

        // Wait short delay for DOM update / AJAX reveal
        await new Promise(res => setTimeout(res, 800));

        // 2. Collect Games & Keys
        const items = [];
        const cardElements = document.querySelectorAll('.details');

        cardElements.forEach(card => {
            // Get Title
            const titleEl = card.querySelector('.name h2');
            const title = titleEl ? titleEl.innerText.trim() : 'Unknown Game';

            // Get Key (Check Steam link first, then text box)
            let key = '';
            const steamLink = card.querySelector('a[href*="registerkey?key="]');
            if (steamLink) {
                const url = new URL(steamLink.href);
                key = url.searchParams.get('key') || '';
            }

            if (!key) {
                const codeEl = card.querySelector('.code .text-box, .code');
                if (codeEl) {
                    key = codeEl.innerText.trim();
                }
            }

            if (key && key !== 'YOUR-AWESOME-GAME-CODE') {
                items.push({ title, key });
            }
        });

        triggerBtn.innerHTML = `🔑 Reveal & Extract Keys`;
        triggerBtn.disabled = false;

        if (items.length === 0) {
            alert('No game keys found on this page.');
            return;
        }

        // 3. Render Dialog
        showDialog(items);
    });

    // Function to render floating modal dialog
    function showDialog(items) {
        const existingOverlay = document.querySelector('.ig-dialog-overlay');
        if (existingOverlay) existingOverlay.remove();

        const overlay = document.createElement('div');
        overlay.className = 'ig-dialog-overlay';

        const card = document.createElement('div');
        card.className = 'ig-dialog-card';

        // Header
        const header = document.createElement('div');
        header.className = 'ig-dialog-header';
        header.innerHTML = `
            <h3>Extracted Game Keys (${items.length})</h3>
            <button class="ig-dialog-close">&times;</button>
        `;
        card.appendChild(header);

        // Body
        const body = document.createElement('div');
        body.className = 'ig-dialog-body';

        // Action Buttons Bar
        const actionsBar = document.createElement('div');
        actionsBar.className = 'ig-actions-bar';

        const btnCopyNames = document.createElement('button');
        btnCopyNames.className = 'ig-btn-action';
        btnCopyNames.innerText = '📋 Copy Game Names';

        const btnCopyKeys = document.createElement('button');
        btnCopyKeys.className = 'ig-btn-action';
        btnCopyKeys.innerText = '🔑 Copy Keys Only';

        const btnCopyBoth = document.createElement('button');
        btnCopyBoth.className = 'ig-btn-action';
        btnCopyBoth.innerText = '📝 Copy Name + Key';

        actionsBar.appendChild(btnCopyNames);
        actionsBar.appendChild(btnCopyKeys);
        actionsBar.appendChild(btnCopyBoth);
        body.appendChild(actionsBar);

        // Item List
        const listContainer = document.createElement('div');
        items.forEach(item => {
            const row = document.createElement('div');
            row.className = 'ig-item-row';
            row.innerHTML = `
                <div class="ig-item-info">
                    <div class="ig-item-title">${escapeHTML(item.title)}</div>
                    <div class="ig-item-key">${escapeHTML(item.key)}</div>
                </div>
            `;
            listContainer.appendChild(row);
        });
        body.appendChild(listContainer);
        card.appendChild(body);
        overlay.appendChild(card);
        document.body.appendChild(overlay);

        // Copy Helper function
        const handleCopy = (text, btnElement, successMsg) => {
            if (typeof GM_setClipboard !== 'undefined') {
                GM_setClipboard(text);
            } else {
                navigator.clipboard.writeText(text);
            }
            const originalText = btnElement.innerText;
            btnElement.innerText = successMsg;
            setTimeout(() => { btnElement.innerText = originalText; }, 1500);
        };

        // Button Event Handlers
        btnCopyNames.addEventListener('click', () => {
            const content = items.map(i => i.title).join('\n');
            handleCopy(content, btnCopyNames, '✓ Names Copied!');
        });

        btnCopyKeys.addEventListener('click', () => {
            const content = items.map(i => i.key).join('\n');
            handleCopy(content, btnCopyKeys, '✓ Keys Copied!');
        });

        btnCopyBoth.addEventListener('click', () => {
            const content = items.map(i => `${i.title} - ${i.key}`).join('\n');
            handleCopy(content, btnCopyBoth, '✓ Copied Both!');
        });

        // Close handlers
        header.querySelector('.ig-dialog-close').addEventListener('click', () => overlay.remove());
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) overlay.remove();
        });
    }

    function escapeHTML(str) {
        return str.replace(/[&<>'"]/g,
            tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag] || tag)
        );
    }
})();