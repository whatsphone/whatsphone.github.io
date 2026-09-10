#!/usr/bin/env node
// Stamp every local asset reference with a hash of that file's contents, so a
// changed asset gets a new URL and can never be served from a stale cache.
//
//   node tools/cache-bust.mjs          # rewrite in place
//   node tools/cache-bust.mjs --check  # exit 1 if anything is out of date (CI)
//
// Run it after changing any image, icon or manifest. index.html itself cannot be
// stamped this way (it is the entry point), but GitHub Pages serves it with
// Cache-Control: max-age=600, so it refreshes on its own within ten minutes.

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const check = process.argv.includes('--check');
// Files that reference local assets and should be stamped.
const TARGETS = ['site.webmanifest', 'index.html'];
// Matches "/asset.ext" or "/asset.ext?v=abc123" inside a src/href/"src" value.
const REF = /(["'(])(\/[A-Za-z0-9._-]+\.(?:png|svg|ico|webmanifest|jpg|jpeg|webp|json))(\?v=[A-Za-z0-9]+)?(["')])/g;

// One target (site.webmanifest) is itself a hashed asset referenced by another,
// so stamping changes its hash. Re-run until the whole set stops changing.
function pass(write) {
    const hashes = new Map();
    const hashOf = (assetPath) => {
        if (hashes.has(assetPath)) return hashes.get(assetPath);
        const file = join(root, assetPath.replace(/^\//, ''));
        if (!existsSync(file)) return null;
        const h = createHash('sha256').update(readFileSync(file)).digest('hex').slice(0, 8);
        hashes.set(assetPath, h);
        return h;
    };

    const changes = [];
    let total = 0;
    for (const target of TARGETS) {
        const file = join(root, target);
        if (!existsSync(file)) continue;
        const before = readFileSync(file, 'utf8');
        const after = before.replace(REF, (match, open, assetPath, existing, close) => {
            const h = hashOf(assetPath);
            if (!h) {
                console.warn(`  ! ${target}: ${assetPath} not found, leaving as-is`);
                return match;
            }
            total++;
            const want = `?v=${h}`;
            if (existing !== want) changes.push(`  ${target}: ${assetPath} ${existing || '(none)'} -> ${want}`);
            return `${open}${assetPath}${want}${close}`;
        });
        if (after !== before && write) writeFileSync(file, after);
    }
    return { changes, total };
}

let result = pass(!check);
if (!check) {
    // Converge: stamping the manifest changes its own hash, which index.html cites.
    for (let i = 0; i < 5 && result.changes.length; i++) {
        result.changes.forEach(c => console.log(c));
        result = pass(true);
    }
}
if (result.changes.length) {
    result.changes.forEach(c => console.log(c));
    if (check) {
        console.error(`\n${result.changes.length} asset reference(s) out of date. Run: node tools/cache-bust.mjs`);
        process.exit(1);
    }
    console.error('\nDid not converge after 5 passes.');
    process.exit(1);
}
console.log(`All ${result.total} asset reference(s) up to date.`);
