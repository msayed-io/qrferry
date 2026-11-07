# QRFerry × Glisse — التنفيذ والتحقق

2026-11-07 · التحديث التالي لـ`e41ce4c` · المرجع الجديد المطلوب: [Glisse](https://glisse.kelvinzhang.ca/) / [المصدر](https://github.com/0kzh/glisse) / [npm](https://www.npmjs.com/package/glisse).

## النتيجة التنفيذية
- ثُبّتت **glisse@0.5.0 بالضبط**، واستخدمت مكوّناتها ومحرك العدسات/الـ springs الحقيقيين، دون fork أو تعديل node_modules أو عدسة CSS بديلة.
- أُدمج TabBar في التنقل الحقيقي، SegmentedControl في ملف/نص، Button في الكبسولات والدوائر، و Glass في رأس المحادثة ومدخلها. البطاقات و QR والكاميرا بقيت صلبة.
- اجتازت 16 حالة Chromium/WebKit ×390/1280 ×فاتح/داكن ×عربي/إنجليزي. لا pageerrors ولا overflow في هذه الحالات. هذه ليست شهادة تطابق 100% لكل جهاز.
- نجح البناء و Lint و 64 اختبار وحدة و 8 اختبارات HTTP ، ونقل الرسائل والملفات الحقيقي و QR بعد التحديث.
- انكسار الخلفية الحية الكامل Chromium-only ؛ WebKit اختُبر فعليًا ويحتفظ بزجاج blur/rim وعدسة النصوص. iPhone/Safari الحقيقي وأجهزة Android الضعيفة غير مُختبرة.

## 1. ما تم بحثه وتنزيله
قرئت README ووثائق الاستخدام، وأنواع API ، ومصادر TabBar/SegmentedControl/Button/Glass ، ومحركات segments/spring/press/refraction/lens ، و CSS. نسخة البحث من المستودع: `46be5ba07b60eb507e887ff338ded7840576a79f`. نسخة التنفيذ هي **حزمة npm المنشورة** لا ملفات المصدر المستنسخة. مجلد البحث المحلي `/home/user/glisse-reference` منفصل عن التطبيق.

- الرخصة MIT ؛ الحزمة بلا runtime dependencies وتطلب React/ReactDOM≥18 ؛ التطبيق 19.2.6.
- package-lock يثبت سلامة tarball: `sha512-FVL7wBj6JS9hx7FrikqLGiJojy4RX1sIRlBSUDZW/3f9+LwILqX9hsILHPgi54PsKSfHFL+C4k6YB411f0mJhA==`.
- إضافة حزمة واحدة فقط. لم تتغير lib/server/next.config ، ولا بروتوكولات/أذونات/قواعد بيانات الملفات.
- npm على نظام الأدوات كان Node 20 وأصدر تحذير engines ؛ build/TypeScript والاختبارات الوحدية نُفذت على Node 22 كما يتطلب المشروع، ونجحت.
- استيراد CSS الرسمي صراحة للـ SSR قبل CSS التطبيق، مع auto-insertion الذي توفره المكتبة للمتصفح: `app/layout.tsx:3`.

## 2. جدول الدمج الفعلي
| مكوّن المكتبة | استخدامه في QRFerry | الربط |
|---|---|---|
| TabBar | Send/Scan/Pair و Chat عند اتصال حقيقي فقط؛ النقر والسحب ولوحة المفاتيح تصل إلى نفس routes والجلسة | `app/app-shell.tsx:69` |
| SegmentedControl | اختيار الملف/النص؛ الحقول الحقيقية لا أمثلة تجريبية | `app/send-client.tsx:1197` |
| Button |26 موضع زر في Send ، 11 في Scan ، حوار مشترك، 3 أزرار History ، زر Offline ، وكل Capsule/CircleButton المشترك | `app/liquid-controls.tsx:8`؛ `app/design-system.tsx:17` |
| Glass | رأس Chat ومدخل الرسالة متعددة الأسطر؛ لا nested glass على المدخل | `app/bridge/bridge-client.tsx:808`؛ `app/bridge/bridge-client.tsx:818` |
| Switch | دُرس؛ لم يُستبدل لأن المطلوب لا يستلزم إعادة تركيب سويتشات الخصوصية الوظيفية في هذه الدفعة | لا ميزة أو إعداد جديد |
| Input/SearchField | دُرسا؛ لم يُخترع بحث، ومدخل Chat textarea حقيقي داخل Glass بدل استبداله بـ input أحادي السطر | الحفاظ على السلوك الموجود |
| Slider/Menu | دُرسا؛ لا تحكم جديد بلا وظيفة موجودة كي نستعرض المكتبة | غير مضافين عمدًا |

## 3. الإعدادات الدقيقة
### العدسة والحركة الأصلية
استُخدمت افتراضات Glisse بلا تضخيم يدوي أو مؤقت نجاح:
- TabBar ذي الأيقونات: slot72px ، height52px ، inset4px ، lift growX24px/growY16px.
- عدسة النصوص: strength0.2 ، dispersion2 ، depth4 ، blur2 كما محرك المكتبة؛ هي التي تنتج الانكسار، وليس CSS تزيينيًا.
- SegmentedControl: bend0.3/dispersion0.1 ، مع height44px لهدف لمس واضح وعرض حاويته موزع بالتساوي.
- Glass: bend0.45/dispersion0.4 ، blur3px الافتراضي؛ رسم rim وحسابضوئه من المكتبة.
- springs الأصلية: REST=(1024,58.9,676,47.8)، DRAG=(2500,94,576,44.2). لم تُستبدل بانتقال CSS بطيء.
- نطاق الألوان المخصصة فقط: --lg-fill=--tint ، --lg-on=--ok ، --lg-ring=--tint ؛ تبقى هوية المنتج، مع خامة Glisse الأصلية.

هذه قيم المصدر/API وليست ادعاءً أن كل هذه الخصائص CSS variables. knobs المدعومة تُقرأ في المكتبة؛ لم تُضاف خصائص وهمية. سجل حالة الضغط المستمر يتضمن scaleX/scaleY و filterURL فعليًا لكل حالة؛ الاختبار يشترط scaleX بين 1.31 و 1.36 و scaleY>1.29 مع lensing حقيقي.

### RTL دون كسر العدسة
المكتبة تقيس x/slots ابتداءً من اليسار. قلب direction مباشرة كان سيجعل العدسة تلاحق العنصر الخطأ، لذلك:
1. يعكس adapter ترتيب العناصر للعربية، ويحتفظ بمحور العدسة `dir=ltr`.
2. نص كل label نفسه `dir=rtl` عند العربية؛ Send ظاهر أقصى اليمين لا أقصى اليسار.
3. ArrowLeft/Right يتبعان الموضع الفيزيائي الأصلي. Home/End يعاد ربطهما بالترتيب المنطقي الأول/الأخير للعربية.
4. يضيف adapter فقط id و aria-controls لأن item API لا يوفرهما. لا يعيد كتابة pointer capture أو اختيار المكتبة أو العدسة.
5. المكوّن controlled بقيمة المسار/المحتوى الحقيقي. الإفلات يختار؛ الضغطة الملغاة بالخارج لا تختار.

المصدر: `app/liquid-controls.tsx:43`.

### عدم تكديس الخامات
LiquidButton يزيل أصناف `.glass/.cap/.circle/.tinted` القديمة من الزر قبل رسمه بالمكتبة، ويستبدلها بأصناف sizing فقط. لا حلقتان ولا blur مضاعف فوق نفس الزر. الـ rim القديم يبقى للأسطح التي لم تُستبدل، مثل الروابط الثانوية؛ قواعده الأصلية لم تُعدل.

لم تُضف `data-glisse-backdrop` على الصفحة أو QR أو الفيديو. المكتبة لا ترشح محتوى QR أو الكاميرا لدينا. الطبقة الصلبة ليست نسخة زخرفية؛ الملف والرمز وأزرارها ما زالت المكونات الحقيقية. المصدر: `app/liquid-controls.css:3` و`app/liquid-controls.tsx:8`.

### تغييرات مقصودة عن المرجع القديم
طلب Glisse الجديد يغيّر خامة وحافة الأدوات التي استُبدلت؛ لا يمكن الادعاء أنها في نفس الوقت rim HTML القديم و rim Glisse نفسه. اخترنا **المكتبة نفسها** للأدوات الجديدة بلا طبقة من الحافة القديمة.

شريط Glisse يستخدم أيقونة فوق label في كل slot متساوٍ، مع بقاء كل التسميات على المحمول؛ لم نستخدم تغيير عرض التبويب المختار الذي يكسر حساباته. الارتفاع 60px بدل 62px ؛ الفراغ بين composer والتنقل صار 18px بدل 16px واختُبر في الحالات الأربع المتصلة. الكبسولات تحتفظ 48/54px والدوائر 44/46px. لا تغيير لبنية البطاقات أو رموز QR أو تدفقات النقل.

## 4. التحقق المنفذ
الأدلة الخام في `docs/glisse-evidence/`. صور rest/held لكل حالة موجودة محليًا في `/home/user/glisse-evidence/`، والفيديو الحقيقي `/home/user/QRFerry-Glisse.webm`، وليس فيديو تصميم مُولّدًا.

| فحص | نتيجة |
|---|---|
| Build + TypeScript / ESLint | ناجحان؛ build.log/lint.log |
| وحدات المنطق |64/64 ؛ بعض الوحدات تستعمل test doubles ، ولا نعدها اتصالًا فعليًا |
| HTTP SSR |8/8 على Next الإنتاجي |
| Chromium + WebKit |16/16 حالة؛ صفر pageerrors/overflow |
| hold/drag | lens و SVG filter يعملان؛ لا اختيار قبل الإفلات؛ يُفتح/scan بعد السحب إليه |
| RTL/LTR | ترتيب فيزيائي صحيح، لغة النص محفوظة، Home/End صحيحان |
| الملف/النص | native radiogroup ؛ اختيار حقيقي للنص ثم رجوع للملف |
| إلغاء الضغط |الإفلات خارج الشريط بلا سحب أفقي لا يغيّر المسار |
| مساحة النقر |كل عينات tabs وأزرار Glisse الظاهرة في Send≥44px ؛ ليسمسحًا لكلحالة التطبيق |
| touch |Native CDP touch drag اختار Pair ؛ محاكاة أحداث الجهاز وليس هاتفًا ماديًا |
| reduced-motion |محرك المكتبة يستقر مباشرة؛ button scale=1/translate=none في الاختبار |
| reduced-transparency |كل lg-glass الظاهرة بلا backdrop أو background-image ؛ النص الأصلي يظل ظاهرًا والعدسة منزوعة بصريًا |
| المحتوى الصلب |card/QR/dropzone بلا filter أو backdrop ؛ لا `.lg-glass.glass` في الشريط |
| WebRTC الحقيقي |عمليتا Chromium مستقلتان و PeerServer حقيقي؛ 3 رسائل/اتجاه و 700000B/اتجاه مع SHA مطابق |
| دورة الجلسة |Chat شرطي؛ فتحه على نجاح حقيقي؛ التنقل يحفظ الجلسة؛الفصل من كل طرف يخفي Chat ويعيد Pair |
| QR |رمزربط 4 حالات؛ QF4 الفاتح/الداكن؛ QFPW ؛فكمن canvas المعروض بالفعل |
| الوظائف الإضافية |ملفات/مجلد/رفض 4 وقبول 3/حذف/نص/تشغيل/إيقاف/fullscreen/clipboard/profile حفظثم reload وحذف/share→IndexedDB |
| offline |ZIP حقيقي؛التشغيل منعزلًا بلا شبكة غير مُختبر؛ عيب/tv السابق باقٍ |

### ملفات النقل الفعلية
- host-to-guest: 700000B في 615ms ؛ المصدر=التنزيل `68c6f7572801a11f7a3d49f7c2194819c1dde83b2d0172d2061a3ad9d82c2cc4`.
- guest-to-host: 700000B في 577ms ؛ المصدر=التنزيل `6896b2ffefced6ff646856b92c3cdff71ac1a9801492b1697b319142cb927349`.

### الأداء المقاس — لا ضمان لكل الأجهزة
- أثناء سحب العدسة: 120 rAF ؛ p50=16.7ms و p95=16.8ms ؛ فواصل>50ms=0 ؛ بعد الإفلات استقر transform و lift=0.
- تحميل محلي: DOMContentLoaded=52.0ms ، load=176.8ms ، script transfer=219299B.
- تمرير الصفحة:119 إطارًا؛ p95=16.8ms ؛فواصل>50ms=0.
- ZIP الحالي 434839B و 39 ملفًا، يشمل أصول البناء الجديدة.
- الأرقام من Chromium headless محلي، ليست FPS مضمونًا لهاتف ضعيف أومتصفححقيقي يعملعلىبطارية. لم تُجرمقارنة بكسلية شاملة مع فيديو Instagram.

## 5. القيود والمخاطر
- Chromium وحده يطبق SVG displacement على live backdrop ، كما تنص مصادر المكتبة. WebKit اختُبر، والـ label lens يعملبـ SVG filter بينما الخلفية blur/rim ؛ لا نسميه نفس انكسار الخلفية 100%.
- كاميرا وشاشة جهازين ماديين، iPhone/Safari/Android فعلي، WAN/NAT/TURN ، WakeLock/torch/permission-on-hardware: **غير مُختبر**. لا كاميرا وهمية ضمن نجاحات النقل.
- تباين كل النصوص عبر كل حالات الخلفية لم يُعَد اعتماده؛ القيود الموثقة سابقًا في palette باقية. فحص 44px لا يعني شهادة WCAG.
- `npm audit` وجد 15 تنبيهًا(10moderate/4high/1critical) **قبل وبعد** إضافة المكتبة؛ لا advisory خاصبـ Glisse ولا entry جديد. لم أطبّق`audit fix --force` لأنه قد يغير framework/بروتوكولاتخارجنطاق الطلب. تلزم متابعة أمنية منفصلة للتبعيات الأصلية.
- المكتبة 0.x ؛ التثبيت exact يمنع تغيير سلوك العدسة دون مراجعة. SVG filters و canvas maps تتأثر بإمكانات GPU والمتصفح؛لا وعد بـ 100%تطابق على كل جهاز.
- التقريرالقديم`REDESIGN-REPORT.md` ومقارنات HTML القديمةتخصمرحلةماقبل Glisse ؛ لا يجب قراءتها كأن التنقل ما زال مطابقًا لذلك المرجع بعد طلب المكتبة الجديد.

## 6. إعادة التحقق
```bash
# Node >=22.13
npm ci
npm run lint
npm run build
node --import tsx --test tests/*.test.ts
# عملية منفصلة: npm run start -- --hostname 0.0.0.0
# signaling للاختبار فقط: node node_modules/peer/dist/bin/peerjs.js --port 9000 --host 0.0.0.0 --path /
node --test tests/rendered-html.test.mjs
EVIDENCE_DIR=/path/to/evidence node scripts/glisse-audit.mjs
EVIDENCE_DIR=/path/to/evidence node scripts/design-real-transport.mjs
EVIDENCE_DIR=/path/to/evidence node scripts/design-app-audit.mjs
```
يتطلب Playwright Chromium/WebKit ومتطلبات نظامهما. سكربتالنقلمازاليقرأ HTML القديملمقارنةالفقاعات؛ ليستفروقمادةأزرار Glisse فشلنقل. ينفذ الاتصال وكل الملفات فعليًا ولا ينتظر مؤقت نجاح.

## 7. حالة التسليم
سيتم تسجيل معرّف commit ونتيجة push وتطابق remote وحالة Vercel في `/home/user/glisse-evidence/delivery-status.json` بعد التنفيذ. بناءمحليأو commit ليسرفعًا. لا يُحفظ التوكن في المستودع أو إعداداته.
