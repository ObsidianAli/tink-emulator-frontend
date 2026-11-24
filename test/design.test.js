const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const renderer = path.join(__dirname, '..', 'renderer');
const read = (name) => fs.readFileSync(path.join(renderer, name), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

function values(css) {
  return [...css.matchAll(/[\w-]+\s*:\s*([^;{}]+);/g)].map((match) => match[1].trim());
}

test('stylesheets only use values from tokens.css', () => {
  const raw = /#[0-9a-f]{3,8}\b|\b(rgba?|hsla?)\(|\d(px|em|rem|ms|s)\b|cubic-bezier|['"]/i;
  for (const name of ['style.css', 'hint.css']) {
    for (const value of values(read(name))) {
      assert.ok(!raw.test(value), `${name} uses a raw value: ${value}`);
    }
  }
});

test('tokens stick to three text sizes and one accent', () => {
  const tokens = read('tokens.css');
  assert.strictEqual([...tokens.matchAll(/--text-[\w-]+\s*:/g)].length, 3);
  assert.strictEqual([...tokens.matchAll(/--accent[\w-]*\s*:/g)].length, 1);
});

test('the bundled font and its licence ship with the app', () => {
  for (const file of ['inter-latin.woff2', 'inter-latin-ext.woff2', 'LICENSE.txt']) {
    assert.ok(fs.existsSync(path.join(renderer, 'fonts', file)), file);
  }
});
