const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { buildSite } = require('./build-site.cjs');

test('release versions assets without publishing development fixtures or changing cloud configuration', () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'tombi-build-test-'));
  const output = path.join(temporary, 'site');
  try {
    const revision = buildSite(output);
    assert.match(revision, /^[a-f0-9]{40}$/);
    assert.equal(JSON.parse(fs.readFileSync(path.join(output, 'release.json'), 'utf8')).revision, revision);
    for (const name of ['index.html', 'parent.html']) {
      const html = fs.readFileSync(path.join(output, name), 'utf8');
      assert.ok(html.includes(`name="tombi-revision" content="${revision}"`));
      if (name === 'index.html') assert.match(html, /assets\/ocupa-mark\.svg\?v=[a-f0-9]{16}/);
      assert.match(html, /js\/cloud-config\.js\?v=[a-f0-9]{16}/);
    }
    for (const name of ['dev', 'docs', 'README.md']) assert.equal(fs.existsSync(path.join(output, name)), false);
    assert.equal(fs.readFileSync(path.join(output, 'js', 'cloud-config.js'), 'utf8'),
      fs.readFileSync(path.join(__dirname, '..', 'js', 'cloud-config.js'), 'utf8'));
    assert.throws(() => buildSite(output), /must not already exist/);
    assert.throws(() => buildSite(path.resolve(__dirname, '..')), /outside the source tree/);
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});
