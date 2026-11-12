import { useCallback, useEffect, useRef, useState } from 'react';
import { NativeLocal, localSupported, type RadarEvent } from '../../lib/native-local';
import {
  SERVICE_ID, decodeAdvertisement, encodeAdvertisement, isRejected,
  markPeerLost, prunePeers, rejectPeer, upsertPeer, type PeerBucket, type Profile,
} from '../../lib/nearby';

export type RadarMode = 'idle' | 'advertising' | 'discovering';
export interface RadarPeerView { endpointId: string; id: string; name: string; avatarIndex: number; avatarVersion: number; avatar?: string }
export interface RadarRequest { endpointId: string; name: string; avatarIndex: number; digits: string }
export interface RadarState {
  mode: RadarMode;
  peers: RadarPeerView[];
  request: RadarRequest | null;      // receiver: incoming connection awaiting confirmation
  outgoing: { endpointId: string; name: string; digits: string } | null;
  connected: string | null;
  error: string;
  busy: boolean;
}

const initial: RadarState = { mode: 'idle', peers: [], request: null, outgoing: null, connected: null, error: '', busy: false };
const ACCEPT_TIMEOUT = 30000;
const CONNECT_TIMEOUT = 15000;

/** Owns advertising, discovery, the confirmation dialog and the card exchange.
 *  The pairing it produces is the same string the QR carries, so nothing about
 *  the transfer, progress or history has to know this path exists. */
export function useRadar(options: {
  profile: Profile | null;
  role: 'receive' | 'send';
  onPaired: (raw: string) => void;
  onError: (code: string) => void;
}) {
  const { profile, role, onPaired, onError } = options;
  const [state, setState] = useState<RadarState>(initial);
  const bucket = useRef<PeerBucket>({ peers: [], rejected: {} });
  const names = useRef(new Map<string, { payload: string; name: string; avatarIndex: number }>());
  const timers = useRef<{ accept?: ReturnType<typeof setTimeout>; connect?: ReturnType<typeof setTimeout>; sweep?: ReturnType<typeof setInterval> }>({});
  const request = useRef<RadarRequest | null>(null);
  const connectedRef = useRef<string>('');
  const profileRef = useRef<Profile | null>(null);
  profileRef.current = profile;

  const clearTimers = () => {
    if (timers.current.accept) clearTimeout(timers.current.accept);
    if (timers.current.connect) clearTimeout(timers.current.connect);
    if (timers.current.sweep) clearInterval(timers.current.sweep);
    timers.current = {};
  };

  const publish = useCallback((next: Partial<RadarState> = {}) => {
    const bucketNow = prunePeers(bucket.current, Date.now());
    bucket.current = bucketNow;
    setState(previous => ({
      ...previous,
      ...next,
      peers: bucketNow.peers.map(entry => ({
        endpointId: entry.endpointId, id: entry.id, name: entry.name,
        avatarIndex: entry.avatarIndex, avatarVersion: entry.avatarVersion,
        avatar: previous.peers.find(peer => peer.id === entry.id)?.avatar,
      })),
    }));
  }, []);

  const stop = useCallback(async () => {
    clearTimers();
    connectedRef.current = '';
    request.current = null;
    if (localSupported()) { try { await NativeLocal.radarStop(); } catch { /* already stopped */ } }
    setState({ ...initial });
  }, []);

  const advertise = useCallback(async (current: Profile) => {
    if (!localSupported()) return;
    const payload = encodeAdvertisement(current);
    try {
      await NativeLocal.radarStart({ mode: 'advertise', payload, serviceId: SERVICE_ID });
      setState(previous => ({ ...previous, mode: 'advertising', error: '' }));
    } catch (error) { onError(String((error as { message?: string })?.message || 'RADAR_UNAVAILABLE')); }
  }, [onError]);

  const discover = useCallback(async () => {
    if (!localSupported()) return;
    if (!profileRef.current) return;
    try {
      await NativeLocal.radarStart({ mode: 'discover', payload: encodeAdvertisement(profileRef.current), serviceId: SERVICE_ID });
      setState(previous => ({ ...previous, mode: 'discovering', error: '' }));
    } catch (error) { onError(String((error as { message?: string })?.message || 'RADAR_UNAVAILABLE')); }
  }, [onError]);

  const accept = useCallback(async () => {
    const pending = request.current;
    const current = profileRef.current;
    if (!pending || !current) return;
    if (timers.current.accept) clearTimeout(timers.current.accept);
    setState(previous => ({ ...previous, busy: true }));
    try { await NativeLocal.radarAccept({ endpointId: pending.endpointId }); }
    catch (error) { onError(String((error as { message?: string })?.message || 'RADAR_UNAVAILABLE')); }
    setState(previous => ({ ...previous, busy: false }));
  }, [onError]);

  const reject = useCallback(async () => {
    const pending = request.current;
    if (!pending) return;
    if (timers.current.accept) clearTimeout(timers.current.accept);
    request.current = null;
    bucket.current = rejectPeer(bucket.current, pending.endpointId, Date.now());
    try { await NativeLocal.radarReject({ endpointId: pending.endpointId }); } catch { /* nothing to clean */ }
    setState(previous => ({ ...previous, request: null }));
    publish();
  }, [publish]);

  const connect = useCallback(async (peer: RadarPeerView) => {
    const current = profileRef.current;
    if (!current) return;
    if (connectedRef.current) return;
    if (timers.current.connect) clearTimeout(timers.current.connect);
    connectedRef.current = peer.endpointId;
    setState(previous => ({ ...previous, outgoing: { endpointId: peer.endpointId, name: peer.name, digits: '' }, error: '' }));
    timers.current.connect = setTimeout(() => {
      if (connectedRef.current !== peer.endpointId) return;
      connectedRef.current = '';
      setState(previous => ({ ...previous, outgoing: null, error: 'CONNECT_TIMEOUT' }));
      void stop();
    }, CONNECT_TIMEOUT);
    try { await NativeLocal.radarConnect({ endpointId: peer.endpointId, payload: encodeAdvertisement(current) }); }
    catch (error) { onError(String((error as { message?: string })?.message || 'RADAR_UNAVAILABLE')); }
  }, [onError, stop]);

  /** The card carries the display identity; the picture only travels after the
   *  connection is confirmed, never in the advertisement. */
  const sendCard = useCallback(async (endpointId: string) => {
    const current = profileRef.current;
    if (!current) return;
    let avatar = '';
    try { avatar = (await NativeLocal.radarSharedAvatar()).avatar; } catch { avatar = ''; }
    const card = {
      t: 'card', v: 1, userId: current.userId, displayName: current.displayName,
      avatarVersion: current.avatarVersion, hasCustomAvatar: current.avatarType === 'custom',
      avatar: avatar.length > 40000 ? '' : avatar,
    };
    try { await NativeLocal.radarSend({ endpointId, message: JSON.stringify(card) }); } catch { /* peer left */ }
  }, []);

  const handOverPairing = useCallback(async (endpointId: string) => {
    // The receiver may still be opening its local link: wait for the code.
    for (let attempt = 0; attempt < 24; attempt += 1) {
      try {
        const { code } = await NativeLocal.radarPairingCode();
        if (code) {
          await NativeLocal.radarSend({ endpointId, message: JSON.stringify({ t: 'pairing', raw: code }) });
          return;
        }
      } catch { /* not ready yet */ }
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    try { await NativeLocal.radarSend({ endpointId, message: JSON.stringify({ t: 'error', code: 'NOT_READY' }) }); } catch { /* peer left */ }
    onError('QR_NOT_READY');
  }, [onError]);

  useEffect(() => {
    if (!localSupported()) return;
    let handle: { remove: () => Promise<void> } | undefined;
    const handleEvent = (event: RadarEvent) => {
      const now = Date.now();
      if (event.type === 'peer') {
        const advertisement = decodeAdvertisement(event.value);
        if (!advertisement) return;
        if (isRejected(bucket.current, advertisement.id, now)) return;
        if (bucket.current.peers.some(peer => peer.endpointId === event.endpointId && peer.id === advertisement.id)) return;
        names.current.set(event.endpointId, { payload: event.value, name: advertisement.name, avatarIndex: advertisement.avatarIndex });
        bucket.current = upsertPeer(bucket.current, {
          endpointId: event.endpointId, id: advertisement.id, name: advertisement.name,
          avatarIndex: advertisement.avatarIndex, avatarVersion: advertisement.avatarVersion,
        });
        publish();
        return;
      }
      if (event.type === 'peer-lost') {
        bucket.current = markPeerLost(bucket.current, event.endpointId, now);
        publish();
        if (timers.current.sweep) clearInterval(timers.current.sweep);
        timers.current.sweep = setInterval(() => { publish(); }, 1000);
        return;
      }
      if (event.type === 'request') {
        const advertisement = decodeAdvertisement(event.value);
        if (!advertisement) return;
        if (request.current) return; // one active request at a time
        if (isRejected(bucket.current, advertisement.id, now)) { void NativeLocal.radarReject({ endpointId: event.endpointId }); return; }
        const pending: RadarRequest = {
          endpointId: event.endpointId, name: advertisement.name,
          avatarIndex: advertisement.avatarIndex, digits: event.digits || '',
        };
        request.current = pending;
        setState(previous => ({ ...previous, request: pending }));
        timers.current.accept = setTimeout(() => {
          if (request.current?.endpointId !== pending.endpointId) return;
          request.current = null;
          setState(previous => ({ ...previous, request: null, error: 'REQUEST_TIMEOUT' }));
          void NativeLocal.radarReject({ endpointId: pending.endpointId });
        }, ACCEPT_TIMEOUT);
        return;
      }
      if (event.type === 'connecting') {
        setState(previous => previous.outgoing ? { ...previous, outgoing: { ...previous.outgoing, digits: event.digits || '' } } : previous);
        return;
      }
      if (event.type === 'connected') {
        if (timers.current.connect) clearTimeout(timers.current.connect);
        if (timers.current.accept) clearTimeout(timers.current.accept);
        request.current = null;
        setState(previous => ({ ...previous, connected: event.endpointId, request: null }));
        void sendCard(event.endpointId);
        return;
      }
      if (event.type === 'message') {
        let message: { t?: string; raw?: string; code?: string; userId?: string; displayName?: string; avatar?: string } = {};
        try { message = JSON.parse(event.value); } catch { return; }
        if (message.t === 'card' && message.userId) {
          const key = message.userId;
          const avatar = message.avatar ? `data:image/jpeg;base64,${message.avatar}` : '';
          setState(previous => ({ ...previous, peers: previous.peers.map(peer => (peer.id === key.slice(0, 8).replace(/-/g, '') ? { ...peer, name: message.displayName || peer.name, avatar: avatar || peer.avatar } : peer)) }));
          return;
        }
        if (message.t === 'pairing' && typeof message.raw === 'string' && message.raw.startsWith('QFL1:')) {
          // The sender now leaves the radar for the verified session.
          void stop();
          onPaired(message.raw);
          return;
        }
        if (message.t === 'error' && message.code) onError(message.code);
        return;
      }
      if (event.type === 'closed') {
        if (request.current?.endpointId === event.endpointId) { request.current = null; setState(previous => ({ ...previous, request: null })); }
        if (connectedRef.current === event.endpointId) {
          connectedRef.current = '';
          setState(previous => ({ ...previous, outgoing: null, connected: null }));
        }
        publish();
        return;
      }
      if (event.type === 'status') {
        if (event.value === 'error') onError(event.endpointId || 'RADAR_UNAVAILABLE');
      }
    };
    void NativeLocal.addListener('radar', handleEvent).then(listener => { handle = listener; });
    return () => { void handle?.remove(); clearTimers(); };
  }, [onError, onPaired, publish, sendCard, stop]);

  // The receiver hands over the pairing code as soon as a peer is confirmed.
  useEffect(() => {
    const endpointId = state.connected;
    if (!endpointId || role !== 'receive') return;
    void handOverPairing(endpointId);
  }, [state.connected, handOverPairing, role]);

  return { state, advertise, discover, connect, accept, reject, stop };
}
