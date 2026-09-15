import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(new URL("./code.user.js", import.meta.url));
const scriptSource = readFileSync(scriptPath, "utf8");

test("matches the Humble keys page when the URL has query parameters", () => {
  const matchPattern = scriptSource.match(/^\/\/\s*@match\s+(.+)$/m)?.[1]?.trim();

  assert.equal(
    matchPattern,
    "https://www.humblebundle.com/home/keys*",
    "@match must include URL variants such as /home/keys?abcxyz=value",
  );
});
