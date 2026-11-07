import assert from "node:assert/strict";
import test from "node:test";
const origin = process.env.QRFERRY_TEST_ORIGIN || "http://localhost:3000";
const routes = [
 ["/", "إرسال ملف · QRFerry", "Send a file · QRFerry", false],
 ["/scan", "مسح نقل · QRFerry", "Scan a transfer · QRFerry", false],
 ["/bridge", "جسر النقل الذكي · QRFerry", "Pair devices · QRFerry", false],
 ["/pc", "جسر الكمبيوتر · QRFerry", "Computer bridge · QRFerry", false],
 ["/history", "سجل النقل · QRFerry", "Transfer history · QRFerry", true],
 ["/offline", "حزمة أوفلاين · QRFerry", "Offline package · QRFerry", true],
 ["/privacy", "سياسة الخصوصية · QRFerry", "Privacy policy · QRFerry", true],
];
for (const lang of ["ar", "en"]) for (const [route, ar, en, standalone] of routes) {
 test(`real HTTP SSR: ${route} ${lang} system locale and page chrome`, async () => {
  const response=await fetch(new URL(route,origin),{headers:{accept:"text/html","accept-language":lang==="ar"?"ar-EG,ar;q=.9":"en-US,en;q=.9"}});
  assert.equal(response.status,200);const html=await response.text();
  assert.ok(html.includes(`<title>${lang==="ar"?ar:en}</title>`));
  assert.ok(html.includes(`lang="${lang}"`));assert.ok(html.includes(`dir="${lang==="ar"?"rtl":"ltr"}"`));
  assert.equal(html.includes('class="app-header"'),!standalone);
  assert.equal(html.includes('class="bottom-nav"'),!standalone);
  if(standalone){assert.ok(html.includes('support-exit'));assert.ok(html.includes('support-title'));}
  assert.ok(!html.includes('qrferry-theme'));assert.ok(!html.includes('secondary-links'));
 });
}
test("pre-existing missing receiver stays 404, not an invented route",async()=>assert.equal((await fetch(new URL('/tv',origin))).status,404));
for(const lang of ['ar','en']){
 test(`manifest follows request language ${lang}`,async()=>{const r=await fetch(new URL('/manifest.webmanifest',origin),{headers:{'accept-language':lang}});assert.equal(r.status,200);const m=await r.json();assert.equal(m.lang,lang);assert.equal(m.dir,lang==='ar'?'rtl':'ltr');assert.equal(m.share_target.action,'/share');});
 test(`real multipart share transitional HTML follows ${lang}`,async()=>{const form=new FormData();form.append('file',new Blob(['language check'],{type:'text/plain'}),'locale.txt');const r=await fetch(new URL('/share',origin),{method:'POST',headers:{'accept-language':lang},body:form});assert.equal(r.status,200);const html=await r.text();assert.ok(html.includes(`lang="${lang}"`));assert.ok(html.includes(lang==='ar'?'جارٍ تجهيز الملفات…':'Preparing files…'));assert.ok(html.includes('qrferry-shared'));});
}
