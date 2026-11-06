// Lets `node --test tests/` work on Node 22, which treats a folder argument as a module path and
// loads tests/index.js. It imports every *.test.mjs file in this folder so all suites run.
// Other ways to run the same suites: `node --test` or `node --test 'tests/*.test.mjs'`.
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const files = fs.readdirSync(__dirname).filter((f) => f.endsWith('.test.mjs')).sort();
(async () => {
  for (const f of files) await import(pathToFileURL(path.join(__dirname, f)).href);
})();
