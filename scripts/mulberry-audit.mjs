import { chromium, webkit, expect } from '@playwright/test';
import fs from 'node:fs/promises';
const dir=process.env.EVIDENCE_DIR||'/home/user/mulberry-evidence';await fs.mkdir(dir,{recursive:true});
const result={cases:[],errors:[],contrast:[],livePreferences:null,limitations:['Browser device preferences are configured by Playwright, not tested on a physical phone.','Only Arabic and English translations exist; first supported preference wins, with English fallback.']};
const browsers=[];
const lum=c=>c.map(x=>(x/=255)<=.04045?x/12.92:((x+.055)/1.055)**2.4).reduce((s,x,i)=>s+x*[.2126,.7152,.0722][i],0);
const contrast=(a,b)=>(Math.max(lum(a),lum(b))+.05)/(Math.min(lum(a),lum(b))+.05);
try{
 for(const [engine,type] of [['chromium',chromium],['webkit',webkit]]){
  const browser=await type.launch();browsers.push(browser);
  for(const width of [390,1280])for(const theme of ['light','dark'])for(const lang of ['ar','en']){
   const ar=lang==='ar';const context=await browser.newContext({viewport:{width,height:900},locale:ar?'ar-EG':'en-US',colorScheme:theme});
   await context.addInitScript(({lang,theme})=>{localStorage.setItem('qrferry-lang',lang==='ar'?'en':'ar');localStorage.setItem('qrferry-theme',theme==='dark'?'light':'dark');},{lang,theme});
   const page=await context.newPage();page.on('pageerror',e=>result.errors.push({engine,width,theme,lang,message:e.message}));
   const response=await page.goto('http://localhost:3000');expect(response.status()).toBe(200); // CSR: locale is asserted on the hydrated document below.
   await expect(page.locator('html')).toHaveAttribute('lang',lang);await expect(page.locator('html')).toHaveAttribute('dir',ar?'rtl':'ltr');await page.locator('.qf-tab-bar[data-ready]').waitFor();
   await expect(page.locator('[data-theme]')).toHaveCount(0);await expect(page.locator('.secondary-links,.site-footer,.tools')).toHaveCount(0);
   const tint=await page.evaluate(()=>getComputedStyle(document.documentElement).getPropertyValue('--tint').trim().toUpperCase());expect(tint).toBe(theme==='light'?'#9A315E':'#E792B9');
   const button=page.getByRole('button',{name:ar?'قائمة التطبيق':'App menu',exact:true});await expect(page.locator('.app-header button')).toHaveCount(1);
   await button.click();const menu=page.getByRole('menu');await expect(menu).toBeVisible();await expect(page.getByRole('menuitem').first()).toBeFocused();await page.keyboard.press('ArrowDown');await expect(page.getByRole('menuitem').nth(1)).toBeFocused();await page.keyboard.press('Escape');await expect(menu).toHaveCount(0);await expect(button).toBeFocused();
   await button.click();await page.waitForTimeout(450);const bounds=await menu.boundingBox();expect(bounds.x).toBeGreaterThanOrEqual(0);expect(bounds.x+bounds.width).toBeLessThanOrEqual(width);
   await expect.poll(()=>page.getByRole('menuitem').evaluateAll(es=>es.every(e=>e.getBoundingClientRect().height>=43.9))).toBe(true);
   const itemHeights=await page.getByRole('menuitem').evaluateAll(els=>els.map(e=>e.getBoundingClientRect().height));expect(itemHeights.every(h=>h>=43.9)).toBe(true);
   await page.screenshot({path:`${dir}/${engine}-${width}-${theme}-${lang}-menu.png`,fullPage:true});
   await page.mouse.click(width/2,230);await expect(menu).toHaveCount(0);
   await page.locator('#nav-scan').click();await page.waitForURL('**/scan');
   const pages=[];
   for(const [route,label] of [['history',ar?'السجل':'History'],['privacy',ar?'الخصوصية':'Privacy']]){
    await page.getByRole('button',{name:ar?'قائمة التطبيق':'App menu',exact:true}).click();await page.getByRole('menuitem',{name:label,exact:true}).click();await page.waitForURL(`**/${route}`);
    await expect(page.locator('.app-header,.bottom-nav,.site-footer,.support-nav,.app-menu')).toHaveCount(0);
    await expect(page.locator('.support-toolbar>.lg-glass')).toHaveCount(2);await expect(page.locator('.support-toolbar h1')).toHaveText(label);
    const exit=page.getByRole('button',{name:ar?'الرجوع إلى التطبيق':'Back to app',exact:true});expect(await exit.textContent()).toBe('');
    const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);expect(overflow).toBe(false);
    const bottomPadding=await page.evaluate(()=>parseFloat(getComputedStyle(document.body).paddingBottom));expect(bottomPadding).toBeLessThan(50);
    await page.waitForTimeout(450);await page.screenshot({path:`${dir}/${engine}-${width}-${theme}-${lang}-${route}.png`,fullPage:true});
    pages.push({route,capsules:2,iconOnlyExit:true,noSharedChrome:true,overflow,bottomPadding});
    await exit.click();await page.waitForURL('**/scan');await expect(page.locator('#nav-scan')).toHaveAttribute('aria-selected','true');
   }
   // A direct secondary-page request must also be standalone, and exit safely without an origin page.
   await page.goto('http://localhost:3000/privacy');await expect(page.locator('.app-header,.bottom-nav')).toHaveCount(0);await page.getByRole('button',{name:ar?'الرجوع إلى التطبيق':'Back to app',exact:true}).click();await page.waitForURL('http://localhost:3000/');
   // Native browser media preference update, no HTML theme attribute and no manual toggle.
   await page.emulateMedia({colorScheme:theme==='light'?'dark':'light'});await expect.poll(()=>page.evaluate(()=>getComputedStyle(document.documentElement).getPropertyValue('--tint').trim().toUpperCase())).toBe(theme==='light'?'#E792B9':'#9A315E');
   await page.emulateMedia({colorScheme:theme});
   if(engine==='chromium'&&width===390&&lang==='ar'){
    await page.locator('.file-button').first().waitFor({state:'visible'});
    const colors=await page.evaluate(()=>{
     const root=getComputedStyle(document.documentElement),canvas=document.createElement('canvas');canvas.width=canvas.height=1;const ctx=canvas.getContext('2d');
     const rgb=v=>{ctx.clearRect(0,0,1,1);ctx.fillStyle=v;ctx.fillRect(0,0,1,1);return [...ctx.getImageData(0,0,1,1).data].slice(0,3);};
     const button=document.querySelector('.file-button');const s=getComputedStyle(button);
     return {accent:rgb(root.getPropertyValue('--tint')),on:rgb(root.getPropertyValue('--on-accent')),card:rgb(root.getPropertyValue('--card')),secondary:rgb(root.getPropertyValue('--label2')),error:rgb(root.getPropertyValue('--danger-ink')),buttonFg:rgb(s.color),buttonBg:rgb(s.backgroundColor)};
    });
    for(const [name,a,b] of [['on-accent / accent',colors.on,colors.accent],['secondary / card',colors.secondary,colors.card],['error / card',colors.error,colors.card],['actual filled control',colors.buttonFg,colors.buttonBg]]){const ratio=contrast(a,b);expect(ratio).toBeGreaterThanOrEqual(4.5);result.contrast.push({theme,name,ratio});}
   }
   result.cases.push({engine,width,theme,lang,hydratedLanguage:true,storedOverridesIgnored:true,tint,menuKeyboard:true,outsideDismiss:true,menuInViewport:true,itemHeights,pages,directLinkExit:true,liveColorScheme:true});console.log('PASS',engine,width,theme,lang);await context.close();
  }
 }
 // This is explicitly a preference-event test, not a physical device language-settings test.
 const c=await browsers[0].newContext({locale:'en-US'}),p=await c.newPage();await p.goto('http://localhost:3000');await expect(p.locator('html')).toHaveAttribute('lang','en');
 await p.evaluate(()=>{Object.defineProperty(navigator,'languages',{configurable:true,value:['fr-FR','ar-EG']});window.dispatchEvent(new Event('languagechange'));});await expect(p.locator('html')).toHaveAttribute('lang','ar');await expect(p.getByRole('button',{name:'قائمة التطبيق',exact:true})).toBeVisible();
 await p.evaluate(()=>{Object.defineProperty(navigator,'languages',{configurable:true,value:['de-DE']});window.dispatchEvent(new Event('languagechange'));});await expect(p.locator('html')).toHaveAttribute('lang','en');result.livePreferences={emulatedLanguageChange:true,firstSupported:'ar',unsupportedFallback:'en'};await c.close();
 expect(result.errors).toEqual([]);result.pass=true;
}catch(e){result.pass=false;result.failure=String(e.stack||e);console.error(result.failure);process.exitCode=1;}
finally{await fs.writeFile(`${dir}/mulberry-audit.json`,JSON.stringify(result,null,2));for(const b of browsers)await b.close();}
