<div dir="rtl" align="center">

# 🚀 النشر — دليل كامل من الهاتف

**مفيش جهاز؟ مفيش مشكلة.** كل الخطوات بتتعمل من متصفح التليفون (Chrome أو Safari).
الطريقة الأسهل: **Vercel** (بتفتح حسابك وتسجّل دخولك بجوجل وخلاص).

</div>

---

## 🥇 الطريقة الأولى (الأسهل): النشر على Vercel

مشروع QRFerry جاهز الآن لـ Vercel — أضفنا ملف `vercel.json` وسكربت
`build:vercel` في `package.json`، فكل شيء يعمل تلقائياً.

### الخطوات (٣ دقائق):

1. **ادخل على Vercel**: `https://vercel.com`
   - سجّل الدخول بزر **"Continue with GitHub"** (أسرع طريقة — يربط حسابك مباشرة).
   - (إن لم يكن عندك حساب: **Sign Up** ← **Continue with GitHub** ← اسمح بالوصول)

2. **استورد مشروعك**:
   - من لوحة التحكم اضغط **"Add New…"** ← **Project**.
   - ستظهر قائمة بمستودعات GitHub — اختر **`qrferry`**.
   - اضغط **"Import"**.

3. **انشر فوراً**:
   - اضغط **"Deploy"** مباشرة (لا تغيّر أي إعداد — كل شيء جاهز).
   - انتظر دقيقة أو دقيقتين وستحصل على رابط مثل:
     ```
     https://qrferry-xxxx.vercel.app
     ```
   - 🎉 افتح الرابط وستجد الموقع يعمل!

### التحديثات التلقائية بعد أول نشر:
- كل تعديل تعمله على فرع `main` في GitHub → Vercel يعيد النشر تلقائياً.
- (يمكنك الربط بنفسك: Project ← Settings ← Git ← connect repo)

### لو حصل خطأ في Vercel:
- اذهب إلى: **Deployments** (أعلى صفحة المشروع) ← اضغط على النشر الفاشل
- اقرأ السطر الأحمر/الخطأ، أو صوّره لي وأنا أحلّه لك.
- المشكلة الشائعة: `Output directory .next not found` → هذا يعني أن Vercel
  لم يقرأ `vercel.json` (تأكد أنك نشرت آخر تحديث للمستودع). إن تكررت، ضع
  في Vercel: **Settings ← General ← Build Command** القيمة:
  ```
  npm run build:vercel
  ```
  ومجلد الإخراج **Output Directory**: `.next`

---

## 🥈 الطريقة الثانية (اختياري): النشر على Cloudflare Workers

مشروع QRFerry مبني أصلاً على قالب vinext الذي ينشر على Cloudflare، والملفات
جاهزة (`wrangler.jsonc` + سكربت `deploy`). هذه الطريقة مجانية أيضاً.

1. سجّل حساباً مجانياً: `https://dash.cloudflare.com/sign-up`
2. أنشئ API Token: `dash.cloudflare.com/profile/api-tokens` ← **Create Token** ←
   قالب **"Edit Cloudflare Workers"** ← **Create Token** ← انسخه.
3. أضفه سرّاً في GitHub: إعدادات المستودع ← **Secrets and variables ← Actions** ←
   **New repository secret** ← الاسم `CLOUDFLARE_API_TOKEN` ← الصق التوكن.
4. من تبويب **Actions** في المستودع ← **"Deploy to Cloudflare Workers"** ←
   **Run workflow** ← ✅ أخضر = موقعك يعمل على `https://qrferry.<اسمك>.workers.dev`.

---

## مقارنة سريعة

| | Vercel (موصى به لك) | Cloudflare Workers |
|---|---|---|
| سهولة الربط من الهاتف | ⭐⭐ سهلة جداً (Continue with GitHub) | ⭐⭐ تحتاج خطوة token إضافية |
| التكلفة | مجاني (خطة Hobby) | مجاني |
| البناء | `next build` (مجرّب وناجح) | `vinext build` (مجرّب وناجح) |
| الرابط النهائي | `qrferry-xxx.vercel.app` | `qrferry.<اسمك>.workers.dev` |

---

## تفاصيل تقنية (للمطورين)

- **مسار Vercel**: `npm run build:vercel` (= `next build --webpack`)، الإخراج `.next`.
  ملف `vercel.json` يضبط هذا تلقائياً.
- **مسار Cloudflare**: `npm run build` (vinext) ثم `npx wrangler deploy --config wrangler.jsonc`.
- التطبيق يعمل بالكامل في المتصفح (ضغط، ترميز، رسم QR، مسح، فك)؛ السيرفر
  يقدّم الصفحات فقط، لذا أي استضافة static أو server تكفي.
