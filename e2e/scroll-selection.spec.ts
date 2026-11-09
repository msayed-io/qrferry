import { test, expect, type Locator } from '@playwright/test';

test.use({serviceWorkers:'block',viewport:{width:390,height:568}});
async function textPoint(locator:Locator) {
 await locator.scrollIntoViewIfNeeded();return locator.evaluate(el=>{
  const walker=document.createTreeWalker(el,NodeFilter.SHOW_TEXT);let node=walker.nextNode();
  while(node&&!node.textContent?.trim())node=walker.nextNode();if(!node)throw new Error('No text');
  const range=document.createRange();range.selectNodeContents(node);const rect=range.getBoundingClientRect();return {x:rect.x+rect.width/2,y:rect.y+rect.height/2};
 });
}
for(const theme of ['light','dark'] as const) {
 test(`UI text is not selectable, input editing is preserved, and scrolling works in ${theme}`,async({page})=>{
  await page.emulateMedia({colorScheme:theme});await page.goto('/bridge');const title=page.locator('h1');await expect(title).toBeVisible();
  const point=await textPoint(title);await page.mouse.dblclick(point.x,point.y);
  expect(await page.evaluate(()=>getSelection()?.toString().trim())).toBe('');
  // WebKit reports computed 'auto' on descendants, whose used value is 'none'
  // from the parent. Assert actual selection above and the declaring rule here.
  await expect(page.locator('body')).toHaveCSS('user-select','none');
  const input=page.locator('#bridge-paste-input');await input.fill('abcdef');await input.focus();await page.keyboard.press('ControlOrMeta+a');
  expect(await input.evaluate((el:HTMLInputElement)=>el.selectionEnd!-el.selectionStart!)).toBe(6);
  await page.keyboard.type('replacement');await expect(input).toHaveValue('replacement');await expect(input).toHaveCSS('user-select','text');
  await page.evaluate(()=>{(document.activeElement as HTMLElement)?.blur();scrollTo(0,0);});await page.mouse.move(180,300);await page.mouse.wheel(0,250);
  await expect.poll(()=>page.evaluate(()=>scrollY)).toBeGreaterThan(50);
  for(const selector of ['html','body','.bridge-page']){
   await expect(page.locator(selector)).toHaveCSS('scrollbar-width','none');
   const rootWebKit = selector === 'html' && await page.evaluate(()=>CSS.supports('-webkit-nbsp-mode','space'));
   await expect(page.locator(selector)).toHaveCSS('overscroll-behavior-y',rootWebKit ? 'auto' : 'none');
   expect(await page.locator(selector).evaluate(el=>getComputedStyle(el,'::-webkit-scrollbar').display)).toBe('none');
  }
 });
}
test('native touch scrolling is not intercepted by hidden scrollbar rules',async({browser,baseURL})=>{
 const context=await browser.newContext({baseURL,locale:'ar-EG',viewport:{width:390,height:568},isMobile:true,hasTouch:true,serviceWorkers:'block'});
 const page=await context.newPage();await page.goto('/');await expect(page.locator('.transfer-page')).toBeVisible();
 const cdp=await context.newCDPSession(page);const point=(y:number)=>({x:30,y,id:1});
 await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[point(400)]});
 for(let i=1;i<=12;i++){await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[point(400-i*18)]});await page.waitForTimeout(16);}
 await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await expect.poll(()=>page.evaluate(()=>scrollY)).toBeGreaterThan(100);await context.close();
});
test('long-press-style selection remains available for a real generated pairing URL',async({page})=>{
 await page.addInitScript(()=>localStorage.setItem('qrferry-peer-host',JSON.stringify({host:'localhost',port:9000,path:'/',secure:false})));
 await page.goto('/bridge');await page.getByRole('button',{name:'أنشئ رمز الربط'}).click();const url=page.locator('.bridge-link-row code');await expect(url).toBeVisible();
 await expect(url).toHaveCSS('user-select','text');const point=await textPoint(url);await page.mouse.dblclick(point.x,point.y);
 expect((await page.evaluate(()=>getSelection()?.toString().trim()))?.length).toBeGreaterThan(0);
});
