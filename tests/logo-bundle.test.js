'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { buildLogoBundle } = require('../private/logo/logo-bundle');
(async () => {
  const images = [{ name: '902000006.png', data: Uint8Array.of(137, 80, 78, 71) }, { name: 'bang_2/902000007.png', data: Uint8Array.of(1, 2, 3) }];
  const playname = { name: 'PlayerNameOverwrite.json', data: new TextEncoder().encode(JSON.stringify({ PlayerNameList: [{ PlayerID: 123, PlayerNameOverwrite: 'TEST' }], TeamRegionList: [] })) };
  const entries = buildLogoBundle(images, playname);
  assert.equal(entries.length, 7);
  assert.deepEqual(entries.map(entry => entry.name), ['BackPackPics/902000006.png', 'BackPackPics/bang_2/902000007.png', 'GloowallPics/902000006.png', 'GloowallPics/bang_2/902000007.png', 'HeadPics/902000006.png', 'HeadPics/bang_2/902000007.png', 'PlayerNameOverwrite.json']);
  assert.throws(() => buildLogoBundle(images, { ...playname, name: '../bad.json' }));
  const source = fs.readFileSync(require.resolve('../private/logo/script.js'), 'utf8');
  const context = vm.createContext({ Uint8Array, Uint32Array, DataView, TextEncoder, Blob });
  vm.runInContext(source.slice(source.indexOf('const crcTable'), source.indexOf('async function download()')), context);
  const bytes = new Uint8Array(await context.makeZip(entries).arrayBuffer());
  const view = new DataView(bytes.buffer);
  let offset = 0;
  const extracted = [];
  while (view.getUint32(offset, true) === 0x04034b50) {
    const length = view.getUint32(offset + 18, true);
    const nameLength = view.getUint16(offset + 26, true);
    const start = offset + 30 + nameLength;
    extracted.push({ name: new TextDecoder().decode(bytes.slice(offset + 30, start)), data: bytes.slice(start, start + length) });
    offset = start + length;
  }
  assert.deepEqual(extracted, entries);
  assert.equal(view.getUint16(bytes.length - 22 + 10, true), 7);
  console.log('PASS logo-bundle: three folders, exact PNG and playname contents, ZIP structure.');
})().catch(error => { console.error(error); process.exitCode = 1; });
