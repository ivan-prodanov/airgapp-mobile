// Asset stub for `node --test`. Metro turns `require('*.png')` into an asset id in
// the app; under plain node those requires are parsed as JavaScript and throw
// (`SyntaxError: Invalid or unexpected token`). Register a no-op loader for asset
// extensions so pure logic modules that transitively import an icon/asset barrel
// (e.g. controlActions -> nativePng -> require('*.png')) stay node-testable.
const Module = require('node:module');
for (const ext of ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg']) {
  Module._extensions[ext] = (module) => {
    module.exports = {};
  };
}
