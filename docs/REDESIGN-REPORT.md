# QRFerry — تقرير تنفيذ التصميم والتحقق النهائي
التاريخ: 2026-11-07 · الأساس: `cd8f2b60184c655e02a1c6de99efcc66c0b08d9b` · المستودع: `msayed-io/qrferry`.
## ملخص تنفيذي — خمس نقاط
- نُفّذ التصميم على تطبيق Next الحقيقي، وليس نسخة mockup مستقلة؛ البناء وLint و64 اختبار وحدة و8 اختبارات HTTP SSR ناجحة.
- مقارنة 12 حالة Send/Scan/Pair: صفر فروق في الخصائص والهندسة المقاسة لـ72 عينة مكوّن؛ ليست نسبة تطابق بكسلية شاملة. Chat مطابق في الخصائص المقاسة عدا ارتفاع صف التوقيت الحقيقي.
- اتصال WebRTC حقيقي بين عمليتَي Chromium: 3 رسائل وملف 700000 بايت في كل اتجاه، مع تطابق SHA-256 وفصل من الطرفين؛ فك QR المعروض نجح في الفاتح والداكن.
- حلقة الحافة تطابق المرجع عند 1×/2×/3×؛ تقليل الحركة والشفافية ناجح. بعض ألوان المرجع المقفلة تفشل تباين 4.5:1؛ الكاميرا الفعلية وWAN غير مُختبرين.
- الرفع ليس نجاحًا محليًا: فحص Git رفض الرفع لغياب المصادقة. لا يوجد نشر جديد مؤكد؛ التنفيذ والقياسات والتقرير متاحة محليًا، ومحاولة push الفعلية تُسجّل منفصلة.

## 1. حدود العمل والقرارات
المصدران البصريان الوحيدان: `/home/user/uploads/qrferry-redesign.html` و`/home/user/uploads/QRFerry-DESIGN-SYSTEM.md`. تم قراءة المرجعين كاملين. أرقام HTML أدناه تخص الملف المرجعي، وأرقام ملفات التطبيق تخص النسخة المنفذة. مجلد الأدلة المحلي: `/home/user/qrferry-redesign-evidence/`. نسخة القياسات النصية داخل المستودع: `docs/design-evidence/`.
لم تتغير `lib/` أو `server/` أو صيغ QR أو المصادقة أو البروتوكولات أو تخزين الملفات أو `package.json`/lock/config. الدليل: `source-audit.json`، قيمة `protectedDiff` فارغة. لم تُضف مكتبة تطبيق. أدوات التحقق تستخدم تبعيات المشروع الموجودة؛ ثُبت Chromium ومتطلبات نظامه للتشغيل فقط.
تعارض المرجعين في dark glass حُسم لصالح HTML المطلوب مطابقته: `rgba(60,62,68,.34)`، بينما Markdown يذكر `rgba(72,72,76,.5)`. لا ادعاء بإمكان تحقيق القيمتين معًا. التباين لم يُعالج بتغيير الألوان المقفلة خفية.

## 2. استخلاص النظام وتصنيف JavaScript المرجع
| مجموعة | القيم المستخلصة والمنفذة | المصدر التنفيذي |
|---|---|---|
| الألوان الفاتحة | bg #F2F2F7؛ card #fff؛ label #000؛ label2 rgba(60,60,67,.62)؛ label3 .3؛ tint #007AFF؛ ok #34C759 | `public/design.css:4` |
| الألوان الداكنة | bg #000؛ card #1C1C1E؛ label #fff؛ label2 rgba(235,235,245,.62)؛ label3 .3؛ tint #0A84FF؛ ok #30D158 | `public/design.css:12` |
| الخامات | sep/fill/hair/shadow/spec/glow كما HTML؛ glass للأدوات فقط؛ محتوى البطاقات/الكاميرا/QR صلب | `public/design.css:31` |
| الحافة | 1px mask؛ ضوء 135deg ثابت؛ مصدر alpha .60/.34/base .06؛ falloff 48/36px؛ --o=.4142×radius | `public/design.css:34` |
| الأبعاد | بطاقة 28px؛ داخلية 16px؛ كبسولة 999px بارتفاع48/54؛ دوائر40–46؛ مسافات8/10/16 | `public/design.css:8` |
| الخط | SF Arabic/SF Pro/system fallback؛ عناوين34/800 و21/700؛ جسم17؛ أزرار15–17؛ أرقام tabular-nums | `public/design.css:9` |
| التخطيط | عمود max560؛ عند900px عمودان max1040؛ نافذة900px ارتفاعًا في المقارنات | `public/design.css:61` |
| الحركة | 350–450ms cubic-bezier(.32,.72,0,1)؛ صعود10px مع fade؛ إيقاف عند reduced-motion | `public/design.css:69` |
`setO()` وكتلة `.glass::after` منقولتان حرفيًا: `source-audit.json` يسجّل `setOVerbatim=true` و`rimVerbatim=true`. مراقبة React الجديدة تحيط بالدالة ولا تغيّر معادلتها: `app/rim.ts:6`.

| JavaScript المرجعي | التصنيف | ما استُخدم فعليًا |
|---|---|---|
| HTML:319 | UI فقط | الهيئة والاختيار؛ رُبطت بتبويب الملف/النص الحقيقي ولوحة المفاتيح. |
| HTML:320 | هيئة UI؛ التبديل الأصلي غير وظيفي | سويتشات التشفير والحذف بعد القراءة والتوقيع والبث الموجودة فعلًا؛ لا حذف بعد الإرسال مستحدث. |
| HTML:321 | UI فقط | ثيم حقيقي مع النظام وdata-theme وحفظ الاختيار. |
| HTML:325 | UI فقط | نسخ حرفي + ResizeObserver/MutationObserver للتركيب الديناميكي. |
| HTML:331 | UI فقط | المظهر فقط؛ التنقل Next routes والحالة المشتركة بدل إخفاء صفحات وهمية. |
| HTML:334 | محاكاة ممنوعة | لم يُنقل؛ encoder QR الأصلي يرسم البايتات الحقيقية. |
| HTML:338 | مختلط: بناء واجهة + نجاح مؤقت وهمي | أُخذ تصميم المرحلة فقط؛ انتظار اتصال/كاميرا/مصادقة حقيقية، بلا مؤقت نجاح. |
| HTML:343 | مختلط | الإلغاء الحقيقي يحرر موارد الاتصال/الكاميرا ويُبطل الجلسة السابقة. |
| HTML:344 | تحقق mock سطحي | decodeBridgePairing الحقيقي؛ النص غير الفارغ وحده لا يكفي. |
| HTML:345 | محاكاة اتصال بعد1400ms | connectWith/joinBridge الحقيقيان. |
| HTML:346 | بناء DOM توضيحي | React يعرض عناصر الجلسة الفعلية مع معرّفات واتجاه وتوقيت. |
| HTML:347 | محاكاة اتصال ورسالة جاهزة | callbacks الاتصال الحقيقي فقط تُظهر Chat؛ لا رسالة افتتاحية مصطنعة. |
| HTML:350 | واجهة قطع وهمية | destroy/release الفعليان مع إخفاء Chat والرجوع Pair. |
| HTML:352 | رسالة محلية ورد تلقائي وtyping وهمي | sendChat وonChat وonTyping من البروتوكول الموجود. |
| HTML:354 | UI فقط | Enter والحدود ومعالجة textarea الأصلية. |
| HTML:355 | ملف وتقدم مؤقتان وهميان | اختيار ملف فعلي، تقدم البايتات، تنزيل ومقارنة hash؛ لا IMG جاهز. |

## 3. المعمارية وملكية الحالة
- Shell واحد يرسم الرأس والتنقل ويحتفظ بمالك جلسة Bridge عبر التبويبات. Chat يظهر عند اتصال حقيقي فقط؛ الانتقال الحقيقي يفتح Chat ولو المستخدم بصفحة أخرى، والفصل يعيد Pair. `app/app-shell.tsx:14`
- مكونات مشتركة: Capsule وCircleButton وCard وCameraCorners وThemeButton؛ NetworkStatus لا يزعم أن الطرفين على نفس Wi-Fi. `app/design-system.tsx:16`
- أيقونات المرجع بالمسارات الأصلية، وبقية أيقونات الميزات الموجودة بوزن1.7. `app/design-icons.tsx:24`
- الثيم محفوظ بمفتاح تفضيل qrferry-theme؛ اللغة عبر LangProvider ومفتاحها القديم. لا تغيير في قواعد بيانات نقل الملفات. `app/layout.tsx:67`
- قائمة الجلسة تحدث بالمعرّف والاتجاه والنوع؛ إصلاح خطأ واجهة كان يستبدل رسائل سابقة. بروتوكول الرسائل نفسه لم يتغير. `app/bridge/bridge-client.tsx:85`
- المؤلف داخل portal إلى body حتى لا يحوله transform حركة الصفحة إلى fixed داخل الحاوية؛ مخفي خارج مساري Bridge/PC. `app/bridge/bridge-client.tsx:813`
- Disclosures تحتفظ بالحقول مركبة؛ الحوار يحبس التركيز ويستعيده ويدعم Escape. `app/workspace-ui.tsx:11`

## 4. جرد المسارات والحالات الحقيقية
| المسار/السطح | الحالات والقدرات المحفوظة | التنفيذ |
|---|---|---|
| / | فارغ؛ ملفات/مجلد/سحب؛ إضافة/استبدال/حذف؛ حدود3 و512MiB؛ نص؛ تجهيز/خطأ؛ بث/إيقاف/ملء الشاشة؛ الحافظة؛ تشفير/حذف بعد القراءة/توقيع/بث جماعي؛ profiles مدمجة ومخصصة؛ QR كلمة المرور والمفتاح العام؛ نافذة النقل السريع idle/scanning/connecting/transferring/done/error. | `app/send-client.tsx:132` |
| /scan | idle؛ تشغيل/إيقاف/فشل الكاميرا؛ اختيار جهاز/torch حسب الدعم؛ single/dual وfast؛ إطارات فعلية/تقدم/تشخيص؛ اكتمال وتنزيل فردي/ZIP؛ كلمة مرور؛ مراجعة توقيع؛ استئناف؛ حفظ السجل وwake lock حسب الدعم. | `app/scan/scanner-client.tsx:129` |
| /bridge و/pc | home/hosting/scanning/connecting/connected؛ بدء/انتظار/فشل/قفل؛ QR حقيقي؛ نسخ/لصق/URL autojoin؛ إلغاء/إعادة محاولة/تحرير؛ رسائل وملفات وtyping؛ previews وتنزيل؛ سجل جلسة بعد الفصل. | `app/bridge/bridge-client.tsx:154` |
| /history | تحميل/فارغ/قائمة؛ بيانات الأسماء والأحجام والتوقيت وحالة التشفير والتوقيع والتحقق؛ تأكيد مسح ثم إعادة قراءة التخزين. | `app/history/history-client.tsx:24` |
| /offline | idle/building/done/error؛ إنشاءZIP الحقيقي وعدد الملفات واسمه؛ إعادة محاولة بلا نجاح مؤقت. | `app/offline/offline-client.tsx:9` |
| /privacy | النص الحقيقي وسياسة الخصوصية والتنقل المشترك باللغتين. | `app/privacy/privacy-client.tsx:1` |
| /share POST | استقبال multipart؛ الحد الموجود؛ تخزين IndexedDB مؤقت ثم استلام Send؛ خطأ/ملف كبير/عودة. شكل الصفحة المؤقتة فقط تغير؛ نصها المؤقت العربي القديم باقٍ. | `app/share/route.ts:65` |
| 404 | عرض جديد لمعالج Next الموجود؛ ليس مسار ميزة جديدًا. /tv ما زال404 كما الأساس. | `app/not-found.tsx:7` |
| global-error | سطح خطأ صلب، retry الأصلي، استعادة ثيم/لغة؛ crash فعلي غير مُختبر. | `app/global-error.tsx:19` |
| PWA/هوية | manifest وfavicon و192/512/maskable وOG من شعار المرجع؛ تسجيل service worker ومنطق التثبيت كما كان. | `app/manifest.ts:3` |

## 5. جدول الربط الكامل لعناصر المرجع
«موجود» يعني قدرة موجودة قبل التصميم؛ «عرض» يعني تنظيم/مكوّن بصري فقط. لا يعني كل صف أنه تحقق على كاميرا فعلية. تفاصيل التشغيل وحدوده في القسم7.
| عنصر المرجع | المرجع | الربط التنفيذي (ملف:سطر) | مصدر الحالة/السلوك |
|---|---|---|---|
| الشعار والرأس | HTML:193 | `app/app-shell.tsx:58` | عرض؛ نفس مسارات الشعار |
| زر المظهر | HTML:198 | `app/design-system.tsx:42` | data-theme/system/localStorage |
| EN | HTML:199 | `app/app-shell.tsx:63` | LangProvider الحقيقي |
| الأيقونات | HTML:180 | `app/design-icons.tsx:24` | SVG المرجع؛ currentColor و1.7 |
| حافة الزجاج | HTML:325 | `app/rim.ts:3` | عرض؛ القياس من نصف القطر الفعلي |
| تبويبات أسفل الشاشة | HTML:309 | `app/app-shell.tsx:76` | المسارات الفعلية وconnected |
| Chat الشرطي | HTML:313 | `app/app-shell.tsx:40` | يُضاف عند نجاح البروتوكول فقط |
| العنوان والوصف Send | HTML:204 | `app/send-client.tsx:1140` | عرض وترجمة حقيقية |
| الحدود 3/512MB | HTML:210 | `app/send-client.tsx:1167` | ثوابت lib/file-selection وoptical-transfer |
| File/Text | HTML:211 | `app/send-client.tsx:1195` | tab الحقيقي؛ لوحة مفاتيح/tabpanel |
| إسقاط الملفات | HTML:212 | `app/send-client.tsx:951` | FileList وprepareFiles الموجودان |
| تصفح الملفات | HTML:216 | `app/send-client.tsx:932` | inputRef → ملفات فعلية |
| اختيار مجلد | HTML:217 | `app/send-client.tsx:942` | webkitdirectory الحقيقي |
| نقل سريع | HTML:221 | `app/send-client.tsx:1898` | النافذة/handlers الموجودة؛ /tv غير موجود أساسًا |
| ملاحظة Wi-Fi | HTML:222 | `app/design-system.tsx:28` | navigator.onLine فقط؛ لا تأكيد LAN أو peer |
| الخصوصية | HTML:225 | `app/send-client.tsx:1391` | WorkspaceDisclosure |
| كلمة المرور | HTML:226 | `app/send-client.tsx:523` | التشفير الموجود؛ ليس toggle وهميًا |
| الحذف | HTML:227 | `app/send-client.tsx:539` | حذف بعد القراءة الموجود بدل اختراع حذف بعد الإرسال |
| موضع QR الفارغ | HTML:236 | `app/send-client.tsx:1567` | عرض hint؛ لا كود مزيف قابل للتقديم كرمز |
| QR الفعلي | HTML:234 | `app/send-client.tsx:551` | renderRawQr/الترميز الأصلي دون تغيير وحداته |
| ملء الشاشة | HTML:237 | `app/send-client.tsx:982` | Fullscreen API الحقيقي؛ شريط56px خارج الرمز |
| حالة البث ونسبته | HTML:239 | `app/send-client.tsx:1129` | transfer وعداد الإطارات؛ الصفر حالة فارغة لا تقدم مصطنع |
| نسخ رابط الماسح | HTML:241 | `app/send-client.tsx:972` | clipboard الحقيقي |
| ضبط البث | HTML:243 | `app/send-client.tsx:515` | profiles الستة الأصلية + المخصص |
| تفاصيل الإطارات | HTML:245 | `app/send-client.tsx:1855` | transfer وactualFps وnominalRate |
| كاميرا Scan | HTML:253 | `app/scan/scanner-client.tsx:1189` | video/stream الحقيقيان |
| زوايا المعاينة | HTML:259 | `app/design-system.tsx:25` | عرض فقط |
| تشغيل الكاميرا | HTML:260 | `app/scan/scanner-client.tsx:892` | getUserMedia والأذونات/الأخطاء الموجودة |
| إعدادات الكاميرا | HTML:261 | `app/scan/scanner-client.tsx:882` | enumerateDevices/torch/mode الموجود |
| حالة ونسبة الاستقبال | HTML:265 | `app/scan/scanner-client.tsx:1334` | state/progress من decoder |
| التفاصيل التقنية | HTML:269 | `app/scan/scanner-client.tsx:1117` | أرقام الإطارات والفك الفعلية |
| Pair العنوان والبطاقات | HTML:276 | `app/bridge/bridge-client.tsx:763` | عرض + حالات الجلسة الأصلية |
| إنشاء رمز الربط | HTML:282 | `app/bridge/bridge-client.tsx:327` | createBridgeHost/encodeBridgePairing/QR الحقيقي |
| انتظار/إلغاء QR | HTML:338 | `app/bridge/bridge-client.tsx:784` | hostState الحقيقي؛ cancel يدمر الموارد |
| مسح رمز الربط | HTML:285 | `app/bridge/bridge-client.tsx:509` | الكاميرا وdecoder الحقيقيان؛ لا fake camera |
| خط المسح | HTML:340 | `app/bridge/bridge-client.tsx:795` | لا خط متحرك قبل تشغيل stream |
| حقل الرابط | HTML:287 | `app/bridge/bridge-client.tsx:727` | decodeBridgePairing؛ aria-invalid/disabled |
| اتصل | HTML:288 | `app/bridge/bridge-client.tsx:384` | joinBridge والتحقق الحقيقيان |
| إلغاء | HTML:343 | `app/bridge/bridge-client.tsx:221` | stopCamera/destroy/generation invalidation |
| فشل/إعادة محاولة | HTML:338 | `app/bridge/bridge-client.tsx:728` | حالة موجودة بتصميم مشتق؛ #FF3B30 |
| رأس Chat | HTML:296 | `app/bridge/bridge-client.tsx:807` | ready وrole الحقيقيان لا اسم جهاز مكتشف مصطنع |
| قطع الاتصال | HTML:298 | `app/bridge/bridge-client.tsx:411` | endSession وreleaseHandles |
| فقاعات الرسائل | HTML:346 | `app/bridge/bridge-client.tsx:184` | items/اتجاه/id/توقيت فعلي؛ لا canned replies |
| رسالة النظام | HTML:348 | `app/bridge/bridge-client.tsx:810` | تظهر داخل ready فقط |
| typing | HTML:353 | `app/bridge/bridge-client.tsx:300` | البروتوكول موجود؛ timeout انقضاء مؤشر لا رد وهمي |
| إرفاق ملف | HTML:355 | `app/bridge/bridge-client.tsx:595` | ملفات المستخدم الفعلية |
| تقدم الملف | HTML:355 | `app/bridge/bridge-client.tsx:746` | item.progress/size/status الفعلية |
| composer input | HTML:303 | `app/bridge/bridge-client.tsx:813` | 3 عناصر منفصلة؛ textarea/draft/limit الأصلي |
| إرسال/Enter | HTML:352 | `app/bridge/bridge-client.tsx:553` | activeRef.sendChat؛ بلا reply timer |

## 6. الأسطح المشتقة والانحرافات الضرورية
- قوائم الملفات الفعلية، نص الإرسال، إضافة/حذف الملفات، إعدادات التشفير والتوقيع والبث، QR كلمة المرور/المفتاح، profiles المخصصة، حوارات النقل السريع، password/signature prompts، نتائج الاستقبال وتنزيلZIP، تشخيص الكاميرا، history/offline/privacy/share/404/global-error: أعيد استخدام البطاقات الصلبة والكبسولات والصفوف hairline، ولم تُختلق ميزة جديدة بدلها. مصادرها في جرد المسارات.
- QR ممتلئ: أضيف شريط تحكم صلب56px أسفل الرمز لأن اختبار ZXing الفعلي كشف أن زر ملء الشاشة يغطي finder. الفراغ قبل وجود QR بقي مطابقًا؛ الترميز والـquiet zone لم يتغيرا. `app/workspace.css:98`.
- Chat: طوابع الوقت المطلوبة تزيد ارتفاع الفقاعة بنحو19.39px مقارنة بفقاعة المرجع بلا وقت. بقية الخصائص المقاسة مطابقة. أسماء الهاتف/الكمبيوتر تصف دور الطرف، لا اسم جهاز مكتشف. لا read receipts مستحدثة.
- composer نُقل خارج العنصر المتحرك لمنع transform من تغيير مرجع fixed؛ بعد الإصلاح قياس gap=16px في الحالات الأربع. روابط الصفحات الثانوية باقية لأن المرجع لا يغطيها.
- اللون الخافت/الأزرار المقفلة لا تحقق كل قيم4.5:1؛ لا يمكن وصف شرط التباين بأنه مجتاز. صفحة Share المؤقتة ما زالت عربية مثل الأساس؛ توحيد شكلها لا يساوي اكتمال ترجمتها.

## 7. نتائج التحقق — عشرة محاور
### 1) البناء وSSR وحدود التعديل
`build-final.log`: Next إنتاجي ناجح مع11 generated entries ونفس مجموعة المسارات. `lint-final.log`: ناجح. `unit-fixed.log`:64/64؛ `ssr-final.log`:8/8 عبر HTTP إلى السيرفر الحقيقي. الاختبارات الوحدية تتضمن test doubles؛ ليست بديلًا لاختبار الشبكة/الكاميرا الحقيقي. أصلح انتظار اختبار وحدة قديم كان يفحص حالة المرسل قبل وصول acknowledgement؛ المحاولتان الأوليان63/64 مسجلتان في `unit-final.log` و`unit-serial.log`؛ لم يُغيّر البروتوكول لإجبار الاختبار على المرور. `tests/bridge.test.ts:351`. استُبدل harness SSR قديم يعتمد Worker محذوف بطلبات Next حقيقية: `tests/rendered-html.test.mjs:1`.
### 2) المقارنة البصرية والمحسوبة
Send/Scan/Pair ×390/1280 ×فاتح/داكن =12 حالة،72 عينة مكوّن، صفر فروق للون والخلفية وأنصاف الأقطار والارتفاع/padding والخط/وزنه/line-height والظل/backdrop وwidth/x/y. صفر overflow وصفر pageerrors. ملفات `visual-comparison.json` و`app-*`/`reference-*` screenshots. ليست كل عناصر التطبيق ولا pixel-diff شاملًا، ولذلك لا نسبة تطابق مخترعة.
Chat:4 حالات ×6 مكونات؛ الحقول/الرأس/المؤلف والألوان مطابقة ضمن العينات، والفارق هو ارتفاع فقاعتي sent/received بسبب التوقيت. المرجع في المقارنة يعرض نصوص الرسائل المستخرجة من الجلسة الحقيقية فقط، لا يشغّل connect/send المحاكي. الدليل `real-transport.json:chatStyles`.
### 3) الحافة وطبقات الزجاج
12 تجربة = تطبيق/مرجع × دائرة/كبسولة ×1/2/3. اختبار أحمر معزول عن النص والخلفية والظلال: interior/exterior/green/blue maxima صفر في المناطق المقاسة (بُعد أكثر من2CSSpx داخليًا وأكثر من1px خارجيًا لتجنب حافة antialias). الحلقة وحدها حمراء. القمم في الجدول تطابق المرجع نفسه، وليست مطالبة بأن raster1× يساوي source alpha حرفيًا.
| الشكل | كثافة | TL raster | BR raster | red ring only |
|---|---:|---:|---:|---|
| circle | 1× | 0.501961 | 0.290196 | True |
| capsule | 1× | 0.537255 | 0.298039 | True |
| circle | 2× | 0.560784 | 0.317647 | True |
| capsule | 2× | 0.592157 | 0.333333 | True |
| circle | 3× | 0.580392 | 0.333333 | True |
| capsule | 3× | 0.592157 | 0.333333 | True |
`rim-audit.json`: سبعة أسطح محتوى مقاسة بلا backdrop وبلا ::after content؛ الـring نفسه بلا filter أو inset shadow. مصدر الشدة .60/.34، offset الدائرة8.28px والكبسولة9.94px.
### 4) الاتصال الفعلي والرسائل والملفات والفصل
عمليتا Chromium مستقلتان، PeerServer حقيقي محلي على9000 وnative WebRTC/DTLS؛ لا route interception ولا fake camera ولا test hooks. إعداد الإشارة المحلي هو التفضيل الموجود أصلًا في التطبيق. هذا ليس اختبار جهازين ماديين أوWAN.
- host-to-guest: 700000B في499ms؛ SHA-256 المصدر=التنزيل: `26a7e5e6373ab3f60016d8cc0b5298b8def240b784b2f363887c4b3d6a9d5cfa`.
- guest-to-host: 700000B في687ms؛ SHA-256 المصدر=التنزيل: `fbd6d063cba83a3212ef6309894cefd41563d3c822e1942b904115e4b58db9e8`.
3 رسائل في كل اتجاه محفوظة بالترتيب؛ typing true/false وصل فعليًا؛ التنقل Send→Chat لا يقطع الجلسة. اللصق وفتح URL الحقيقي يتصلان؛ fragment يُزال. نجاح الاتصال أثناء وجود المستخدم في Send يفتح Chat، وفصل الضيف أثناء وجود المضيف في Send يعيده Pair. الفصل من الطرفين أخفى Chat. `real-transport.json` و`.log`.
### 5) QR والقراءة
رمز الربط المعروض فُك واستُعيد payload المطابق في4 حالات مقاس/ثيم. QR بصري QF4 مولَّد من نص المستخدم فُك من screenshot للcanvas في الفاتح والداكن:412B، SHA-256 `dccaf1cec611af0bb5557f6d10dffefec3ffe1ab8b66d7e8d0004b28ce6d6b15`. QR كلمة مرور الاختبار QFPW فُك مطابقًا. هذه اختبارات encoder/render/decoder حقيقية؛ استقبال النقل عبر عدسة كاميرا **غير مُختبر**.
### 6) وظائف الإرسال والمسح والأخطاء والصفحات الثانوية
`app-audit.json`: رفض4 ملفات فعلية؛ قبول مجلد من2 ثم3 ملفات؛ حذف حتى الفراغ؛ نص→QR؛ بدء/إيقاف؛ clipboard حقيقي؛ fullscreen دخول/خروج؛ حوار النقل السريع وتركيز/Escape؛ واجهة التشفير وQR كلمة المرور؛ الستة profiles؛ إنشاء profile مخصص ثمreload وحذفه. غياب الكاميرا عُرض خطأ حقيقيًا في Scan وPair، بلا scan line فعالة. الرابط غير الصالح يُرفض قبل الاتصال. لا نعيد تسمية خطأ الكاميرا نجاحًا.
History/Offline/Privacy ترجع200 ولا overflow في القياس. ZIP حقيقي نُزّل: 411969B و37 ملفًا، ومنهاindex.html. تشغيل الحزمة معزولة بلا شبكة **غير مُختبر**. POST multipart حقيقي إلى/share وصل عبر IndexedDB إلىSend. /tv يعيد404 كما الأساس، ولذلك المسار السريع المعتمد عليه غير قابل لاعتباره مجتازًا.
### 7) RTL/LTR والثيم
تبديل اللغة يحوّل html lang/dir، ويستمر بعدreload؛ اختيار الثيم يستمر. تدرج الحافة المحسوب نفسه في RTL وLTR، فلم تُعكس إضاءة أعلى اليسار. ملفاتاللغة/التخزين الأصلية لم تتغير. المقارنة البصرية الشاملة بالإنجليزية وأخطاء النقل العربية الآتية من الطبقات القديمة ليست شهادة تطابق كامل. `app-audit.json` و`app/lang-provider.tsx:26`.
### 8) تقليل الحركة والشفافية
animation/transition=none تحت reduced-motion. تحت reduced-transparency:10 عناصر زجاجية مقاسة، منها tinted، كلهاbackdrop=none وrim=.5 وخلفيات معتمة. أصلح ترتيب declarations لمنع optimizer من إسقاط override. `rim-audit.json` و`app/workspace.css:87`.
### 9) إمكانية الوصول
عبر6 مسارات ×ثيمين في390px: لا هدف تفاعلي مقاس أقل من44px بعد احتساب امتداد hit area الحقيقي؛ الأسهم/End تعمل، وfocus outline solid2px. حوار النقل السريع يستعيد التركيز. هذا فحص هندسي/لوحة مفاتيح لا اختبار قارئ شاشة ولا اعتماد WCAG كامل؛ الحالات المخفية/نتائج الكاميرا ليست كلها ضمن قياس الأهداف.
| زوج الألوان | الوضع | التباين | ≥4.5 |
|---|---|---:|---|
| body label on card | light | 21.000:1 | نعم |
| secondary label on card | light | 3.614:1 | **لا** |
| white on tint | light | 4.017:1 | **لا** |
| white on actual tinted control | light | 3.528:1 | **لا** |
| error on card | light | 3.547:1 | **لا** |
| body label on card | dark | 17.015:1 | نعم |
| secondary label on card | dark | 6.300:1 | نعم |
| white on tint | dark | 3.647:1 | **لا** |
| white on actual tinted control | dark | 4.229:1 | **لا** |
| error on card | dark | 4.797:1 | نعم |
المطلوب4.5:1 غير مجتاز بالكامل. الأرقام من compositing حسابي لأزواج tokens/control backgrounds، وليست مسحًا لكل بكسل نصي متحرك فوق خلفية مركبة. `accessibility-audit.json`.
### 10) الأداء والنظافة وحدود الانحدار
قياس Chromium headless محلي أثناء تشغيل اختبارات متوازية: DOMContentLoaded=215.4ms؛ load=448.0ms؛ scripts transfer=203026B. تمرير119 إطارًا: p50=16.7ms؛ p95=33.3ms؛ عددفواصل>50ms=2. هذه عينة مختبر وليست ضمان60fps أو قياس هاتف ضعيف أو مقارنة أداء baseline؛ وجود توقفات مسجَّل لا مخفي.
`source-audit.json`: صفر علامات QR/ردود/ملفات/نجاح مؤقت من mockup داخل app/lib/public؛ لا UI build badge. الوثائق والاختبارات القديمة ما زالت تحتوي اسم التصميم القديم تاريخيًا، وليس في التطبيق المعروض. timeouts الأصلية للتحقق/تنظيف الموارد/انقضاء typing/إشعار النسخ ليست نجاحات اتصال مصطنعة. لم تُستخدم suites الكاميرا المزيفة القديمة كدليل قبول؛ وبعض e2e القديمة ما زالت تتوقع تخطيطUI6/UI7 وتحتاج إعادة baselining، فلا ادعاء بأن كل suite قديمة اجتازت.

## 8. غير المُختبر والمخاطر المتبقية
- كاميرا/شاشة حقيقيتان، screen-to-camera pairing، استقبال ملف بصري فعلي بكل profiles، تغيير العدسة/torch/focus وwake lock على هاتف: **غير مُختبر**؛ enumerateDevices فارغ.
- WAN/NAT/TURN، Safari/iOS/Firefox، أذونات notifications/native media controls، قارئ الشاشة، اللمس الحقيقي، لوحة مفاتيح الهاتف ومساحتها الآمنة: **غير مُختبر**.
- تاريخ استقبال بصري ممتلئ ومسحه، password/signature acceptance الفعلي من الكاميرا، crash global-error حقيقي، رفض permission على جهاز بكاميرا بدل no-device، نشر PWA/install/offline isolation: **غير مُختبر**. الروابط والhandlers محفوظة بالمصدر، وليس ذلك نجاح تشغيل.
- /tv غير موجود في الأساس. لم يُخترع مسار بديل أو transport جديد لإخفاء العطل. قيود استضافة/share والأوفلاين القديمة لم تُعاد هندستها.
- Shared Bridge يبقى مركبًا عمدًا لاستمرار الجلسة، فيضيف كود الجسر للغلاف المشترك؛ لا يفتح كاميرا تلقائيًا، ويوقفها عند مغادرة صفحة الربط. قياس الأثر على الأجهزة الضعيفة **غير مُختبر**.
- تطابق المرجع لا يساوي استيفاء التباين؛ يلزم إذن منفصل لتعديل palette إذا كان4.5:1 شرطًا غير قابل للتنازل. صفحة Share المؤقتة ونصوص أخطاء قديمة ليست مترجمة بالكامل.
- لا دعم typing/read receipts/اسم الجهاز/تأكيد same-Wi-Fi مُخترع: typing فقط لأنه مدعوم؛ لا receipts جديدة؛ navigator.onLine لا يثبت وصول الطرف الآخر.

## 9. إعادة التشغيل والأدلة وحالة الرفع
يتطلب Node≥22.13، `npm ci`، Chromium ومتطلبات تشغيله، ثم build/start على0.0.0.0:3000. شغّل PeerServer الحقيقي على9000 للاختبار المحلي؛ لا يُغيّر هذا إعداد النشر الافتراضي. يمكن تشغيله بأداة peer المثبتة أصلًا: `node node_modules/peer/dist/bin/peerjs.js --port 9000 --host 0.0.0.0 --path /`.
```bash
npm run lint
node --import tsx --test tests/*.test.ts
npm run build
# في عملية منفصلة: npm run start -- --hostname 0.0.0.0
node --test tests/rendered-html.test.mjs
node scripts/design-app-audit.mjs
node scripts/design-real-transport.mjs
node scripts/design-visual-audit.mjs
node scripts/design-rim-audit.mjs
node scripts/design-accessibility-audit.mjs
```
سكربتات المقارنة تتطلب المرجع المحلي في المسار المذكور؛ يمكن تعيين EVIDENCE_DIR لمخرجات الاختبار. ملفات القياس JSON هي البيانات الخام؛ ملفاتPNG المحلية تبين حالات التطبيق/المرجع، واختبار الحافة الأحمر/الأبيض، وQR والصفحات الثانوية. لم تُرفق صور رموز ربط ذات payload داخل المستودع العام.
آخر مراجعة للremote main أعادت نفس الأساس `cd8f2b6…`. فحص `git push --dry-run origin HEAD:main` فشل128 برسالة `could not read Username for https://github.com: terminal prompts disabled`. موصل GitHub في هذه البيئة أفاد unsupported. لم تُستخدم بيانات الاعتماد المكشوفة القديمة ولم تُحفظ. لا يُعد commit محلي أو patch رفعًا. محاولةpush النهائية ومعرّفcommit يسجلان في `delivery-status.json` و`push-final.log` بمجلد الأدلة المحلي.
