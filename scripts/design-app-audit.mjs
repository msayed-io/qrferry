import { chromium, expect } from '@playwright/test';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { PNG } from 'pngjs';
import { readBarcodes, prepareZXingModule } from 'zxing-wasm/reader';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
const require=createRequire(import.meta.url),dir=process.env.EVIDENCE_DIR||'/home/user/qrferry-redesign-evidence';
const out={checks:[],errors:[],mockedAPIs:false,limitations:[]};
const browser=await chromium.launch({args:['--no-sandbox']});
const context=await browser.newContext({viewport:{width:390,height:900},acceptDownloads:true,permissions:['clipboard-read','clipboard-write'],locale:'ar-EG'});
const page=await context.newPage();page.on('pageerror',e=>out.errors.push(e.message));
const check=(name,data)=>{out.checks.push({name,...data});console.log(name,data);};
try{
 await page.goto('http://localhost:3000');
 check('real initial navigation timing',await page.evaluate(()=>{const n=performance.getEntriesByType('navigation')[0];return {domContentLoadedMs:n.domContentLoadedEventEnd,loadMs:n.loadEventEnd,transferBytes:n.transferSize,scriptTransferBytes:performance.getEntriesByType('resource').filter(r=>r.initiatorType==='script').reduce((sum,r)=>sum+r.transferSize,0)};}));
 await page.emulateMedia({colorScheme:'dark'});await expect(page.locator('html')).not.toHaveAttribute('data-theme',/.+/);
 check('automatic device appearance',{colorScheme:'dark',tint:await page.evaluate(()=>getComputedStyle(document.documentElement).getPropertyValue('--tint').trim())});
 await expect(page.locator('html')).toHaveAttribute('lang','ar');await expect(page.locator('html')).toHaveAttribute('dir','rtl');
 check('automatic browser language',{locale:'ar-EG',lang:'ar',dir:'rtl'});
 // Actual files, selected through the real native browser file input.
 const folder=`${dir}/input-folder`;await fs.mkdir(folder,{recursive:true});
 const files=[];for(let i=1;i<=4;i++){const f=`${folder}/file-${i}.txt`;await fs.writeFile(f,`QRFerry real browser selection ${i}\n`);files.push(f);}
 await page.locator('input[type=file][multiple]').first().setInputFiles(files);
 await expect(page.locator('.error-message')).toBeVisible();check('four actual files rejected',{message:await page.locator('.error-message').textContent()});
 const chosenFolder=`${dir}/chosen-folder`;await fs.mkdir(chosenFolder,{recursive:true});await fs.copyFile(files[0],`${chosenFolder}/file-1.txt`);await fs.copyFile(files[1],`${chosenFolder}/file-2.txt`);
 await page.locator('input[webkitdirectory]').setInputFiles(chosenFolder);await expect(page.locator('.batch-file')).toHaveCount(2);check('real directory selection',{rows:2});await expect(page.locator('.batch-file button').first()).toBeEnabled({timeout:30000});
 await page.locator('input[type=file][multiple]').first().setInputFiles(files.slice(0,3));
 await expect(page.locator('.batch-file')).toHaveCount(3);check('three actual files selected',{rows:3});
 await page.getByRole('button',{name:'إزالة file-1.txt',exact:true}).click();await expect(page.locator('.batch-file')).toHaveCount(2);check('remove file',{rows:2});
 for(const name of ['file-2.txt','file-3.txt']){await expect(page.getByRole('button',{name:`إزالة ${name}`,exact:true})).toBeEnabled();await page.getByRole('button',{name:`إزالة ${name}`,exact:true}).click();}
 await page.getByRole('radio',{name:'نص',exact:true}).click();
 const text=page.locator('.text-entry textarea');await text.fill('QRFerry actual optical render / عرض حقيقي');await page.locator('.text-entry button').click();
 await expect(page.locator('.qr-stage canvas')).toBeVisible({timeout:30000});
 await prepareZXingModule({overrides:{wasmBinary:readFileSync(require.resolve('zxing-wasm/reader/zxing_reader.wasm'))},fireImmediately:true});
 await page.locator('.qr-stage canvas').evaluate(el=>el.scrollIntoView({block:'center'}));
 for(const theme of ['light','dark']) {
 await page.emulateMedia({colorScheme:theme});
 const canvasPng=await page.locator('.qr-stage canvas').screenshot();await fs.writeFile(`${dir}/actual-optical-frame-${theme}.png`,canvasPng);
 const image=PNG.sync.read(canvasPng);const codes=await readBarcodes({data:new Uint8ClampedArray(image.data),width:image.width,height:image.height},{formats:['QRCode'],tryHarder:true});
 const code=codes.find(c=>c.isValid);if(!code)throw new Error('Real optical canvas did not decode');
 const bytes=Buffer.from(code.bytes);if(bytes.subarray(0,3).toString()!=='QF4')throw new Error('Unexpected optical frame format');
 check('actual text converted to readable optical QF4 frame',{theme,bytes:bytes.length,header:bytes.subarray(0,3).toString(),sha256:createHash('sha256').update(bytes).digest('hex'),physicalCamera:false});
 }
 await page.locator('.qr-panel>.primary-action').click();await expect(page.locator('.qr-stage')).toHaveClass(/playing/);await page.waitForTimeout(400);await page.locator('.qr-panel>.primary-action').click();await expect(page.locator('.qr-stage')).not.toHaveClass(/playing/);check('QR stream starts and pauses',{result:'real playing state and canvas'});
 await page.getByRole('button',{name:/نسخ رابط الماسح/}).click();const copied=await page.evaluate(()=>navigator.clipboard.readText());check('real clipboard scanner URL',{copied});
 await page.locator('.fullscreen-button').click();await expect.poll(()=>page.evaluate(()=>!!document.fullscreenElement),{timeout:5000}).toBe(true);const fullscreen=true;await page.evaluate(()=>document.exitFullscreen());await expect.poll(()=>page.evaluate(()=>!!document.fullscreenElement)).toBe(false);check('fullscreen API',{entered:fullscreen,exited:true});
 await page.locator('.fast-action').click();await expect(page.getByRole('dialog')).toBeVisible();await page.keyboard.press('Tab');await expect(page.getByRole('button',{name:'إغلاق النافذة',exact:true})).toBeFocused();await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).toHaveCount(0);await expect(page.locator('.fast-action')).toBeFocused();check('real fast-transfer dialog keyboard and focus restoration',{result:'opened, Tab focused close, Escape closed, trigger restored'});
 await page.getByRole('button',{name:'الخصوصية وخيارات إضافية',exact:true}).click();
 const switches=page.getByRole('switch');check('real existing options',{count:await switches.count(),labels:await switches.allTextContents()});
 await switches.first().click();await expect(page.locator('#send-password')).toBeVisible();await page.locator('#send-password').fill('test-only-password');await expect(switches.first()).toHaveAttribute('aria-checked','true');
 await page.locator('.encrypt-field .mini-btn').click();await expect(page.getByRole('dialog').locator('canvas')).toBeVisible();const passwordImage=PNG.sync.read(await page.getByRole('dialog').locator('canvas').screenshot());const passwordCodes=await readBarcodes({data:new Uint8ClampedArray(passwordImage.data),width:passwordImage.width,height:passwordImage.height},{formats:['QRCode'],tryHarder:true});if(!passwordCodes.some(c=>c.isValid&&Buffer.from(c.bytes).toString()==='QFPW:test-only-password'))throw new Error('Password QR did not decode');await page.keyboard.press('Escape');check('existing password QR modal actual encode/decode',{prefix:'QFPW',exactTestPayload:true});
 await switches.first().click();await expect(switches.first()).toHaveAttribute('aria-checked','false');check('encryption setting UI preserved',{result:'real existing handler, no claim of end-to-end encrypted camera transfer'});
 await page.getByRole('button',{name:/إعدادات بثّ QR/}).click();const presets=await page.locator('.preset-list [role=radio] strong').allTextContents();check('real presets',{presets});
 await page.locator('.preset-add').click();await page.locator('.preset-form input[name=label]').fill('Audit profile');await page.locator('.preset-form button[type=submit]').click();await expect(page.locator('.preset-list [role=radio]').filter({hasText:'Audit profile'})).toBeVisible();await page.reload();await page.getByRole('button',{name:/إعدادات بثّ QR/}).click();const customPreset=page.locator('.preset-list [role=radio]').filter({hasText:'Audit profile'});await expect(customPreset).toBeVisible();await customPreset.getByRole('button',{name:'حذف البروفايل'}).click();await expect(customPreset).toHaveCount(0);check('existing custom preset actual save/reload/delete',{persisted:true,deleted:true});
 // A permission/device failure is observed, never re-labelled as a camera success.
 await page.goto('http://localhost:3000/scan');await page.getByRole('button',{name:'تشغيل الكاميرا',exact:true}).click();await expect(page.locator('.error-message')).toBeVisible({timeout:15000});check('real camera unavailable handling',{message:await page.locator('.error-message').textContent(),activeLines:await page.locator('.camera-view .ln').count()});
 await page.goto('http://localhost:3000/bridge');await page.locator('#bridge-paste-input').fill('not a QRFerry link');await expect(page.getByRole('button',{name:'اتصل',exact:true})).toBeDisabled();check('invalid pairing rejected before attempt',{ariaInvalid:await page.locator('#bridge-paste-input').getAttribute('aria-invalid')});
 await page.locator('#bridge-paste-input').fill('');await page.getByRole('button',{name:'افتح الكاميرا للمسح',exact:true}).click();await expect(page.locator('.bridge-error').first()).toContainText('الكاميرا',{timeout:15000});check('pair camera unavailable handling',{message:await page.locator('.bridge-error').first().textContent()});
 for(const route of ['/history','/privacy']){
  const response=await page.goto(`http://localhost:3000${route}`);await expect(page.locator('.support-page')).toBeVisible();
  for(const theme of ['light','dark']){await page.emulateMedia({colorScheme:theme});await page.screenshot({path:`${dir}/secondary-${route.slice(1)}-${theme}.png`,fullPage:true});}
  check('secondary route rendered',{route,status:response.status(),overflow:await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)});
 }
 const tv=await page.goto('http://localhost:3000/tv');await expect(page.getByRole('heading',{name:'استقبال على الشاشة'})).toBeVisible();check('restored QFTV receiver route',{status:tv.status()});
 // Real browser multipart submission intercepted locally by the installed SW.
 await page.goto('http://localhost:3000');await page.evaluate(async()=>{await navigator.serviceWorker.ready;if(!navigator.serviceWorker.controller)await new Promise(resolve=>navigator.serviceWorker.addEventListener('controllerchange',resolve,{once:true}));});
 await page.evaluate(()=>{const f=document.createElement('form');f.method='POST';f.enctype='multipart/form-data';f.action='/share';f.id='real-share-check';const i=document.createElement('input');i.type='file';i.name='files';f.append(i);document.body.append(f);});
 await page.locator('#real-share-check input').setInputFiles(files[0]);await page.locator('#real-share-check').evaluate(f=>f.submit());
 await page.waitForURL(/shared=1/);await expect(page.locator('.batch-file')).toContainText('file-1.txt',{timeout:30000});check('real multipart share and IndexedDB pickup',{selected:'file-1.txt',route:page.url()});
 // Performance of real scrolling with active browser compositing, not device simulation.
 await page.goto('http://localhost:3000/privacy');
 const performance=await page.evaluate(async()=>{const deltas=[];let last;for(let i=0;i<120;i++){const now=await new Promise(r=>requestAnimationFrame(r));if(last)deltas.push(now-last);last=now;window.scrollTo(0,Math.sin(i/20)**2*(document.documentElement.scrollHeight-innerHeight));}deltas.sort((a,b)=>a-b);return {frames:deltas.length,p50:deltas[Math.floor(deltas.length*.5)],p95:deltas[Math.floor(deltas.length*.95)],over50ms:deltas.filter(x=>x>50).length};});check('headless browser scroll timing',performance);
 out.pass=true;
}catch(e){out.pass=false;out.failure=String(e.stack||e);console.error(out.failure);process.exitCode=1;}
finally{await fs.writeFile(`${dir}/app-audit.json`,JSON.stringify(out,null,2));await browser.close();}
