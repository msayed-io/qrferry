import { test, expect, type Page } from '@playwright/test';

test.use({serviceWorkers:'block',viewport:{width:390,height:740}});
async function pauseChunk(page: Page, name: string) {
  let release!: () => void, requested!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const seen = new Promise<void>(resolve => { requested = resolve; });
  await page.route(`**/assets/${name}-*.js`, async route => { requested(); await gate; await route.continue(); });
  return {release,seen};
}
async function recordFrames(page: Page) {
  await page.evaluate(() => {
    const state = { live: true, frames: [] as {path:string;visible:boolean;loading:boolean;body:number;scroll:number;nav:number}[] };
    Object.assign(window,{continuity:state});
    function frame() {
      const pages = [...document.querySelectorAll('.transfer-page,.support-page')];
      state.frames.push({path:location.pathname,visible:pages.some(p=>p.getBoundingClientRect().height>0),loading:!!document.querySelector('.route-loading'),body:document.body.scrollHeight,scroll:scrollY,nav:document.querySelector('.bottom-nav')?.getBoundingClientRect().y ?? -1});
      if(state.live) requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  });
}
async function frames(page: Page) {
  return page.evaluate(() => {
    const state = (window as unknown as {continuity:{live:boolean;frames:{path:string;visible:boolean;loading:boolean;body:number;scroll:number;nav:number}[]}}).continuity;
    state.live=false;return state.frames;
  });
}
for(const theme of ['light','dark'] as const) {
 test(`cold routes retain content, scroll and pending lens in ${theme}`,async({page})=>{
  await page.emulateMedia({colorScheme:theme});await page.goto('/');await expect(page.locator('.transfer-page')).toBeVisible();
  await page.evaluate(()=>scrollTo(0,200));await recordFrames(page);
  for(const [chunk,id,path,selector] of [['scanner-client','scan','/scan','.scanner-page'],['bridge-client','pair','/bridge','.bridge-page']]){
   const before=await page.evaluate(()=>({path:location.pathname,scroll:scrollY,body:document.body.scrollHeight}));
   const paused=await pauseChunk(page,chunk);
   await page.locator('#nav-'+id).click();await paused.seen;
   await expect(page.locator('#nav-'+id)).toHaveAttribute('aria-selected','true');
   // Exercise frames while the real import is pending, not merely final state.
   await page.waitForTimeout(220);
   expect(await page.evaluate(()=>({path:location.pathname,scroll:scrollY,body:document.body.scrollHeight}))).toEqual(before);
   expect(await page.locator('.route-loading').count()).toBe(0);
   paused.release();await expect(page).toHaveURL(new RegExp(path+'$'));await expect(page.locator(selector)).toBeVisible();
   expect(await page.evaluate(()=>scrollY)).toBe(0);
  }
  const trace=await frames(page);expect(trace.length).toBeGreaterThan(10);
  expect(trace.filter(f=>!f.visible||f.loading)).toEqual([]);
  expect(Math.max(...trace.map(f=>f.nav))-Math.min(...trace.map(f=>f.nav))).toBeLessThan(1);
 });
}
test('latest intent cancels cold loading; reselecting the visible tab restores selection without scrolling',async({page})=>{
 await page.goto('/');await expect(page.locator('.transfer-page')).toBeVisible();await page.evaluate(()=>scrollTo(0,200));
 const scan=await pauseChunk(page,'scanner-client'),pair=await pauseChunk(page,'bridge-client');
 await page.locator('#nav-scan').click();await scan.seen;await page.locator('#nav-pair').click();await pair.seen;
 await page.locator('#nav-send').click();scan.release();pair.release();await page.waitForTimeout(500);
 await expect(page).toHaveURL(/\/$/);await expect(page.locator('#nav-send')).toHaveAttribute('aria-selected','true');expect(await page.evaluate(()=>scrollY)).toBe(200);
});
test('Back cancels an unfinished navigation and Forward does not resurrect it',async({page})=>{
 await page.goto('/');await page.locator('#nav-scan').click();await expect(page).toHaveURL(/\/scan$/);
 const pair=await pauseChunk(page,'bridge-client');await page.locator('#nav-pair').click();await pair.seen;
 await page.goBack();await expect(page).toHaveURL(/\/$/);pair.release();await page.waitForTimeout(400);
 await expect(page).toHaveURL(/\/$/);await expect(page.locator('#nav-send')).toHaveAttribute('aria-selected','true');
 await page.goForward();await expect(page).toHaveURL(/\/scan$/);await expect(page.locator('.scanner-page')).toBeVisible();
});
test('cold support entry retains its source until ready and exit returns to that source',async({page})=>{
 await page.goto('/scan');await expect(page.locator('.scanner-page')).toBeVisible();const history=await pauseChunk(page,'history-client');
 await page.getByRole('button',{name:'قائمة التطبيق'}).click();await page.getByRole('menuitem',{name:'السجل'}).click();await history.seen;
 await expect(page.locator('.scanner-page')).toBeVisible();await expect(page.locator('.bottom-nav')).toBeVisible();history.release();
 await expect(page).toHaveURL(/\/history$/);await expect(page.locator('.support-toolbar')).toBeVisible();
 await page.locator('.support-exit').click();await expect(page).toHaveURL(/\/scan$/);await expect(page.locator('.scanner-page')).toBeVisible();
});
test('failed chunk shows the real error boundary and can return to Send',async({page})=>{
 await page.goto('/');await expect(page.locator('.transfer-page')).toBeVisible();await page.route('**/assets/scanner-client-*.js',route=>route.abort());
 await page.locator('#nav-scan').click();await expect(page.getByRole('heading',{name:'تعذّر عرض هذه الصفحة'})).toBeVisible();
 await page.getByRole('link',{name:'العودة إلى الإرسال',exact:true}).click();await expect(page.locator('.transfer-page')).toBeVisible();await expect(page).toHaveURL(/\/$/);
});
