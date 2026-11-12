import { useEffect, useState } from 'react';
import { DesignIcon } from '../../app/design-icons';
import { NativeLocal, localSupported, type UserProfile } from '../../lib/native-local';
import { DEFAULT_AVATAR_COUNT, radarSlot } from '../../lib/nearby';
import type { RadarMode, RadarPeerView, RadarRequest, RadarState } from './use-radar';

/* Ten built-in avatars: a palette plus a shared silhouette. Only the index is
   stored on the device and advertised, never the picture. */
const AVATAR_COLORS = ['#E792B9', '#7FC8B8', '#8FA8E0', '#E0B27F', '#B79FE0', '#7FBFE0', '#E08F8F', '#9FD07F', '#E0D07F', '#9F9FD0'];

export function AvatarBubble({ index, image, name, size = 44 }: { index: number; image?: string; name?: string; size?: number }) {
  const color = AVATAR_COLORS[((index % AVATAR_COLORS.length) + AVATAR_COLORS.length) % AVATAR_COLORS.length];
  return (
    <span className="lf-av" style={{ width: size, height: size, background: image ? '#000' : color }} aria-hidden="true">
      {image
        ? <img src={image} alt="" width={size} height={size} />
        : <svg viewBox="0 0 24 24" width={size * 0.62} height={size * 0.62} fill="none" stroke="#101013" strokeWidth="1.9" strokeLinecap="round"><circle cx="12" cy="8.6" r="3.5" /><path d="M5 20c0-3.6 3.1-5.6 7-5.6s7 2 7 5.6" /></svg>}
      {!image && name ? <i className="sr-only">{name}</i> : null}
    </span>
  );
}

export function ProfilePill({ profile, onOpen, label }: { profile: UserProfile | null; onOpen: () => void; label: string }) {
  return (
    <button type="button" className="glass cap lf-profile-pill" onClick={onOpen} aria-label={label}>
      <AvatarBubble index={profile?.defaultAvatarIndex ?? 0} image={profile?.avatar || undefined} size={26} />
      <b><bdi>{profile?.displayName || label}</bdi></b>
    </button>
  );
}

const STATE_TEXT: Record<string, [string, string]> = {
  idle: ['الرادار متوقف', 'Radar is stopped'],
  advertising: ['أنت ظاهر الآن على الأجهزة القريبة', 'You are visible to nearby devices'],
  discovering: ['البحث عن أجهزة قريبة…', 'Looking for nearby devices'],
  error: ['تعذر تشغيل الرادار', 'The radar could not start'],
};

export function RadarScreen(props: {
  ar: boolean; tx: (a: string, b: string) => string;
  radar: RadarState; mode: RadarMode;
  hasFiles: boolean;
  onConnect: (peer: RadarPeerView) => void;
  onStart: () => void;
  onBack: () => void;
  onUseQr: () => void;
}) {
  const { tx, radar, hasFiles, onConnect, onStart, onBack, onUseQr } = props;
  const status = STATE_TEXT[radar.error ? 'error' : radar.mode] || STATE_TEXT.idle;
  const peers = radar.peers;

  return (
    <div className="lf-r">
      <header className="lf-r-top">
        <button type="button" className="glass cap lf-r-back" onClick={onBack} aria-label={tx('رجوع', 'Back')}>
          <DesignIcon name="chev" style={{ width: 18, height: 18 }} />
        </button>
        <div className="glass cap lf-r-title">{tx('الاقتران القريب', 'Nearby pairing')}</div>
      </header>

      <div className="lf-r-stage">
        <div className={`lf-r-radar${radar.mode === 'discovering' ? '' : ' is-idle'}`} aria-hidden="true">
          <div className="lf-r-sweep" />
          <em /><em /><em />
          {peers.slice(0, 8).map((peer, index) => {
            const slot = radarSlot(peer.id, 8);
            const angle = (slot / 8) * Math.PI * 2 - Math.PI / 2;
            const radius = 108;
            return (
              <span key={peer.endpointId} className="lf-r-node" style={{ transform: `translate(${Math.cos(angle) * radius}px, ${Math.sin(angle) * radius}px)`, animationDelay: `${index * 80}ms` }}>
                <AvatarBubble index={peer.avatarIndex} image={peer.avatar} size={46} />
              </span>
            );
          })}
          <div className="lf-r-core"><DesignIcon name="wifi" style={{ width: 28, height: 28 }} /></div>
        </div>
        <p className="lf-r-state" role="status">{radar.error ? tx('تعذر تشغيل الرادار', 'The radar could not start') : tx(status[0], status[1])}</p>
        {radar.error ? <p className="lf-r-hint">{tx('تأكد من تشغيل البلوتوث ومنح إذن الأجهزة القريبة.', 'Make sure Bluetooth is on and the nearby permission is granted.')}</p>
          : <p className="lf-r-hint">{tx('اطلب من صديقك فتح صفحة الاستلام.', 'Ask your friend to open the Receive page.')}</p>}
      </div>

      <div className="lf-r-sheet">
        <i className="lf-r-grab" aria-hidden="true" />
        <h2>{peers.length ? tx('اختر جهازًا', 'Choose a device') : tx('لا توجد أجهزة بعد', 'No devices yet')}</h2>
        {!hasFiles && <p className="lf-r-warn">{tx('اختر ملفات من صفحة الإرسال أولًا.', 'Choose files on the Send page first.')}</p>}
        <ul className="lf-r-list">
          {peers.map(peer => (
            <li key={peer.endpointId}>
              <button type="button" className="lf-r-peer" disabled={!hasFiles || !!radar.outgoing || !!radar.connected}
                onClick={() => onConnect(peer)} aria-label={`${tx('جهاز', 'Device')}: ${peer.name}, ${tx('اضغط للاتصال', 'tap to connect')}`}>
                <AvatarBubble index={peer.avatarIndex} image={peer.avatar} size={46} />
                <span className="lf-r-peer-text"><b><bdi>{peer.name}</bdi></b><small>{tx('قريب · جاهز للاستلام', 'Nearby · ready to receive')}</small></span>
                <DesignIcon name="chev" style={{ width: 18, height: 18 }} />
              </button>
            </li>
          ))}
        </ul>
        {radar.outgoing && (
          <p className="lf-r-wait" role="status">
            {radar.outgoing.digits
              ? tx(`بانتظار قبول ${radar.outgoing.name}… الرمز ${radar.outgoing.digits}`, `Waiting for ${radar.outgoing.name}… code ${radar.outgoing.digits}`)
              : tx(`جارٍ الاتصال بـ ${radar.outgoing.name}…`, `Connecting to ${radar.outgoing.name}…`)}
          </p>
        )}
        <div className="lf-r-actions">
          {radar.mode !== 'discovering' && <button type="button" className="glass cap tinted lf-r-big" onClick={onStart}><DesignIcon name="wifi" style={{ width: 18, height: 18 }} />{tx('تشغيل الرادار', 'Start the radar')}</button>}
          <button type="button" className="glass cap lf-r-quiet" onClick={onUseQr}>{tx('استخدم الباركود بدلًا من ذلك', 'Use the QR code instead')}</button>
        </div>
      </div>
    </div>
  );
}

export function RadarConfirm(props: { ar: boolean; tx: (a: string, b: string) => string; request: RadarRequest; busy: boolean; onAccept: () => void; onReject: () => void }) {
  const { tx, request, busy, onAccept, onReject } = props;
  return (
    <div className="lf-confirm" role="dialog" aria-modal="true" aria-label={tx('تأكيد الاتصال', 'Confirm the connection')}>
      <div className="glass lf-confirm-box">
        <AvatarBubble index={request.avatarIndex} size={64} />
        <h2>{tx(`${request.name} يريد إرسال ملفات إليك`, `${request.name} wants to send you files`)}</h2>
        {request.digits && <>
          <p className="lf-confirm-code" aria-label={tx('رمز التحقق', 'verification code')}>{request.digits}</p>
          <p className="lf-confirm-note">{tx('تأكد أن نفس الرقم يظهر على جهازه قبل القبول.', 'Make sure the same digits appear on their device before accepting.')}</p>
        </>}
        <div className="lf-confirm-actions">
          <button type="button" className="glass cap tinted lf-r-big" disabled={busy} onClick={onAccept}>{tx('قبول', 'Accept')}</button>
          <button type="button" className="glass cap lf-r-quiet" disabled={busy} onClick={onReject}>{tx('رفض', 'Reject')}</button>
        </div>
      </div>
    </div>
  );
}

export function ProfileScreen(props: { tx: (a: string, b: string) => string; profile: UserProfile | null; onSaved: (p: UserProfile) => void; onBack: () => void }) {
  const { tx, profile, onSaved, onBack } = props;
  const [name, setName] = useState(profile?.displayName || '');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { setName(profile?.displayName || ''); }, [profile?.displayName]);

  const save = async () => {
    setBusy(true); setNote('');
    try { const next = await NativeLocal.profileSetName({ name }); onSaved(next); setNote(tx('تم حفظ الاسم.', 'Name saved.')); }
    catch { setNote(tx('تعذر حفظ الاسم.', 'The name could not be saved.')); }
    finally { setBusy(false); }
  };
  const pick = async () => {
    setBusy(true); setNote('');
    try { const next = await NativeLocal.profilePickAvatar(); onSaved(next); }
    catch (error) {
      const code = String((error as { message?: string })?.message || '');
      setNote(code.includes('CANCELLED') ? '' : tx('تعذر استخدام هذه الصورة.', 'That picture could not be used.'));
    } finally { setBusy(false); }
  };
  const reset = async () => {
    setBusy(true);
    try { const next = await NativeLocal.profileSetDefaultAvatar({ index: Math.floor(Math.random() * DEFAULT_AVATAR_COUNT) }); onSaved(next); }
    finally { setBusy(false); }
  };

  return (
    <div className="lf-p">
      <header className="lf-r-top">
        <button type="button" className="glass cap lf-r-back" onClick={onBack} aria-label={tx('رجوع', 'Back')}><DesignIcon name="chev" style={{ width: 18, height: 18 }} /></button>
        <div className="glass cap lf-r-title">{tx('ملفي الشخصي', 'My profile')}</div>
      </header>
      <div className="lf-p-body">
        <AvatarBubble index={profile?.defaultAvatarIndex ?? 0} image={profile?.avatar || undefined} size={112} />
        <div className="lf-p-row"><button type="button" className="glass cap lf-r-big" disabled={busy} onClick={() => void pick()}>{tx('تغيير الصورة', 'Change the picture')}</button></div>
        <label className="lf-p-label" htmlFor="lf-name">{tx('الاسم الظاهر', 'Display name')}</label>
        <input id="lf-name" className="lf-p-input" value={name} maxLength={32} onChange={event => setName(event.target.value)} placeholder={tx('اسمك', 'Your name')} />
        <div className="lf-p-actions">
          <button type="button" className="glass cap tinted lf-r-big" disabled={busy} onClick={() => void save()}>{tx('حفظ', 'Save')}</button>
          <button type="button" className="glass cap lf-r-quiet" disabled={busy} onClick={() => void reset()}>{tx('استعادة صورة افتراضية', 'Use a default picture')}</button>
        </div>
        {note && <p className="lf-r-hint" role="status">{note}</p>}
        {profile && <p className="lf-p-id">{tx('معرّف مختصر', 'Short id')}: {profile.userId.slice(0, 8)}</p>}
      </div>
    </div>
  );
}

/** Loads the profile once per screen entry; it is created silently on first use. */
export function useProfile(word: string, onLoaded?: (profile: UserProfile) => void) {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  useEffect(() => {
    if (!localSupported()) return;
    let live = true;
    void NativeLocal.profileGet({ word }).then(next => { if (!live) return; setProfile(next); onLoaded?.(next); }).catch(() => { /* profile is retried next entry */ });
    return () => { live = false; };
  }, [word]);
  return [profile, setProfile] as const;
}
