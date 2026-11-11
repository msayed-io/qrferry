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
