const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

function buildSite(output) {
  const source = path.resolve(__dirname, '..');
  const destination = path.resolve(output);
  if (destination === source || destination.startsWith(source + path.sep) ||
      source.startsWith(destination + path.sep)) {
    throw new Error('Build output must be outside the source tree and its ancestors');
  }
  if (fs.existsSync(destination)) throw new Error('Build output must not already exist');
  const revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: source, encoding: 'utf8' }).trim();
  fs.cpSync(source, destination, {
    recursive: true,
    filter: (file) => !['dev', 'docs', 'README.md'].includes(path.relative(source, file).split(path.sep)[0]),
  });
  for (const name of ['index.html', 'parent.html']) {
    const target = path.join(destination, name);
    const html = fs.readFileSync(target, 'utf8').replace(
      /\b(src|href)="([^"]+)"/g,
      (match, attribute, url) => {
        if (/^(?:[a-z]+:|\/\/|#)/i.test(url)) return match;
        const relative = url.split(/[?#]/)[0];
        const asset = path.resolve(destination, relative);
        if (!asset.startsWith(destination + path.sep) || !fs.existsSync(asset) || !fs.statSync(asset).isFile()) return match;
        const hash = createHash('sha256').update(fs.readFileSync(asset)).digest('hex').slice(0, 16);
        return `${attribute}="${relative}?v=${hash}"`;
      },
    ).replace('</head>', `<meta name="tombi-revision" content="${revision}">\n</head>`);
    fs.writeFileSync(target, html);
  }
  fs.writeFileSync(path.join(destination, 'release.json'), JSON.stringify({ revision }) + '\n');
  return revision;
}

if (require.main === module) {
  if (process.argv.length !== 3) throw new Error('Usage: node build-site.cjs <new-output-directory>');
  console.log('Built revision:', buildSite(process.argv[2]));
}

module.exports = { buildSite };
