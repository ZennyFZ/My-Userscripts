// ==UserScript==
// @name         Humble Helper Buttons
// @namespace    http://tampermonkey.net/
// @version      1.1
// @author       Zenny
// @description  Reveal and copy game keys easily
// @match        https://www.humblebundle.com/home/keys
// @icon         https://www.google.com/s2/favicons?sz=64&domain=humblebundle.com
// @grant        GM_setClipboard
// ==/UserScript==

(function () {
    'use strict';

    function createButton(text, topOffset, onClick) {
        const btn = document.createElement("button");
        btn.innerText = text;

        btn.style.position = "fixed";
        btn.style.right = "20px";
        btn.style.top = topOffset + "px";
        btn.style.zIndex = "9999";
        btn.style.padding = "10px 15px";
        btn.style.background = "#3B82F6";
        btn.style.color = "white";
        btn.style.border = "none";
        btn.style.borderRadius = "8px";
        btn.style.cursor = "pointer";
        btn.style.fontWeight = "bold";
        btn.style.boxShadow = "0 4px 10px rgba(0,0,0,0.3)";

        btn.addEventListener("click", onClick);
        document.body.appendChild(btn);
    }

    // Reveal All Keys
    createButton("Reveal All Keys", 150, () => {
        document.querySelectorAll("div.js-keyfield.keyfield.enabled")
            .forEach(el => el.click());
    });

    // Copy All Names
    createButton("Copy All Names", 200, () => {
        const names = Array.from(document.querySelectorAll("td.game-name h4"))
            .filter(name => !name.textContent.includes("Humble Choice"))
            .map(name => name.textContent.trim())
            .join("\n");

        GM_setClipboard(names);
        alert("Game names copied!");
    });

    // Copy All Keys
    createButton("Copy All Keys", 250, () => {
        const keys = Array.from(document.getElementsByClassName("keyfield-value"))
            .map(code => code.textContent.trim())
            .join("\n");

        GM_setClipboard(keys);
        alert("Keys copied!");
    });

    // Copy Name : Key
    createButton("Copy Name : Key", 300, () => {
        const pairs = Array.from(document.querySelectorAll("td.game-name"))
            .map(td => {
                const name = td.querySelector("h4")?.textContent.trim();
                const key = td.closest("tr")?.querySelector(".keyfield-value")?.textContent.trim();
                return name && key && !name.includes("Humble Choice") ? `${name} : ${key}` : null;
            })
            .filter(Boolean)
            .join("\n");

        if (!pairs) {
            alert("No revealed keys found. Click 'Reveal All Keys' first!");
            return;
        }

        GM_setClipboard(pairs);
        alert("Game names and keys copied!");
    });

})();