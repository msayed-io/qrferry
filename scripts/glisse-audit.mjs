// Production app + genuine pointer/keyboard events. No mocked transport, camera or library.
import {chromium, webkit, expect} from '@playwright/test';
import fs from 'node:fs/promises';
const dir=process.env.EVIDENCE_DIR||'/home/user/glisse-evidence';
await fs.mkdir(dir,{recursive:true});
const result={package:'glisse@0.5.0',cases:[],errors:[],preferences:[],touch:null,performance:null,limitations:['Desktop Chromium and WebKit automation, not a physical phone or Safari installation.','Native SVG backdrop refraction is Chromium-only; WebKit retains frost/rim and the label lens.']};
const browsers=[];
const center=async locator=>{const b=await locator.boundingBox();return {x:b.x+b.width/2,y:b.y+b.height/2};};
try {
 for(const [engine,type] of [['chromium',chromium],['webkit',webkit]]) {
  const browser=await type.launch();browsers.push(browser);
  for(const width of [390,1280])for(const theme of ['light','dark'])for(const lang of ['ar','en']) {
   const context=await browser.newContext({viewport:{width,height:900},colorScheme:theme,locale:lang==='ar'?'ar-EG':'en-US'});
   await context.addInitScript(({lang,theme})=>{localStorage.setItem('qrferry-lang',lang==='ar'?'en':'ar');localStorage.setItem('qrferry-theme',theme==='dark'?'light':'dark');},{lang,theme});
   const page=await context.newPage();page.on('pageerror',e=>result.errors.push({engine,width,theme,lang,message:e.message}));
   await page.goto('http://localhost:3000');await expect(page.locator('html')).toHaveAttribute('lang',lang);
   const bar=page.locator('.qf-tab-bar');await expect(bar).toHaveAttribute('data-ready','');await page.waitForTimeout(650);
   const at=await bar.evaluate(el=>({
    physicalOrder:[...el.querySelectorAll('.lg-tab')].map(b=>b.id),
    selected:el.querySelector('[aria-selected=true]')?.id,
    growX:getComputedStyle(el).getPropertyValue('--lg-lens-grow-x').trim(),growY:getComputedStyle(el).getPropertyValue('--lg-lens-grow-y').trim(),
    slot:getComputedStyle(el).getPropertyValue('--lg-tab-width').trim(),height:getComputedStyle(el).getPropertyValue('--lg-tab-height').trim(),
    backdrop:getComputedStyle(el.querySelector('.lg-tab-bar-glass')).backdropFilter,
    oldMaterialLayers:el.querySelectorAll('.glass').length,
    accessibleTabs:el.querySelectorAll('[role=tab]').length,
   }));
   expect(at.physicalOrder[lang==='ar'?2:0]).toBe('nav-send');expect(at.selected).toBe('nav-send');
   expect(at.growX).toBe('24px');expect(at.growY).toBe('16px');expect(at.oldMaterialLayers).toBe(0);expect(at.accessibleTabs).toBe(3);
   const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);expect(overflow).toBe(false);
   const solid=await page.locator('.control-panel,.qr-panel,.qr-stage,.qr-canvas-grid').evaluateAll(els=>els.map(el=>({class:el.className,filter:getComputedStyle(el).filter,backdrop:getComputedStyle(el).backdropFilter,glisse:el.classList.contains('lg-glass')})));
   expect(solid.every(x=>x.filter==='none'&&x.backdrop==='none'&&!x.glisse)).toBe(true);
   await page.screenshot({path:`${dir}/${engine}-${width}-${theme}-${lang}-rest.png`,fullPage:true});
   const start=await center(page.locator('#nav-send'));await page.mouse.move(start.x,start.y);await page.mouse.down();
   await expect(bar).toHaveAttribute('data-lifted','');
   await expect.poll(()=>bar.locator('.lg-tab-lens').evaluate(el=>parseFloat(el.style.getPropertyValue('--lg-lift')))).toBeGreaterThan(.95);
   const held=await bar.evaluate(el=>{
    const lens=el.querySelector('.lg-tab-lens'),matrix=new DOMMatrix(getComputedStyle(lens).transform);
    return {scaleX:matrix.a,scaleY:matrix.d,lift:parseFloat(lens.style.getPropertyValue('--lg-lift')),labelFilter:getComputedStyle(el.querySelector('.lg-tab-lensed')).filter,lensing:el.hasAttribute('data-lensing'),selected:el.querySelector('[aria-selected=true]')?.id};
   });
   expect(held.scaleX).toBeGreaterThan(1.31);expect(held.scaleX).toBeLessThan(1.36);expect(held.scaleY).toBeGreaterThan(1.29);
   expect(held.labelFilter).toContain('url(');expect(held.selected).toBe('nav-send');
   await page.screenshot({path:`${dir}/${engine}-${width}-${theme}-${lang}-held.png`,fullPage:true});
   const target=await center(page.locator('#nav-scan'));await page.mouse.move(target.x,target.y,{steps:12});
   await expect(page.locator('#nav-send')).toHaveAttribute('aria-selected','true');await page.mouse.up();await page.waitForURL('**/scan');
   await expect(page.locator('#nav-scan')).toHaveAttribute('aria-selected','true');
   await page.locator('#nav-scan').focus();await page.keyboard.press('End');await page.waitForURL('**/bridge');await expect(page.locator('#nav-pair')).toHaveAttribute('aria-selected','true');
   await page.locator('#nav-pair').focus();await page.keyboard.press('Home');await page.waitForURL('http://localhost:3000/');
   await page.getByRole('radio',{name:lang==='ar'?'نص':'Text',exact:true}).click();await expect(page.locator('.text-entry textarea')).toBeVisible();
   const segment=page.locator('.qf-segmented');expect(await segment.getByRole('radio').count()).toBe(2);
   await segment.getByRole('radio',{name:lang==='ar'?'نص':'Text',exact:true}).focus();await page.keyboard.press('Home');
   await expect(segment.getByRole('radio',{name:lang==='ar'?'ملف':'File',exact:true})).toHaveAttribute('aria-checked','true');
   const drop=await page.locator('.drop-zone').evaluate(el=>({backdrop:getComputedStyle(el).backdropFilter,filter:getComputedStyle(el).filter}));expect(drop).toEqual({backdrop:'none',filter:'none'});
   // A cancelled press outside the bar must not navigate.
   const scan=await center(page.locator('#nav-scan'));await page.mouse.move(scan.x,scan.y);await page.mouse.down();await page.mouse.move(scan.x,scan.y-180);await page.mouse.up();await page.waitForTimeout(120);expect(new URL(page.url()).pathname).toBe('/');
   // No synthetic controls were added to the content; the library remains initialized after route transitions.
   const small=await page.locator('.lg-tab,.qf-liquid-button').evaluateAll(els=>els.filter(e=>e.getClientRects().length&&!e.closest('[hidden]')).map(e=>{const r=e.getBoundingClientRect();return {class:e.className,width:r.width,height:r.height};}).filter(r=>r.width<43.9||r.height<43.9));expect(small).toEqual([]);
   result.cases.push({engine,width,theme,lang,at,held,overflow,solid,dragSelectsOnRelease:true,homeEnd:true,realContentSelection:true,cancelPreservesSelection:true,smallTargets:small});
   console.log('PASS',engine,width,theme,lang);await context.close();
  }
 }
 const browser=browsers[0];
 const context=await browser.newContext({viewport:{width:390,height:900},hasTouch:true,isMobile:true,locale:'ar-EG'});const page=await context.newPage();await page.goto('http://localhost:3000');await page.locator('.qf-tab-bar[data-ready]').waitFor();await page.waitForTimeout(650);
 const cdp=await context.newCDPSession(page),from=await center(page.locator('#nav-send')),to=await center(page.locator('#nav-pair'));
 await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:from.x,y:from.y}]});await expect(page.locator('.qf-tab-bar')).toHaveAttribute('data-lifted','');
 await page.waitForTimeout(180);
 for(let i=1;i<=12;i++)await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:from.x+(to.x-from.x)*i/12,y:from.y}]});
 await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await page.waitForURL('**/bridge');result.touch={nativeCDPTouch:true,dragSelected:'pair',physicalDevice:false};
 await page.goto('http://localhost:3000');await page.locator('.qf-tab-bar[data-ready]').waitFor();await page.waitForTimeout(650);
 const measurement=page.evaluate(async()=>{const samples=[];let last=performance.now();for(let i=0;i<120;i++){const t=await new Promise(requestAnimationFrame);samples.push(t-last);last=t;}samples.sort((a,b)=>a-b);return {frames:samples.length,p50:samples[60],p95:samples[114],over50ms:samples.filter(v=>v>50).length};});
 const pos=await center(page.locator('#nav-send'));await page.mouse.move(pos.x,pos.y);await page.mouse.down();
 for(let i=0;i<24;i++){await page.mouse.move(pos.x-100*Math.sin(i/4)**2,pos.y,{steps:2});await page.waitForTimeout(25);}
 await page.mouse.move(pos.x,pos.y);await page.mouse.up();result.performance=await measurement;await page.waitForTimeout(700);
 const idle=await page.locator('.qf-tab-bar .lg-tab-lens').evaluate(async e=>{const before=e.style.transform;await new Promise(r=>setTimeout(r,500));return {stable:before===e.style.transform,lift:e.style.getPropertyValue('--lg-lift')};});expect(idle.stable).toBe(true);result.performance.idle=idle;
 await cdp.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-transparency',value:'reduce'}]});
 const transparency=await page.locator('.lg-glass:visible').evaluateAll(els=>els.map(e=>({class:e.className,backdrop:getComputedStyle(e).backdropFilter,background:getComputedStyle(e).backgroundColor,image:getComputedStyle(e).backgroundImage})));
 expect(transparency.every(x=>x.backdrop==='none'&&x.image==='none')).toBe(true);result.preferences.push({reducedTransparency:transparency});
 await cdp.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
 const button=page.locator('.app-menu>.lg-button'),b=await center(button);await page.mouse.move(b.x,b.y);await page.mouse.down();const reduced=await button.evaluate(e=>({scale:getComputedStyle(e).scale,translate:getComputedStyle(e).translate,animation:getComputedStyle(e).animationName}));await page.mouse.move(0,0);await page.mouse.up();expect(reduced.scale).toBe('1');expect(reduced.translate).toBe('none');result.preferences.push({reducedMotion:reduced});
 await context.close();expect(result.errors).toEqual([]);result.pass=true;
} catch(error){result.pass=false;result.failure=String(error.stack||error);console.error(result.failure);process.exitCode=1;}
finally{await fs.writeFile(`${dir}/glisse-audit.json`,JSON.stringify(result,null,2));for(const b of browsers)await b.close();}
