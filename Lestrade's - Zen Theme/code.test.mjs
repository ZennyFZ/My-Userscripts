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
