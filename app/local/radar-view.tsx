import { useEffect, useState } from 'react';
import { DesignIcon } from '../../app/design-icons';
import { NativeLocal, localSupported, type UserProfile } from '../../lib/native-local';
import { DEFAULT_AVATAR_COUNT, validateName } from '../../lib/nearby';
import type { RadarRequest } from './use-radar';

/* Ten built-in avatars: a palette plus a shared silhouette. Only the index is
   stored on the device and advertised, never the picture. */
const AVATAR_COLORS = ['#E792B9', '#7FC8B8', '#8FA8E0', '#E0B27F', '#B79FE0', '#7FBFE0', '#E08F8F', '#9FD07F', '#E0D07F', '#9F9FD0'];

export function AvatarBubble({ index, image, name, size = 44 }: { index: number; image?: string; name?: string; size?: number }) {
  const color = AVATAR_COLORS[((index % AVATAR_COLORS.length) + AVATAR_COLORS.length) % AVATAR_COLORS.length];
  return (
    <span className="lf-av" style={{ width: size, height: size, background: image ? '#0B0B0D' : color }}>
      {image
        ? <img src={image} alt="" width={size} height={size} />
        : <svg viewBox="0 0 24 24" width={size * 0.62} height={size * 0.62} fill="none" stroke="#101013" strokeWidth="1.9" strokeLinecap="round"><circle cx="12" cy="8.6" r="3.5" /><path d="M5 20c0-3.6 3.1-5.6 7-5.6s7 2 7 5.6" /></svg>}
      {!image && name ? <i className="sr-only">{name}</i> : null}
    </span>
  );
}

/* One shared record for the whole app: the header, the scanner and the profile
   screen must never disagree, and the bridge must not be asked twice. */
let cachedProfile: UserProfile | null = null;
let profilePending: Promise<UserProfile> | null = null;
export function rememberProfile(profile: UserProfile) { cachedProfile = profile; profilePending = Promise.resolve(profile); }

export function useProfile(word: string) {
  const [profile, setProfile] = useState<UserProfile | null>(cachedProfile);
  useEffect(() => {
    if (!localSupported()) return;
    let live = true;
    const pending = cachedProfile ? Promise.resolve(cachedProfile) : (profilePending = profilePending ?? NativeLocal.profileGet({ word }));
    void pending.then(next => {
      cachedProfile = next;
      if (live) setProfile(next);
    }).catch(() => { profilePending = null; });
    return () => { live = false; };
  }, [word]);
  const update = (next: UserProfile) => { rememberProfile(next); setProfile(next); };
  return [profile, update] as const;
}

/** The header entry: the user's own picture, circular, where the menu used to be. */
export function ProfileButton({ profile, onOpen, label }: { profile: UserProfile | null; onOpen: () => void; label: string }) {
  return (
    <button type="button" className="glass cap lf-avatar-button" onClick={onOpen} aria-label={label}>
      <AvatarBubble index={profile?.defaultAvatarIndex ?? 0} image={profile?.avatar || undefined} size={38} />
    </button>
  );
}

/** Receivers discovered by the radar, as circles inside the scanner sheet. */
export function PeerCircles({ peers, disabled, onPick, ar }: {
  peers: { endpointId: string; name: string; avatarIndex: number; avatar?: string }[];
  disabled: boolean; onPick: (endpointId: string) => void; ar: boolean;
}) {
  if (!peers.length) return null;
  return (
    <ul className="lf-peers" aria-label={ar ? 'المستلمون القريبون' : 'Nearby receivers'}>
      {peers.map(peer => (
        <li key={peer.endpointId}>
          <button type="button" className="lf-peer-circle" disabled={disabled} onClick={() => onPick(peer.endpointId)}
            aria-label={ar ? `جهاز: ${peer.name}، اضغط للاتصال` : `Device: ${peer.name}, tap to connect`}>
            <AvatarBubble index={peer.avatarIndex} image={peer.avatar} size={56} />
            <b>{peer.name}</b>
          </button>
        </li>
      ))}
    </ul>
  );
}

export function RadarConfirm(props: { tx: (a: string, b: string) => string; request: RadarRequest; busy: boolean; onAccept: () => void; onReject: () => void }) {
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

export function ProfileScreen(props: {
  ar: boolean; tx: (a: string, b: string) => string; profile: UserProfile | null;
  onSaved: (profile: UserProfile) => void; onBack: () => void;
  onHistory: () => void; onPrivacy: () => void;
}) {
  const { tx, profile, onSaved, onBack, onHistory, onPrivacy } = props;
  const [name, setName] = useState(profile?.displayName || '');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { setName(profile?.displayName || ''); }, [profile?.displayName]);

  const save = async () => {
    const checked = validateName(name);
    if (checked.issue) {
      const text = { empty: tx('اكتب اسمًا أولًا.', 'Write a name first.'), 'too-long': tx('الاسم أطول من ٢٤ حرفًا.', 'The name is longer than 24 characters.'), control: tx('الاسم يحتوي أحرفًا غير مسموحة.', 'The name contains characters that are not allowed.'), bidi: tx('الاسم يحتوي أحرف اتجاه مخفية.', 'The name contains hidden direction characters.') }[checked.issue];
      setNote(text);
      return;
    }
    setBusy(true); setNote('');
    try { const next = await NativeLocal.profileSetName({ name: checked.name }); onSaved(next); setName(next.displayName); setNote(tx('تم حفظ الاسم.', 'Name saved.')); }
    catch { setNote(tx('تعذر حفظ الاسم.', 'The name could not be saved.')); }
    finally { setBusy(false); }
  };
  const pick = async () => {
    setBusy(true); setNote('');
    try { const next = await NativeLocal.profilePickAvatar(); onSaved(next); setNote(tx('تم تحديث الصورة.', 'Picture updated.')); }
    catch (error) {
      const code = String((error as { message?: string })?.message || '');
      setNote(code.includes('CANCELLED') ? '' : tx('تعذر استخدام هذه الصورة.', 'That picture could not be used.'));
    } finally { setBusy(false); }
  };
  const choose = async (index: number) => {
    setBusy(true);
    try { const next = await NativeLocal.profileSetDefaultAvatar({ index }); onSaved(next); }
    catch { setNote(tx('تعذر تغيير الصورة.', 'The picture could not be changed.')); }
    finally { setBusy(false); }
  };

  return (
    <div className="lf-p">
      <header className="lf-p-top">
        <button type="button" className="glass cap lf-r-back" onClick={onBack} aria-label={tx('رجوع', 'Back')}><DesignIcon name="chev" style={{ width: 18, height: 18 }} /></button>
        <div className="glass cap lf-r-title">{tx('ملفي الشخصي', 'My profile')}</div>
      </header>

      <div className="lf-p-scroll">
        <div className="lf-p-hero">
          <AvatarBubble index={profile?.defaultAvatarIndex ?? 0} image={profile?.avatar || undefined} size={116} />
          <button type="button" className="glass cap tinted lf-p-camera" disabled={busy} onClick={() => void pick()} aria-label={tx('تغيير الصورة', 'Change the picture')}>
            <DesignIcon name="cam" style={{ width: 18, height: 18 }} />{tx('صورة من المعرض', 'Picture from the gallery')}
          </button>
        </div>

        <div className="glass lf-p-card">
          <label className="lf-p-label" htmlFor="lf-name">{tx('الاسم الظاهر للآخرين', 'Name others see')}</label>
          <div className="lf-p-field">
            <input id="lf-name" className="lf-p-input" value={name} maxLength={32} onChange={event => setName(event.target.value)}
              placeholder={tx('اسمك', 'Your name')} enterKeyHint="done" />
            <button type="button" className="glass cap tinted lf-p-save" disabled={busy} onClick={() => void save()}>{tx('حفظ', 'Save')}</button>
          </div>
          <p className="lf-p-hint">{tx('هذا الاسم يظهر على رادار الأجهزة القريبة.', 'This name appears on nearby devices’ radars.')}</p>
          {note && <p className="lf-p-note" role="status">{note}</p>}
        </div>

        <div className="glass lf-p-card">
          <p className="lf-p-label">{tx('صورة افتراضية', 'A built-in picture')}</p>
          <ul className="lf-p-avatars">
            {Array.from({ length: DEFAULT_AVATAR_COUNT }, (_, index) => (
              <li key={index}>
                <button type="button" className={`lf-p-avatar${profile && profile.avatarType === 'default' && profile.defaultAvatarIndex === index ? ' is-on' : ''}`}
                  disabled={busy} onClick={() => void choose(index)} aria-label={tx(`الصورة ${index + 1}`, `Picture ${index + 1}`)}>
                  <AvatarBubble index={index} size={44} />
                </button>
              </li>
            ))}
          </ul>
        </div>

        <div className="lf-p-links">
          <button type="button" className="glass cap lf-r-quiet" onClick={onHistory}>{tx('السجل', 'History')}</button>
          <button type="button" className="glass cap lf-r-quiet" onClick={onPrivacy}>{tx('الخصوصية', 'Privacy')}</button>
        </div>

        {profile && <p className="lf-p-id">{tx('معرّف مختصر', 'Short id')}: {profile.userId.slice(0, 8)}</p>}
      </div>
    </div>
  );
}
