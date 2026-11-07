import {chromium,expect} from '@playwright/test';
import fs from 'node:fs/promises';
const dir=process.env.EVIDENCE_DIR||'/home/user/qrferry-redesign-evidence';
const browser=await chromium.launch({args:['--no-sandbox']});
const result={contrast:[],targets:[],keyboard:[],limitations:['Computed contrast checks are token-pair checks, not a full WCAG certification.','Native media controls and physical touch hardware were not tested.']};
const linear=c=>(c/=255)<=.04045?c/12.92:((c+.055)/1.055)**2.4;
const lum=c=>.2126*linear(c[0])+.7152*linear(c[1])+.0722*linear(c[2]);
const ratio=(a,b)=>(Math.max(lum(a),lum(b))+.05)/(Math.min(lum(a),lum(b))+.05);
const blend=(a,b)=>a.slice(0,3).map((n,i)=>n*a[3]+b[i]*(1-a[3]));
for(const theme of ['light','dark']){
 const context=await browser.newContext({viewport:{width:390,height:900},colorScheme:theme});const page=await context.newPage();
 await page.goto('http://localhost:3000/bridge');await page.locator('.tabs').waitFor();
 const colors=await page.evaluate(()=>{const root=getComputedStyle(document.documentElement),canvas=document.createElement('canvas'),ctx=canvas.getContext('2d');canvas.width=canvas.height=1;const rgb=v=>{ctx.clearRect(0,0,1,1);ctx.fillStyle=v;ctx.fillRect(0,0,1,1);const p=ctx.getImageData(0,0,1,1).data;return [p[0],p[1],p[2],p[3]/255];};return {card:rgb(root.getPropertyValue('--card')),label:rgb(root.getPropertyValue('--label')),label2:rgb(root.getPropertyValue('--label2')),tint:rgb(root.getPropertyValue('--tint')),white:[255,255,255,1],error:[255,59,48,1],button:rgb(getComputedStyle(document.querySelector('.bridge-grid .tinted')).backgroundColor)};});
 for(const [name,foreground,background] of [['body label on card',colors.label,colors.card],['secondary label on card',colors.label2,colors.card],['white on tint',colors.white,colors.tint],['white on actual tinted control',colors.white,blend(colors.button,colors.card)],['error on card',colors.error,colors.card]]){
  const value=ratio(blend(foreground,background),background);result.contrast.push({theme,name,ratio:value,passes4_5:value>=4.5});
 }
 for(const route of ['/','/scan','/bridge','/history','/offline','/privacy']){
  await page.goto('http://localhost:3000'+route);await page.locator('.tabs').waitFor();
  result.targets.push({theme,route,small:await page.locator('button,a[href],input:not([type=file]),textarea,select,summary').evaluateAll(els=>els.filter(el=>el.getClientRects().length&&!el.closest('[hidden]')&&!el.disabled).map(el=>{const r=el.getBoundingClientRect();let w=r.width,h=r.height;const s=getComputedStyle(el,'::before');if(s.content!=='none'&&s.position==='absolute'){w-=parseFloat(s.left)||0;w-=parseFloat(s.right)||0;h-=parseFloat(s.top)||0;h-=parseFloat(s.bottom)||0;}const label=el.closest('label');if(label){const lr=label.getBoundingClientRect();w=Math.max(w,lr.width);h=Math.max(h,lr.height);}return {tag:el.tagName,class:el.className,label:el.getAttribute('aria-label')||el.textContent.trim().slice(0,60),width:w,height:h};}).filter(r=>r.width<44||r.height<44))});
 }
 await page.goto('http://localhost:3000');await page.getByRole('tab',{name:'ملف',exact:true}).focus();await page.keyboard.press('ArrowLeft');await expect(page.getByRole('tab',{name:'نص',exact:true})).toHaveAttribute('aria-selected','true');
 await page.locator('#nav-send').focus();await page.keyboard.press('End');await expect(page.locator('#nav-pair')).toHaveAttribute('aria-selected','true');
 const outline=await page.locator('#nav-pair').evaluate(el=>({outline:getComputedStyle(el).outlineStyle,width:getComputedStyle(el).outlineWidth,focused:document.activeElement===el}));
 result.keyboard.push({theme,segmentArrow:true,navigationEnd:true,outline});await context.close();
}
await fs.writeFile(`${dir}/accessibility-audit.json`,JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));await browser.close();
