import { chromium } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
const dir = process.env.EVIDENCE_DIR || '/home/user/qrferry-redesign-evidence';
await fs.mkdir(dir, {recursive:true});
const browser = await chromium.launch({headless:true,args:['--no-sandbox']});
const results = [], errors = [];
const components = {
 send: [['header','.app-header','header'],['title','.workspace-intro h1','#send h1'],['card','.control-panel','#send .card'],['segment','.send-tabs','#send .seg'],['drop','.drop-zone','#send .drop'],['quick','.fast-action','#send .cta .cap'],['stage','.qr-stage','#send .stage'],['tabbar','.tabs','.tabs']],
 scan: [['title','.workspace-intro h1','#scan h1'],['card','.camera-card','#scan .card'],['camera','.camera-view','#scan .cam'],['start','.camera-actions button','#scan .cap.lg'],['tabbar','.tabs','.tabs']],
 pair: [['title','.workspace-intro h1','#pair h1'],['card','.bridge-grid .card','#pair .card'],['primary','.bridge-grid .tinted','#pair .tinted'],['field','#bridge-paste-input','#lnk'],['tabbar','.tabs','.tabs']],
};
const props=['backgroundColor','color','borderRadius','height','paddingTop','paddingRight','paddingBottom','paddingLeft','fontFamily','fontSize','fontWeight','lineHeight','boxShadow','backdropFilter'];
for(const width of [390,1280]) for(const theme of ['light','dark']) {
 const context=await browser.newContext({viewport:{width,height:900},deviceScaleFactor:1,colorScheme:theme});
 const app=await context.newPage(); const ref=await context.newPage();
 app.on('pageerror',e=>errors.push({width,theme,message:e.message}));
 await ref.goto('file:///home/user/uploads/qrferry-redesign.html');
 await ref.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
 for(const view of ['send','scan','pair']) {
  await app.goto('http://localhost:3000'+({send:'/',scan:'/scan',pair:'/bridge'}[view]));
  await app.locator('.tabs').waitFor();
  await app.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
  await ref.locator(`.tab[data-v="${view}"]`).click();
  await app.waitForTimeout(550); await ref.waitForTimeout(450);
  const measurements=[];
  for(const [name,a,r] of components[view]){
   const read=async(page,sel)=>page.locator(sel).first().evaluate((el,props)=>{const s=getComputedStyle(el),rect=el.getBoundingClientRect();return Object.fromEntries([...props.map(p=>[p,s[p]]),['width',rect.width],['x',rect.x],['y',rect.y]]);},props);
   const actual=await read(app,a), expected=await read(ref,r);
   measurements.push({name,actual,expected,differences:Object.fromEntries([...props,'width','x','y'].filter(p=>actual[p]!==expected[p]).map(p=>[p,{actual:actual[p],expected:expected[p]}]))});
  }
  const overflow=await app.evaluate(()=>document.documentElement.scrollWidth>innerWidth);
  await app.screenshot({path:path.join(dir,`app-${view}-${width}-${theme}.png`),fullPage:true});
  await ref.screenshot({path:path.join(dir,`reference-${view}-${width}-${theme}.png`),fullPage:true});
  results.push({view,width,theme,overflow,measurements});
 }
 await context.close();
}
await fs.writeFile(path.join(dir,'visual-comparison.json'),JSON.stringify({results,errors},null,2));
console.log(JSON.stringify({cases:results.length,errors,overflow:results.filter(r=>r.overflow).map(r=>[r.view,r.width,r.theme]),differences:results.map(r=>({view:r.view,width:r.width,theme:r.theme,components:r.measurements.filter(m=>Object.keys(m.differences).length).map(m=>({name:m.name,differences:m.differences}))}))},null,2));
await browser.close();
