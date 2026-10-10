#!/bin/sh
# Rebuilds art/imd-panel.js.gz from art/source: the panel page and the imd.fun drawing code it imports, bundled and
# minified with a pinned esbuild, then gzipped by Node's zlib at level 9 with no name, no timestamp and the OS byte set
# to 3, so the same source gives the same bytes. Built with Node v24.10.0 (zlib 1.3.1); other zlib builds may compress
# differently. Prints the keccak256 to check against the hash in README.md and PanelRenderer.scriptHash().
set -e
cd "$(dirname "$0")/source"
npx --yes esbuild@0.24.0 contracts/renderer/panel.ts --bundle --minify --format=iife --target=es2020 --legal-comments=none --log-level=warning --outfile=../out/imd-panel.js
cd ..
node -e '
const fs = require("fs"), zlib = require("zlib");
const gz = zlib.gzipSync(fs.readFileSync("out/imd-panel.js"), { level: 9, memLevel: 8, windowBits: 15, strategy: zlib.constants.Z_DEFAULT_STRATEGY });
gz[9] = 3;
fs.writeFileSync("out/imd-panel.js.gz", gz);
console.log(`node ${process.version}, zlib ${process.versions.zlib}`);
'
echo "gzipped $(wc -c < out/imd-panel.js.gz | tr -d ' ') bytes"
echo "keccak256 $(cast keccak "0x$(xxd -p out/imd-panel.js.gz | tr -d '\n')")"
cmp -s out/imd-panel.js.gz imd-panel.js.gz && echo "matches art/imd-panel.js.gz" || { echo "DIFFERS from art/imd-panel.js.gz"; exit 1; }
