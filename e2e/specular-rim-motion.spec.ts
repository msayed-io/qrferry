import {test,expect} from '@playwright/test';
test('physical light follows screen normals during rotation-only CSS animation and stays stable while scrolling',async({page})=>{
 await page.setViewportSize({width:430,height:740});await page.goto('/');await expect(page.locator('.transfer-page')).toBeVisible();
 await page.evaluate(()=>{
  const el=document.createElement('button');el.className='glass cap';el.id='rim-spin';Object.assign(el.style,{position:'fixed',left:'30px',top:'300px',width:'350px',height:'60px',borderRadius:'30px'});document.body.append(el);
  const style=document.createElement('style');style.textContent='@keyframes rim-spin-test{from{transform:rotate(0deg)}to{transform:rotate(90deg)}} #rim-spin.spin{animation:rim-spin-test .4s linear forwards}';document.head.append(style);
 });
 const canvas=page.locator('#rim-spin canvas');await expect(canvas).toHaveCount(1);
 const images=await page.evaluate(async()=>{
  const el=document.querySelector('#rim-spin')!,c=el.querySelector<HTMLCanvasElement>('canvas')!;const frames=new Set<string>();let delivered=0;el.classList.add('spin');
  const until=performance.now()+600;
  while(performance.now()<until){await new Promise(r=>requestAnimationFrame(r));frames.add(c.toDataURL());delivered++;}
  await Promise.all(el.getAnimations().map(animation=>animation.finished));
  await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
  const data=c.getContext('2d')!.getImageData(0,0,c.width,c.height).data;
  return {frames:frames.size,delivered,top:data[Math.floor(c.width/2)*4+3]/255};
 });
 expect(images.frames).toBeGreaterThanOrEqual(Math.min(8,Math.max(2,images.delivered-1)));expect(images.top).toBeCloseTo(.095,2);
 const before=await canvas.evaluate((c:HTMLCanvasElement)=>c.toDataURL());await page.evaluate(()=>scrollTo(0,200));
 expect(await canvas.evaluate((c:HTMLCanvasElement)=>c.toDataURL())).toBe(before);
});
