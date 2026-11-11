import {test,expect} from '@playwright/test';
for(const width of [320,390,844,1440])test(`local mode has no fabricated connection or files on web at ${width}`,async({page})=>{
 await page.setViewportSize({width,height:740});await page.goto('/local');
 await expect(page.locator('.local-page')).toBeVisible();await expect(page.getByRole('heading',{name:'هذه المنظومة تعمل داخل تطبيق Android'})).toBeVisible();
 await expect(page.locator('.local-actions button').first()).toBeDisabled();await expect(page.locator('[data-file-row]')).toHaveCount(0);await expect(page.locator('[data-msg]')).toHaveCount(0);
 await expect(page.locator('.progressive-blur-top')).toHaveCount(1);await expect(page.locator('.local-nav .qf-tab-bar')).toHaveCount(1);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
 await page.goto('/local/session');await expect(page.getByRole('heading',{name:'لا توجد جلسة نقل بدأت بالفعل'})).toBeVisible();await expect(page.locator('.bridge-composer')).toHaveCount(0);
 await page.goto('/');await expect(page.locator('#nav-send')).toBeVisible();await expect(page.locator('.qf-segmented')).toBeVisible();
});
// A missing route entry turned Receive into the app's 404 page; every local
// child must render the subsystem instead.
test('every local child route renders the subsystem and never the 404 page',async({page})=>{
 for(const route of ['/local','/local/send','/local/setup','/local/receive','/local/scan','/local/session']){
  await page.goto(route);
  await expect(page.locator('.local-page')).toBeVisible();
  await expect(page.getByRole('heading',{name:/404/})).toHaveCount(0);
 }
 await page.goto('/local/setup');
 await expect(page.getByRole('heading',{name:'تحضير الاستلام'})).toBeVisible();
});
test('top capsules outrank the progressive blur',async({page})=>{
 await page.goto('/local/send');
 await expect(page.locator('.lf-chip').first()).toBeVisible();
 const ok=await page.evaluate(()=>{
  const chip=document.querySelector('.lf-chip'),blur=document.querySelector('.progressive-blur-top');
  if(!chip||!blur)return false;
  const z=(el:Element|null)=>Number(el?getComputedStyle(el).zIndex:0)||0;
  return z(chip.closest('.lf-top'))>z(blur);
 });
 expect(ok).toBe(true);
});
test('local catalogue and scanner do not manufacture data when native bridge is absent',async({page})=>{
 await page.goto('/local/send');await expect(page.locator('[data-file-row]')).toHaveCount(0);await expect(page.getByRole('button',{name:'تصفح ملفات الجهاز',exact:true})).toBeDisabled();await expect(page.locator('.local-send-action button')).toBeDisabled();
 await page.goto('/local/scan');await expect(page.getByRole('button',{name:'فتح الكاميرا',exact:true})).toBeDisabled();await expect(page.locator('video')).toHaveCount(0);await expect(page.locator('.lf-cam-surface')).toBeVisible();
});
