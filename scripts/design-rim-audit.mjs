import {chromium} from '@playwright/test';
import {PNG} from 'pngjs';
import fs from 'node:fs/promises';
const dir=process.env.EVIDENCE_DIR||'/home/user/qrferry-redesign-evidence';
const browser=await chromium.launch({args:['--no-sandbox']});
const measurements=[];
for(const target of ['app','reference']) for(const scale of [1,2,3]){
 const context=await browser.newContext({viewport:{width:1280,height:900},deviceScaleFactor:scale});
 const page=await context.newPage();await page.goto(target==='app'?'http://localhost:3000':'file:///home/user/uploads/qrferry-redesign.html');await page.locator('.tabs').waitFor();
 await page.addStyleTag({content:'html,body,.qr-panel,.control-panel,.card{background:#000!important}.bottom-nav,body>nav{display:none!important} *{animation:none!important;transition:none!important}.rim-probe{background:#000!important;backdrop-filter:none!important;-webkit-backdrop-filter:none!important;box-shadow:none!important;color:transparent!important;opacity:1!important;outline:none!important}.rim-probe>*{visibility:hidden!important}'});
 for(const [name,selector] of [['circle','.tools button:first-child'],['capsule',target==='app'?'.link-action':'#send .cap.wide']]){
  const probe=page.locator(selector).first();await probe.evaluate(el=>el.classList.add('rim-probe'));
  await page.waitForTimeout(100);
  const style=await probe.evaluate(el=>{const s=getComputedStyle(el),p=getComputedStyle(el,'::after'),r=el.getBoundingClientRect();return {width:r.width,height:r.height,radius:Math.min(parseFloat(s.borderTopLeftRadius),r.width/2,r.height/2),offset:s.getPropertyValue('--o'),rimWidth:p.paddingTop,mask:p.maskComposite,background:p.backgroundImage,opacity:p.opacity,filter:p.filter,shadow:p.boxShadow};});
  const white=PNG.sync.read(await probe.screenshot({path:`${dir}/rim-white-${target}-${name}-${scale}x.png`}));
  const redBackground=style.background.replaceAll('255, 255, 255','255, 0, 0');
  const redRule=await page.addStyleTag({content:`.rim-probe::after{background-image:${redBackground}!important}`});
  const red=PNG.sync.read(await probe.screenshot({path:`${dir}/rim-red-${target}-${name}-${scale}x.png`}));
  const r=style.radius,w=style.width,h=style.height;
  let interiorMax=0,exteriorMax=0,greenMax=0,blueMax=0,tl=0,br=0;
  for(let py=0;py<red.height;py++)for(let px=0;px<red.width;px++){
   const x=(px+.5)/scale,y=(py+.5)/scale,index=(py*red.width+px)*4;
   const qx=Math.abs(x-w/2)-(w/2-r),qy=Math.abs(y-h/2)-(h/2-r);
   const distance=Math.hypot(Math.max(qx,0),Math.max(qy,0))+Math.min(Math.max(qx,qy),0)-r;
   if(distance < -2)interiorMax=Math.max(interiorMax,red.data[index],red.data[index+1],red.data[index+2]);
   if(distance > 1)exteriorMax=Math.max(exteriorMax,red.data[index]);
   greenMax=Math.max(greenMax,red.data[index+1]);blueMax=Math.max(blueMax,red.data[index+2]);
   if(x<r&&y<r)tl=Math.max(tl,white.data[index]/255);
   if(x>w-r&&y>h-r)br=Math.max(br,white.data[index]/255);
  }
  measurements.push({target,name,scale,...style,rasterTopLeft:tl,rasterBottomRight:br,interiorMax,exteriorMax,greenMax,blueMax,redRingOnly:interiorMax===0&&exteriorMax===0&&greenMax===0&&blueMax===0});
  await redRule.evaluate(el=>el.remove());await probe.evaluate(el=>el.classList.remove('rim-probe'));
 }
 await context.close();
}
const page=await browser.newPage();await page.goto('http://localhost:3000');
const solid=await page.locator('.control-panel,.qr-panel,.drop-zone,.qr-stage').evaluateAll(els=>els.map(el=>({class:el.className,backdrop:getComputedStyle(el).backdropFilter,rim:getComputedStyle(el,'::after').content})));
await page.goto('http://localhost:3000/scan');solid.push(...await page.locator('.camera-card,.camera-view,.receive-card').evaluateAll(els=>els.map(el=>({class:el.className,backdrop:getComputedStyle(el).backdropFilter,rim:getComputedStyle(el,'::after').content}))));
await page.emulateMedia({reducedMotion:'reduce'});
const reducedMotion=await page.locator('.transfer-page:visible').evaluate(el=>({animation:getComputedStyle(el).animationName,transition:getComputedStyle(el).transitionProperty}));
const cdp=await page.context().newCDPSession(page);
await cdp.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-transparency',value:'reduce'}]});
const reducedTransparency=await page.locator('.glass').evaluateAll(els=>els.map(el=>({class:el.className,backdrop:getComputedStyle(el).backdropFilter,rim:getComputedStyle(el).getPropertyValue('--rim'),background:getComputedStyle(el).backgroundColor})));
const output={measurements,solid,reducedMotion,reducedTransparency};await fs.writeFile(`${dir}/rim-audit.json`,JSON.stringify(output,null,2));console.log(JSON.stringify(output,null,2));await browser.close();
