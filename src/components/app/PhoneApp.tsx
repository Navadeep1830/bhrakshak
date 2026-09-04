'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Box, Stack, Typography, Chip, Paper, IconButton, Badge, Snackbar, Alert, AppBar, Toolbar, Tooltip,
} from '@mui/material';
import MapIcon from '@mui/icons-material/Map';
import PhotoCameraFrontIcon from '@mui/icons-material/PhotoCameraFront';
import NotificationsActiveIcon from '@mui/icons-material/NotificationsActive';
import SyncIcon from '@mui/icons-material/Sync';
import LandscapeIcon from '@mui/icons-material/Landscape';
import DesktopWindowsIcon from '@mui/icons-material/DesktopWindows';
import { hazardColor } from '@/components/theme';
import type { SessionUser } from '@/components/login-gate';
import AppMapView from './AppMapView';
import AppReport from './AppReport';
import AppAlerts from './AppAlerts';
import AppSync from './AppSync';
import StreetViewModal, { StreetViewTarget } from './StreetViewModal';
import type { AppNotification, AppSms, AppZone, BootstrapData, RoutePlanUI } from './types';
import type { QueuedReport } from '@/lib/offline-store';

interface Props {
  user: SessionUser;
  /** standalone (APK / /mobile) mode: omit to hide the back-to-website button */
  onExit?: () => void;
}

const LS = {
  deviceId: 'bhr-device-id',
  deviceInfo: 'bhr-device-info',
  bootCache: 'bhr-boot-cache',
  lastNotifTs: 'bhr-last-notif-ts',
  simOffline: 'bhr-sim-offline',
  lastSync: 'bhr-last-sync',
  userPos: 'bhr-user-pos',
};

type Screen = 'map' | 'report' | 'alerts' | 'sync';

const SCREENS: Array<{ id: Screen; label: string; icon: React.ReactNode }> = [
  { id: 'map', label: 'Map', icon: <MapIcon sx={{ fontSize: 20 }} /> },
  { id: 'report', label: 'Report', icon: <PhotoCameraFrontIcon sx={{ fontSize: 20 }} /> },
  { id: 'alerts', label: 'Alerts', icon: <NotificationsActiveIcon sx={{ fontSize: 20 }} /> },
  { id: 'sync', label: 'Sync', icon: <SyncIcon sx={{ fontSize: 20 }} /> },
];

function lsGet<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}
function lsSet(key: string, v: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch { /* quota */ }
}

export default function PhoneApp({ user, onExit }: Props) {
  const [boot, setBoot] = useState<BootstrapData | null>(() => lsGet<BootstrapData | null>(LS.bootCache, null));
  const [screen, setScreen] = useState<Screen>('map');
  const [online, setOnline] = useState(true);
  const [simOffline, setSimOffline] = useState<boolean>(() => lsGet(LS.simOffline, false));
  const [queue, setQueue] = useState<QueuedReport[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [lastSync, setLastSync] = useState<string | null>(() => lsGet<string | null>(LS.lastSync, null));
  const [deviceId] = useState<string>(() => {
    const existing = lsGet<string | null>(LS.deviceId, null);
    if (existing) return existing;
    const id = `pwa-${Math.random().toString(36).slice(2, 10)}`;
    lsSet(LS.deviceId, id);
    return id;
  });
  const [device, setDevice] = useState<{ name: string; phone: string; district: string | null }>(() =>
    lsGet(LS.deviceInfo, { name: `${user.fullName.split(' ')[0]}'s phone`, phone: '+919876543210', district: null })
  );
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [sms, setSms] = useState<AppSms[]>([]);
  const [unread, setUnread] = useState(0);
  const [pushEnabled, setPushEnabled] = useState(false);
  const [plan, setPlan] = useState<RoutePlanUI | null>(null);
  const [userPos, setUserPos] = useState<{ lat: number; lon: number } | null>(() => lsGet<{ lat: number; lon: number } | null>(LS.userPos, null));
  const [streetTarget, setStreetTarget] = useState<StreetViewTarget | null>(null);
  const [toast, setToast] = useState<{ msg: string; sev: 'success' | 'error' | 'info' } | null>(null);

  // remember manually-set position across app re-opens
  useEffect(() => {
    if (userPos) lsSet(LS.userPos, userPos);
  }, [userPos]);

  const effectiveOnline = online && !simOffline;
  const seenNotif = useRef<Set<string>>(new Set());
  const bootedOnce = useRef(false);
  const lastTsRef = useRef<string | null>(null);

  const showToast = useCallback((msg: string, sev: 'success' | 'error' | 'info' = 'info') => {
    setToast({ msg, sev });
  }, []);

  /* ── real network listeners ── */
  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    setOnline(navigator.onLine);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => {
      window.removeEventListener('online', up);
      window.removeEventListener('offline', down);
    };
  }, []);

  /* persist simOffline */
  useEffect(() => lsSet(LS.simOffline, simOffline), [simOffline]);

  /* ── device registration (app works even without user session) ── */
  useEffect(() => {
    fetch('/api/app/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId, ...device }),
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deviceId]);

  const reRegister = useCallback((d: { name: string; phone: string; district: string | null }) => {
    setDevice(d);
    lsSet(LS.deviceInfo, d);
    fetch('/api/app/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId, ...d }),
    }).catch(() => {});
  }, [deviceId]);

  /* ── refresh queue view ── */
  const refreshQueue = useCallback(async () => {
    const { getQueue } = await import('@/lib/offline-store');
    setQueue(await getQueue());
  }, []);
  useEffect(() => { refreshQueue(); }, [refreshQueue]);

  /* ── bootstrap (online) ── */
  const doBootstrap = useCallback(async () => {
    try {
      const res = await fetch('/api/app/bootstrap', { headers: { 'x-device-id': deviceId } });
      if (!res.ok) return;
      const d: BootstrapData = await res.json();
      setBoot(d);
      lsSet(LS.bootCache, d);
    } catch { /* offline */ }
  }, [deviceId]);

  useEffect(() => {
    if (!effectiveOnline) return;
    doBootstrap();
    const iv = setInterval(doBootstrap, 30_000);
    return () => clearInterval(iv);
  }, [effectiveOnline, doBootstrap]);

  /* ── notification polling (online) ── */
  useEffect(() => {
    if (!effectiveOnline) return;
    let stop = false;
    const poll = async () => {
      try {
        const since = lastTsRef.current ?? lsGet<string | null>(LS.lastNotifTs, null) ?? new Date(Date.now() - 60_000).toISOString();
        const res = await fetch(`/api/app/notifications?since=${encodeURIComponent(since)}`, { headers: { 'x-device-id': deviceId } });
        if (!res.ok) return;
        const d = await res.json();
        if (stop) return;
        if (Array.isArray(d.sms)) setSms(d.sms);
        const evts: AppNotification[] = d.notifications ?? [];
        if (evts.length) {
          const fresh = evts.filter((n) => !seenNotif.current.has(n.id));
          if (fresh.length) {
            if (bootedOnce.current) {
              // ── the phone actually notifies ──
              setUnread((u) => u + fresh.length);
              if ('Notification' in window && Notification.permission === 'granted') {
                for (const n of fresh.slice(0, 3)) {
                  try { new Notification(`BhuRakshak ${n.kind === 'allclear' ? '✓' : '⚠'} ${n.title}`, { body: n.body.slice(0, 120) }); } catch { /* */ }
                }
              }
              if (navigator.vibrate) navigator.vibrate([180, 90, 180]);
              const top = fresh[0];
              showToast(`${fresh.length} new alert${fresh.length > 1 ? 's' : ''} — ${top.title.slice(0, 60)}`, top.level >= 3 ? 'error' : 'info');
            }
            fresh.forEach((n) => seenNotif.current.add(n.id));
            setNotifications((prev) => [...fresh, ...prev].slice(0, 100));
          }
        }
        // advance the watermark to server time
        if (d.serverTime) {
          lastTsRef.current = d.serverTime;
          lsSet(LS.lastNotifTs, d.serverTime);
        }
        bootedOnce.current = true;
      } catch { /* offline */ }
    };
    poll();
    const iv = setInterval(poll, 6_000);
    return () => { stop = true; clearInterval(iv); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveOnline, deviceId]);

  /* heartbeat so the website sees this phone as online */
  useEffect(() => {
    if (!effectiveOnline) return;
    const beat = () =>
      fetch('/api/app/notifications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceId }),
      }).catch(() => {});
    beat();
    const iv = setInterval(beat, 30_000);
    return () => clearInterval(iv);
  }, [effectiveOnline, deviceId]);

  /* ── offline queue auto-sync ── */
  const syncNow = useCallback(async () => {
    if (syncing) return;
    setSyncing(true);
    try {
      const { getQueue, removeFromQueue } = await import('@/lib/offline-store');
      const items = await getQueue();
      if (!items.length) {
        showToast('Queue is empty', 'info');
        return;
      }
      const { dataUrlToBlob } = await import('@/lib/offline-store');
      let sent = 0;
      let flagged = 0;
      for (const item of items) {
        try {
          const fd = new FormData();
          fd.set('category', item.category);
          fd.set('notes', item.notes ?? '');
          fd.set('lat', String(item.lat));
          fd.set('lon', String(item.lon));
          fd.set('deviceId', deviceId);
          fd.set('clientCreatedAt', item.clientCreatedAt);
          fd.set('offlineQueued', '1');
          if (item.photoDataUrl) fd.set('photo', dataUrlToBlob(item.photoDataUrl), 'crack.jpg');
          const res = await fetch('/api/app/report', { method: 'POST', body: fd });
          const d = await res.json();
          if (!res.ok || d.error) throw new Error(d.error || 'sync failed');
          if (d.report?.aiPreScreen === 'flagged') flagged++;
          await removeFromQueue(item.id);
          sent++;
        } catch {
          break; // network died mid-sync — keep the rest queued
        }
      }
      setQueue(await getQueue());
      setLastSync(new Date().toISOString());
      lsSet(LS.lastSync, new Date().toISOString());
      showToast(`Synced ${sent}/${items.length} report${items.length > 1 ? 's' : ''}${flagged ? ` — ${flagged} AI-flagged` : ''}`, 'success');
    } finally {
      setSyncing(false);
    }
  }, [deviceId, syncing, showToast]);

  useEffect(() => {
    if (effectiveOnline && queue.length > 0 && !syncing) {
      const t = setTimeout(() => syncNow(), 1500);
      return () => clearTimeout(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveOnline, queue.length]);

  /* ── storm demo (admin) ── */
  const [stormBusy, setStormBusy] = useState(false);
  const triggerStorm = useCallback(async (district: string) => {
    setStormBusy(true);
    try {
      const res = await fetch('/api/demo/storm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ district, peakMmPerH: 36, hours: 6 }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'storm failed');
      showToast(`Storm over ${district}: ${d.escalatedToL2plus} zones escalated, ${d.smsSent} SMS dispatched`, 'success');
      setTimeout(doBootstrap, 2500);
    } catch (e) {
      showToast((e as Error).message, 'error');
    } finally {
      setStormBusy(false);
    }
  }, [showToast, doBootstrap]);

  const enablePush = () => {
    if (!('Notification' in window)) { showToast('Browser notifications unsupported', 'error'); return; }
    Notification.requestPermission().then((p) => {
      setPushEnabled(p === 'granted');
      showToast(p === 'granted' ? 'Phone notifications enabled' : 'Permission denied', p === 'granted' ? 'success' : 'error');
    });
  };

  const zones: AppZone[] = boot?.zones ?? [];
  const districts = [...new Set(zones.map((z) => z.district))];

  const openStreetView = (t: StreetViewTarget) => setStreetTarget(t);
  const nearbyMarks = (streetTarget
    ? zones
        .filter((z) => z.level >= 2)
        .map((z) => ({ zoneCode: z.zoneCode, level: z.level, lat: z.lat, lon: z.lon, name: z.name, distanceKm: Math.round(Math.hypot(z.lat - streetTarget.lat, z.lon - streetTarget.lon) * 89) }))
        .sort((a, b) => a.distanceKm - b.distanceKm)
        .slice(0, 6)
    : []
  ).map((m) => ({ ...m, distanceKm: Math.round((m.distanceKm / 89) * 8) })); // approx km on screen scale

  return (
    <Box
      sx={{
        position: 'fixed', inset: 0, zIndex: 1200, bgcolor: '#04070d',
        display: 'flex', alignItems: { xs: 'stretch', sm: 'center' }, justifyContent: { xs: 'stretch', sm: 'center' },
        p: { xs: 0, sm: 3 },
      }}
      onClick={(e) => e.stopPropagation()}
    >
      {/* phone frame */}
      <Box
        sx={{
          width: { xs: '100%', sm: 396 }, height: { xs: '100%', sm: 800 }, maxHeight: { sm: '92vh' },
          borderRadius: { xs: 0, sm: 4.5 }, bgcolor: '#0b1220', position: 'relative', overflow: 'hidden',
          border: { xs: 'none', sm: '10px solid #1b2432' },
          boxShadow: { sm: '0 40px 90px rgba(0,0,0,.6), inset 0 0 0 1px rgba(148,163,184,.18)' },
          display: 'flex', flexDirection: 'column',
        }}
      >
        {/* status bar */}
        <AppBar position="static" elevation={0} sx={{ bgcolor: '#0b1220', flexShrink: 0, borderBottom: '1px solid rgba(148,163,184,.12)' }}>
          <Toolbar sx={{ minHeight: { xs: 52, sm: 54 }, gap: 1 }}>
            <Box sx={{ width: 30, height: 30, borderRadius: 1.4, display: 'grid', placeItems: 'center', bgcolor: 'rgba(16,185,129,.14)', border: '1px solid rgba(16,185,129,.35)' }}>
              <LandscapeIcon sx={{ fontSize: 17, color: 'primary.main' }} />
            </Box>
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography variant="body2" sx={{ fontWeight: 800, letterSpacing: '-.01em', lineHeight: 1 }}>
                BhuRakshak Field
              </Typography>
              <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: 9.5, lineHeight: 1 }}>
                {user.fullName} · {user.role}
              </Typography>
            </Box>
            <Chip
              size="small"
              icon={<Box component="span" sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: effectiveOnline ? '#34d399' : '#f87171', boxShadow: `0 0 6px ${effectiveOnline ? '#34d399' : '#f87171'}`, display: 'inline-block' }} />}
              label={effectiveOnline ? 'LIVE' : simOffline ? 'SIM OFFLINE' : 'OFFLINE'}
              sx={{ height: 22, fontWeight: 800, fontSize: 10, bgcolor: effectiveOnline ? 'rgba(52,211,153,.1)' : 'rgba(239,68,68,.12)', color: effectiveOnline ? '#34d399' : '#f87171', border: `1px solid ${effectiveOnline ? 'rgba(52,211,153,.3)' : 'rgba(239,68,68,.35)'}` }}
            />
            {queue.length > 0 && (
              <Chip size="small" icon={<SyncIcon sx={{ fontSize: 12 }} />} label={queue.length} color="warning" sx={{ height: 22, fontWeight: 800, fontSize: 10 }} />
            )}
            {onExit && (
              <Tooltip title="Back to website">
                <IconButton size="small" onClick={onExit} sx={{ color: 'text.secondary' }}>
                  <DesktopWindowsIcon sx={{ fontSize: 18 }} />
                </IconButton>
              </Tooltip>
            )}
          </Toolbar>
        </AppBar>

        {/* screen */}
        <Box sx={{ flex: 1, minHeight: 0, position: 'relative' }}>
          {screen === 'map' && (
            <AppMapView
              zones={zones}
              roads={boot?.roads ?? []}
              shelters={boot?.shelters ?? []}
              plan={plan}
              online={effectiveOnline}
              userPos={userPos}
              onUserPos={setUserPos}
              onPlan={setPlan}
              onStreetView={openStreetView}
              onToast={showToast}
            />
          )}
          {screen === 'report' && (
            <AppReport
              online={effectiveOnline}
              zones={zones}
              userPos={userPos}
              onUserPos={setUserPos}
              deviceId={deviceId}
              onQueueChange={refreshQueue}
              onToast={showToast}
            />
          )}
          {screen === 'alerts' && (
            <AppAlerts
              notifications={notifications}
              sms={sms}
              unread={unread}
              onEnablePush={enablePush}
              pushEnabled={pushEnabled}
            />
          )}
          {screen === 'sync' && (
            <AppSync
              online={online}
              simOffline={simOffline}
              onSimOffline={setSimOffline}
              queue={queue}
              syncing={syncing}
              lastSync={lastSync}
              onSyncNow={syncNow}
              device={device}
              onDevice={reRegister}
              canDemo={user.role === 'admin' || user.role === 'district_admin'}
              onStorm={triggerStorm}
              stormBusy={stormBusy}
              districts={districts}
            />
          )}

          {/* street view overlay */}
          <StreetViewModal target={streetTarget} nearbyMarks={nearbyMarks} online={effectiveOnline} onClose={() => setStreetTarget(null)} />
        </Box>

        {/* bottom nav */}
        <Paper
          elevation={0}
          square
          sx={{
            flexShrink: 0, bgcolor: '#0b1220', borderTop: '1px solid rgba(148,163,184,.14)',
            display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', pb: { xs: 1, sm: 0 },
          }}
        >
          {SCREENS.map((s) => {
            const badge = s.id === 'alerts' ? unread : s.id === 'sync' ? queue.length : 0;
            const active = screen === s.id;
            return (
              <Box
                key={s.id}
                onClick={() => { setScreen(s.id); if (s.id === 'alerts') setUnread(0); }}
                sx={{ py: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.25, cursor: 'pointer', opacity: active ? 1 : 0.55 }}
              >
                <Badge badgeContent={badge} color={s.id === 'sync' ? 'warning' : 'error'} max={9} sx={{ '& .MuiBadge-badge': { fontSize: 9, height: 15, minWidth: 15 } }}>
                  <Box sx={{ color: active ? 'primary.main' : 'text.secondary' }}>{s.icon}</Box>
                </Badge>
                <Typography variant="caption" sx={{ fontSize: 10, fontWeight: 700, color: active ? 'primary.main' : 'text.secondary' }}>
                  {s.label}
                </Typography>
              </Box>
            );
          })}
        </Paper>

        {/* toast */}
        <Snackbar open={!!toast} autoHideDuration={4200} onClose={() => setToast(null)} anchorOrigin={{ vertical: 'top', horizontal: 'center' }}>
          <Alert severity={toast?.sev ?? 'info'} variant="filled" onClose={() => setToast(null)} sx={{ py: 0.75, '& .MuiAlert-message': { fontSize: 12.5 } }}>
            {toast?.msg}
          </Alert>
        </Snackbar>
      </Box>
    </Box>
  );
}
