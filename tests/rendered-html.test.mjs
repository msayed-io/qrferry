import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { chromium } from '@playwright/test';

// Vite is CSR: exercise hydrated pages rather than asserting nonexistent SSR.
const origin=process.env.QRFERRY_TEST_ORIGIN||'http://localhost:3000';
let browser;
before(async()=>{browser=await chromium.launch();});
after(async()=>{await browser?.close();});
for(const locale of ['ar-EG','en-US'])for(const route of ['/','/scan','/bridge','/pc','/history','/privacy']){
  test(`hydrated route ${route} follows ${locale} and preserves chrome`,async()=>{
    const context=await browser.newContext({locale});const page=await context.newPage();
    try{
      await page.goto(origin+route);await page.locator('main').waitFor();
      const ar=locale.startsWith('ar');assert.equal(await page.locator('html').getAttribute('lang'),ar?'ar':'en');
      assert.equal(await page.locator('html').getAttribute('dir'),ar?'rtl':'ltr');
      assert.match(await page.title(),/QRFerry/);assert.notEqual(await page.title(),'QRFerry');
      const support=['/history','/privacy'].includes(route);
      assert.equal(await page.locator('.app-header').count(),support?0:1);
      assert.equal(await page.locator('.bottom-nav').count(),support?0:1);
      if(support){assert.equal(await page.locator('.support-toolbar > *').count(),2);}
      assert.equal(await page.locator('.secondary-links').count(),0);
    }finally{await context.close();}
  });
}
test('manifest declares local multipart sharing; installation metadata is language neutral',async()=>{
  const response=await fetch(origin+'/manifest.webmanifest');assert.equal(response.status,200);const manifest=await response.json();
  assert.equal(manifest.name,'QRFerry');assert.equal(manifest.share_target.action,'/share');assert.equal(manifest.share_target.method,'POST');assert.equal(manifest.share_target.params.files[0].name,'files');
});
test('precache includes lazy route, decoder worker and all four WASM files',async()=>{
  const response=await fetch(origin+'/asset-manifest.json');assert.equal(response.status,200);const assets=await response.json();
  for(const name of ['scanner-client','bridge-client','tv-client','scan.worker'])assert.ok(assets.some(asset=>asset.includes(name)),name);
  assert.ok(assets.filter(asset=>asset.endsWith('.wasm')).length>=4);
  assert.ok(!assets.some(asset=>asset.includes('offline-client')||asset.includes('offline-server')));
});
test('unknown and removed offline routes render a real not-found state, not Send',async()=>{
  const context=await browser.newContext({locale:'en-US'});const page=await context.newPage();
  try{for(const path of ['/not-a-route','/offline']){await page.goto(origin+path);await page.getByRole('heading',{name:'404 — Page not found'}).waitFor();assert.equal(await page.locator('.sender-page').count(),0);}}finally{await context.close();}
});
