#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.argv[2] ?? '');
if (!process.argv[2]) throw new Error('usage: check-seeded-assets.mjs SEEDED_DIR');
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');
const manifest = JSON.parse(read('demo-apps/demos.json'));
if (!Array.isArray(manifest.demos) || manifest.demos.length !== 3) throw new Error('expected three demo entries');
for (const demo of manifest.demos) {
  const wasm = path.join(root, 'demo-apps', demo.wasm);
  if (!fs.statSync(wasm).isFile() || fs.statSync(wasm).size === 0) throw new Error(`bad wasm: ${demo.wasm}`);
}
const skills = fs.readdirSync(path.join(root, 'skills'), { withFileTypes: true }).filter((e) => e.isDirectory());
if (skills.length === 0) throw new Error('no seeded skills');
for (const skill of skills) {
  const file = path.join(root, 'skills', skill.name, 'SKILL.md');
  if (!fs.statSync(file).isFile() || fs.statSync(file).size === 0) throw new Error(`bad skill: ${skill.name}`);
}
for (const logo of ['logo.svg', 'logo-dark.svg']) {
  if (!fs.statSync(path.join(root, 'channel', logo)).isFile()) throw new Error(`missing ${logo}`);
}
console.log(`seed probe passed: demos=${manifest.demos.length} skills=${skills.length} logos=2`);
