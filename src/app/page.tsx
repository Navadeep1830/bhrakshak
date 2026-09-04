'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Box, Typography, Stack, Chip, Paper, AppBar, Toolbar, Tabs, Tab, Button, IconButton,
  Tooltip, Avatar, Menu, MenuItem, Divider, Snackbar, Alert,
  LinearProgress, Badge, Dialog, DialogTitle, DialogContent, DialogContentText,
} from '@mui/material';
import LandscapeIcon from '@mui/icons-material/Landscape';
import LogoutIcon from '@mui/icons-material/Logout';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import CampaignIcon from '@mui/icons-material/Campaign';
import PublicIcon from '@mui/icons-material/Public';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import LoginGate, { SessionUser } from '@/components/login-gate';
import MapView, { ZoneFeature, RoadRow, ShelterRow as MapShelter, ReportPin, EvacRoute } from '@/components/map/MapView';
import DossierDrawer from '@/components/dossier-drawer';
import EvacuationPanel, { EvacResponse } from '@/components/evacuation-panel';
import OpsView from '@/components/views/ops-view';
import AnalyticsView from '@/components/views/analytics-view';
import FieldView from '@/components/views/field-view';
import ExplorerView from '@/components/views/explorer-view';
import SimulateView from '@/components/views/simulate-view';
import PhoneApp from '@/components/app/PhoneApp';
import { hazardColor } from '@/components/theme';
import { DISTRICT_CENTERS } from '@/components/map/map-styles';

import SmartphoneIcon from '@mui/icons-material/Smartphone';
import TravelExploreIcon from '@mui/icons-material/TravelExplore';
import ScienceIcon from '@mui/icons-material/Science';

type ViewKey = 'command' | 'ops' | 'analytics' | 'field' | 'explorer' | 'simulate';

interface Kpis {
  zonesTotal: number; populationMonitored: number; populationAtRiskL3: number;
  populationExposedL2: number; activeAlerts: number; l3plusZones: number;
  pendingReports: number; verifiedReports: number; sensorsOnline: number;
  roadsBlocked: number; detoursActive: number; checkins24h: number; smsSent24h: number; fieldMessagesNew: number; sosOpen: number; districts: number; updatedAt: string;
}

interface AlertRow {
  id: string; level: number; title: string; message: string; status: string;
  createdAt: string;
  zone: { zoneCode: string; name: string; district: string } | null;
}

function useCountUp(value: number, ms = 800): number {
  const [display, setDisplay] = useState(0);
  const fromRef = useRef(0);
  useEffect(() => {
    const from = fromRef.current;
    const start = performance.now();
    let raf: number;
    const tick = (t: number) => {
      const k = Math.min(1, (t - start) / ms);
      const eased = 1 - Math.pow(1 - k, 3);
      setDisplay(Math.round(from + (value - from) * eased));
      if (k < 1) raf = requestAnimationFrame(tick);
      else fromRef.current = value;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, ms]);
  return display;
}

function KpiStat({ label, value, suffix, tone }: { label: string; value: number; suffix?: string; tone?: string }) {
  const v = useCountUp(value);
  return (
    <Box sx={{ minWidth: { xs: 90, md: 108 }, textAlign: 'left' }}>
      <Typography
        variant="overline"
        sx={{ display: 'block', lineHeight: 1, fontWeight: 700, color: 'text.secondary', fontSize: { xs: 9, md: 10 } }}
      >
        {label}
      </Typography>
      <Typography
        variant="h6"
        sx={{
          fontWeight: 800, fontFamily: 'var(--font-mono-num), monospace', lineHeight: 1.15,
          color: tone ?? 'text.primary', fontSize: { xs: 15, md: 18 },
        }}
      >
        {v.toLocaleString('en-IN')}{suffix ?? ''}
      </Typography>
    </Box>
  );
}

export default function Home() {
  const [user, setUser] = useState<SessionUser | null | undefined>(undefined);
  const [view, setView] = useState<ViewKey>('command');
  const [appMode, setAppMode] = useState(false);
  const [selectedZone, setSelectedZone] = useState<string | null>(null);
  const [originMode, setOriginMode] = useState(false);
  const [origin, setOrigin] = useState<{ lat: number; lon: number } | null>(null);
  const [evac, setEvac] = useState<EvacResponse | null>(null);
  const [flyTo, setFlyTo] = useState<{ center: [number, number]; zoom: number; key: number } | null>(null);
  const [userMenu, setUserMenu] = useState<null | HTMLElement>(null);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [toast, setToast] = useState<{ msg: string; sev: 'success' | 'error' | 'info' } | null>(null);
  const [districtFilter, setDistrictFilter] = useState('all');
  const [explorerDistrict, setExplorerDistrict] = useState<string | null>(null);
  const qc = useQueryClient();
  const seenAlerts = useRef<Set<string>>(new Set());
  const [newAlertToasts, setNewAlertToasts] = useState<AlertRow[]>([]);
  const firstAlertLoad = useRef(true);

  // session bootstrap
  useEffect(() => {
    fetch('/api/auth/me')
      .then((r) => r.json())
      .then((d) => setUser(d.user ?? null))
      .catch(() => setUser(null));
  }, []);

  // live data
  const kpiQ = useQuery<Kpis>({
    queryKey: ['kpis'],
    queryFn: async () => (await fetch('/api/kpis')).json(),
    refetchInterval: 15_000,
    enabled: !!user,
  });
  const zonesQ = useQuery<{ features: ZoneFeature[] }>({
    queryKey: ['zones-map'],
    queryFn: async () => (await fetch('/api/zones')).json(),
    refetchInterval: 10_000,
    enabled: !!user,
  });
  const alertsQ = useQuery<{ alerts: AlertRow[] }>({
    queryKey: ['alerts-live'],
    queryFn: async () => (await fetch('/api/alerts?status=active&limit=40')).json(),
    refetchInterval: 8_000,
    enabled: !!user,
  });
  const roadsQ = useQuery<{ roads: RoadRow[] }>({
    queryKey: ['roads-map'],
    queryFn: async () => (await fetch('/api/roads')).json(),
    refetchInterval: 15_000,
    enabled: !!user,
  });
  const sheltersQ = useQuery<{ shelters: MapShelter[] }>({
    queryKey: ['shelters-map'],
    queryFn: async () => (await fetch('/api/shelters')).json(),
    refetchInterval: 60_000,
    enabled: !!user,
  });
  const reportsQ = useQuery<{ reports: Array<{ id: string; category: string; status: string; lat: number; lon: number }> }>({
    queryKey: ['reports-map'],
    queryFn: async () => (await fetch('/api/reports?status=all')).json(),
    refetchInterval: 12_000,
    enabled: !!user,
  });

  // new-alert → snackbars
  useEffect(() => {
    const alerts = alertsQ.data?.alerts ?? [];
    if (!alerts.length) {
      if (firstAlertLoad.current) firstAlertLoad.current = false;
      return;
    }
    if (firstAlertLoad.current) {
      alerts.forEach((a) => seenAlerts.current.add(a.id));
      firstAlertLoad.current = false;
      return;
    }
    const fresh = alerts.filter((a) => !seenAlerts.current.has(a.id));
    if (fresh.length) {
      fresh.forEach((a) => seenAlerts.current.add(a.id));
      setNewAlertToasts((prev) => [...fresh.slice(0, 3), ...prev].slice(0, 4));
    }
  }, [alertsQ.data]);

  const zones = useMemo(() => {
    const all = zonesQ.data?.features ?? [];
    return districtFilter === 'all' ? all : all.filter((z) => z.properties.district === districtFilter);
  }, [zonesQ.data, districtFilter]);

  const reportPins: ReportPin[] = useMemo(
    () =>
      (reportsQ.data?.reports ?? [])
        .filter((r) => districtFilter === 'all' || true) // pins are few; always show
        .map((r) => ({ id: r.id, category: r.category, status: r.status, lat: r.lat, lon: r.lon })),
    [reportsQ.data]
  );

  const shelters = useMemo(
    () =>
      (sheltersQ.data?.shelters ?? []).filter((s) => districtFilter === 'all' || s.district === districtFilter),
    [sheltersQ.data, districtFilter]
  );

  const evacRoute: EvacRoute | null = useMemo(
    () => (evac ? { origin: evac.origin, destination: evac.destination, route: evac.route, etaMinutes: evac.etaMinutes, routeLengthKm: evac.routeLengthKm } : null),
    [evac]
  );

  const canAck = !!user && ['admin', 'district_admin', 'field_official'].includes(user.role);
  const canVerify = canAck;

  // phones open the field app directly; laptops get the website
  useEffect(() => {
    if (typeof window !== 'undefined' && window.innerWidth < 640 && user) setAppMode(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const handleMapClick = (lat: number, lon: number) => {
    setOriginMode(false);
    setOrigin({ lat, lon });
    fetch('/api/evacuation/route', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lat, lon }),
    })
      .then((r) => r.json())
      .then((d) => {
        if (d.error) setToast({ msg: d.error, sev: 'error' });
        else setEvac(d);
      })
      .catch(() => setToast({ msg: 'Routing request failed', sev: 'error' }));
  };

  const flyToDistrict = (d: string) => {
    setDistrictFilter(d);
    const c = DISTRICT_CENTERS[d];
    if (c) setFlyTo({ center: c.center, zoom: c.zoom, key: Date.now() });
  };

  if (user === undefined) {
    return (
      <Box sx={{ minHeight: '100vh', display: 'grid', placeItems: 'center', bgcolor: 'background.default' }}>
        <LinearProgress sx={{ width: 220 }} />
      </Box>
    );
  }
  if (!user) {
    return <LoginGate onLogin={setUser} />;
  }

  // ── field-phone app mode (full-screen overlay) ──
  if (appMode) {
    return <PhoneApp user={user} onExit={() => setAppMode(false)} />;
  }

  const tickerAlerts = alertsQ.data?.alerts ?? [];

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'background.default', display: 'flex', flexDirection: 'column' }}>
      {/* ─── app bar ─────────────────────────────────────────── */}
      <AppBar
        position="static"
        elevation={0}
        sx={{ bgcolor: '#0a0f1a', borderBottom: '1px solid rgba(148,163,184,.14)', flexShrink: 0 }}
      >
        <Toolbar sx={{ gap: 1.5, minHeight: { xs: 56, md: 60 } }}>
          <Stack direction="row" spacing={1} sx={{ mr: 1, alignItems: 'center' }}>
            <Box
              sx={{
                width: 34, height: 34, borderRadius: 1.5, display: 'grid', placeItems: 'center',
                bgcolor: 'rgba(16,185,129,.14)', border: '1px solid rgba(16,185,129,.35)',
              }}
            >
              <LandscapeIcon sx={{ fontSize: 19, color: 'primary.main' }} />
            </Box>
            <Box sx={{ display: { xs: 'none', sm: 'block' } }}>
              <Typography variant="body1" sx={{ fontWeight: 800, letterSpacing: '-.01em', lineHeight: 1.1 }}>
                BhuRakshak
              </Typography>
              <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: 10, lineHeight: 1 }}>
                SIH26001 · NER landslide EWS
              </Typography>
            </Box>
          </Stack>

          <Divider orientation="vertical" flexItem sx={{ display: { xs: 'none', md: 'block' } }} />

          {/* KPIs */}
          <Stack direction="row" spacing={{ xs: 1.5, md: 2.5 }} sx={{ flex: 1, overflow: 'hidden' }} divider={<Divider orientation="vertical" flexItem sx={{ display: { xs: 'none', md: 'block' } }} />}>
            <KpiStat label="Zones live" value={kpiQ.data?.zonesTotal ?? 0} />
            <KpiStat label="Population" value={kpiQ.data?.populationMonitored ?? 0} />
            <KpiStat label="At risk L3+" value={kpiQ.data?.populationAtRiskL3 ?? 0} tone="#ef4444" />
            <KpiStat label="Active alerts" value={kpiQ.data?.activeAlerts ?? 0} tone="#f59e0b" />
            <KpiStat label="Sensors" value={kpiQ.data?.sensorsOnline ?? 0} />
            <KpiStat label="Roads blocked" value={kpiQ.data?.roadsBlocked ?? 0} tone="#f97316" />
            <KpiStat label="Alt. routes live" value={kpiQ.data?.detoursActive ?? 0} tone="#38bdf8" />
            <KpiStat label="SMS 24h" value={kpiQ.data?.smsSent24h ?? 0} tone="#34d399" />
            <KpiStat label="Field msgs" value={kpiQ.data?.fieldMessagesNew ?? 0} tone={(kpiQ.data?.sosOpen ?? 0) > 0 ? '#ef4444' : '#f59e0b'} />
          </Stack>

          <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
            <Chip
              size="small"
              icon={<span style={{ width: 7, height: 7, borderRadius: '50%', background: '#34d399', display: 'inline-block', boxShadow: '0 0 6px #34d399' }} />}
              label="LIVE"
              sx={{ height: 24, fontWeight: 800, bgcolor: 'rgba(52,211,153,.1)', color: '#34d399', border: '1px solid rgba(52,211,153,.3)' }}
            />
            <Tooltip title="Open the field app (phone view) — street map, alternative safe routes, offline crack photos, SMS & notifications">
              <Button
                size="small"
                variant="contained"
                color="secondary"
                startIcon={<SmartphoneIcon sx={{ fontSize: 16 }} />}
                onClick={() => setAppMode(true)}
                sx={{ mr: 0.5, borderRadius: 1.5, boxShadow: 'none', fontWeight: 800, whiteSpace: 'nowrap' }}
              >
                Field App
              </Button>
            </Tooltip>
            <Tooltip title="What am I looking at?">
              <IconButton size="small" aria-label="What am I looking at" onClick={() => setAboutOpen(true)}>
                <InfoOutlinedIcon fontSize="small" />
              </IconButton>
            </Tooltip>
            <Tooltip title={user?.email}>
              <IconButton size="small" aria-label="Account menu" onClick={(e) => setUserMenu(e.currentTarget)}>
                <Avatar sx={{ width: 30, height: 30, bgcolor: 'rgba(16,185,129,.2)', fontSize: 13, fontWeight: 700 }}>
                  {(user?.fullName ?? 'U').split(' ').map((w) => w[0]).slice(0, 2).join('')}
                </Avatar>
              </IconButton>
            </Tooltip>
            <Menu anchorEl={userMenu} open={!!userMenu} onClose={() => setUserMenu(null)}>
              <Box sx={{ px: 2, py: 1 }}>
                <Typography variant="body2" sx={{ fontWeight: 700 }}>{user?.fullName}</Typography>
                <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                  {user?.email} · {user?.role}{user?.district ? ` · ${user.district}` : ''}
                </Typography>
              </Box>
              <Divider />
              <MenuItem
                onClick={async () => {
                  await fetch('/api/auth/logout', { method: 'POST' });
                  setUserMenu(null);
                  setUser(null);
                  qc.clear();
                  seenAlerts.current = new Set();
                  firstAlertLoad.current = true;
                }}
              >
                <LogoutIcon fontSize="small" sx={{ mr: 1 }} /> Sign out
              </MenuItem>
            </Menu>
          </Stack>
        </Toolbar>
      </AppBar>

      {/* ─── view tabs ───────────────────────────────────────── */}
      <Tabs
        value={view}
        onChange={(_, v) => setView(v)}
        sx={{
          px: 2, bgcolor: '#0a0f1a', borderBottom: '1px solid rgba(148,163,184,.14)', minHeight: 44, flexShrink: 0,
          '& .MuiTab-root': { minHeight: 44, fontSize: 13, fontWeight: 600 },
        }}
      >
        <Tab value="command" label="Command Center" />
        <Tab
          value="explorer"
          label={
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <TravelExploreIcon sx={{ fontSize: 15 }} /> Risk Explorer
            </span>
          }
        />
        <Tab
          value="ops"
          label={
            <Badge badgeContent={kpiQ.data?.activeAlerts ?? 0} color="error" max={99}>
              Operations
            </Badge>
          }
        />
        <Tab value="analytics" label="Analytics" />
        <Tab
          value="simulate"
          label={
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <ScienceIcon sx={{ fontSize: 15 }} /> Simulation
            </span>
          }
        />
        <Tab value="field" label="Field Report" />
      </Tabs>

      {/* ─── body ───────────────────────────────────────────── */}
      <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        {view === 'command' && (
          <Box sx={{ flex: 1, display: 'flex', minHeight: 0, flexDirection: { xs: 'column', md: 'row' } }}>
            {/* left rail */}
            <Stack
              spacing={1.5}
              sx={{
                width: { xs: '100%', md: 285 }, flexShrink: 0, p: 1.5, overflowY: 'auto',
                maxHeight: { xs: 'none', md: '100%' }, borderRight: { md: '1px solid rgba(148,163,184,.12)' },
                order: { xs: 2, md: 0 },
              }}
            >
              <Paper variant="outlined" sx={{ p: 1.75 }}>
                <Typography variant="subtitle2" sx={{ mb: 1 }}>District focus</Typography>
                <Stack direction="row" spacing={0.5} useFlexGap sx={{ flexWrap: 'wrap' }}>
                  <Chip
                    size="small"
                    label="All NER"
                    variant={districtFilter === 'all' ? 'filled' : 'outlined'}
                    color={districtFilter === 'all' ? 'primary' : 'default'}
                    onClick={() => { setDistrictFilter('all'); setFlyTo({ center: [92.8, 25.4], zoom: 6.4, key: Date.now() }); }}
                    sx={{ fontWeight: 700 }}
                  />
                  {Object.keys(DISTRICT_CENTERS).map((d) => (
                    <Chip
                      key={d}
                      size="small"
                      label={d}
                      variant={districtFilter === d ? 'filled' : 'outlined'}
                      color={districtFilter === d ? 'primary' : 'default'}
                      onClick={() => flyToDistrict(d)}
                      sx={{ fontWeight: 600 }}
                    />
                  ))}
                </Stack>
              </Paper>

              <EvacuationPanel
                origin={origin}
                onSetOrigin={(o) => {
                  setOrigin(o);
                  fetch('/api/evacuation/route', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(o),
                  })
                    .then((r) => r.json())
                    .then((d) => (d.error ? setToast({ msg: d.error, sev: 'error' }) : setEvac(d)))
                    .catch(() => setToast({ msg: 'Routing failed', sev: 'error' }));
                }}
                route={evac}
                onClear={() => {
                  setEvac(null);
                  setOrigin(null);
                }}
                originMode={originMode}
                onToggleOriginMode={() => setOriginMode((v) => !v)}
              />

              {user?.role === 'admin' || user?.role === 'district_admin' ? (
                <Paper variant="outlined" sx={{ p: 1.75, borderColor: 'rgba(245,158,11,.3)' }}>
                  <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
                    <ScienceIcon sx={{ fontSize: 18, color: '#f59e0b' }} />
                    <Box sx={{ flex: 1 }}>
                      <Typography variant="subtitle2">Injecting conditions?</Typography>
                      <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', lineHeight: 1.4 }}>
                        Manual condition injection now lives in the Simulation tab — one control point, every section reacts.
                      </Typography>
                    </Box>
                    <Button size="small" variant="outlined" color="warning" onClick={() => setView('simulate')} sx={{ whiteSpace: 'nowrap' }}>
                      Open
                    </Button>
                  </Stack>
                </Paper>
              ) : null}

              <Paper variant="outlined" sx={{ p: 1.75 }}>
                <Stack direction="row" spacing={1} sx={{ mb: 0.75, alignItems: 'center' }}>
                  <PublicIcon sx={{ fontSize: 16, color: 'text.secondary' }} />
                  <Typography variant="subtitle2">Coverage</Typography>
                </Stack>
                <Stack spacing={0.5}>
                  {[
                    ['Response zones', kpiQ.data?.zonesTotal ?? 0],
                    ['Monitored population', (kpiQ.data?.populationMonitored ?? 0).toLocaleString('en-IN')],
                    ['Field sensors online', kpiQ.data?.sensorsOnline ?? 0],
                    ['Reports (24 h)', (kpiQ.data?.pendingReports ?? 0) + (kpiQ.data?.verifiedReports ?? 0)],
                    ['Safe check-ins (24 h)', kpiQ.data?.checkins24h ?? 0],
                  ].map(([k, v]) => (
                    <Stack key={k as string} direction="row" sx={{ justifyContent: 'space-between' }}>
                      <Typography variant="caption" sx={{ color: 'text.secondary' }}>{k}</Typography>
                      <Typography variant="caption" sx={{ fontWeight: 700, fontFamily: 'monospace' }}>{v}</Typography>
                    </Stack>
                  ))}
                </Stack>
              </Paper>
            </Stack>

            {/* map */}
            <Box sx={{ flex: 1, minHeight: { xs: 420, md: 0 }, p: 1.25, position: 'relative' }}>
              <MapView
                zones={zones}
                roads={roadsQ.data?.roads ?? []}
                shelters={shelters}
                reportPins={reportPins}
                evacRoute={evacRoute}
                selectedZone={selectedZone}
                originMode={originMode}
                onZoneSelect={setSelectedZone}
                onMapClick={handleMapClick}
                flyTo={flyTo}
              />
            </Box>
          </Box>
        )}

        {view === 'ops' && (
          <OpsView
            canAck={canAck}
            canVerify={canVerify}
            onZoneSelect={(zoneCode) => {
              setSelectedZone(zoneCode);
            }}
            onFlyTo={(lat, lon) => {
              setView('command');
              setFlyTo({ center: [lon, lat], zoom: 10.5, key: Date.now() });
            }}
          />
        )}

        {view === 'analytics' && <AnalyticsView />}

        {view === 'simulate' && (user?.role === 'admin' || user?.role === 'district_admin') && <SimulateView />}

        {view === 'simulate' && !(user?.role === 'admin' || user?.role === 'district_admin') && (
          <Box sx={{ p: 4, textAlign: 'center' }}>
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
              Condition injection requires an admin or district-admin account.
            </Typography>
          </Box>
        )}

        {view === 'explorer' && (
          <ExplorerView
            district={explorerDistrict}
            onDistrict={setExplorerDistrict}
            onZoneSelect={(zoneCode) => setSelectedZone(zoneCode)}
            onFlyTo={(lat, lon) => {
              setView('command');
              setFlyTo({ center: [lon, lat], zoom: 11, key: Date.now() });
            }}
          />
        )}

        {view === 'field' && (
          <FieldView
            onMapPick={() => {
              setView('command');
              setOriginMode(true);
              setToast({ msg: 'Origin mode on — click the map to place your position', sev: 'info' });
            }}
          />
        )}
      </Box>

      {/* ─── alert ticker ───────────────────────────────────── */}
      {view === 'command' && tickerAlerts.length > 0 && (
        <Paper
          elevation={0}
          sx={{
            flexShrink: 0, borderRadius: 0, borderLeft: '3px solid #f59e0b', bgcolor: '#0d1520',
            overflow: 'hidden', py: 0.75,
          }}
        >
          <Stack direction="row" spacing={1} sx={{ px: 1.5, alignItems: 'center' }}>
            <CampaignIcon sx={{ fontSize: 17, color: 'warning.main', animation: 'pulse 2s infinite' }} />
            <Typography variant="overline" sx={{ fontWeight: 800, color: 'warning.main', lineHeight: 1, flexShrink: 0 }}>
              Live alerts
            </Typography>
            <Box sx={{ flex: 1, overflow: 'hidden', position: 'relative', height: 22 }}>
              <Box
                sx={{
                  display: 'flex', gap: 3, whiteSpace: 'nowrap', position: 'absolute',
                  animation: `ticker ${Math.max(30, tickerAlerts.length * 6)}s linear infinite`,
                }}
              >
                {tickerAlerts.slice(0, 14).map((a) => (
                  <Stack key={a.id} direction="row" spacing={0.75} sx={{ alignItems: 'center' }}>
                    <Chip
                      size="small"
                      label={`L${a.level}`}
                      sx={{ height: 17, fontSize: 9, fontWeight: 800, bgcolor: `${hazardColor(a.level)}22`, color: hazardColor(a.level) }}
                    />
                    <Typography variant="caption" sx={{ fontWeight: 600 }}>
                      {a.zone?.zoneCode ?? '—'} · {a.message.slice(0, 90)}
                    </Typography>
                    <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                      {new Date(a.createdAt).toLocaleTimeString()}
                    </Typography>
                  </Stack>
                ))}
              </Box>
            </Box>
          </Stack>
        </Paper>
      )}

      {/* ─── dossier drawer ─────────────────────────────────── */}
      <DossierDrawer zoneCode={selectedZone} onClose={() => setSelectedZone(null)} />

      {/* ─── new-alert toasts ───────────────────────────────── */}
      <Snackbar
        open={newAlertToasts.length > 0}
        autoHideDuration={6000}
        onClose={() => setNewAlertToasts((p) => p.slice(0, -1))}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
      >
        <Alert
          severity={newAlertToasts[0]?.level >= 3 ? 'error' : 'warning'}
          variant="filled"
          onClose={() => setNewAlertToasts((p) => p.slice(0, -1))}
          icon={<CampaignIcon fontSize="small" />}
        >
          <b>{newAlertToasts[0]?.title?.slice(0, 70)}</b>
          <br />
          {newAlertToasts[0]?.message?.slice(0, 110)}
        </Alert>
      </Snackbar>

      {/* general toast */}
      <Snackbar
        open={!!toast}
        autoHideDuration={4000}
        onClose={() => setToast(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert severity={toast?.sev ?? 'info'} variant="filled" onClose={() => setToast(null)}>
          {toast?.msg}
        </Alert>
      </Snackbar>

      {/* ─── about dialog ───────────────────────────────────── */}
      <Dialog open={aboutOpen} onClose={() => setAboutOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ fontWeight: 800 }}>What am I looking at?</DialogTitle>
        <DialogContent>
          <DialogContentText component="div">
            <Typography variant="body2" sx={{ mb: 1.5 }}>
              BhuRakshak (भूरक्षक — Earth Guardian) is a 4-layer landslide early warning system for the
              North East Region. The map shows <b>hexagonal response zones (~5 km each)</b> covering five
              pilot districts.
            </Typography>
            <Stack spacing={1} sx={{ mb: 1.5 }}>
              {[
                ['Hexagon color', 'the live hazard level L0–L4, fused from rainfall I-D thresholds, susceptibility and a calibrated probability prior'],
                ['Hexagon tower height', 'how escalated the zone is — taller means more urgent'],
                ['Green line + pins', 'the A* evacuation route to the safest shelter, and shelter locations'],
                ['Colored road lines', 'road network status — green open, amber watch, red blocked'],
                ['Small dots', 'citizen field reports (amber pending, orange verified)'],
              ].map(([k, v]) => (
                <Stack key={k} direction="row" spacing={1.5}>
                  <Chip size="small" label={k} sx={{ minWidth: 128, fontWeight: 700, height: 24 }} />
                  <Typography variant="caption" sx={{ color: 'text.secondary', pt: 0.25 }}>{v}</Typography>
                </Stack>
              ))}
            </Stack>
            <Typography variant="body2">
              Click any hexagon to open its <b>dossier</b> — drivers behind the level, 48 h rainfall chart,
              ground sensors, field reports, and the DC standard-operating playbook. Switch between
              <b> Satellite / Terrain / Street</b> basemaps, and use the evacuation planner to route
              around hazard zones to shelters. Everything you see is computed live by the backend engine.
            </Typography>
          </DialogContentText>
        </DialogContent>
      </Dialog>

      <style>{`
        @keyframes ticker {
          0% { transform: translateX(10%); }
          100% { transform: translateX(-100%); }
        }
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.45; }
        }
      `}</style>
    </Box>
  );
}
