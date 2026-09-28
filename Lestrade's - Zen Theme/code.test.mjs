import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(new URL("./code.user.js", import.meta.url));
const scriptSource = readFileSync(scriptPath, "utf8");

test("adds spacing above another user's offers navigation", () => {
  const offersRule = scriptSource.match(
    /html\.\$\{ROOT_CLASS\} body\.lt-offers-page #more-lists \{([\s\S]*?)\n    \}/,
  )?.[1];

  assert.match(
    offersRule || "",
    /margin-top:\s*22px\s*!important;/,
    "the other-user offers navigation must sit below the fixed header",
  );
});

test("does not start automatic PM conversation polling", () => {
  assert.doesNotMatch(scriptSource, /function startPmLivePolling/);
  assert.doesNotMatch(scriptSource, /startPmLivePolling\(threadPane, replyHref\)/);
});

test("lets the native PM send submit reload the page", () => {
  assert.match(
    scriptSource,
    /function bindInlinePmSubmit\([\s\S]*?if \(submitter\?\.name === "post_button"\) return;/,
    "the send action must use the browser's native form submission",
  );
});

test("recreates a missing SteamTrades profile link from the Steam profile", () => {
  assert.match(
    scriptSource,
    /function ensureSteamTradesProfileLink\(definition\) \{/,
    "the fallback must derive the SteamTrades profile from the native Steam profile link",
  );
  assert.ok(
    scriptSource.includes("steamcommunity\\.com"),
    "the fallback must inspect the native Steam profile link",
  );
  assert.ok(
    scriptSource.includes("steamtrades\\.com\\/user\\/"),
    "the fallback must build the SteamTrades profile URL",
  );
  assert.match(
    scriptSource,
    /function parseSteamTradesReputation\(html\) \{/,
    "the fallback must parse the live SteamTrades profile response",
  );
  assert.match(scriptSource, /@grant\s+GM_xmlhttpRequest/, "the userscript must be allowed to read SteamTrades cross-origin");
  assert.match(scriptSource, /GM_xmlhttpRequest\(/, "the reputation request must use the userscript cross-origin API");
  assert.match(scriptSource, /findRatingLink\("positive"\)/, "the parser must read the positive count from SteamTrades");
  assert.match(scriptSource, /findRatingLink\("negative"\)/, "the parser must read the negative count from SteamTrades");
  assert.doesNotMatch(
    scriptSource,
    /STEAMTRADES_REPUTATION_FALLBACKS|76561198425513259.*positive: "300"/s,
    "the reputation must not be hard-coded to one profile",
  );
  assert.match(
    scriptSource,
    /ensureSteamTradesProfileLink\(definitions\[7\]\);/,
    "the Profile links definition must receive the SteamTrades fallback",
  );
  assert.match(scriptSource, /Reputation:/, "the fallback must preserve the reputation label");
});

test("keeps the Lest amount field visible in the Zen profile", () => {
  assert.match(
    scriptSource,
    /markProfileFieldsHidden\(definitions\[0\], \(label\) => \/\^Username:\/i\.test\(label\)\);/,
    "the Zen profile must not hide Lest ₪ amount",
  );
});
