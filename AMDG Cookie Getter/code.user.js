// ==UserScript==
// @name         AMDG Cookie Getter
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  get http-cookie from amdgaming
// @author       Zenny
// @icon         https://www.google.com/s2/favicons?sz=64&domain=amdgaming.com
// @match        https://*.amdgaming.com/*
// @grant        GM_xmlhttpRequest
// @grant        GM_registerMenuCommand
// @grant        GM_cookie
// @grant        GM_setValue
// @grant        GM_getValue
// ==/UserScript==

(function() {
    'use strict';

    const COOKIE_CACHE_KEY = "_t_cookie_list";
    const AMDG_AS = "/account-settings";
    const COOKIE_NAME = "_t";

    function getCookie(details) {
        return new Promise((resolve, reject) => {
            try {
                GM_cookie.list(details, (cookies, error) => {
                    if (error) reject(error);
                    else resolve(Array.isArray(cookies) ? cookies : []);
                });
            } catch (e) {
                reject(e);
            }
        });
    }

    async function fetchEmail() {
        const response = await GM.xmlHttpRequest({
            method: 'GET',
            url: AMDG_AS,
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            }
        });

        const data = JSON.parse(response.responseText);
        return data.current_user?.email;
    }

    async function captureCookie() {
        try {
            const cookies = await getCookie({
                url: location.href,
                name: COOKIE_NAME,
            });

            const cookie = cookies.find((item) => item?.name === COOKIE_NAME && item.value);

            if (!cookie) {
                console.log(`[Userscript] cookie not found: ${COOKIE_NAME}`);
                return;
            }

            const email = await fetchEmail();

            const newEntry = {
                email: email,
                url: location.origin,
                domain: cookie.domain,
                path: cookie.path,
                value: cookie.value,
                updatedAt: Date.now(),
                expirationDate: cookie.expirationDate ?? null,
                httpOnly: cookie.httpOnly ?? false,
                secure: cookie.secure ?? false,
            };

            let cookieList = GM_getValue(COOKIE_CACHE_KEY, []);

            const existingIndex = cookieList.findIndex(item => item.domain === newEntry.domain && item.value === newEntry.value);
            if (existingIndex !== -1) {
                cookieList[existingIndex] = newEntry;
            } else {
                cookieList.push(newEntry);
            }

            GM_setValue(COOKIE_CACHE_KEY, cookieList);
        } catch (e) {
            console.error("[Userscript] get cookie failed:", e);
        }
    }

    captureCookie();
})();