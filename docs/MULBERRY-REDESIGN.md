# QRFerry — Mulberry / System preferences / Native Menu

تاريخ التنفيذ: 7 نوفمبر 2026. تغيير جديد فوق `e3e09cfb0c93785a370abdb251024b0b7333ce0a`.

**الحالة: منفّذ ومبني ومختبر محليًا؛ ليس نشرًا جديدًا على GitHub أو Vercel.** لم تُستخدم بيانات اعتماد ولم تُعد استعمال صلاحية الرفع السابقة ذات الاستخدام الواحد. المعاينة تشغّل production build على المنفذ 3000. التسجيل الجديد: `/home/user/QRFerry-Mulberry.webm`، وليس تسجيل الواجهة الزرقاء السابقة.

## الهوية

Mulberry: توتي غني على خلفيات خزفية فاتحة، ووردي توتي على فحمي دافئ ليلًا. تغيّرت هوية الضوابط والشعار وfavicon وأيقونات PWA وOG، وليس لون الخلفية وحده.

| الرمز | فاتح | داكن |
|---|---|---|
| Accent | `#9A315E` | `#E792B9` |
| On-accent | `#FFFFFF` | `#2E1424` |
| Background | `#F7F4F6` | `#121014` |
| Solid card | `#FFFDFF` | `#211D22` |
| Primary text | `#241B24` | `#F7F1F6` |
| Secondary text | `#6E5B69` | `#C5B7C1` |

بقيت الأشكال الأساسية 28/16/999 والكبسولات 48/54. الزجاج للضوابط والتنقل، لا لبطاقات المحتوى أو QR أو الكاميرا، ولا rim مضاف فوق Glisse. أحمر مؤشرات الخطأ بقي `#FF3B30`؛ نصوص الخطأ بدرجات مشتقة أوضح للقراءة (`#BD283B` / `#FF8092`).

## التنفيذ

- **المظهر:** `prefers-color-scheme` فقط، مع theme-color متكيف لشريط المتصفح. أزيل ThemeButton والـ bootstrap اليدوي. المصدر: `public/design.css:1` و`app/layout.tsx:14`.
- **اللغة:** أول لغة مدعومة من `navigator.languages`؛ العربية والإنجليزية، ثم الإنجليزية fallback. SSR يستعمل Accept-Language وأوزان q. المصدر: `app/device-language.ts:4` و`app/device-language.ts:13`.
- **تغير اللغة:** `useSyncExternalStore` وlanguagechange وfocus وvisibilitychange. لا قراءة أو كتابة أو حذف للتفضيلات اليدوية السابقة. المصدر: `app/lang-provider.tsx:12`.
- **البيانات الوصفية:** العناوين والأوصاف وlang/dir وmanifest وHTML المشاركة المؤقت تتبع لغة الطلب. ملفات `app/route-metadata.ts` و`app/layout.tsx` و`app/manifest.ts` و`app/share/route.ts`.
- **Menu:** استيراد فعلي من glisse **0.5.0** في `app/app-menu.tsx:3`، بلا fork أو محاكاة CSS. morph وsprings وplate وscrubbing ولوحة المفاتيح واستعادة التركيز من المكتبة نفسها. الوجهات: History، Privacy، Offline.
- **تكييف Menu:** محاذاة RTL والخط والألوان وصفوف 44px وتوسيع هدف لمس الزر دون تغيير مظهره الأصلي، واحترام تقليل الشفافية. لا تغيير لمحرك الحركة. المصدر: `app/liquid-controls.css`.
- **الصفحات المستقلة:** لا AppHeader ولا BottomNav ولا footer. رأس من كبسولتين: Button بأيقونة X فقط مع اسم وصول غير مرئي، وGlass لاسم الصفحة. المحتوى والوظائف الحقيقية باقية. المصدر: `app/support-shell.tsx` و`app/support.css` و`app/app-shell.tsx`.
- **الرجوع:** سياق مؤقت يتذكر أصل التنقل؛ الرجوع إلى Scan أو Chat وفق الأصل، والزيارة المباشرة تعود إلى `/`. `app/support-navigation.tsx` و`app/app-shell.tsx`.
- **حذف الروابط السفلية:** أزيل footer، ونُقلت معلومات الشبكة الحقيقية إلى تفاصيل البث، دون اختراع حالة شبكة. `app/send-client.tsx`.

لم تتغير `lib/` أو `server/` أو `next.config.ts` أو الحزم وlockfile. لا تغيير للبروتوكولات أو QR أو WebRTC أو مخطط التخزين أو الأذونات. تعديل `/share` خاص باللغة المعروضة وليس معالجة الملفات. بقي BridgeClient مركّبًا أثناء زيارة الصفحات المستقلة، لكنه مخفي بصريًا.

## تحقق جديد على هذه النسخة

| الاختبار | النتيجة |
|---|---|
| Lint / production build / TypeScript | نجاح |
| وحدات المنطق | 76/76، تشمل 12 اختبارًا جديدًا للغة |
| طلبات HTTP فعلية | 19/19: الصفحات بلغتين و404 وmanifest وmultipart share |
| مصفوفة Mulberry/Menu | 16/16: Chromium/WebKit × 390/1280 × light/dark × ar/en |
| مصفوفة عدسات Glisse | 16/16 على المحركين والمقاسين واللغتين والمظهرين |
| انحدار وظائف التطبيق | 28 فحصًا ناجحًا |
| أخطاء pageerror المسجلة | صفر في الحزم السابقة |
| الصفحات الثلاث | كبسولتان في الرأس؛ لا chrome رئيسي ولا overflow؛ رجوع صحيح |
| تفضيلات يدوية قديمة معاكسة | تجاهلها التطبيق واستمر باتباع المتصفح |
| تغير المظهر أثناء التشغيل | ناجح بمحاكاة media preference في المتصفح |
| تغير اللغة أثناء التشغيل | ناجح باختبار محاكاة navigator.languages وlanguagechange؛ ليس هاتفًا فعليًا |

### Menu الأصلية

قيس عرض السطح في rAF أثناء الفتح والإغلاق: انتقل من حجم الزر إلى 200px ثم عكس ذلك عند Escape. السحب الحقيقي بمؤشر المتصفح أظهر data-pressed وdata-scrubbing وتمدد/ترجمة البطاقة؛ لم يحدث التنقل قبل الإفلات، ثم اختيرت Offline.

CDP touch اختار Privacy بالسحب والإفلات، وtouchCancel لم ينقّل. نجحت الأسهم وEscape واستعادة التركيز والنقر خارج القائمة. في reduced motion/transparency صار السطح ثابتًا بلا backdrop blur ولا content blur. الأدلة: `menu-motion.json` و`scripts/mulberry-menu-motion.mjs`.

### النقل الفعلي

متصفحان Chromium مستقلان وPeerServer محلي حقيقي على 9000، دون اعتراض شبكة أو PeerJS بديل أو كاميرا وهمية. ثلاث رسائل في كل اتجاه وملف عشوائي 700,000 بايت في كل اتجاه؛ SHA-256 للمصدر طابق البايتات التي نُزلت فعلًا.

أثناء عرض Privacy أرسل الطرف الآخر رسالة جديدة حقيقية، ووصلت إلى الجلسة المخفية ثم ظهرت بعد الخروج إلى Chat. الاتصال الحقيقي يضيف Chat ويختاره، والانفصال يعيد Pair. مسافة composer فوق التنقل 18px في الوضعين والمقاسين. صور QR الاقتران الأربع فُكّت إلى payload المطابق، مع بقاء خلفيته البيضاء.

اختُبرت الملفات/المجلدات والحدود والنص وpresets والحافظة وQR والتشفير والإيقاف والشاشة الكاملة وWeb Share مع IndexedDB. وُلّدت حزمة Offline ZIP ونُزلت؛ تشغيلها معزولة عن الإنترنت لم يُختبر. الأدلة: `app-audit.json` و`real-transport.json`.

## حدود الإثبات

- أتمتة Chromium/WebKit مكتبية، لا أجهزة iPhone/Android فعلية ولا تثبيت Safari فعليًا.
- تغير وضع الجهاز محاكى بواجهة المتصفح. تغير اللغة يعتمد على ما يكشفه المتصفح؛ قد تتطلب بعض المتصفحات إعادة فتح الصفحة بعد تغيير إعداداتها.
- اللغتان المترجمتان العربية والإنجليزية فقط. manifest المثبّت قد لا يحدّث الاسم فورًا، ولون splash الافتراضي فاتح، بينما الصفحة نفسها تتبع النظام.
- انكسار خلفيات SVG الكامل في Glisse خاص بـ Chromium؛ WebKit يحتفظ بالتعتيم والحافة وعدسة النص المدعومة. لا نزعم تماثل المؤثرات الكامل.
- الكاميرا الفعلية وقراءة QR بين شاشة وعدسة وtorch/WakeLock على عتاد وWAN/NAT/TURN والعمل المعزول بالكامل غير مختبرة.
- خطأ غياب الكاميرا ومسار `/tv` المفقود مسبقًا موثقان كما هما؛ لم تُختلق تجربة ناجحة لهما.
- قياسات التباين أدناه ليست شهادة WCAG شاملة. قياس الأداء محلي، وليس ضمان أداء هاتف.
- لم يحدث رفع/نشر جديد أو فحص أمني شامل جديد. التبعيات لم تتغير.

## إعادة التحقق

الأدلة المنتقاة في `docs/mulberry-evidence/` والكاملة في `/home/user/mulberry-evidence/`. توجد أربع screenshots منتقاة، دون نشر أكواد اقتران الاختبار.

يتطلب Node >=22.13 وتبعيات المشروع ومتصفحات Playwright وproduction server على 3000 وPeerServer على 9000. حزمة الانحدار القديمة تستخدم أيضًا المرجع الأصلي `/home/user/uploads/qrferry-redesign.html` للمقارنة فقط، ولا يزوّد التطبيق الحقيقي بأي حالة.

```sh
npm run lint
npm run build
node --import tsx --test tests/*.test.ts
node --test tests/rendered-html.test.mjs
EVIDENCE_DIR=/home/user/mulberry-evidence node scripts/mulberry-audit.mjs
EVIDENCE_DIR=/home/user/mulberry-evidence node scripts/mulberry-menu-motion.mjs
EVIDENCE_DIR=/home/user/mulberry-evidence node scripts/glisse-audit.mjs
EVIDENCE_DIR=/home/user/mulberry-evidence node scripts/design-app-audit.mjs
EVIDENCE_DIR=/home/user/mulberry-evidence node scripts/design-real-transport.mjs
```

اختبارات الوحدات التي تستخدم test doubles، ومدخلات اللمس المحاكية، ليست دليلًا على كاميرا أو شبكة فعلية؛ دليل النقل الحقيقي منفصل في `real-transport.json`.

## القياسات الأخيرة

| الاتجاه | البايتات | الزمن المحلي | SHA-256 للمصدر والتنزيل |
|---|---:|---:|---|
| host-to-guest | 700,000 | 542 ms | `a408721691499dcb2cd51ffae5af16b073d5addff8c777cf233b13be5d692513` |
| guest-to-host | 700,000 | 689 ms | `aa3fcbd2f34ec869ee141522d9cf13079453e0f7e09d4b7c7718c7b2ef37c57e` |

| المظهر | الزوج المقاس | التباين |
|---|---|---:|
| light | on-accent / accent | 7.06:1 |
| light | secondary / card | 6.17:1 |
| light | error / card | 5.88:1 |
| light | actual filled control | 7.06:1 |
| dark | on-accent / accent | 7.42:1 |
| dark | secondary / card | 8.64:1 |
| dark | error / card | 6.93:1 |
| dark | actual filled control | 7.42:1 |

عينة عدسات Glisse المحلية: 120 إطارًا، p50=16.7ms، p95=33.3ms، وفجوات أكبر من 50ms: 0.
