"use client";
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Glass } from 'glisse';
import {
  ArrowDownToLine, ArrowUpFromLine, Camera, Check, ChevronDown, ChevronRight, File, FolderOpen, Home,
  Image as ImageIcon, Lock, Music2, Package, Pause, Play, Plus, QrCode, Send, ShieldCheck, Smartphone, Video, Wifi,
} from 'lucide-react';
import { useI18n } from '../lang-provider';
import { AppLink, usePathname, useRouter } from '../router';
import { LiquidChoices } from '../liquid-controls';
import { CircleButton } from '../design-system';
import { ProgressiveBlur } from '../progressive-blur';
import { NativeLocal, displayLabel, emptyLocalState, localSessionVisible, localSupported, transferRatio, type LocalFile, type LocalState, type NativeBounds } from '../../lib/native-local';
import './local.css';

type IconType = typeof File;
const categories: { id: string; ar: string; en: string; icon: IconType; mime: string }[] = [
  { id: 'apps', ar: 'تطبيقات', en: 'Apps', icon: Package, mime: 'application/vnd.android.package-archive' },
  { id: 'images', ar: 'صور', en: 'Photos', icon: ImageIcon, mime: 'image/*' },
  { id: 'videos', ar: 'فيديو', en: 'Videos', icon: Video, mime: 'video/*' },
  { id: 'audio', ar: 'صوت', en: 'Audio', icon: Music2, mime: 'audio/*' },
  { id: 'files', ar: 'ملفات', en: 'Files', icon: File, mime: '*/*' },
];
const errorText: Record<string, [string, string]> = {
  RECOVERY_UNAVAILABLE: ['تعذر قراءة حالة الجلسة السابقة. الأجزاء المستلمة لم تُحذف؛ اختر الملفات وأعد الاقتران.', 'The previous session record could not be read. Received parts are retained; select files and pair again.'],
  SOURCE_UNAVAILABLE: ['أحد الملفات المحددة لم يعد متاحًا. أعد اختياره من «تصفح» ثم استكمل.', 'A selected source is unavailable. Select it again with Browse, then resume.'],
  FILE_ACCESS_REQUIRED: ['اسمح بالوصول أو اختر ملفات محددة من مدير ملفات النظام.', 'Allow access or choose specific files using the system picker.'],
  SESSION_ACTIVE: ['أنهِ جلسة النقل الحالية قبل تغيير مجلد الاستقبال.', 'End the current transfer session before changing the destination folder.'],
  STORAGE_ACCESS_REQUIRED: ['لم يعد مجلد الاستقبال متاحًا للكتابة. أعد منحه الإذن أو اختر مجلدًا آخر بعد إنهاء الجلسة.', 'The receiving folder is not writable. Restore its permission or choose another folder after ending the session.'],
  CAMERA_PERMISSION_REQUIRED: ['إذن الكاميرا غير متاح. امنحه من نافذة Android ثم أعد المحاولة.', 'Camera permission is unavailable. Grant it in the Android dialog and retry.'],
  NEARBY_PERMISSION_REQUIRED: ['اسمح بالاتصال بالأجهزة القريبة من نافذة Android. قد يحتاج Android القديم إلى Location أيضًا.', 'Allow nearby-device access in the Android dialog. Older Android may also need Location.'],
  WIFI_OFF: ['فعّل Wi-Fi ثم أعد المحاولة.', 'Turn on Wi-Fi, then retry.'],
  JOIN_WIFI_FIRST: ['لم يُعثر على شبكة محلية. اتصل بشبكة Wi-Fi لا تحتاج إنترنت ثم أعد المحاولة.', 'No local network found. Join a Wi-Fi network (internet not required) and retry.'],
  HOTSPOT_UNAVAILABLE_USE_EXISTING_WIFI: ['تعذر إنشاء نقطة اتصال محلية؛ سيُستَخدم المسار التالي تلقائيًا.', 'A local hotspot is unavailable; the next path is used automatically.'],
  DIRECT_UNAVAILABLE: ['الاتصال المباشر غير متاح هنا؛ سيُجرَّب المسار التالي تلقائيًا.', 'Direct connection is unavailable here; the next path is tried automatically.'],
  DIRECT_UNAVAILABLE_USE_EXISTING_WIFI: ['هذا الإصدار من Android لا يدعم الاتصال المباشر؛ جرّب شبكة Wi-Fi موجودة.', 'This Android version has no direct link here; use an existing Wi-Fi network.'],
  HOTSPOT_ADDRESS_UNAVAILABLE: ['تعذر تحديد عنوان نقطة الاتصال بأمان. استخدم شبكة Wi-Fi موجودة.', 'The hotspot address could not be determined safely. Use an existing Wi-Fi network.'],
  HOTSPOT_STOPPED: ['أوقفت نقطة الاتصال. أعد المحاولة.', 'The local hotspot stopped. Try again.'],
  NETWORK_UNAVAILABLE: ['تعذر إنشاء أي اتصال محلي على هذا الجهاز. جرّب Wi-Fi مشتركًا.', 'No local link could be created on this device. Try a shared Wi-Fi network.'],
  NETWORK_LOST: ['انقطع الاتصال بالشبكة المحلية.', 'The local network connection dropped.'],
  NETWORK_REQUEST_DECLINED: ['لم يكتمل طلب الاتصال من النظام. أعد المحاولة.', 'The system connection request did not complete. Retry.'],
  WIFI_JOIN_FAILED: ['تعذر الانضمام لشبكة المستقبل تلقائيًا. أعد المحاولة من صفحة الاستقبال.', 'Could not join the receiver’s network automatically. Retry from the receive side.'],
  WIFI_JOIN_TIMEOUT: ['انتهت مهلة الانضمام لشبكة المستقبل.', 'Joining the receiver’s network timed out.'],
  WIFI_CHANNEL_LOST: ['فقد النظام قناة الاتصال المحلي. أعد المحاولة.', 'Android lost the local network channel. Retry.'],
  PAIRING_EXPIRED: ['انتهت صلاحية الرمز. أنشئ رمزًا جديدًا من المستقبل.', 'The pairing code expired. Create a new one on the receiving phone.'],
  INVALID_OR_EXPIRED_QR: ['رمز غير صالح أو منتهي. امسح رمز النقل المحلي الحالي.', 'Invalid or expired code. Scan the receiver’s current local QR.'],
  CONNECTION_LOST: ['انقطع الاتصال؛ الأجزاء المستلمة محفوظة. أعد المحاولة للاستكمال.', 'Connection lost; received parts are retained. Retry to resume.'],
  TLS_VERIFICATION_FAILED: ['تعذر التحقق من هوية الجهاز. أعد الاقتران برمز موثوق.', 'Device identity verification failed. Pair again with a trusted code.'],
  STORAGE_FULL: ['مساحة التخزين غير كافية. حرّر مساحة ثم أعد المحاولة.', 'Not enough storage. Free space and retry.'],
  HASH_MISMATCH: ['فشل تحقق سلامة الملف؛ لم يُعتمد الملف المستلم.', 'Integrity verification failed; the received file was not published.'],
  PUBLISHED_FILE_CHANGED: ['تغيّر الملف المحفوظ أو لم يعد متاحًا. أعد الإرسال.', 'The saved file changed or is unavailable. Send it again.'],
  CAMERA_UNAVAILABLE: ['تعذر تشغيل الكاميرا. أغلق التطبيقات التي تستخدمها وحاول مجددًا.', 'Camera unavailable. Close other camera apps and retry.'],
  STORAGE_SETTINGS_UNAVAILABLE: ['تعذر فتح شاشة أذونات التخزين على هذا الجهاز.', 'The storage permission screen could not be opened on this device.'],
  SETTINGS_UNAVAILABLE: ['تعذر فتح إعدادات النظام.', 'The system settings screen could not be opened.'],
};
function errorCode(e: unknown) { return e instanceof Error ? e.message : 'LOCAL_TRANSFER_FAILED'; }
function size(value: number) { if (value < 0) return '—'; const units = ['B', 'KB', 'MB', 'GB', 'TB']; let i = 0; while (value >= 1024 && i < 4) { value /= 1024; i++; } return `${value.toLocaleString(undefined, { maximumFractionDigits: i ? 1 : 0 })} ${units[i]}`; }
function bounds(el: HTMLElement): NativeBounds { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, viewport: innerWidth }; }

/** Bottom inset driven by the real visual viewport, so a fixed composer never
 *  floats over the keyboard and the page never jumps between scroll positions. */
function useKeyboardInset() {
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const apply = () => {
      const inset = Math.max(0, Math.round(window.innerHeight - viewport.height - viewport.offsetTop));
      document.documentElement.style.setProperty('--kb', `${inset}px`);
    };
    apply();
    viewport.addEventListener('resize', apply);
    viewport.addEventListener('scroll', apply);
    return () => {
      viewport.removeEventListener('resize', apply);
      viewport.removeEventListener('scroll', apply);
      document.documentElement.style.setProperty('--kb', '0px');
    };
  }, []);
}

export function LocalClient() {
  const { lang } = useI18n(), ar = lang === 'ar', tx = (a: string, b: string) => (ar ? a : b), path = usePathname(), router = useRouter(), native = localSupported();
  const [state, setState] = useState<LocalState>(emptyLocalState);
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), [category, setCategory] = useState('apps');
  const [catalogue, setCatalogue] = useState<LocalFile[]>([]), [page, setPage] = useState(0);
  const [draft, setDraft] = useState(''), [scanning, setScanning] = useState(false), [qrShown, setQrShown] = useState(false), [foreground, setForeground] = useState(true);
  const surface = useRef<HTMLDivElement>(null), request = useRef(0), autoCamera = useRef(false);
  useKeyboardInset();
  const current = path.split('/')[2] || 'home', activeSession = localSessionVisible(state), sessionPage = current === 'session' && (activeSession || state.started);
  const apply = useCallback((next: LocalState) => setState(previous => (next.revision >= previous.revision ? { ...previous, ...next } : previous)), []);
  const run = useCallback(async (action: () => Promise<unknown>) => {
    if (!native) return;
    setBusy(true); setError('');
    try { const result = await action(); if (result && typeof result === 'object' && 'revision' in result) apply(result as LocalState); return result; }
    catch (e) { setError(errorCode(e)); }
    finally { setBusy(false); }
  }, [apply, native]);
  useEffect(() => {
    if (!native) return;
    let dead = false;
    const listener = NativeLocal.addListener('state', s => { if (!dead) apply(s); });
    void NativeLocal.getState().then(s => { if (!dead) apply(s); }).catch(e => setError(errorCode(e)));
    return () => { dead = true; void listener.then(l => l.remove()); void NativeLocal.hideNativeView(); };
  }, [native, apply]);
  useEffect(() => {
    if (!native) return;
    let live = true;
    const listener = NativeLocal.addListener('lifecycle', ({ active }) => { if (!live) return; setForeground(active); setScanning(false); if (!active) setQrShown(false); });
    return () => { live = false; void listener.then(handle => handle.remove()); };
  }, [native]);
  useEffect(() => { if (activeSession && (current === 'receive' || current === 'scan' || current === 'setup')) router.replace('/local/session'); }, [activeSession, current, router]);
  useEffect(() => { if (state.phase === 'connecting' || state.phase === 'error' || state.authenticated) setScanning(false); }, [state.phase, state.authenticated]);
  useEffect(() => {
    if (!native || current !== 'send') return;
    let dead = false;
    const id = ++request.current;
    void NativeLocal.listFiles({ category, page }).then(v => { if (!dead && id === request.current) setCatalogue(v.files); }).catch(e => { if (!dead) setError(errorCode(e)); });
    return () => { dead = true; };
  }, [category, current, page, native]);
  useEffect(() => { setScanning(false); setQrShown(false); if (native) void NativeLocal.hideNativeView(); }, [current, native]);
  useEffect(() => {
    if (!native || !foreground || current !== 'receive' || !state.qrReady || !surface.current) return;
    let live = true;
    void NativeLocal.showPairingCode(bounds(surface.current)).then(() => { if (live) setQrShown(true); }).catch(e => setError(errorCode(e)));
    return () => { live = false; setQrShown(false); void NativeLocal.hideNativeView(); };
  }, [current, native, state.qrReady, foreground]);
  useEffect(() => {
    if (!native || !surface.current) return;
    let frame = 0;
    const update = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(() => { if (surface.current) void NativeLocal.updateNativeView(bounds(surface.current)).catch(() => {}); }); };
    const observer = new ResizeObserver(update);
    observer.observe(surface.current);
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, { passive: true });
    update();
    return () => { observer.disconnect(); window.removeEventListener('resize', update); window.removeEventListener('scroll', update); cancelAnimationFrame(frame); };
  }, [current, native]);
  const code = error || state.error;
  const message = errorText[code]?.[ar ? 0 : 1] || (code ? tx('لم تكتمل العملية؛ أعد المحاولة.', 'The operation did not complete; retry.') : '');
  const icon = categories.find(c => c.id === category) ?? categories[0];
  const selected = new Set(state.selected.map(f => f.id));
  const totalSize = state.selected.reduce((n, f) => n + f.size, 0);
  const pick = () => run(() => NativeLocal.pickFiles({ mime: icon.mime }));
  const closeCamera = () => { setScanning(false); void NativeLocal.hideNativeView(); };
  const openScanner = useCallback(async () => {
    if (!surface.current) return;
    const result = await run(() => NativeLocal.startScan(bounds(surface.current!)));
    setScanning(!!(result as { scanning?: boolean } | undefined)?.scanning);
  }, [run]);
  useEffect(() => {
    if (!native || current !== 'scan' || autoCamera.current || !state.selected.length) return;
    autoCamera.current = true;
    const frame = requestAnimationFrame(() => { if (surface.current) void openScanner(); });
    return () => cancelAnimationFrame(frame);
  }, [current, native, openScanner, state.selected.length]);
  useEffect(() => { if (current !== 'scan') autoCamera.current = false; }, [current]);
  const end = async () => { await run(() => NativeLocal.disconnect()); router.replace('/local'); };
  const back = () => { if (sessionPage || current === 'scan') void end(); else if (current === 'home') router.push('/'); else router.push(current === 'receive' || current === 'setup' ? '/local' : '/local'); };
  const title = current === 'send' ? tx('إرسال', 'Send') : current === 'setup' ? tx('التحضير', 'Prepare') : current === 'scan' ? tx('مسح للاتصال', 'Scan to connect') : current === 'receive' ? tx('استلام', 'Receive') : sessionPage ? tx('متصل', 'Connected') : tx('نقل محلي', 'Local transfer');
  const methodLabel = state.method === 'direct' ? 'Wi-Fi Direct' : state.method === 'hotspot' ? tx('نقطة محلية', 'Local hotspot') : state.method === 'lan' ? tx('شبكة محلية', 'Local Wi-Fi') : tx('تلقائي', 'Automatic');
  const setupReady = !!state.nearby && !!state.wifi;
  const done = state.files.filter(f => f.status === 'complete').length;

  return <main className={`local-page ${sessionPage ? 'local-session' : ''}`} data-page="local" data-screen={current} data-phase={state.phase}>
    <header className="lf-top">
      <button type="button" className={`glass cap lf-chip ${current === 'home' ? 'lf-brand' : 'lf-icon lf-back'}`} onClick={back} aria-label={current === 'home' ? tx('العودة للنقل البصري', 'Return to optical transfer') : tx('رجوع', 'Back')}>
        {current === 'home' ? <><span className="lf-dot" />QRFerry<ChevronDown size={16} /></> : <ChevronRight size={20} />}
      </button>
      {current !== 'home' && <div className="glass cap lf-chip lf-title">{title}</div>}
      <div className="lf-top-end">
        {current === 'send' && <button type="button" className="glass cap lf-chip lf-icon" disabled={!native} onClick={() => void pick()} aria-label={tx('تصفح ملفات الجهاز', 'Browse device files')}><FolderOpen size={19} /></button>}
        {sessionPage && <div className="glass cap lf-chip lf-mode"><span className="lf-dot" />{state.authenticated ? tx('موثّق', 'Verified') : tx('متوقف', 'Paused')}<small>{methodLabel}</small></div>}
      </div>
    </header>

    {!native && <section className="card local-notice"><Smartphone /><h2>{tx('هذه المنظومة تعمل داخل تطبيق Android', 'This mode runs inside the Android app')}</h2><p>{tx('الاتصال والملفات والكاميرا تعمل محليًا في طبقة Android. المنظومة البصرية الحالية ما زالت متاحة.', 'Networking, files and camera run in the native Android layer. The existing optical mode is still available.')}</p><AppLink href="/">{tx('العودة إلى المنظومة الحالية', 'Return to the existing mode')}</AppLink></section>}
    {!!message && <div className="local-error" role="alert"><p>{message}</p>{error && <button type="button" onClick={() => setError('')}>{tx('إخفاء', 'Dismiss')}</button>}</div>}
    {native && state.recoveryWarning && <p className="local-error" role="alert">{tx('تعذر حفظ سجل الاستعادة. الأجزاء المستلمة محفوظة، لكن قد تحتاج لإعادة اختيار الملفات.', 'The recovery record could not be saved. Received parts are retained, but sources may need selecting again.')}</p>}

    {current === 'home' && <>
      <section className="lf-orb" aria-hidden="true"><i /><i /><i /><div className="lf-core"><ArrowUpFromLine size={30} /></div></section>
      <h1 className="lf-h1">{tx('انقل ملفاتك مباشرة', 'Move your files directly')}</h1>
      <p className="lf-sub">{tx('بين هاتفين، عبر اتصال محلي موثّق. لا إنترنت في مسار النقل.', 'Between two phones over an authenticated local link. No internet in the transfer path.')}</p>
      <div className="lf-row local-actions">
        <button type="button" className="glass cap tinted lf-big" disabled={!native} onClick={() => router.push('/local/send')}><ArrowUpFromLine size={20} />{tx('إرسال', 'Send')}</button>
        <button type="button" className="glass cap lf-big" disabled={!native} onClick={() => router.push('/local/setup')}><ArrowDownToLine size={20} />{tx('استلام', 'Receive')}</button>
      </div>
      {state.started && <button type="button" className="card lf-li lf-resume" onClick={() => router.push('/local/session')}><span className="lf-ic"><ShieldCheck size={22} /></span><span className="lf-gr"><b>{tx('الجلسة الحالية', 'Current session')}</b><small>{state.authenticated ? tx('موثّقة — عرض التقدم', 'Verified — view progress') : tx('متوقفة — عرض الحالة', 'Paused — view state')}</small></span><ChevronRight size={18} /></button>}
      <button type="button" className="card lf-li" onClick={() => router.push('/local/send')}><span className="lf-ic"><FolderOpen size={22} /></span><span className="lf-gr"><b>{tx('الملفات', 'Files')}</b><small>{tx('تصفّح ملفات جهازك واختر ما تريد', 'Browse your device files and choose')}</small></span><ChevronRight size={18} /></button>
      <h2 className="lf-h2">{tx('الأخيرة', 'Recent')}</h2>
      {state.files.length ? <div className="card lf-list">{state.files.slice(-6).reverse().map(f => <div className="lf-li" key={f.id}><span className="lf-ic">{f.direction === 'in' ? <ArrowDownToLine size={20} /> : <ArrowUpFromLine size={20} />}</span><span className="lf-gr"><b>{displayLabel(f)}</b><small>{size(f.size)} · {f.status === 'complete' ? tx('اكتمل', 'Complete') : `${Math.floor(transferRatio(f) * 100)}%`}</small></span></div>)}</div>
        : <div className="card lf-empty"><p>{tx('لا يوجد سجل نقل بعد.', 'No transfers yet.')}</p></div>}
      {state.recovered && <section className="card local-recovery"><h2>{tx('جلسة سابقة قابلة للاستعادة', 'A previous session can be resumed')}</h2><p>{tx('استُعيدت الملفات والسجل. أعد الاقتران برمز جديد لإكمال التحقق ونقل الأجزاء الناقصة.', 'Files and history were restored. Pair again with a new code to re-authenticate and finish the missing parts.')}</p></section>}
    </>}

    {current === 'send' && <>
      <div className="glass lf-seg" role="tablist" aria-label={tx('نوع الملفات', 'File type')}>
        {categories.map(c => <button type="button" key={c.id} role="tab" aria-selected={category === c.id} className={category === c.id ? 'on' : ''} onClick={() => { setCategory(c.id); setPage(0); }}>{ar ? c.ar : c.en}</button>)}
      </div>
      <section className="card lf-list" aria-live="polite">
        {catalogue.length ? catalogue.map(f => <button type="button" data-file-row="" className={`lf-li ${selected.has(f.id) ? 'sel' : ''}`} key={f.id} aria-pressed={selected.has(f.id)} disabled={busy} onClick={() => void run(() => NativeLocal.selectFile({ id: f.id, selected: !selected.has(f.id) }))}>
          <span className="lf-ic">{f.thumb ? <img src={f.thumb} alt="" loading="lazy" /> : <Package size={20} />}</span>
          <span className="lf-gr"><b>{displayLabel(f)}</b><small>{size(f.size)}{f.splitCount && f.splitCount > 1 ? ` · ${f.splitCount} APK` : ''}</small></span>
          <span className={`lf-ck ${selected.has(f.id) ? 'on' : ''}`}><Check size={15} /></span>
        </button>) : <div className="lf-empty"><FolderOpen size={30} /><p>{tx('لا توجد عناصر في هذا التصنيف. استخدم زر التصفح لاختيار ملفات من جهازك.', 'Nothing in this category. Use Browse to choose files from your device.')}</p></div>}
      </section>
      {catalogue.length >= 30 && <button type="button" className="glass cap lf-more" onClick={() => setPage(p => p + 1)}>{tx('المزيد', 'More')}</button>}
      <div className="lf-bar">
        <div className="glass lf-bx">
          <span className="lf-sum">{state.selected.length} {tx('عناصر', 'items')}<small>{size(totalSize)}</small></span>
          <div className="local-send-action">
            <button type="button" className="glass cap tinted" disabled={!native || busy || !state.selected.length} onClick={() => { if (activeSession) { void run(() => NativeLocal.sendSelected()); router.push('/local/session'); } else router.push('/local/scan'); }}><ArrowUpFromLine size={18} />{tx('إرسال', 'Send')}</button>
          </div>
        </div>
      </div>
    </>}

    {current === 'setup' && <>
      <h1 className="lf-h1 lf-h1-sm">{tx('تحضير الاستلام', 'Prepare to receive')}</h1>
      <p className="lf-sub">{tx('تظهر هنا نوافذ Android الرسمية فقط. كل عنصر يوضح حالته على هذا الجهاز وإصداره.', 'Only official Android dialogs appear here. Each row reflects this device and its Android version.')}</p>
      <div className="card lf-list">
        <div className="lf-li"><span className="lf-ic"><Wifi size={20} /></span><span className="lf-gr"><b>Wi-Fi</b><small>{state.wifi ? tx('مفعّل', 'On') : tx('متوقف — يجب تفعيله', 'Off — required')}</small></span>{state.wifi ? <span className="lf-ok"><Check size={16} /></span> : <button type="button" className="glass cap lf-small" onClick={() => void run(() => NativeLocal.openSettings({ which: 'wifi' }))}>{tx('فتح الإعدادات', 'Open settings')}</button>}</div>
        <div className="lf-li"><span className="lf-ic"><ShieldCheck size={20} /></span><span className="lf-gr"><b>{tx('الأجهزة القريبة', 'Nearby devices')}</b><small>{state.nearby ? tx('مسموح', 'Allowed') : tx('غير مسموح — ستظهر نافذة Android', 'Not allowed — the Android dialog will appear')}</small></span>{state.nearby ? <span className="lf-ok"><Check size={16} /></span> : <button type="button" className="glass cap lf-small" onClick={() => void run(() => NativeLocal.requestNearby())}>{tx('السماح', 'Allow')}</button>}</div>
        <div className="lf-li"><span className="lf-ic"><FolderOpen size={20} /></span><span className="lf-gr"><b>{tx('حفظ الملفات', 'Saving files')}</b><small>{state.destination || tx('في مجلد التطبيق', 'App folder')}</small></span><button type="button" className="glass cap lf-small" onClick={() => void run(() => NativeLocal.requestStorage())}>{tx('تغيير', 'Change')}</button></div>
      </div>
      <div className="lf-bar"><div className="glass lf-bx"><div className="lf-row lf-bx-row"><button type="button" className="glass cap tinted lf-big" disabled={!native || busy || !state.nearby || !state.wifi} onClick={() => router.push('/local/receive')}><ArrowDownToLine size={19} />{tx('متابعة إلى الاستلام', 'Continue to receive')}</button></div></div></div>
      {!setupReady && <p className="lf-hint">{tx('يفتح Android نافذته الرسمية عند الضغط على «السماح». لن يظهر أي شيء من تصميمنا بدلًا منها.', 'Android opens its own dialog when you press Allow. Nothing of our design replaces it.')}</p>}
    </>}

    {current === 'scan' && <>
      <div className="lf-cam">
        <div className="local-native-surface lf-cam-surface" ref={surface} aria-label={tx('معاينة كاميرا المسح الأصلية', 'Native scan camera preview')}>
          <Camera size={40} /><span>{scanning ? tx('الكاميرا تعمل محليًا', 'Camera running locally') : tx('الكاميرا مغلقة', 'Camera is closed')}</span>
        </div>
      </div>
      <div className="lf-sheet">
        <h2>{tx('ضع رمز QR داخل الإطار', 'Place the QR code inside the frame')}</h2>
        <p role="status">{state.phase === 'connecting' ? tx('جارٍ الاتصال والتحقق…', 'Connecting and verifying…') : state.phase === 'preparing-files' ? tx('تم التحقق. تجهيز الملفات…', 'Verified. Preparing files…') : scanning ? tx('ابحث عن رمز المستقبل. تُقرأ الرموز محليًا فقط.', 'Look for the receiver’s code. Codes are decoded locally only.') : tx('سيطلب Android إذن الكاميرا إن لم يكن ممنوحًا.', 'Android asks for camera permission if it is not granted.')}</p>
        <div className="lf-row">
          <button type="button" className="glass cap tinted lf-big" disabled={!native || busy || scanning} onClick={() => void openScanner()}><QrCode size={18} />{tx('فتح الكاميرا', 'Open camera')}</button>
          {scanning && <button type="button" className="glass cap lf-big" onClick={closeCamera}>{tx('إغلاق', 'Close')}</button>}
        </div>
      </div>
    </>}

    {current === 'receive' && <>
      <h1 className="lf-h1 lf-h1-sm">{tx('امسح هذا الرمز من الهاتف المرسل', 'Have the sending phone scan this')}</h1>
      <p className="lf-sub">{tx('يظهر الرمز بعد جاهزية الاتصال المحلي فعلًا. صالح لدقائق ثم يلزم رمز جديد.', 'The code appears only when the local link is genuinely ready. It expires after a few minutes.')}</p>
      <div ref={surface} className="local-native-surface lf-qr" aria-label={tx('رمز الاقتران الأصلي', 'Native pairing QR')}>
        <QrCode size={56} />
        <p>{qrShown ? tx('رمز جلسة مؤقت', 'Temporary session code') : state.phase === 'preparing' ? tx('جارٍ تجهيز أفضل اتصال متاح…', 'Preparing the best available link…') : tx('يظهر الرمز بعد جاهزية الاتصال', 'The code appears when the link is ready')}</p>
      </div>
      <p className="lf-status" role="status">{state.authenticated ? tx('تم التحقق من المرسل؛ سيبدأ النقل.', 'Sender verified; the transfer will start.') : state.qrReady ? <>{tx('يعمل الآن:', 'Active path:')} <b>{methodLabel}</b></> : state.phase === 'recovering' ? '' : ''}</p>
      <div className="lf-bar"><div className="glass lf-bx"><div className="lf-row lf-bx-row">
        <button type="button" className="glass cap tinted lf-big" disabled={!native || busy || state.qrReady || state.authenticated || state.phase === 'preparing'} onClick={() => void run(() => NativeLocal.startReceive({ method: 'auto' }))}><Wifi size={19} />{tx('بدء الاتصال المحلي تلقائيًا', 'Start the local link automatically')}</button>
        {(state.qrReady || state.phase === 'preparing') && <button type="button" className="glass cap lf-big" onClick={() => void end()}>{tx('إلغاء', 'Cancel')}</button>}
      </div></div></div>
    </>}

    {sessionPage && <>
      <div className="lf-progress">
        <span className="lf-pct">{Math.floor(state.files.length ? (state.files.reduce((n, f) => n + transferRatio(f), 0) / state.files.length) * 100 : 0)}%</span>
        <div className="lf-progress-meta"><b>{size(state.files.reduce((n, f) => n + Math.min(f.bytes, f.size), 0))} / {size(state.files.reduce((n, f) => n + f.size, 0))}</b><small>{state.authenticated ? (state.paused ? tx('متوقف مؤقتًا', 'Paused') : tx('جارٍ النقل', 'Transferring')) : tx('بانتظار إعادة الاتصال', 'Waiting to reconnect')}</small></div>
      </div>
      <h2 className="lf-h2">{tx('الملفات', 'Files')} · {done}/{state.files.length}</h2>
      <section className="card lf-list">{state.files.map(f => <div className="lf-li lf-file" data-file-row="" key={f.id}>
        <span className="lf-ic">{f.direction === 'in' ? <ArrowDownToLine size={20} /> : <ArrowUpFromLine size={20} />}</span>
        <span className="lf-gr"><b>{displayLabel(f)}</b><span className="lf-tr"><i style={{ width: `${Math.round(transferRatio(f) * 100)}%` }} /></span></span>
        <span className={`lf-st ${f.status === 'complete' ? 'ok' : ''}`}>{f.status === 'complete' ? <Check size={16} /> : `${Math.floor(transferRatio(f) * 100)}%`}</span>
      </div>)}</section>
      <div className="lf-row lf-session-actions">
        <button type="button" className="glass cap lf-big" disabled={!state.authenticated} onClick={() => state.recovered ? router.push(state.role === 'receive' ? '/local/receive' : '/local/scan') : void run(() => NativeLocal.pause({ paused: !state.paused && state.phase !== 'paused' }))}>{state.paused || state.phase === 'paused' ? <Play size={18} /> : <Pause size={18} />}{state.paused || state.phase === 'paused' ? tx('استكمال', 'Resume') : tx('إيقاف مؤقت', 'Pause')}</button>
        <button type="button" className="glass cap lf-big" onClick={() => void end()}>{tx('إنهاء الجلسة', 'End session')}</button>
      </div>
      <div className="lf-msgs">{state.messages.map(m => <div className={`lf-bb ${m.direction === 'out' ? 'me' : ''}`} data-msg="" key={m.id}><p>{m.text}</p><small>{m.direction === 'out' ? (m.status === 'delivered' ? tx('وصلت', 'Delivered') : m.status === 'sending' ? tx('جارٍ الإرسال', 'Sending') : m.status === 'failed' ? tx('لم تُرسل', 'Not sent') : tx('أُرسلت', 'Sent')) : new Date(m.time).toLocaleTimeString(lang, { hour: '2-digit', minute: '2-digit' })}</small></div>)}</div>
      {createPortal(<>
        <ProgressiveBlur edge="bottom" />
        <form className="bridge-composer lf-composer" onSubmit={e => { e.preventDefault(); if (!draft.trim() || !state.authenticated) return; void run(() => NativeLocal.sendMessage({ text: draft })).then(result => { if (result) setDraft(''); }); }}>
          <CircleButton disabled={!state.authenticated} aria-label={tx('إرفاق ملفات', 'Attach files')} onClick={() => router.push('/local/send')}><Plus size={20} /></CircleButton>
          <Glass className="inp"><textarea rows={1} aria-label={tx('رسالة للجهاز المتصل', 'Message to the connected device')} placeholder={tx('أدخل الرسالة…', 'Message…')} value={draft} maxLength={4000} onChange={e => setDraft(e.target.value)} /></Glass>
          <CircleButton type="submit" tinted disabled={!state.authenticated || !draft.trim() || busy} aria-label={tx('إرسال الرسالة', 'Send message')}><Send size={18} /></CircleButton>
        </form>
      </>, document.body)}
    </>}

    {current === 'home' && <nav className="bottom-nav local-nav" aria-label={tx('التنقل في النقل المحلي', 'Local transfer navigation')}>
      <LiquidChoices kind="navigation" value="home" label={tx('النقل المحلي', 'Local transfer')} items={[{ value: 'home', label: tx('الرئيسية', 'Home'), icon: <Home /> }, { value: 'send', label: tx('إرسال', 'Send'), icon: <ArrowUpFromLine /> }, { value: 'receive', label: tx('استلام', 'Receive'), icon: <ArrowDownToLine /> }]} onValueChange={v => router.push(v === 'home' ? '/local' : v === 'receive' ? '/local/setup' : '/local/send')} />
    </nav>}
    {current === 'session' && !sessionPage && <section className="card lf-empty"><Lock size={30} /><h2>{tx('لا توجد جلسة نقل بدأت بالفعل', 'No transfer session has started')}</h2><p>{tx('الاقتران وحده لا يكفي لعرض نجاح أو تقدم.', 'Pairing alone does not justify showing success or progress.')}</p><AppLink href="/local">{tx('العودة', 'Go back')}</AppLink></section>}
  </main>;
}
