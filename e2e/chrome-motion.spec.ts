import {test,expect} from '@playwright/test';

test('reselecting the current navigation tab preserves scroll position',async({page})=>{
 await page.setViewportSize({width:390,height:568});await page.goto('/scan');
 await expect(page.locator('.transfer-page')).toBeVisible();
 await page.evaluate(()=>window.scrollTo(0,180));const before=await page.evaluate(()=>scrollY);expect(before).toBeGreaterThan(80);
 await page.locator('#nav-scan').click();await page.waitForTimeout(350);
 expect(await page.evaluate(()=>scrollY)).toBeCloseTo(before,0);
});

test('route entry does not translate or spring the whole page',async({page})=>{
 await page.goto('/');await expect(page.locator('.transfer-page')).toBeVisible();
 for(const id of ['scan','pair','send']){
  await page.locator('#nav-'+id).click();
  const root=page.locator('.transfer-page:visible');await expect(root).toBeVisible();
  expect(await root.evaluate(e=>({animation:getComputedStyle(e).animationName,transform:getComputedStyle(e).transform}))).toEqual({animation:'none',transform:'none'});
 }
});

test('held and diagonal Glisse drag retains its real foreground lens and commits once',async({browser,baseURL})=>{
 const context=await browser.newContext({baseURL,viewport:{width:390,height:568},isMobile:true,hasTouch:true,locale:'ar-EG'});
 const page=await context.newPage();await page.goto('/scan');await expect(page.locator('.transfer-page')).toBeVisible();
 const session=await context.newCDPSession(page),start=(await page.locator('#nav-scan').boundingBox())!,end=(await page.locator('#nav-send').boundingBox())!;
 await page.evaluate(()=>{(window as unknown as {cancelled:number}).cancelled=0;document.addEventListener('pointercancel',()=>{(window as unknown as {cancelled:number}).cancelled++;});});
 const point=(x:number,y:number)=>({x,y,id:1,radiusX:2,radiusY:2,force:1});
 const x=start.x+start.width/2,y=start.y+start.height/2;
 await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[point(x,y)]});
 await session.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[point(x+2,y-18)]});
 await page.waitForTimeout(180);
 await expect(page.locator('.qf-tab-bar')).toHaveAttribute('data-lensing','');
 expect(await page.locator('.qf-tab-bar .lg-tab-lensed').evaluate(e=>getComputedStyle(e).filter)).toContain('glisse-lens-');
 expect(await page.locator('filter[id^="glisse-lens-"] feDisplacementMap').count()).toBeGreaterThanOrEqual(2);
 for(let i=1;i<=8;i++)await session.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[point(x+(end.x+end.width/2-x)*i/8,y-18+18*i/8)]});
 await session.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
 await expect(page).toHaveURL(baseURL+'/');await page.waitForTimeout(350);
 expect(await page.evaluate(()=>(window as unknown as {cancelled:number}).cancelled)).toBe(0);
 await expect(page.locator('#nav-send')).toHaveAttribute('aria-selected','true');
 await context.close();
});
