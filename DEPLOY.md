# نشر QRFerry

## الويب — Vite SPA

- Node.js ≥22.13.
- Install: `npm ci`
- Build: `npm run build`
- Output directory: **`dist`**، لا `.next` ولا `www`.
- Framework preset: **Vite**. `vercel.json` يحدد ذلك صراحة.
- لا تحتاج ملفات المستخدم إلى API أو قاعدة بيانات على الخادم.

المسارات `/scan`, `/bridge`, `/pc`, `/tv`, `/history`, `/privacy`, `/share` تعاد إلى `index.html`. المسارات غير المعروفة ليست مرادفات للإرسال؛ تعرض الواجهة حالة 404، وVercel لا يعيد كتابة المسارات غير المدرجة. Vite preview قد يعيد HTTP 200 لقشرة SPA حتى عند عرض 404؛ لا تُخلط هذه الحالة مع 404 على الاستضافة.

`/offline` وحزمة ZIP الخاصة بنشر التطبيق أُزيلتا. أي رابط قديم لهما لا ينبغي أن يظهر في القائمة أو ينتج حزمة.

### الكاش والتحديث

يشغّل البناء `scripts/build-precache.mjs` بعد Vite وقبل نسخ `dist` إلى `www`. ينتج قائمة بجميع الأصول ورقم كاش مشتقًا من المحتوى. تثبيت الكاش ذري: إن فشل أصل، لا يُفعّل بناء ناقص. يُحتفظ ببناء سابق للتبويبات المفتوحة. لا تخزن آلية الكاش الملفات المستلمة أو طلبات غير مرتبطة بأصول التطبيق.

`sw.js` و`asset-manifest.json` يقدمان مع `Cache-Control: no-cache` على Vercel. لا تعدّل أسماء chunks أو تنقل بعض ملفات WASM يدويًا بعد البناء. اختبار الأوفلاين الصحيح: زيارة Home فقط، انتظار `navigator.serviceWorker.ready` والسيطرة، قطع الشبكة، فتح Scan لأول مرة وإتمام نقل حقيقي من fixture.

### Web Share

الـmanifest يحتوي `share_target` لملفات multipart باسم `files`. يتعامل Service Worker مع POST محليًا ويحفظ ملفات المشاركة مؤقتًا في IndexedDB ثم يعيد التوجيه إلى Send. لا يُضاف endpoint يرفع الملفات إلى Vercel. يجب تثبيت PWA وفتحها أولًا؛ دعم استهداف المشاركة يعتمد على المتصفح/النظام.

### HTTPS والكاميرا والإشارة

الكاميرا تحتاج سياقًا آمنًا: HTTPS أو localhost للتطوير. Pair وQuick transfer يستخدمان PeerJS للإشارة وWebRTC للبيانات. الافتراضي `0.peerjs.com:443` آمن؛ اختبار الوصول محليًا ليس ضمانًا لشبكات WAN/NAT المختلفة.

يمكن تحديد خادم إشارة مخصص من خلال التهيئة الموجودة (`qrferry-peer-host`). Android لا يفتح cleartext عالميًا: خوادم الإشارة المحلية في الإصدار الأصلي تحتاج WSS وشهادة موثوقة. لا تستخدم تعطيل الحماية كحل لمشكلة اتصال.

## Android

```sh
npm ci
npm run build
npx cap sync android
# باستخدام Java 21 وAndroid SDK 36:
cd android
./gradlew testDebugUnitTest assembleDebug
```

`capacitor.config.ts` يشير إلى `www` ولا يحتوي `server.url`. التطبيق لا يحمل الواجهة من Vercel. الروابط المصدرة من داخل التطبيق تستخدم أصل الويب المنشور `https://qrferry-io.vercel.app` بدل localhost؛ يمكن ضبط `VITE_PUBLIC_APP_ORIGIN` عند البناء. تظل حمولة QFB1 في fragment، ولا تُرسل إلى خادم HTTP.

تفاصيل التوقيع، بوابة Emulator، والإصدار: [docs/android-release.md](docs/android-release.md).

## قائمة تحقق بعد النشر

1. تحقق من حالة نشر **آخر commit**، وليس نشر سابق ناجح.
2. افتح المسارات مباشرة وبالتنقل الداخلي؛ الشعار وروابط السجل لا تعيد تحميل المستند أو تقطع جلسة Pair.
3. اختبر ثيم/لغة الجهاز، وRTL، والرجوع، والمشاركة، والكاش البارد.
4. تحقق من APK/AAB، رقم النسخة، توقيع APK بـ`apksigner`، ووجود worker وWASM داخل الحزمة.
5. نفّذ قبولًا على هاتف Android فعلي: الكاميرا/إذنها، الإلغاء والتبديل، حفظ الملفات في SAF، المشاركة من تطبيق خارجي، الإشعارات، منع نوم الشاشة، وثيم/لغة النظام أثناء تشغيل التطبيق.
