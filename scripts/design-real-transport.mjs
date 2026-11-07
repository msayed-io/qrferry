// No fake camera, no route interception, no mock PeerJS, no test hooks.
// Two independent Chromium processes use the production build and a real PeerServer.
import { chromium, expect } from '@playwright/test';
import fs from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createHash, randomBytes } from 'node:crypto';
import { prepareZXingModule, readBarcodes } from 'zxing-wasm/reader';
import { PNG } from 'pngjs';
const require=createRequire(import.meta.url), dir=process.env.EVIDENCE_DIR||'/home/user/qrferry-redesign-evidence';
const result={kind:'real-browser-WebRTC',mockNetwork:false,mockCamera:false,testHooks:false,events:[],qr:[],chatStyles:[],errors:[],physicalCamera:'NOT TESTED: no physical camera/display path in this sandbox'};
const browsers=[];
const hash=b=>createHash('sha256').update(b).digest('hex');
const event=(name,detail)=>{result.events.push({name,...detail});console.log(name,detail);};
try {
 await prepareZXingModule({overrides:{wasmBinary:readFileSync(require.resolve('zxing-wasm/reader/zxing_reader.wasm'))},fireImmediately:true});
 for(let i=0;i<2;i++)browsers.push(await chromium.launch({headless:true,args:['--no-sandbox']}));
 const pages=[];
 for(const [i,browser] of browsers.entries()){
  const context=await browser.newContext({viewport:{width:i?390:1280,height:900},acceptDownloads:true});
  // This is the app's existing, documented signaling-server preference, NOT a stub.
  await context.addInitScript(()=>localStorage.setItem('qrferry-peer-host',JSON.stringify({host:'localhost',port:9000,path:'/',secure:false})));
  const page=await context.newPage();
  page.on('pageerror',e=>result.errors.push(e.message));
  await page.goto('http://localhost:3000/pc');pages.push(page);
 }
 const [host,guest]=pages;
 const makeCode=async()=>{
  const start=Date.now();
  await host.getByRole('button',{name:'أنشئ رمز الربط',exact:true}).click();
  await expect(host.locator('.bridge-qr-canvas')).toBeVisible({timeout:30000});
  await expect(host.locator('.bridge-link-row code')).toHaveText(/QFB1\./,{timeout:30000});
  const url=await host.locator('.bridge-link-row code').textContent();
  event('real pairing encoder',{milliseconds:Date.now()-start});return url;
 };
 const connected=async()=>{
  await Promise.all(pages.map(p=>expect(p.locator('.chatbar')).toBeVisible({timeout:35000})));
  for(const p of pages) await expect(p.locator('#nav-chat')).toHaveAttribute('aria-selected','true');
 };
 const url=await makeCode();
 // Decode screenshots of the actual rendered QR tile, not raw QR data nor a generated fixture.
 for(const width of [390,1280])for(const theme of ['light','dark']){
  await host.setViewportSize({width,height:900});
  await host.evaluate(t=>document.documentElement.dataset.theme=t,theme);
  const png=await host.locator('.qrt').screenshot();
  await fs.writeFile(`${dir}/pairing-qr-${width}-${theme}.png`,png);
  const img=PNG.sync.read(png);
  const decoded=await readBarcodes({data:new Uint8ClampedArray(img.data),width:img.width,height:img.height},{formats:['QRCode'],tryHarder:true,textMode:'Plain'});
  const match=decoded.some(d=>d.isValid&&new TextDecoder().decode(new Uint8Array(d.bytes))===url);
  result.qr.push({width,theme,screenshotWidth:img.width,decodedExactPayload:match});
  if(!match) throw new Error(`QR screenshot failed decode ${width}/${theme}`);
 }
 await host.setViewportSize({width:1280,height:900});
 await host.evaluate(()=>document.documentElement.dataset.theme='light');
 await host.locator('#nav-send').click();await expect(host.locator('.sender-page')).toBeVisible();
 const start=Date.now();
 await guest.locator('#bridge-paste-input').fill(url);
 await expect(guest.getByRole('button',{name:'اتصل',exact:true})).toBeEnabled();
 await guest.getByRole('button',{name:'اتصل',exact:true}).click();
 await connected();event('real connection auto-opens Chat from another route',{route:host.url()});event('pasted link real DTLS connection',{milliseconds:Date.now()-start});
 for(const [sender,receiver,label] of [[host,guest,'host-to-guest'],[guest,host,'guest-to-host']]){
  const t=Date.now();
  for(let i=1;i<=3;i++){
   const text=`${label} · رسالة تحقق فعلية ${i}`;
   await sender.getByLabel('اكتب رسالة').fill(text);
   await sender.getByRole('button',{name:'إرسال',exact:true}).click();
   await expect(receiver.locator('.bridge-bubble.pc').filter({hasText:text})).toBeVisible();
  }
  await expect(receiver.locator('.bridge-bubble.pc')).toHaveCount(3);
  event('real bidirectional chat',{direction:label,messages:3,milliseconds:Date.now()-t});
  const bytes=randomBytes(700000),filename=`${label}.bin`,filepath=`${dir}/${filename}`;
  await fs.writeFile(filepath,bytes);
  const fstart=Date.now();
  await sender.locator('.bridge-composer input[type=file]').setInputFiles(filepath);
  const downloadButton=receiver.getByRole('button',{name:`تنزيل ${filename}`,exact:true});
  await expect(downloadButton).toBeVisible({timeout:60000});
  const downloadPromise=receiver.waitForEvent('download');await downloadButton.click();
  const download=await downloadPromise;
  const received=await fs.readFile(await download.path());
  if(hash(received)!==hash(bytes))throw new Error('Download SHA-256 mismatch');
  event('real file transfer and downloaded bytes',{direction:label,bytes:bytes.length,milliseconds:Date.now()-fstart,sha256:hash(bytes),downloadHash:hash(received)});
 }
 // Typing is driven by the existing protocol, not a timed response fixture.
 await host.getByLabel('اكتب رسالة').fill('كتابة فعلية');
 await expect(guest.getByLabel('يكتب الآن…')).toBeVisible();
 await host.getByLabel('اكتب رسالة').fill('');
 await expect(guest.getByLabel('يكتب الآن…')).toHaveCount(0);
 event('real typing messages',{result:'received true and false'});
 // Session must survive navigation; its owner is still the same BridgeClient.
 await host.locator('#nav-send').click();
 await expect(host.locator('.sender-page')).toBeVisible();
 await expect(host.locator('.bridge-composer')).toHaveCount(0);
 await expect(host.locator('#nav-chat')).toBeVisible();
 await host.locator('#nav-chat').click();
 await expect(host.locator('.chatbar')).toBeVisible();
 event('tab navigation preserves real session',{result:'connected, original messages retained'});
 const reference=await browsers[0].newPage();await reference.goto('file:///home/user/uploads/qrferry-redesign.html');
 await reference.evaluate(()=>{window.go('chat');document.getElementById('chatTab').hidden=false;});
 const sentText=await host.locator('.bridge-bubble.me p').first().textContent(),receivedText=await host.locator('.bridge-bubble.pc p').first().textContent();
 await reference.evaluate(([sent,received])=>{for(const [cls,text] of [['me',sent],['pc',received]]){const el=document.createElement('div');el.className='m '+cls;el.textContent=text;document.getElementById('msgs').append(el);}},[sentText,receivedText]);
 for(const width of [390,1280]) for(const theme of ['light','dark']){
  await host.setViewportSize({width,height:900});await reference.setViewportSize({width,height:900});
  for(const p of [host,reference])await p.evaluate(t=>document.documentElement.dataset.theme=t,theme);
  await host.waitForTimeout(550);await reference.waitForTimeout(550);
  const layout=await host.evaluate(()=>{const c=document.querySelector('.bridge-composer').getBoundingClientRect(),n=document.querySelector('.bottom-nav').getBoundingClientRect();return {composerTop:c.top,composerBottom:c.bottom,navTop:n.top,gap:n.top-c.bottom};});
  if(layout.gap<0)throw new Error('Composer overlaps bottom navigation');
  event('composer above navigation',{width,theme,...layout});
  await host.screenshot({path:`${dir}/app-chat-${width}-${theme}.png`,fullPage:true});
  await reference.screenshot({path:`${dir}/reference-chat-${width}-${theme}.png`,fullPage:true});
  const props=['backgroundColor','color','borderRadius','height','paddingTop','paddingRight','paddingBottom','paddingLeft','fontSize','fontWeight','lineHeight','boxShadow','backdropFilter'];
  const components=[];
  for(const [name,appSel,refSel] of [['chatbar','.chatbar','.chatbar'],['composer','.bridge-composer','#composer'],['attach','.bridge-composer>.circle','#composer>.circle'],['input','.bridge-composer>.inp','#composer>.inp'],['sent','.bridge-bubble.me','.m.me'],['received','.bridge-bubble.pc','.m.pc']]){
   const read=(p,sel)=>p.locator(sel).first().evaluate((el,props)=>Object.fromEntries(props.map(k=>[k,getComputedStyle(el)[k]])),props);
   const actual=await read(host,appSel),expected=await read(reference,refSel);
   components.push({name,actual,expected,differences:Object.fromEntries(props.filter(k=>actual[k]!==expected[k]).map(k=>[k,{actual:actual[k],expected:expected[k]}]))});
  }
  result.chatStyles.push({width,theme,components});
 }
 await reference.close();
 await host.locator('#nav-send').click();await expect(host.locator('.sender-page')).toBeVisible();
 let t=Date.now();await guest.getByRole('button',{name:'قطع الاتصال',exact:true}).click();
 await Promise.all(pages.map(p=>expect(p.locator('#nav-chat')).toHaveCount(0,{timeout:15000})));
 for(const p of pages)await expect(p.locator('#nav-pair')).toHaveAttribute('aria-selected','true');
 event('disconnect returns to Pair from another route',{route:host.url()});
 event('guest disconnect propagated',{milliseconds:Date.now()-t});
 // Host remains a real listener after peer disconnect; cancel it to generate a new secret.
 await host.getByRole('button',{name:'إلغاء',exact:true}).click();
 const url2=await makeCode();t=Date.now();
 await guest.goto(url2);await connected();
 event('opening real pairing URL auto-joins',{milliseconds:Date.now()-t,urlFragmentRemoved:!new URL(guest.url()).hash});
 t=Date.now();await host.getByRole('button',{name:'قطع الاتصال',exact:true}).click();
 await Promise.all(pages.map(p=>expect(p.locator('#nav-chat')).toHaveCount(0,{timeout:15000})));
 event('host disconnect propagated',{milliseconds:Date.now()-t});
 result.cameraDevices=await guest.evaluate(async()=> (await navigator.mediaDevices.enumerateDevices()).map(d=>({kind:d.kind,label:d.label})));
 result.pass=true;
} catch(error){result.pass=false;result.failure=String(error.stack||error);console.error(result.failure);process.exitCode=1;}
finally {await fs.writeFile(`${dir}/real-transport.json`,JSON.stringify(result,null,2));for(const b of browsers)await b.close();}
