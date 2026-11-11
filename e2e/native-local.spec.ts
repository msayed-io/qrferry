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
test('local catalogue and scanner do not manufacture data when native bridge is absent',async({page})=>{
 await page.goto('/local/send');await expect(page.locator('[data-file-row]')).toHaveCount(0);await expect(page.getByRole('button',{name:'تصفح ملفات الجهاز',exact:true})).toBeDisabled();await expect(page.locator('.local-send-action button')).toBeDisabled();
 await page.goto('/local/scan');await expect(page.getByRole('button',{name:'فتح الكاميرا',exact:true})).toBeDisabled();await expect(page.locator('video')).toHaveCount(0);await expect(page.locator('.lf-cam-surface')).toBeVisible();
});
