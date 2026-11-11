import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {localSessionVisible,transferRatio} from '../lib/native-local';
test('native session gate requires authentication and actual transfer start',()=>{
 for(const authenticated of [false,true])for(const started of [false,true])assert.equal(localSessionVisible({authenticated,started}),authenticated&&started);
});
test('progress is bounded and zero-byte completion is explicit',()=>{
 assert.equal(transferRatio({bytes:5,size:0,status:'offering'}),0);assert.equal(transferRatio({bytes:0,size:0,status:'complete'}),1);assert.equal(transferRatio({bytes:50,size:100,status:'receiving'}),.5);assert.equal(transferRatio({bytes:200,size:100,status:'receiving'}),1);
});
test('new JS bridge exposes metadata and commands, never file byte I/O',()=>{
 const src=fs.readFileSync('lib/native-local.ts','utf8');assert.doesNotMatch(src,/readChunk|writeChunk|ArrayBuffer|Uint8Array|base64|Blob|FileReader/);
 const ui=fs.readFileSync('app/local/local-client.tsx','utf8');assert.doesNotMatch(ui,/setTimeout|createObjectURL|readAs|atob\(|btoa\(|Math\.random|<input[^>]*type="file"/);
 assert.match(ui,/ProgressiveBlur/);assert.match(ui,/LiquidChoices/);assert.match(ui,/bridge-composer/);
});
test('every local route renders the local subsystem, never the 404 page',()=>{
 const main=fs.readFileSync('src/main.tsx','utf8');
 assert.match(main,/path\.startsWith\("\/local\/"\)/);
 const routes=fs.readFileSync('app/route-pages.ts','utf8');
 for(const route of ['/local','/local/send','/local/setup','/local/receive','/local/scan','/local/session'])assert.match(routes,new RegExp(`'${route}': *LocalPage`),`${route} must be preloadable`);
 assert.match(routes,/path\.startsWith\('\/local\/'\) *\? *LocalPage/);
});
test('top capsules stay above the app blur and accent surfaces never rely on color-mix alone',()=>{
 const css=fs.readFileSync('app/local/local.css','utf8');
 const z=(selector:string)=>{const rule=new RegExp(`${selector}\\{[^}]*z-index:([0-9]+)`).exec(css);assert.ok(rule,`${selector} must declare a z-index`);return Number(rule![1]);};
 assert.ok(z('\\.lf-top')>18,`top bar must outrank the progressive blur (18), got ${z('\\.lf-top')}`);
 assert.ok(z('\\.lf-bar')>18);assert.ok(z('\\.lf-sheet')>18);
 assert.match(css,/\.local-page \.tinted[^{]*\{[^}]*background:var\(--tint\)/);
 const design=fs.readFileSync('public/design.css','utf8');
 assert.match(design,/\.tinted\{background:var\(--tint\);color:var\(--on-accent\)\}/);
});
test('send and prepare open the official storage and nearby prompts by themselves',()=>{
 const ui=fs.readFileSync('app/local/local-client.tsx','utf8');
 assert.match(ui,/current !== 'send'[\s\S]{0,240}requestStorage/);
 assert.match(ui,/current !== 'setup'[\s\S]{0,240}requestNearby/);
 assert.match(ui,/current !== 'receive'[\s\S]{0,240}startReceive/);
 assert.doesNotMatch(ui,/requestPermissions\(/);
});
