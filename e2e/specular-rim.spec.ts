import {test,expect,type Page} from '@playwright/test';
import {mkdir} from 'node:fs/promises';
import {sampleRim} from '../lib/specular-rim';
const evidence=process.env.RIM_EVIDENCE_DIR;
async function fixture(page:Page,w=350,h=60) {
 await page.goto('/');await expect(page.locator('.transfer-page')).toBeVisible();
 await page.evaluate(({w,h})=>{
  const el=document.createElement('button');el.id='rim-fixture';el.className='glass cap';
  Object.assign(el.style,{position:'fixed',left:'20px',top:'140px',width:w+'px',height:h+'px',padding:'0',border:'0',borderRadius:h/2+'px',zIndex:'100',background:'#000',boxShadow:'none',backdropFilter:'none',transition:'none'});
  const stage=document.createElement('div');stage.id='rim-stage';Object.assign(stage.style,{position:'fixed',inset:'0',zIndex:'99',background:'#000'});document.body.append(stage);stage.append(el);
 },{w,h});
 await expect(page.locator('#rim-fixture > .qf-specular-rim')).toHaveCount(1);
 await expect.poll(()=>page.locator('#rim-fixture canvas').evaluate((c:HTMLCanvasElement)=>c.width)).toBeGreaterThan(1);
}
for(const dpr of [1,2,3])test(`rim raster: sizes, backgrounds, red isolation and RTL at DPR${dpr}`,async({browser,baseURL})=>{
 const context=await browser.newContext({baseURL,viewport:{width:430,height:740},deviceScaleFactor:dpr,locale:'ar-EG',serviceWorkers:'block'});
 const page=await context.newPage();
 for(const [w,h] of [[350,60],[44,44],[36,36]]) {
  await fixture(page,w,h);
  const canvas=page.locator('#rim-fixture canvas');
  const original=await canvas.evaluate((c:HTMLCanvasElement)=>c.toDataURL());
  // Physical samples at the flat edges; no gradient wash in the interior.
  const samples=await canvas.evaluate((c:HTMLCanvasElement)=>{
   const ctx=c.getContext('2d')!,d=ctx.getImageData(0,0,c.width,c.height).data;
   const at=(x:number,y:number)=>d[(Math.floor(y)*c.width+Math.floor(x))*4+3];
   let interior=0;
   for(let y=Math.floor(c.height*.3);y<c.height*.7;y++)for(let x=Math.floor(c.width*.3);x<c.width*.7;x++)interior+=at(x,y);
   return {top:at(c.width/2,0)/255,bottom:at(c.width/2,c.height-1)/255,interior};
  });
  expect(samples.interior).toBe(0);
  // A circle has no straight edge: the centre of its nearest device pixel
  // has a slightly tilted normal. Compare that exact position, not n=(0,-1).
  const x=(Math.floor(w*dpr/2)+.5)/dpr;
  const top=sampleRim(x,.5/dpr,w,h,h/2,undefined,dpr),bottom=sampleRim(x,h-.5/dpr,w,h,h/2,undefined,dpr);
  expect(samples.top).toBeCloseTo(top.coverage*top.intensity,2);
  expect(samples.bottom).toBeCloseTo(bottom.coverage*bottom.intensity,2);
  if(w>h){expect(samples.top).toBeCloseTo(.1275,2);expect(samples.bottom).toBeCloseTo(.095,2);}
  for(const background of ['black','white','moving']) {
   await page.evaluate(bg=>{
    document.querySelector<HTMLElement>('#rim-stage')!.style.background=bg==='moving'?'repeating-linear-gradient(45deg,#111 0 12px,#ddd 12px 24px)':bg;
    if(bg==='moving')document.querySelector<HTMLElement>('#rim-stage')!.animate([{backgroundPosition:'0px 0px'},{backgroundPosition:'120px 0px'}],{duration:600,iterations:2});
   },background);
   expect(await canvas.evaluate((c:HTMLCanvasElement)=>c.toDataURL())).toBe(original);
   if(evidence){await mkdir(evidence,{recursive:true});await page.locator('#rim-fixture').screenshot({path:`${evidence}/${w}x${h}-${dpr}x-${background}.png`});}
  }
  await page.evaluate(()=>{document.documentElement.dir='ltr';});
  expect(await canvas.evaluate((c:HTMLCanvasElement)=>c.toDataURL())).toBe(original);
  // Recolour the actual ring bitmap, then inspect the screenshot over black.
  await page.evaluate(()=>{document.querySelector<HTMLElement>('#rim-stage')!.style.background='#000';});
  const red=await canvas.evaluate((c:HTMLCanvasElement)=>{
   const ctx=c.getContext('2d')!,im=ctx.getImageData(0,0,c.width,c.height);let leaks=0;
   for(let i=0;i<im.data.length;i+=4){im.data[i+1]=im.data[i+2]=0;if(im.data[i+3]&&im.data[i]!==255)leaks++;}
   ctx.putImageData(im,0,0);return leaks;
  });expect(red).toBe(0);
  if(evidence)await page.locator('#rim-fixture').screenshot({path:`${evidence}/${w}x${h}-${dpr}x-red.png`});
 }
 await context.close();
});
test('rim updates geometry during CSS rotation/resize; one layer and no panel rings',async({page})=>{
 await page.setViewportSize({width:430,height:740});await fixture(page);
 await expect(page.locator('.card > .qf-specular-rim,.lg-menu-surface > .qf-specular-rim,.chatbar > .qf-specular-rim')).toHaveCount(0);
 expect(await page.evaluate(()=>[...document.querySelectorAll('[data-qf-rim]')].every(el=>el.querySelectorAll(':scope > .qf-specular-rim').length===1))).toBe(true);
 const trace=await page.evaluate(async()=>{
  const el=document.querySelector<HTMLElement>('#rim-fixture')!,c=el.querySelector<HTMLCanvasElement>('canvas')!;
  const animation=el.animate([{width:'350px',height:'60px',transform:'rotate(0deg)'},{width:'120px',height:'44px',transform:'rotate(90deg)'}],{duration:600,fill:'forwards'});
  const samples:{width:number;bitmap:number}[]=[];
  while(animation.playState==='running'){await new Promise(r=>requestAnimationFrame(r));samples.push({width:el.offsetWidth,bitmap:c.width});}
  await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
  const pixels=c.getContext('2d')!.getImageData(0,0,c.width,c.height).data;
  return {samples,top:pixels[(Math.floor(c.width/2))*4+3]/255,final:c.width};
 });
 // Assert updates against frames actually delivered by the engine, not a presumed refresh rate.
 expect(new Set(trace.samples.map(s=>s.bitmap)).size).toBeGreaterThanOrEqual(Math.min(8,Math.max(2,trace.samples.length-1)));
 expect(trace.final).toBe(120);expect(trace.top).toBeCloseTo(.095,2);
});
test('rim intensity, nested attenuation and reduced transparency preserve the ring',async({page,context})=>{
 await fixture(page);
 const rim=page.locator('#rim-fixture canvas');
 await expect(rim).toHaveCSS('opacity','1');
 await expect(page.locator('.qf-tab-bar .lg-tab-lens > canvas')).toHaveCSS('opacity','0.85');
 await page.evaluate(()=>document.documentElement.style.setProperty('--rim','.4'));await expect(rim).toHaveCSS('opacity','0.4');
 const session=await context.newCDPSession(page);
 await session.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-transparency',value:'reduce'}]});
 await expect(rim).toHaveCSS('opacity','0.2');
 await expect(page.locator('.lg-button').first()).toHaveCSS('backdrop-filter','none');
 await expect(page.locator('.qf-tab-bar .lg-tab-lens > canvas')).toHaveCSS('opacity','0.17');
 await expect(page.locator('.qf-tab-bar .lg-tab-lens')).toBeVisible();
 await page.evaluate(()=>document.documentElement.style.setProperty('--rim','0'));await expect(rim).toHaveCSS('opacity','0');
});
