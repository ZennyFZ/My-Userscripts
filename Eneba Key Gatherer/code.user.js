// ==UserScript==
// @name         Eneba Key Gatherer
// @namespace    http://tampermonkey.net/
// @version      2.7
// @description  Automate Eneba redemption, gather keys, handle React Select dropdown, and block copy prompt fallback.
// @author       Zenny
// @match        https://www.eneba.com/redeem-keys*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=eneba.com
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

    const isVisible = (elem) => {
        if (!elem) return false;

        const rect = elem.getBoundingClientRect();
        const style = window.getComputedStyle(elem);

        return (
            rect.width > 0 &&
            rect.height > 0 &&
            style.display !== 'none' &&
            style.visibility !== 'hidden' &&
            style.opacity !== '0'
        );
    };

    let gatheredKeys = [];

    // --- 1. CLIPBOARD + PROMPT INTERCEPTOR ---

    const hasClipboardWrite =
        navigator.clipboard &&
        typeof navigator.clipboard.writeText === 'function';

    const originalWriteText = hasClipboardWrite
        ? navigator.clipboard.writeText.bind(navigator.clipboard)
        : async () => {};

    const originalPrompt = window.prompt.bind(window);

    function addGatheredKey(text, source = 'unknown') {
        if (!text) return;

        const cleanText = String(text).trim();

        if (!cleanText || cleanText.length <= 5) return;

        // Nếu clipboard chứa nhiều dòng thì tách từng dòng để tránh lưu cả block thành 1 key
        const lines = cleanText
            .split(/\r?\n/)
            .map(line => line.trim())
            .filter(Boolean);

        for (const line of lines) {
            if (line.length > 5 && !gatheredKeys.includes(line)) {
                gatheredKeys.push(line);
                console.log(`🔑 Captured from ${source}:`, line);
            }
        }

        updateUIBox();
    }

    // Chặn Clipboard API của Eneba.
    // Quan trọng: luôn resolve để Eneba không fallback sang window.prompt().
    if (hasClipboardWrite) {
        navigator.clipboard.writeText = async function (text) {
            addGatheredKey(text, 'clipboard');

            try {
                await originalWriteText(text);
            } catch (error) {
                console.warn('Clipboard write failed, but key was already captured:', error);
            }

            return Promise.resolve();
        };
    }

    // Chặn popup fallback kiểu:
    // Copy to clipboard: Ctrl+C, Enter
    window.prompt = function (message, defaultValue) {
        const msg = String(message || '');
        const value = String(defaultValue || '').trim();

        if (/copy to clipboard/i.test(msg) && value.length > 5) {
            addGatheredKey(value, 'prompt');

            try {
                originalWriteText(value).catch(() => {});
            } catch (error) {
                console.warn('Silent clipboard copy failed:', error);
            }

            // Không gọi originalPrompt, nên popup sẽ không hiện.
            return value;
        }

        return originalPrompt(message, defaultValue);
    };

    async function copyFinalResult(text) {
        try {
            await originalWriteText(text);
            return true;
        } catch (error) {
            console.warn('Final clipboard copy failed:', error);
            return false;
        }
    }

    // --- 2. EVENT HELPERS FOR REACT SELECT ---

    function fireMouseLikeUser(el, type) {
        if (!el) return;

        const rect = el.getBoundingClientRect();

        const baseOptions = {
            bubbles: true,
            cancelable: true,
            view: window,
            clientX: rect.left + rect.width / 2,
            clientY: rect.top + rect.height / 2,
            screenX: window.screenX + rect.left + rect.width / 2,
            screenY: window.screenY + rect.top + rect.height / 2,
            buttons: type.includes('down') ? 1 : 0,
            button: 0,
        };

        const EventCtor =
            type.startsWith('pointer') && window.PointerEvent
                ? PointerEvent
                : MouseEvent;

        const eventOptions = type.startsWith('pointer')
            ? {
                ...baseOptions,
                pointerId: 1,
                pointerType: 'mouse',
                isPrimary: true,
            }
            : baseOptions;

        el.dispatchEvent(new EventCtor(type, eventOptions));
    }

    function fireFullMouseSequence(el) {
        fireMouseLikeUser(el, 'pointerdown');
        fireMouseLikeUser(el, 'mousedown');
        fireMouseLikeUser(el, 'pointerup');
        fireMouseLikeUser(el, 'mouseup');
        fireMouseLikeUser(el, 'click');
    }

    function fireKey(el, key, code, keyCode) {
        if (!el) return;

        const event = new KeyboardEvent('keydown', {
            key,
            code,
            bubbles: true,
            cancelable: true,
        });

        Object.defineProperty(event, 'keyCode', {
            get: () => keyCode,
        });

        Object.defineProperty(event, 'which', {
            get: () => keyCode,
        });

        el.dispatchEvent(event);
    }

    async function waitForReactSelectOptions(timeout = 3000) {
        const start = Date.now();

        while (Date.now() - start < timeout) {
            const menuList = Array.from(document.querySelectorAll(
                '.react-select__menu-list, [class*="__menu-list"]'
            )).find(isVisible);

            const optionSelector = [
                '.react-select__option',
                'div[role="option"]',
                'div[id*="-option-"]',
                '[class*="__option"]'
            ].join(',');

            const options = menuList
                ? Array.from(menuList.querySelectorAll(optionSelector))
                : Array.from(document.querySelectorAll(optionSelector));

            const visibleOptions = options.filter(option => {
                const text = option.textContent.trim();

                return (
                    isVisible(option) &&
                    text &&
                    option.getAttribute('aria-disabled') !== 'true' &&
                    !/no options/i.test(text)
                );
            });

            if (visibleOptions.length > 0) {
                return visibleOptions;
            }

            await sleep(100);
        }

        return [];
    }

    async function selectFirstReactSelectOption(control) {
        if (!control || !isVisible(control)) {
            console.log('⚠️ React Select control không tồn tại hoặc không hiển thị.');
            return false;
        }

        control.scrollIntoView({
            block: 'center',
            inline: 'nearest',
        });

        await sleep(300);

        const input = control.querySelector('input');

        if (input) {
            input.focus({ preventScroll: true });
            await sleep(200);
        }

        console.log('Đang mở react-select dropdown...');

        fireFullMouseSequence(control);
        await sleep(800);

        let options = await waitForReactSelectOptions(2500);

        if (!options.length && input) {
            console.log('Không thấy option sau khi click. Thử mở bằng keyboard...');

            input.focus({ preventScroll: true });
            await sleep(200);

            fireKey(input, 'ArrowDown', 'ArrowDown', 40);
            await sleep(800);

            options = await waitForReactSelectOptions(2500);
        }

        if (!options.length) {
            console.log('⚠️ Không tìm thấy option nào trong dropdown.');
            return false;
        }

        const targetOption = options[0];

        targetOption.scrollIntoView({
            block: 'nearest',
            inline: 'nearest',
        });

        await sleep(250);

        console.log('Đang chọn option:', targetOption.textContent.trim());

        fireFullMouseSequence(targetOption);
        await sleep(800);

        const stillOpen = Array.from(document.querySelectorAll(
            '.react-select__menu, .react-select__menu-list, [class*="__menu"]'
        )).some(isVisible);

        if (stillOpen && input) {
            console.log('Dropdown vẫn mở. Thử chọn bằng Enter...');

            input.focus({ preventScroll: true });
            await sleep(200);

            fireKey(input, 'Enter', 'Enter', 13);
            await sleep(700);
        }

        return true;
    }

    // --- 3. REDEMPTION PROCESS ---

    async function processSingleKey() {
        console.log('Starting redemption process...');

        // A. Click "Manual Activation"
        const manualBtn = Array.from(document.querySelectorAll('button')).find(btn =>
            btn.textContent.includes('Manual Activation') &&
            isVisible(btn) &&
            !btn.disabled
        );

        if (manualBtn) {
            console.log('Clicking Manual Activation...');
            manualBtn.click();
            await sleep(1500);
        } else {
            console.log('Manual Activation button not found. Maybe already selected.');
        }

        // B. Check Platform and Region checkboxes
        const checkBoxes = ['confirmPlatform', 'confirmRegion'];

        for (const id of checkBoxes) {
            const cb = document.getElementById(id);

            if (cb && !cb.checked && isVisible(cb)) {
                console.log(`Checking ${id}...`);
                cb.click();
                await sleep(400);
            }
        }

        await sleep(600);

        // C. Handle React Select Dropdown
        const dropdownControls = Array.from(
            document.querySelectorAll('.react-select__control, [class*="__control"]')
        ).filter(isVisible);

        if (dropdownControls.length > 0) {
            console.log(`Found ${dropdownControls.length} dropdown control(s).`);

            const control = dropdownControls[0];
            const selected = await selectFirstReactSelectOption(control);

            if (selected) {
                console.log('✅ Đã chọn option đầu tiên trong dropdown.');
            } else {
                console.log('⚠️ Không thể chọn option trong dropdown.');
            }

            await sleep(1000);
        } else {
            console.log('No react-select dropdown found. Skipping dropdown step.');
        }

        // D. Click "Display the key"
        const displayBtn = Array.from(document.querySelectorAll('button')).find(btn =>
            btn.textContent.includes('Display the key') &&
            isVisible(btn) &&
            !btn.disabled
        );

        if (displayBtn) {
            console.log('Clicking Display the key...');
            displayBtn.click();

            console.log('Waiting for key generation...');
            await sleep(4500);
        } else {
            console.log('Display the key button not found or disabled.');
        }

        // E. Click "Copy"
        const copyBtn =
            document.querySelector('button.fBdMXd') ||
            document.querySelector('.PMaLzD button') ||
            Array.from(document.querySelectorAll('button')).find(btn =>
                /copy/i.test(btn.textContent) &&
                isVisible(btn) &&
                !btn.disabled
            );

        if (copyBtn && isVisible(copyBtn)) {
            console.log('Clicking Copy button...');
            copyBtn.click();
            await sleep(700);
        } else {
            console.log('Copy button not found.');
        }
    }

    // --- 4. MAIN LOOP ---

    async function runAutoRedeem() {
        const btn = document.getElementById('tm-start-btn');

        if (btn) {
            btn.textContent = 'Processing...';
            btn.style.backgroundColor = '#ff9800';
            btn.disabled = true;
        }

        gatheredKeys = [];
        updateUIBox();

        const items = Array.from(
            document.querySelectorAll('ul.p9i66W li.BahnFD')
        ).filter(isVisible);

        if (items.length > 0) {
            console.log(`Found ${items.length} items. Processing...`);

            for (let i = 0; i < items.length; i++) {
                console.log(`\n--- Item ${i + 1} of ${items.length} ---`);

                const currentItems = Array.from(
                    document.querySelectorAll('ul.p9i66W li.BahnFD')
                ).filter(isVisible);

                const item = currentItems[i];

                if (!item) {
                    console.log(`Item ${i + 1} not found. Skipping...`);
                    continue;
                }

                item.scrollIntoView({
                    block: 'center',
                    inline: 'nearest',
                });

                await sleep(500);

                item.click();
                await sleep(1800);

                await processSingleKey();
                await sleep(1600);
            }

            if (gatheredKeys.length > 0) {
                const allKeysString = gatheredKeys.join('\n');
                const copied = await copyFinalResult(allKeysString);

                alert(
                    `Done! Successfully gathered ${gatheredKeys.length} keys.\n\n` +
                    (
                        copied
                            ? 'All keys have been copied to your clipboard.'
                            : 'Could not copy automatically, but all keys are visible in the green box.'
                    )
                );
            } else {
                alert('Finished, but no keys were found. Please check the console.');
            }
        } else {
            console.log('No item list found. Processing current page only...');

            await processSingleKey();

            if (gatheredKeys.length > 0) {
                const allKeysString = gatheredKeys.join('\n');
                const copied = await copyFinalResult(allKeysString);

                alert(
                    `Done! Successfully gathered ${gatheredKeys.length} key(s).\n\n` +
                    (
                        copied
                            ? 'All keys have been copied to your clipboard.'
                            : 'Could not copy automatically, but all keys are visible in the green box.'
                    )
                );
            } else {
                alert('Finished, but no keys were found. Please check the console.');
            }
        }

        if (btn) {
            btn.textContent = 'Start Key Gatherer';
            btn.style.backgroundColor = '#4CAF50';
            btn.disabled = false;
        }
    }

    // --- 5. USER INTERFACE & INITIALIZATION ---

    function updateUIBox() {
        let box = document.getElementById('tm-key-box');

        if (!box) {
            if (!document.body) return;

            box = document.createElement('textarea');
            box.id = 'tm-key-box';
            box.readOnly = true;
            box.placeholder = 'Gathered keys will appear here...';

            box.style.cssText = [
                'position:fixed',
                'top:20px',
                'right:20px',
                'width:250px',
                'height:300px',
                'z-index:999999',
                'background:#1e1e1e',
                'color:#00ff00',
                'font-family:monospace',
                'padding:12px',
                'border-radius:8px',
                'border:2px solid #333',
                'box-shadow:0 4px 10px rgba(0,0,0,0.5)',
                'resize:none',
                'font-size:14px',
            ].join(';');

            document.body.appendChild(box);
        }

        box.value = gatheredKeys.join('\n');
        box.scrollTop = box.scrollHeight;
    }

    function createUIButton() {
        if (!document.body) return;

        updateUIBox();

        if (document.getElementById('tm-start-btn')) return;

        const btn = document.createElement('button');
        btn.id = 'tm-start-btn';
        btn.textContent = 'Start Key Gatherer';

        btn.style.cssText = [
            'position:fixed',
            'bottom:20px',
            'right:20px',
            'z-index:999999',
            'padding:15px 25px',
            'background-color:#4CAF50',
            'color:white',
            'border:none',
            'border-radius:8px',
            'cursor:pointer',
            'font-weight:bold',
            'box-shadow:0 4px 6px rgba(0,0,0,0.3)',
            'font-size:16px',
            'transition:0.3s',
        ].join(';');

        btn.addEventListener('click', runAutoRedeem);
        document.body.appendChild(btn);
    }

    function initUI() {
        createUIButton();

        // Check every 1.5 seconds to restore UI if React dynamic re-renders remove it
        setInterval(() => {
            if (!document.getElementById('tm-start-btn')) {
                createUIButton();
            }
        }, 1500);
    }

    if (document.readyState === 'complete' || document.readyState === 'interactive') {
        initUI();
    } else {
        window.addEventListener('DOMContentLoaded', initUI);
    }

})();