import {test,expect} from '@playwright/test';

for(const lang of ['ar-EG','en-US']) test(`measured content slots and fixed transparent chrome ${lang}`,async({browser,baseURL})=>{
 const context=await browser.newContext({baseURL,locale:lang,viewport:{width:390,height:740}}),page=await context.newPage();
 await page.goto('/');await expect(page.locator('.qf-segmented .lg-tab')).toHaveCount(2);
 for(const width of [320,390,844]){
  await page.setViewportSize({width,height:740});
  await expect.poll(()=>page.locator('.qf-segmented').evaluate(el=>{
   const w=el.getBoundingClientRect().width,buttons=[...el.querySelectorAll('.lg-tab')].map(e=>e.getBoundingClientRect());
   return buttons.every(r=>Math.abs(r.width-w/2)<1)&&buttons[0].right<=buttons[1].left+1;
  })).toBe(true);
 }
 const menu=await page.locator('.app-menu>.lg-button').boundingBox();expect(menu!.width).toBe(40);expect(menu!.height).toBe(40);
 const header=page.locator('.app-header'),before=await header.boundingBox();await page.evaluate(()=>scrollTo(0,200));expect((await header.boundingBox())!.y).toBe(before!.y);
 await expect(header).toHaveCSS('background-color','rgba(0, 0, 0, 0)');await expect(page.locator('.brand')).not.toHaveClass(/lg-glass/);
 for(const route of ['privacy','history']){
  await page.goto('/'+route);await expect(page.locator('.support-title')).toBeVisible();
  const title=await page.locator('.support-title').boundingBox(),exit=await page.locator('.support-exit').boundingBox();
  expect(title!.x).toBeLessThan(exit!.x);expect(title!.height).toBe(40);expect(exit!.width).toBe(40);expect(exit!.height).toBe(40);
  await page.evaluate(()=>scrollTo(0,180));expect((await page.locator('.support-exit').boundingBox())!.y).toBe(exit!.y);
  await expect(page.locator('.support-toolbar')).toHaveCSS('background-color','rgba(0, 0, 0, 0)');
  await expect(page.locator('.progressive-blur-top i')).toHaveCount(5);await expect(page.locator('.progressive-blur-bottom')).toHaveCount(0);
 }
 await context.close();
});

test('top blur uses distinct masked radii, fades without a plate, and respects reduced transparency',async({page,context})=>{
 await page.goto('/privacy');await expect(page.locator('.support-title')).toBeVisible();
 const values=await page.locator('.progressive-blur i').evaluateAll(es=>es.map(e=>{const s=getComputedStyle(e);return {filter:s.backdropFilter,mask:s.maskImage,pointer:s.pointerEvents}}));
 expect(new Set(values.map(v=>v.filter)).size).toBe(5);expect(values.every(v=>v.filter.includes('blur(')&&v.mask.includes('gradient')&&v.pointer==='none')).toBe(true);
 const session=await context.newCDPSession(page);await session.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-transparency',value:'reduce'}]});await expect(page.locator('.progressive-blur i').first()).toHaveCSS('display','none');
 await expect(page.locator('.support-title')).toHaveCSS('backdrop-filter','none');
});
