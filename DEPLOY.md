<div dir="rtl" align="center">

# 🚀 النشر على Cloudflare Workers — دليل كامل من الهاتف

**مفيش جهاز؟ مفيش مشكلة.** كل الخطوات دي بتتعمل من متصفح التليفون (Chrome أو Safari)
على موقعين: **GitHub** و **Cloudflare**. مفيش أي أمر برمجي بتكتبه بنفسك.

</div>

---

## لماذا Cloudflare وليس Vercel؟

مشروع QRFerry مبني على قالب **vinext** (Vite + Next.js) الذي يُنتج تطبيقاً
يعمل على **Cloudflare Workers** — والبناء يخرج ملفات جاهزة للنشر مباشرة.
Vercel يتوقع بنية Next.js قياسية مختلفة، لذا فشل النشر عليه. Cloudflare مجاني
للخطة الأساسية ويكفي المشروع تماماً.

---

## الطريقة (٤ خطوات فقط)

### ١) أنشئ حساب Cloudflare مجاني
- افتح على التليفون: **https://dash.cloudflare.com/sign-up**
- سجّل بالبريد (أو "Continue with Google/Apple").
- فعّل حسابك من رسالة البريد.

### ٢) أنشئ API Token خاص بالنشر (مرة واحدة فقط)
- ادخل على: **https://dash.cloudflare.com/profile/api-tokens**
- اضغط **Create Token** ← اختر القالب: **"Edit Cloudflare Workers"**
- اضغط **Continue to summary** ← **Create Token**
- **انسخ التوكن** واحفظه في ملاحظة على هاتفك (يظهر مرة واحدة فقط).

### ٣) أضف التوكن كمفتاح سري في مستودع GitHub
- افتح على التليفون: **https://github.com/mo01115285816-cyber/qrferry/settings/secrets/actions**
  (أو: افتح المستودع ← تبويب **Settings** ← **Secrets and variables** ← **Actions**)
- اضغط **New repository secret**
- الاسم: `CLOUDFLARE_API_TOKEN`  ← (بالضبط، بأحرف كبيرة)
- القيمة: الصق التوكن من الخطوة ٢
- اضغط **Add secret** ✅

### ٤) شغّل النشر (زر واحد!)
- افتح على التليفون: **https://github.com/mo01115285816-cyber/qrferry/actions**
- اختر من القائمة اليسرى: **"Deploy to Cloudflare Workers"**
- اضغط زر **"Run workflow"** ← **Run workflow**
- انتظر دقيقة أو دقيقتين، وسترى علامة ✅ خضراء.

🎉 **عند نجاح النشر** ستظهر لك في نهاية السجل رسالة فيها رابط موقعك، مثل:
```
https://qrferry.<your-name>.workers.dev
```
ادخل على الرابط من التليفون وستجد الموقع شغال!

---

## بعد أول نشر: التحديثات التلقائية

من الآن فصاعداً، **كل تعديل تنشره على فرع `main` في GitHub ينشر الموقع تلقائياً**
(سطر `push:` في ملف النشر). حتى لو عدّلت من تطبيق GitHub على التليفون،
أي ضغطة "Commit" على main → نشر جديد تلقائي.

---

## طريقة بديلة أسهل (بدون توكن): Connect to Git

- ادخل على: **https://dash.cloudflare.com** ← **Workers & Pages** ← **Create** ← **Worker** ← **Deploy from Git**
- اسمح لـ Cloudflare بالوصول لحساب GitHub الخاص بك (زر Authorize).
- اختر مستودع `qrferry`.
- في إعدادات البناء (Build): أمر البناء `npm run build`، والمجلد الناتج `dist`.
- اضغط **Deploy**.

> ⚠️ هذه الطريقة مريحة، لكن إن واجهتك أي أخطاء في البناء فيها، استخدم
> طريقة الـ Actions (أعلاه) فهي الأكثر موثوقية.

---

## مشكلة شائعة وحلّها

| المشكلة | الحل |
|---|---|
| النشر فشل والخطأ فيه `CLOUDFLARE_API_TOKEN` | تأكد أن اسم السر بالضبط `CLOUDFLARE_API_TOKEN` وأنك لصقت التوكن كاملاً |
| النشر نجح لكن الرابط لا يعمل | انتظر دقيقة ثم حدّث الصفحة؛ أو امسح كاش المتصفح |
| خطأ `Incorrect response MIME type` للـ wasm | لا تقلق — يظهر أحياناً في السجل لكن التطبيق يعمل (fallback تلقائي) |
| تريد تغيير اسم الرابط | من لوحة Cloudflare: Worker ← Settings ← Domains & Routes |

---

## تفاصيل تقنية (للمطورين)

- ملف الإعداد: `wrangler.jsonc` في جذر المشروع.
- البناء ينتج:
  - `dist/server/index.js` → كود الـ Worker
  - `dist/client/` → الأصول الثابتة (توزَّع تلقائياً عبر `assets`)
- النشر اليدوي من أي مكان فيه Node:
  ```bash
  npm run build
  npx wrangler deploy --config wrangler.jsonc
  ```
- حدود الخطة المجانية مريحة جداً للمشروع (الحجم المضغوط ≈ 600KB).
