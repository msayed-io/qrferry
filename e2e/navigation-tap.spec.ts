import {test,expect} from '@playwright/test';

test('short tab taps slide continuously without lift; latest tap wins',async({page})=>{
 await page.setViewportSize({width:390,height:740});await page.goto('/');await expect(page.locator('#nav-send')).toHaveAttribute('aria-selected','true');await page.waitForTimeout(300);
 await page.evaluate(()=>{
  const state={samples:[] as {x:number,lift:number,t:number}[],stop:false};Object.assign(window,{tapTrace:state});
  const sample=(t:number)=>{const e=document.querySelector<HTMLElement>('.qf-tab-bar .lg-tab-lens')!;state.samples.push({t,x:new DOMMatrix(getComputedStyle(e).transform).e,lift:Number(e.style.getPropertyValue('--lg-lift'))});if(!state.stop)requestAnimationFrame(sample)};requestAnimationFrame(sample);
 });
 await page.locator('#nav-scan').click({delay:65});await expect(page).toHaveURL(/\/scan$/);await page.waitForTimeout(600);
 const trace=await page.evaluate(()=>{const s=(window as unknown as {tapTrace:{samples:{x:number,lift:number,t:number}[],stop:boolean}}).tapTrace;s.stop=true;return s.samples});
 expect(Math.max(...trace.map(s=>s.lift))).toBe(0);
 const start=trace[0].x,end=trace.at(-1)!.x;expect(Math.abs(end-start)).toBeGreaterThan(60);
 expect(trace.filter(s=>Math.abs(s.x-start)>2&&Math.abs(s.x-end)>2).length).toBeGreaterThan(3);
 for(let i=1;i<trace.length;i++)expect((trace[i].x-trace[i-1].x)*Math.sign(end-start)).toBeGreaterThan(-.2);
 await page.locator('#nav-pair').click({delay:30});await page.locator('#nav-send').click({delay:30});await expect(page).toHaveURL(/\/$/);await expect(page.locator('#nav-send')).toHaveAttribute('aria-selected','true');
});

test('unselected hold still enters original lens and cancellation never navigates',async({page})=>{
 await page.goto('/');await expect(page.locator('#nav-send')).toHaveAttribute('aria-selected','true');
 const box=(await page.locator('#nav-scan').boundingBox())!;await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.waitForTimeout(220);
 await expect(page.locator('.qf-tab-bar')).toHaveAttribute('data-lensing','');
 await page.evaluate(()=>window.dispatchEvent(new Event('blur')));await page.mouse.move(0,0);await page.mouse.up();await expect(page).toHaveURL(/\/$/);
 await expect(page.locator('.qf-tab-bar')).not.toHaveAttribute('data-lifted','');
});

test('reduced motion taps settle without lifting',async({page})=>{
 await page.emulateMedia({reducedMotion:'reduce'});await page.goto('/');await expect(page.locator('#nav-send')).toHaveAttribute('aria-selected','true');await page.locator('#nav-scan').click({delay:50});await expect(page).toHaveURL(/\/scan$/);
 await expect(page.locator('.qf-tab-bar .lg-tab-lens')).toHaveCSS('transform',/matrix\(1, 0, 0, 1,/);
 expect(await page.locator('.qf-tab-bar .lg-tab-lens').evaluate(e=>Number((e as HTMLElement).style.getPropertyValue('--lg-lift')))).toBe(0);
});
