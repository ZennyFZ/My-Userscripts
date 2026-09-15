// ==UserScript==
// @name         Kinguin Auto Download Keys
// @namespace    http://tampermonkey.net/
// @version      1.1
// @description  Automates downloading of order keys based on a target product name.
// @author       Zenny
// @match        https://*.kinguin.net/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=Kinguin.net
// @grant        GM_registerMenuCommand
// ==/UserScript==

(function() {
    'use strict';

    // Helper function to pause execution and let the DOM catch up
    const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

    async function autoDownloadKeys() {
        const targetProductName = prompt(
            "Enter the product name to download keys for:",
            "Jurassic World Evolution ASIA/OCEANIA Steam CD Key"
        );

        if (!targetProductName || targetProductName.trim() === "") {
            console.log("Auto-download cancelled: No product name provided.");
            return;
        }

        console.log(`Searching for exact matches: "${targetProductName}"`);

        // 1. Find all text nodes on the page that contain the target product name
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null, false);
        const matchingTextElements = [];
        let node;

        while ((node = walker.nextNode())) {
            // We use includes() to ensure partial text matches still work correctly
            if (node.nodeValue.includes(targetProductName.trim())) {
                matchingTextElements.push(node.parentElement);
            }
        }

        // 2. Resolve those text elements to their specific order's "3 dots" button
        // We use a Set so we don't accidentally click the exact same button twice
        const matchedButtons = new Set();

        for (let el of matchingTextElements) {
            let parent = el;
            let foundBtn = null;

            // Traverse up until we find a container that has EXACTLY ONE menu toggle button.
            // This ensures we have found the individual order row, not the entire list of orders.
            while (parent && parent !== document.body) {
                const btns = parent.querySelectorAll('button[data-test="orderActionsMenuToggle"]');

                if (btns.length === 1) {
                    foundBtn = btns[0];
                    break; // Found the 1:1 matching button for this specific order!
                } else if (btns.length > 1) {
                    // We traversed too high and hit the master list container holding multiple orders. Stop immediately.
                    break;
                }
                parent = parent.parentElement;
            }

            if (foundBtn) {
                matchedButtons.add(foundBtn);
            }
        }

        if (matchedButtons.size === 0) {
            alert(`No exact matches found for product: "${targetProductName}"`);
            return;
        }

        console.log(`Found ${matchedButtons.size} orders matching the product. Starting download sequence...`);

        let processedCount = 0;

        // 3. Process each accurately identified button
        for (const toggle of matchedButtons) {
            console.log(`Opening menu for item ${processedCount + 1}...`);

            // Open the 3-dots menu
            toggle.click();

            // Wait for the dropdown menu to dynamically render in the DOM
            await sleep(600);

            // Find the active 'Download keys' button
            const downloadBtns = document.querySelectorAll('button[data-test="downloadKeysButton"]');
            const activeDownloadBtn = Array.from(downloadBtns).find(btn => btn.offsetParent !== null) || downloadBtns[0];

            if (activeDownloadBtn) {
                console.log("Clicking 'Download keys'...");
                activeDownloadBtn.click();
                processedCount++;

                // Wait for the download/action to trigger before processing the next order
                await sleep(1500);
            } else {
                console.warn("Could not locate the 'Download keys' button in the opened menu.");
            }
        }

        alert(`Sequence complete! Processed ${processedCount} orders safely.`);
    }

    // Register the command so it appears in the Tampermonkey popup menu
    if (typeof GM_registerMenuCommand !== "undefined") {
        GM_registerMenuCommand("Auto-Download Keys by Name", autoDownloadKeys);
    } else {
        console.warn("Your script manager does not support GM_registerMenuCommand.");
    }
})();