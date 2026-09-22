const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

function loadGetPricesFromDOM() {
  const scriptPath = path.join(__dirname, "code.user.js");
  const source = fs.readFileSync(scriptPath, "utf8").replace(
    /\n\}\)\(\);\s*$/,
    "\n  globalThis.__lestradesTestHooks = { getPricesFromDOM };\n})();\n",
  );
  const context = {
    console,
    document: {},
    globalThis: null,
    location: { hostname: "lestrades.com" },
    navigator: { userAgent: "node" },
    setTimeout: () => 0,
    window: { addEventListener: () => {} },
    GM_addStyle: () => {},
    GM_getValue: () => ({}),
    GM_registerMenuCommand: () => {},
    GM_setValue: () => {},
  };
  context.globalThis = context;

  vm.runInNewContext(source, context, { filename: scriptPath });
  return context.__lestradesTestHooks.getPricesFromDOM;
}

function priceElement(title, price) {
  const container = { textContent: title };
  return {
    textContent: `$${price.toFixed(2)}`,
    closest: (selector) =>
      selector === ".similar-deals-container" ? container : null,
  };
}

function priceDocument(official, keyshops) {
  return {
    querySelector: () => null,
    querySelectorAll: (selector) =>
      selector.startsWith("#official-stores") ? official : keyshops,
  };
}

test("Steam Key prices take priority over cheaper Altergift and official offers", async () => {
  const getPricesFromDOM = loadGetPricesFromDOM();
  const doc = priceDocument(
    [priceElement("Official Steam offer", 6)],
    [
      priceElement("Game Steam Altergift", 4),
      priceElement("Game Steam Key", 10),
      priceElement("Game Steam Key", 8),
    ],
  );

  const result = await getPricesFromDOM(
    doc,
    "steam",
    '"priceCurrency":"USD"',
  );

  assert.equal(result, "USD|800");
});

test("all Steam Altergift offers still compete with official store prices", async () => {
  const getPricesFromDOM = loadGetPricesFromDOM();
  const doc = priceDocument(
    [priceElement("Official Steam offer", 6)],
    [
      priceElement("Game Steam Altergift", 5),
      priceElement("Game Steam Altergift", 4),
    ],
  );

  const result = await getPricesFromDOM(
    doc,
    "steam",
    '"priceCurrency":"USD"',
  );

  assert.equal(result, "USD|400");
});

test("official store price is used when Steam keyshops are empty", async () => {
  const getPricesFromDOM = loadGetPricesFromDOM();
  const doc = priceDocument([priceElement("Official Steam offer", 6)], []);

  const result = await getPricesFromDOM(
    doc,
    "steam",
    '"priceCurrency":"USD"',
  );

  assert.equal(result, "USD|600");
});
