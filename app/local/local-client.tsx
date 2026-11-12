"use client";
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Button, Glass } from 'glisse';
import { useI18n } from '../lang-provider';
import { AppLink, usePathname, useRouter } from '../router';
import { LiquidChoices } from '../liquid-controls';
import { CircleButton } from '../design-system';
import { DesignIcon } from '../design-icons';
import { AppMenu } from '../app-menu';
import { BackChevron, ProgressiveBlur } from '../progressive-blur';
import { NativeLocal, displayLabel, emptyLocalState, localSessionVisible, localSupported, transferRatio, type LocalFile, type LocalState, type NativeBounds } from '../../lib/native-local';
import './local.css';

type IconName = Parameters<typeof DesignIcon>[0]['name'];
const categories: { id: string; ar: string; en: string; icon: IconName; mime: string }[] = [
  { id: 'apps', ar: 'تطبيقات', en: 'Apps', icon: 'apps', mime: 'application/vnd.android.package-archive' },
  { id: 'images', ar: 'صور', en: 'Photos', icon: 'image', mime: 'image/*' },
  { id: 'videos', ar: 'فيديو', en: 'Videos', icon: 'video', mime: 'video/*' },
  { id: 'audio', ar: 'صوت', en: 'Audio', icon: 'music', mime: 'audio/*' },
  { id: 'files', ar: 'ملفات', en: 'Files', icon: 'doc', mime: '*/*' },
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
  TURN_ON_LOCATION: ['فعّل خدمة الموقع (Location) في Android. الأجهزة التي تعمل بإصدار أقدم من Android 13 تحتاجها لفتح اتصال محلي.', 'Turn on Location services. Androids older than 13 need it for a local link.'],
  JOIN_FAILED: ['تعذر بدء الاتصال بهذا الرمز. أعد مسح رمز المستقبل.', 'Could not start the connection with this code. Scan the receiver’s code again.'],
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

/** Pictures are fetched for the first screenful of rows, never for all. */
const THUMB_ROWS = 48;

/** Per app run: a leftover native selection is dropped once, at boot. */
let selectionReset = false;

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
  const [catalogue, setCatalogue] = useState<LocalFile[]>([]), [sheetOpen, setSheetOpen] = useState(false);
  const [listLoading, setListLoading] = useState(false);
  const [draft, setDraft] = useState(''), [scanning, setScanning] = useState(false), [qrShown, setQrShown] = useState(false), [foreground, setForeground] = useState(true);
  const [found, setFound] = useState<{ raw: string; device?: string } | null>(null), [connecting, setConnecting] = useState(false);
  const surface = useRef<HTMLDivElement>(null), qrSurface = useRef<HTMLDivElement>(null), request = useRef(0), autoCamera = useRef(false);
  // One automatic attempt per screen entry. Every prompt behind these refs is an
  // official Android dialog/screen; the rows stay as an explicit retry.
  const askedStorage = useRef(false), askedNearby = useRef(false), autoReceive = useRef(false), askedMedia = useRef(false);
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
  /** Automatic prompts must never block the screen: a system settings page can
   *  stay open for minutes, so `busy` is reserved for user-initiated actions. */
  const ask = useCallback((action: () => Promise<unknown>) => {
    if (!native) return;
    void action()
      .then(result => { if (result && typeof result === 'object' && 'revision' in result) apply(result as LocalState); })
      .catch(e => setError(errorCode(e)));
  }, [apply, native]);
  useEffect(() => {
    if (!native) return;
    let dead = false;
    const listener = NativeLocal.addListener('state', s => { if (!dead) apply(s); });
    void NativeLocal.getState().then(async s => {
      if (dead) return;
      // A selection left over from an earlier run must not look pre-chosen, so it
      // is dropped once at boot — never while the user is working on this screen.
      if (!selectionReset && s.selected.length && !s.started) {
        selectionReset = true;
        try { const cleared = await NativeLocal.clearSelection(); if (!dead) s = cleared; } catch { /* keep the snapshot */ }
        if (dead) return;
      }
      apply(s);
    }).catch(e => setError(errorCode(e)));
    return () => { dead = true; void listener.then(l => l.remove()); void NativeLocal.hideNativeView(); };
  }, [native, apply]);
  useEffect(() => {
    if (!native) return;
    let live = true;
    const listener = NativeLocal.addListener('lifecycle', ({ active }) => {
      if (!live) return;
      setForeground(active); setScanning(false); if (!active) setQrShown(false);
      // Returning from an Android settings screen (all-files access) must be
      // reflected immediately, otherwise the granted scope looks missing.
      if (active) void NativeLocal.getState().then(s => { if (live) apply(s); }).catch(() => {});
    });
    return () => { live = false; void listener.then(handle => handle.remove()); };
  }, [native, apply]);
  useEffect(() => { if (activeSession && (current === 'receive' || current === 'scan' || current === 'setup')) router.replace('/local/session'); }, [activeSession, current, router]);
  useEffect(() => { if (state.phase === 'connecting' || state.phase === 'error' || state.authenticated) setScanning(false); }, [state.phase, state.authenticated]);
  useEffect(() => {
    if (!native || current !== 'send') return;
    let dead = false;
    const id = ++request.current;
    setListLoading(true);
    // The catalogue is pure metadata and arrives in one fast call; pictures are
    // fetched afterwards in small batches so the list never waits for bitmaps.
    void NativeLocal.listFiles({ category }).then(v => {
      if (dead || id !== request.current) return;
      const seen = new Set<string>();
      const rows = v.files.filter(f => (seen.has(f.id) ? false : (seen.add(f.id), true)));
      setCatalogue(rows); setListLoading(false);
      const ids = rows.slice(0, THUMB_ROWS).map(f => f.id);
      void (async () => {
        for (let at = 0; at < ids.length; at += 12) {
          if (dead || id !== request.current) return;
          try {
            const { thumbs } = await NativeLocal.thumbnails({ ids: ids.slice(at, at + 12) });
            if (dead || id !== request.current) return;
            setCatalogue(previous => previous.map(f => (thumbs[f.id] ? { ...f, thumb: thumbs[f.id] } : f)));
          } catch { return; }
        }
      })();
    }).catch(e => { if (!dead) { setListLoading(false); setError(errorCode(e)); } });
    return () => { dead = true; };
  }, [category, current, native]);
  // The official prompts are asked on every visit, never cached.
  useEffect(() => {
    if (current !== 'send' && current !== 'setup') { askedStorage.current = false; askedMedia.current = false; }
  }, [current]);
  useEffect(() => { setScanning(false); setQrShown(false); if (native) void NativeLocal.hideNativeView(); }, [current, native]);
  // Storage: Android 11+ grants "all files" only on its own settings screen, and
  // ≤10 uses the classic read/write dialog. Open whichever applies as soon as
  // Send is entered, so the catalogue is never empty for lack of a prompt.
  useEffect(() => {
    if (!native || current !== 'send' || askedStorage.current || typeof state.storageReady !== 'boolean') return;
    if (state.storageReady) return;
    askedStorage.current = true;
    ask(() => NativeLocal.requestStorage());
  }, [ask, current, native, state.storageReady]);
  // Android 13+ falls back to the official photo/video/audio dialog when the
  // all-files screen was declined; apps need neither.
  useEffect(() => {
    if (!native || current !== 'send' || category === 'apps' || askedMedia.current) return;
    if (state.media === undefined || state.media) return;
    askedMedia.current = true;
    ask(() => NativeLocal.requestMedia());
  }, [ask, category, current, native, state.media]);
  // Nearby devices: the official dialog is opened by Prepare itself.
  useEffect(() => {
    if (current !== 'setup') { askedNearby.current = false; return; }
    if (!native || askedNearby.current || typeof state.nearby !== 'boolean') return;
    if (state.nearby) return;
    askedNearby.current = true;
    ask(() => NativeLocal.requestNearby());
  }, [ask, current, native, state.nearby]);
  // Receiving is automatic: entering Receive starts the best available link.
  useEffect(() => {
    if (!native || current !== 'receive') { if (current !== 'receive') autoReceive.current = false; return; }
    if (autoReceive.current || busy || state.qrReady || state.authenticated || state.phase === 'preparing') return;
    autoReceive.current = true;
    ask(() => NativeLocal.startReceive({ method: 'auto' }));
  }, [ask, busy, current, native, state.authenticated, state.phase, state.qrReady]);
  useEffect(() => {
    if (!native || !foreground || current !== 'receive' || !state.qrReady || !qrSurface.current) return;
    let live = true;
    if (!qrSurface.current) return;
    void NativeLocal.showPairingCode(bounds(qrSurface.current)).then(() => { if (live) setQrShown(true); }).catch(e => setError(errorCode(e)));
    return () => { live = false; setQrShown(false); void NativeLocal.hideNativeView(); };
  }, [current, native, state.qrReady, foreground]);
  useEffect(() => {
    const node = current === 'receive' ? qrSurface.current : surface.current;
    if (!native || !node) return;
    let frame = 0;
    const update = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(() => { if (node.isConnected) void NativeLocal.updateNativeView(bounds(node)).catch(() => {}); }); };
    const observer = new ResizeObserver(update);
    observer.observe(node);
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
  // The native layer reads the code; the page shows the device and connects on tap.
  useEffect(() => {
    if (!native) return;
    let handle: { remove: () => Promise<void> } | undefined;
    void NativeLocal.addListener('scan', payload => {
      setScanning(false);
      setConnecting(false);
      setFound({ raw: payload.raw, device: payload.device });
    }).then(h => { handle = h; });
    return () => { void handle?.remove(); };
  }, [native]);
  useEffect(() => { if (current !== 'scan') { setFound(null); setConnecting(false); } }, [current]);
  const connectFound = async () => {
    if (!found) return;
    setConnecting(true);
    await run(() => NativeLocal.join({ raw: found.raw }));
    setConnecting(false);
  };
  const rescan = async () => { setFound(null); await openScanner(); };
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
  const scanHeadline = found ? tx('تم العثور على جهاز', 'Device found')
    : connecting || state.phase === 'connecting' ? tx('جارٍ الاتصال…', 'Connecting…')
      : code && !scanning ? tx('تعذر إكمال المسح', 'The scan did not complete')
        : tx('البحث عن مستلمين…', 'Looking for receivers…');
  const methodLabel = state.method === 'direct' ? 'Wi-Fi Direct' : state.method === 'hotspot' ? tx('نقطة محلية', 'Local hotspot') : state.method === 'lan' ? tx('شبكة محلية', 'Local Wi-Fi') : tx('تلقائي', 'Automatic');
  // Every indicator must be green: the link scope, Wi-Fi, and a storage route
  // (all-files, or the MediaStore fallback that every Android 10+ device has).
  const legacyLocation = (state.sdk ?? 99) < 33;
  const setupReady = !!state.nearby && !!state.wifi && (!legacyLocation || state.locationOn !== false) && (!!state.storageReady || (state.sdk ?? 0) >= 29);
  const done = state.files.filter(f => f.status === 'complete').length;

  return <main className={`local-page ${sessionPage ? 'local-session' : ''}`} data-page="local" data-screen={current} data-phase={state.phase}>
    <header className={current === 'home' ? 'app-header lf-home-header' : 'support-toolbar lf-toolbar'}>
      {current === 'home' ? <>
        <div className="brand-group">
          <button type="button" className="brand" onClick={back} aria-label={tx('العودة للنقل البصري', 'Return to optical transfer')}>
            <svg width="30" height="30" viewBox="0 0 30 30" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true"><rect x="3" y="3" width="10" height="10" rx="3" /><rect x="17" y="3" width="10" height="10" rx="3" /><rect x="3" y="17" width="10" height="10" rx="3" /><rect x="17" y="17" width="10" height="10" rx="3" fill="var(--tint)" stroke="none" /></svg>
            QRFerry
          </button>
          <button type="button" className="brand-mode" onClick={back} aria-label={tx('العودة للنقل البصري', 'Return to optical transfer')}><DesignIcon name="chev" /></button>
        </div>
        <AppMenu onNavigate={href => router.push(href)} />
      </> : <>
        <Button className="support-exit" icon={<BackChevron />} aria-label={tx('رجوع', 'Back')} onClick={back} />
        <Glass className="support-title"><h1>{title}</h1></Glass>
        <div className="lf-toolbar-end">
          {current === 'send' && <Button className="lf-tool" icon={<DesignIcon name="folder" />} aria-label={tx('تصفح ملفات الجهاز', 'Browse device files')} disabled={!native} onClick={() => void pick()} />}
        </div>
      </>}
    </header>

    {!native && <section className="card local-notice"><DesignIcon name="phone" /><h2>{tx('هذه المنظومة تعمل داخل تطبيق Android', 'This mode runs inside the Android app')}</h2><p>{tx('الاتصال والملفات والكاميرا تعمل محليًا في طبقة Android. المنظومة البصرية الحالية ما زالت متاحة.', 'Networking, files and camera run in the native Android layer. The existing optical mode is still available.')}</p><AppLink href="/">{tx('العودة إلى المنظومة الحالية', 'Return to the existing mode')}</AppLink></section>}
    {!!message && <div className="local-error" role="alert"><p>{message}</p>{error && <button type="button" onClick={() => setError('')}>{tx('إخفاء', 'Dismiss')}</button>}</div>}
    {native && state.recoveryWarning && <p className="local-error" role="alert">{tx('تعذر حفظ سجل الاستعادة. الأجزاء المستلمة محفوظة، لكن قد تحتاج لإعادة اختيار الملفات.', 'The recovery record could not be saved. Received parts are retained, but sources may need selecting again.')}</p>}

    {current === 'home' && <>
      <section className="lf-orb" aria-hidden="true"><i /><i /><i /><div className="lf-core"><DesignIcon name="up" style={{ width: 30, height: 30 }} /></div></section>
      <h1 className="lf-h1">{tx('انقل ملفاتك مباشرة', 'Move your files directly')}</h1>
      <p className="lf-sub">{tx('بين هاتفين، عبر اتصال محلي موثّق. لا إنترنت في مسار النقل.', 'Between two phones over an authenticated local link. No internet in the transfer path.')}</p>
      <div className="lf-row local-actions">
        <button type="button" className="glass cap tinted lf-big" disabled={!native} onClick={() => router.push('/local/send')}><DesignIcon name="up" style={{ width: 20, height: 20 }} />{tx('إرسال', 'Send')}</button>
        <button type="button" className="glass cap lf-big" disabled={!native} onClick={() => router.push('/local/setup')}><DesignIcon name="down" style={{ width: 20, height: 20 }} />{tx('استلام', 'Receive')}</button>
      </div>
      {state.started && <button type="button" className="card lf-li lf-resume" onClick={() => router.push('/local/session')}><span className="lf-ic"><DesignIcon name="shield" style={{ width: 22, height: 22 }} /></span><span className="lf-gr"><b>{tx('الجلسة الحالية', 'Current session')}</b><small>{state.authenticated ? tx('موثّقة — عرض التقدم', 'Verified — view progress') : tx('متوقفة — عرض الحالة', 'Paused — view state')}</small></span><DesignIcon name="chev" style={{ width: 18, height: 18 }} /></button>}
      <button type="button" className="card lf-li" onClick={() => router.push('/local/send')}><span className="lf-ic"><DesignIcon name="folder" style={{ width: 22, height: 22 }} /></span><span className="lf-gr"><b>{tx('الملفات', 'Files')}</b><small>{tx('تصفّح ملفات جهازك واختر ما تريد', 'Browse your device files and choose')}</small></span><DesignIcon name="chev" style={{ width: 18, height: 18 }} /></button>
      <h2 className="lf-h2">{tx('الأخيرة', 'Recent')}</h2>
      {state.files.length ? <div className="card lf-list">{state.files.slice(-6).reverse().map(f => <div className="lf-li" key={f.id}><span className="lf-ic">{f.direction === 'in' ? <DesignIcon name="down" style={{ width: 20, height: 20 }} /> : <DesignIcon name="up" style={{ width: 20, height: 20 }} />}</span><span className="lf-gr"><b>{displayLabel(f)}</b><small>{size(f.size)} · {f.status === 'complete' ? tx('اكتمل', 'Complete') : `${Math.floor(transferRatio(f) * 100)}%`}</small></span></div>)}</div>
        : <div className="card lf-empty"><p>{tx('لا يوجد سجل نقل بعد.', 'No transfers yet.')}</p></div>}
      {state.recovered && <section className="card local-recovery"><h2>{tx('جلسة سابقة قابلة للاستعادة', 'A previous session can be resumed')}</h2><p>{tx('استُعيدت الملفات والسجل. أعد الاقتران برمز جديد لإكمال التحقق ونقل الأجزاء الناقصة.', 'Files and history were restored. Pair again with a new code to re-authenticate and finish the missing parts.')}</p></section>}
    </>}

    {current === 'send' && <>
      <div className="glass lf-seg" role="tablist" aria-label={tx('نوع الملفات', 'File type')}>
        {categories.map(c => <button type="button" key={c.id} role="tab" aria-selected={category === c.id} className={category === c.id ? 'on' : ''} onClick={() => setCategory(c.id)}>{ar ? c.ar : c.en}</button>)}
      </div>
      {catalogue.length > 0 && <p className="lf-count" role="status">{new Intl.NumberFormat(ar ? 'ar-EG' : 'en-US').format(catalogue.length)} {tx('عنصرًا في هذا التصنيف', 'items in this category')}</p>}
      {native && state.storageReady === false && <button type="button" className="lf-perm-banner" data-perm="storage" onClick={() => void run(() => NativeLocal.requestStorage())}>
        <DesignIcon name="shield" style={{ width: 18, height: 18 }} />
        <span>{tx('الوصول لكل الملفات غير ممنوح — التطبيق يرى ملفاته فقط.', 'All files access is not granted — the app only sees its own files.')}</span>
        <b>{tx('منح', 'Allow')}</b>
      </button>}
      <section className="card lf-list" aria-live="polite">

        {listLoading && <div className="lf-empty lf-loading" data-loading=""><DesignIcon name="folder" style={{ width: 26, height: 26 }} /><p>{tx('جارٍ قراءة الملفات من الجهاز…', 'Reading files from this device…')}</p></div>}

        {catalogue.length ? catalogue.map(f => <button type="button" data-file-row="" className={`lf-li ${selected.has(f.id) ? 'sel' : ''}`} key={f.id} aria-pressed={selected.has(f.id)} disabled={busy} onClick={() => void run(() => NativeLocal.selectFile({ id: f.id, selected: !selected.has(f.id) }))}>
          <span className="lf-ic">{f.thumb ? <img src={f.thumb} alt="" loading="lazy" /> : <DesignIcon name="apps" style={{ width: 20, height: 20 }} />}</span>
          <span className="lf-gr"><b>{displayLabel(f)}</b><small>{size(f.size)}{f.splitCount && f.splitCount > 1 ? ` · ${f.splitCount} APK` : ''}</small></span>
          <span className={`lf-ck ${selected.has(f.id) ? 'on' : ''}`}><DesignIcon name="ok" style={{ width: 15, height: 15 }} /></span>
        </button>) : <div className="lf-empty" hidden={listLoading}><DesignIcon name="folder" style={{ width: 30, height: 30 }} /><p>{tx('لا توجد عناصر في هذا التصنيف. استخدم زر التصفح لاختيار ملفات من جهازك.', 'Nothing in this category. Use Browse to choose files from your device.')}</p></div>}
      </section>
      <div className="lf-bar">
        <div className="glass lf-bx">
          <button type="button" className="lf-sum" data-sheet="selection" onClick={() => setSheetOpen(true)} aria-expanded={sheetOpen}>{state.selected.length} {tx('محدد', 'selected')}<small>{size(totalSize)}</small></button>
          <div className="local-send-action">
            <button type="button" className="glass cap tinted" disabled={!native || busy || !state.selected.length} onClick={() => { if (activeSession) { void run(() => NativeLocal.sendSelected()); router.push('/local/session'); } else router.push('/local/scan'); }}><DesignIcon name="up" style={{ width: 18, height: 18 }} />{tx('إرسال', 'Send')}</button>
          </div>
        </div>
      </div>
    </>}

    {current === 'setup' && <>
      <h1 className="lf-h1 lf-h1-sm">{tx('تحضير الاستلام', 'Prepare to receive')}</h1>
      <p className="lf-sub">{tx('تظهر هنا نوافذ Android الرسمية فقط. كل عنصر يوضح حالته على هذا الجهاز وإصداره.', 'Only official Android dialogs appear here. Each row reflects this device and its Android version.')}</p>
      <div className="card lf-list">
        <div className="lf-li"><span className="lf-ic"><DesignIcon name="wifi" style={{ width: 20, height: 20 }} /></span><span className="lf-gr"><b>Wi-Fi</b><small>{state.wifi ? tx('مفعّل', 'On') : tx('متوقف — يجب تفعيله', 'Off — required')}</small></span>{state.wifi ? <span className="lf-ok"><DesignIcon name="ok" style={{ width: 16, height: 16 }} /></span> : <button type="button" className="glass cap lf-small" onClick={() => void run(() => NativeLocal.openSettings({ which: 'wifi' }))}>{tx('فتح الإعدادات', 'Open settings')}</button>}</div>
        {legacyLocation && !state.locationOn && <div className="lf-li"><span className="lf-ic"><DesignIcon name="full" style={{ width: 20, height: 20 }} /></span><span className="lf-gr"><b>{tx('خدمة الموقع', 'Location service')}</b><small>{tx('مطلوبة في هذا الإصدار من Android لفتح اتصال محلي', 'Required on this Android version for a local link')}</small></span><button type="button" className="glass cap lf-small" onClick={() => void run(() => NativeLocal.openSettings({ which: 'location' }))}>{tx('فتح', 'Open')}</button></div>}
        <div className="lf-li"><span className="lf-ic"><DesignIcon name="shield" style={{ width: 20, height: 20 }} /></span><span className="lf-gr"><b>{tx('الأجهزة القريبة', 'Nearby devices')}</b><small>{state.nearby ? tx('مسموح', 'Allowed') : tx('غير مسموح — ستظهر نافذة Android', 'Not allowed — the Android dialog will appear')}</small></span>{state.nearby ? <span className="lf-ok"><DesignIcon name="ok" style={{ width: 16, height: 16 }} /></span> : <button type="button" className="glass cap lf-small" onClick={() => void run(() => NativeLocal.requestNearby())}>{tx('السماح', 'Allow')}</button>}</div>
        <div className="lf-li"><span className="lf-ic"><DesignIcon name="folder" style={{ width: 20, height: 20 }} /></span><span className="lf-gr"><b>{tx('حفظ الملفات', 'Saving files')}</b><small>{state.storageReady ? (state.destination || 'QRFerry') : state.sdk && state.sdk >= 30 ? tx('الوصول إلى كل الملفات غير ممنوح', 'All-files access is not granted') : tx('إذن التخزين غير ممنوح', 'Storage permission is not granted')}</small></span>{state.storageReady ? <span className="lf-ok"><DesignIcon name="ok" style={{ width: 16, height: 16 }} /></span> : <button type="button" className="glass cap lf-small" onClick={() => void run(() => NativeLocal.requestStorage())}>{tx('السماح', 'Allow')}</button>}</div>
      </div>
      <div className="lf-bar"><div className="glass lf-bx"><div className="lf-row lf-bx-row"><button type="button" className="glass cap tinted lf-big" disabled={!native || busy || !setupReady} onClick={() => router.push('/local/receive')}><DesignIcon name="down" style={{ width: 19, height: 19 }} />{tx('متابعة إلى الاستلام', 'Continue to receive')}</button></div></div></div>
      {!setupReady && <p className="lf-hint">{tx('يفتح Android نافذته الرسمية عند الضغط على «السماح». لن يظهر أي شيء من تصميمنا بدلًا منها.', 'Android opens its own dialog when you press Allow. Nothing of our design replaces it.')}</p>}
    </>}

    {current === 'scan' && (
      <div className="lf-s">
        <div className="lf-s-stage">
          <div className="lf-s-frame">
            <div className="local-native-surface lf-s-preview" ref={surface} aria-label={tx('معاينة كاميرا المسح الأصلية', 'Native scan camera preview')} />
            <b className="lf-s-cn" /><b className="lf-s-cn" /><b className="lf-s-cn" /><b className="lf-s-cn" />
            <i className="lf-s-laser" aria-hidden="true" />
          </div>
          <div className="glass cap lf-s-hint">
            <DesignIcon name="qr" style={{ width: 17, height: 17 }} />
            {tx('ضع رمز QR داخل الإطار', 'Place the QR code inside the frame')}
          </div>
        </div>

        <div className="lf-s-sheet">
          <i className="lf-s-grab" aria-hidden="true" />
          <div className={`lf-s-radar${scanning && !found && !connecting && !code ? '' : ' is-off'}`} aria-hidden="true">
            <div className="lf-s-sweep" />
            <em /><em /><em />
            <i className="lf-s-bl" style={{ left: 'calc(50% - 118px)', bottom: 128, animationDelay: '1s' }} />
            <i className="lf-s-bl" style={{ left: 'calc(50% + 102px)', bottom: 104, animationDelay: '1.7s' }} />
            <i className="lf-s-bl" style={{ left: 'calc(50% + 28px)', bottom: 162, animationDelay: '2.4s' }} />
            <div className="lf-s-core"><DesignIcon name="wifi" style={{ width: 30, height: 30 }} /></div>
          </div>

          <h2 className="lf-s-h" role="status">{scanHeadline}</h2>

          {found ? <>
            <div className="lf-s-found">
              <span className="lf-s-dev">{(found.device || 'QR').slice(0, 2).toUpperCase()}</span>
              <div className="lf-s-gr">
                <b>{found.device || tx('جهاز المستقبل', 'Receiver')}</b>
                <small>{tx('قريب · جاهز للاستلام', 'Nearby · ready to receive')}</small>
              </div>
            </div>
            <div className="lf-s-actions">
              <button type="button" className="glass cap tinted lf-s-big" disabled={busy} onClick={() => void connectFound()}>
                <DesignIcon name="wifi" style={{ width: 19, height: 19 }} />{tx('اتصال', 'Connect')}
              </button>
              <button type="button" className="glass cap lf-s-quiet" disabled={busy} onClick={rescan}>{tx('مسح آخر', 'Scan again')}</button>
            </div>
          </> : code && !scanning && !connecting ? <>
            <p className="lf-s-msg">{message}</p>
            <div className="lf-s-actions">
              <button type="button" className="glass cap tinted lf-s-big" disabled={busy} onClick={rescan}>{tx('إعادة المسح', 'Scan again')}</button>
              <button type="button" className="glass cap lf-s-quiet" onClick={() => void run(() => NativeLocal.openSettings({ which: 'app' }))}>{tx('الإعدادات', 'Settings')}</button>
            </div>
          </> : <>
            <p className="lf-s-msg">{!state.camera ? tx('يحتاج المسح إلى الكاميرا. سيظهر إذن Android الرسمي.', 'Scanning needs the camera. Android’s own dialog will appear.') : state.phase === 'connecting' ? (state.method === 'hotspot' ? tx('وافق على نافذة Android للاتصال بشبكة المستقبل…', 'Accept the Android prompt to join the receiver’s network…') : tx('جارٍ الاتصال والتحقق…', 'Connecting and verifying…')) : state.phase === 'preparing-files' ? tx('تم التحقق. تجهيز الملفات…', 'Verified. Preparing files…') : tx('وجّه الكاميرا إلى رمز الاقتران على جهاز المستقبل.', 'Point the camera at the pairing code on the receiver.')}</p>
            <div className="lf-s-actions">
              {!scanning && !state.authenticated && <button type="button" className="glass cap tinted lf-s-big" disabled={!native || busy} onClick={() => void openScanner()}>
                <DesignIcon name="cam" style={{ width: 19, height: 19 }} />{!state.camera ? tx('السماح بالكاميرا', 'Allow the camera') : tx('فتح الكاميرا', 'Open camera')}
              </button>}
              {scanning && <button type="button" className="glass cap lf-s-quiet" onClick={closeCamera}>{tx('إيقاف الكاميرا', 'Stop the camera')}</button>}
            </div>
          </>}
        </div>
      </div>
    )}

    {current === 'receive' && <>
      <div className="lf-qr-wrap" ref={surface}>
        <div className="local-native-surface lf-qr" ref={qrSurface} aria-label={tx('رمز الاقتران الأصلي', 'Native pairing QR')}>
          {/* While the link is being prepared this plate is a quiet
              placeholder; the live code is drawn by the native layer into
              exactly this box. */}
          <DesignIcon name="qr" style={{ width: 44, height: 44 }} />
        </div>
      </div>
      <div className="lf-bar"><div className="glass lf-bx lf-bx-compact">
        {!(state.qrReady || state.authenticated || state.phase === 'preparing')
          ? <button type="button" className="glass cap tinted lf-act" disabled={!native || busy} onClick={() => void run(() => NativeLocal.startReceive({ method: 'auto' }))}><DesignIcon name="wifi" style={{ width: 18, height: 18 }} />{tx('بدء الاتصال', 'Start link')}</button>
          : <span className="lf-live"><i />{state.authenticated
              ? tx('تم التحقق من المرسل', 'Sender verified')
              : qrShown ? `${tx('الرمز جاهز', 'Code ready')} · ${methodLabel}` : tx('جارٍ عرض الرمز…', 'Rendering the code…')}</span>}
        <button type="button" className="glass cap lf-act lf-act-quiet" onClick={() => void end()}>{tx('إلغاء', 'Cancel')}</button>
      </div></div>
    </>}

    {sessionPage && <>
      <div className="lf-progress">
        <span className="lf-pct">{Math.floor(state.files.length ? (state.files.reduce((n, f) => n + transferRatio(f), 0) / state.files.length) * 100 : 0)}%</span>
        <div className="lf-progress-meta"><b>{size(state.files.reduce((n, f) => n + Math.min(f.bytes, f.size), 0))} / {size(state.files.reduce((n, f) => n + f.size, 0))}</b><small>{state.authenticated ? (state.paused ? tx('متوقف مؤقتًا', 'Paused') : tx('جارٍ النقل', 'Transferring')) : tx('بانتظار إعادة الاتصال', 'Waiting to reconnect')}</small></div>
      </div>
      <h2 className="lf-h2">{tx('الملفات', 'Files')} · {done}/{state.files.length}</h2>
      <section className="card lf-list">{state.files.map(f => <div className="lf-li lf-file" data-file-row="" key={f.id}>
        <span className="lf-ic">{f.direction === 'in' ? <DesignIcon name="down" style={{ width: 20, height: 20 }} /> : <DesignIcon name="up" style={{ width: 20, height: 20 }} />}</span>
        <span className="lf-gr"><b>{displayLabel(f)}</b><span className="lf-tr"><i style={{ width: `${Math.round(transferRatio(f) * 100)}%` }} /></span></span>
        <span className={`lf-st ${f.status === 'complete' ? 'ok' : ''}`}>{f.status === 'complete' ? <DesignIcon name="ok" style={{ width: 16, height: 16 }} /> : `${Math.floor(transferRatio(f) * 100)}%`}</span>
      </div>)}</section>
      <div className="lf-row lf-session-actions">
        <button type="button" className="glass cap lf-big" disabled={!state.authenticated} onClick={() => state.recovered ? router.push(state.role === 'receive' ? '/local/receive' : '/local/scan') : void run(() => NativeLocal.pause({ paused: !state.paused && state.phase !== 'paused' }))}>{state.paused || state.phase === 'paused' ? <DesignIcon name="play" style={{ width: 18, height: 18 }} /> : <DesignIcon name="pause" style={{ width: 18, height: 18 }} />}{state.paused || state.phase === 'paused' ? tx('استكمال', 'Resume') : tx('إيقاف مؤقت', 'Pause')}</button>
        <button type="button" className="glass cap lf-big" onClick={() => void end()}>{tx('إنهاء الجلسة', 'End session')}</button>
      </div>
      <div className="lf-msgs">{state.messages.map(m => <div className={`lf-bb ${m.direction === 'out' ? 'me' : ''}`} data-msg="" key={m.id}><p>{m.text}</p><small>{m.direction === 'out' ? (m.status === 'delivered' ? tx('وصلت', 'Delivered') : m.status === 'sending' ? tx('جارٍ الإرسال', 'Sending') : m.status === 'failed' ? tx('لم تُرسل', 'Not sent') : tx('أُرسلت', 'Sent')) : new Date(m.time).toLocaleTimeString(lang, { hour: '2-digit', minute: '2-digit' })}</small></div>)}</div>
      {createPortal(<>
        <ProgressiveBlur edge="bottom" />
        <form className="bridge-composer lf-composer" onSubmit={e => { e.preventDefault(); if (!draft.trim() || !state.authenticated) return; void run(() => NativeLocal.sendMessage({ text: draft })).then(result => { if (result) setDraft(''); }); }}>
          <CircleButton disabled={!state.authenticated} aria-label={tx('إرفاق ملفات', 'Attach files')} onClick={() => router.push('/local/send')}><DesignIcon name="plus" style={{ width: 20, height: 20 }} /></CircleButton>
          <Glass className="inp"><textarea rows={1} aria-label={tx('رسالة للجهاز المتصل', 'Message to the connected device')} placeholder={tx('أدخل الرسالة…', 'Message…')} value={draft} maxLength={4000} onChange={e => setDraft(e.target.value)} /></Glass>
          <CircleButton type="submit" tinted disabled={!state.authenticated || !draft.trim() || busy} aria-label={tx('إرسال الرسالة', 'Send message')}><DesignIcon name="sendup" style={{ width: 18, height: 18 }} /></CircleButton>
        </form>
      </>, document.body)}
    </>}

    {sheetOpen && <div className="lf-scrim" role="presentation" onClick={() => setSheetOpen(false)}>
      <section className="lf-dialog" role="dialog" aria-modal="true" aria-label={tx('العناصر المحددة', 'Selected items')} onClick={e => e.stopPropagation()}>
        <header className="lf-dialog-head"><h2>{state.selected.length} {tx('محدد للإرسال', 'selected to send')}</h2>
          <button type="button" className="glass circle" aria-label={tx('إغلاق', 'Close')} onClick={() => setSheetOpen(false)}><DesignIcon name="x" style={{ width: 18, height: 18 }} /></button></header>
        <div className="lf-dialog-list">
          {state.selected.length ? state.selected.map(f => <div className="lf-li" data-selected-row="" key={f.id}>
            <span className="lf-ic">{f.thumb ? <img src={f.thumb} alt="" loading="lazy" /> : <DesignIcon name="doc" style={{ width: 20, height: 20 }} />}</span>
            <span className="lf-gr"><b>{displayLabel(f)}</b><small>{size(f.size)}</small></span>
            <button type="button" className="glass circle lf-remove" aria-label={tx('إزالة من التحديد', 'Remove from selection')} disabled={busy} onClick={() => void run(() => NativeLocal.selectFile({ id: f.id, selected: false }))}><DesignIcon name="x" style={{ width: 16, height: 16 }} /></button>
          </div>) : <p className="lf-empty">{tx('لم تختر أي عنصر بعد.', 'Nothing selected yet.')}</p>}
        </div>
        <div className="lf-dialog-foot">
          <button type="button" className="glass cap lf-act" onClick={() => setSheetOpen(false)}>{tx('تم', 'Done')}</button>
        </div>
      </section>
    </div>}

    {current === 'home' && <nav className="bottom-nav local-nav" aria-label={tx('التنقل في النقل المحلي', 'Local transfer navigation')}>
      <LiquidChoices kind="navigation" value="home" label={tx('النقل المحلي', 'Local transfer')} items={[{ value: 'home', label: tx('الرئيسية', 'Home'), icon: <DesignIcon name="home" /> }, { value: 'send', label: tx('إرسال', 'Send'), icon: <DesignIcon name="up" /> }, { value: 'receive', label: tx('استلام', 'Receive'), icon: <DesignIcon name="down" /> }]} onValueChange={v => router.push(v === 'home' ? '/local' : v === 'receive' ? '/local/setup' : '/local/send')} />
    </nav>}
    {current === 'session' && !sessionPage && <section className="card lf-empty"><DesignIcon name="lock" style={{ width: 30, height: 30 }} /><h2>{tx('لا توجد جلسة نقل بدأت بالفعل', 'No transfer session has started')}</h2><p>{tx('الاقتران وحده لا يكفي لعرض نجاح أو تقدم.', 'Pairing alone does not justify showing success or progress.')}</p><AppLink href="/local">{tx('العودة', 'Go back')}</AppLink></section>}
  </main>;
}
