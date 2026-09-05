'use client';

import { useMemo, useState } from 'react';
import {
  Box, Typography, Stack, Chip, Paper, Button, Slider, Select, MenuItem, InputLabel,
  FormControl, Switch, FormControlLabel, LinearProgress, Table, TableBody, TableCell,
  TableContainer, TableHead, TableRow, Tooltip, Divider, ToggleButtonGroup, ToggleButton,
} from '@mui/material';
import ScienceIcon from '@mui/icons-material/Science';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import RestartAltIcon from '@mui/icons-material/RestartAlt';
import ThunderstormIcon from '@mui/icons-material/Thunderstorm';
import WaterDropIcon from '@mui/icons-material/WaterDrop';
import EarthquakeIcon from '@mui/icons-material/Landslide';
import TrendingUpIcon from '@mui/icons-material/TrendingUp';
import HistoryIcon from '@mui/icons-material/History';
import ArrowRightAltIcon from '@mui/icons-material/ArrowRightAlt';
import CampaignIcon from '@mui/icons-material/Campaign';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { hazardColor } from '@/components/theme';
import { ZoneFeature } from '@/components/map/MapView';

/* ── types ─────────────────────────────────────────────────────────── */

interface PredictResult {
  ok: boolean;
  zone: { zoneCode: string; name: string; district: string; currentLevel: number } | null;
  currentObs: { rain1h: number; rain24h: number; soilMoisture: number | null } | null;
  inputs: Record<string, number | boolean | null>;
  probability: number;
  thresholdTier: number;
  mlPriorTier: number;
  fusedLevel: number;
  suscBand: string;
  idThresholds: Array<{ level: number; rain24h: number; rain1h: number; breached24h: boolean; breachedIntensity: boolean }>;
  drivers: Array<{ feature: string; name: string; value: string; contribution: number; description: string }>;
  formula: string;
}

interface InjectResult {
  ok: boolean;
  scope: string;
  zonesInjected: number;
  changes: Array<{ zoneCode: string; name: string; district: string; before: number; after: number; probability: number; escalated: boolean; deescalated: boolean }>;
  escalated: number;
  deescalated: number;
  maxLevel: number;
  alertsFired: number;
  notifications: number;
  sms: number;
  levelCounts: Record<string, number>;
}

const PRESETS: Array<{ id: string; label: string; hint: string; values: { rain1h: number; rain24h: number; rain72h: number; soil: number; seismic?: boolean } }> = [
  { id: 'cloudburst', label: 'Cloudburst burst', hint: '62 mm/h flash intensity on soaked ground', values: { rain1h: 62, rain24h: 130, rain72h: 180, soil: 88 } },
  { id: 'monsoon', label: 'Extreme monsoon cell', hint: '36 mm/h sustained for hours (storm preset)', values: { rain1h: 36, rain24h: 165, rain72h: 230, soil: 82 } },
  { id: 'seismic', label: 'M 5.2 quake + rain', hint: 'ground shaking on a saturated slope', values: { rain1h: 14, rain24h: 60, rain72h: 90, soil: 68, seismic: true } },
  { id: 'dry', label: 'Dry spell', hint: 'rain decays — watch zones stand down', values: { rain1h: 1, rain24h: 8, rain72h: 18, soil: 41 } },
];

const REPLAY_STEPS: Array<{ t: string; label: string; rain1h: number; rain24h: number; soil: number }> = [
  { t: 'T−72 h', label: 'Antecedent wetting season', rain1h: 8, rain24h: 62, soil: 63 },
  { t: 'T−60 h', label: 'Sustained monsoon rain sets in', rain1h: 15, rain24h: 96, soil: 71 },
  { t: 'T−48 h', label: 'Rainfall keeps accumulating', rain1h: 22, rain24h: 138, soil: 78 },
  { t: 'T−36 h', label: 'I-D threshold breached — first warnings', rain1h: 27, rain24h: 158, soil: 83 },
  { t: 'T−24 h', label: 'Intense cell stalls over the district', rain1h: 39, rain24h: 198, soil: 89 },
  { t: 'T−12 h', label: 'Cloudburst — evacuation window closing', rain1h: 55, rain24h: 246, soil: 94 },
  { t: 'T−0', label: 'Event peak (Tupul-type disaster)', rain1h: 68, rain24h: 302, soil: 97 },
];

function fmtP(p: number): string {
  return `${(p * 100).toFixed(1)}%`;
}

export default function SimulateView() {
  const qc = useQueryClient();

  /* scope + inputs */
  const [district, setDistrict] = useState('East Khasi Hills');
  const [zoneScope, setZoneScope] = useState<string>('all');
  const [rain1h, setRain1h] = useState(24);
  const [rain24h, setRain24h] = useState(120);
  const [rain72h, setRain72h] = useState(180);
  const [soil, setSoil] = useState(78);
  const [seismic, setSeismic] = useState(false);
  const [pred, setPred] = useState<PredictResult | null>(null);
  const [inj, setInj] = useState<InjectResult | null>(null);
  const [busy, setBusy] = useState<'predict' | 'inject' | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  /* replay player state */
  const [replayIdx, setReplayIdx] = useState(-1);
  const [replayPlaying, setReplayPlaying] = useState(false);
  const [replayResults, setReplayResults] = useState<Array<{ maxLevel: number; alerts: number; sms: number; escalated: number }>>([]);
  const [replayBusy, setReplayBusy] = useState(false);

  const zonesQ = useQuery<{ features: ZoneFeature[] }>({
    queryKey: ['zones-simulate'],
    queryFn: async () => (await fetch('/api/zones')).json(),
  });

  const districts = useMemo(
    () => [...new Set((zonesQ.data?.features ?? []).map((f) => f.properties.district))].sort(),
    [zonesQ.data]
  );
  const districtZones = useMemo(
    () =>
      (zonesQ.data?.features ?? [])
        .filter((f) => f.properties.district === district)
        .sort((a, b) => b.properties.hazardLevel - a.properties.hazardLevel || b.properties.probability - a.properties.probability),
    [zonesQ.data, district]
  );

  const body = {
    district: zoneScope === 'all' ? district : null,
    zoneCode: zoneScope === 'all' ? null : zoneScope,
    rain1h, rain24h, rain72h, soilMoisture: soil,
  };

  const predictMut = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/simulate/predict', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          zoneCode: zoneScope === 'all' ? (districtZones[0]?.properties.zoneCode ?? null) : zoneScope,
          rain1h, rain24h, rain72h, soilMoisture: soil, seismic,
        }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'Prediction failed');
      return d as PredictResult;
    },
    onMutate: () => setBusy('predict'),
    onSuccess: (d) => {
      setPred(d);
      setInj(null);
      setBusy(null);
    },
    onError: (e: Error) => { setToast(e.message); setBusy(null); },
  });

  const injectMut = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/simulate/conditions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'Injection failed');
      return d as InjectResult;
    },
    onMutate: () => setBusy('inject'),
    onSuccess: (d) => {
      setInj(d);
      setPred(null);
      setBusy(null);
      qc.invalidateQueries(); // every dashboard section re-reads live state
    },
    onError: (e: Error) => { setToast(e.message); setBusy(null); },
  });

  const resetMut = useMutation({
    mutationFn: async (d: string | null) => {
      const res = await fetch('/api/simulate/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ district: d }),
      });
      const dd = await res.json();
      if (!res.ok) throw new Error(dd.error || 'Reset failed');
      return dd;
    },
    onSuccess: (d) => {
      setToast(`Conditions decayed — ${d.deescalated} zones stood down`);
      qc.invalidateQueries();
    },
    onError: (e: Error) => setToast(e.message),
  });

  /* ── Noney-2022 scenario replay: sequential real engine passes ── */
  const replayStep = async (i: number) => {
    const s = REPLAY_STEPS[i];
    let lastErr: Error | null = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await fetch('/api/simulate/conditions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ district: 'Noney', rain1h: s.rain1h, rain24h: s.rain24h, soilMoisture: s.soil }),
        });
        const d = await res.json();
        if (!res.ok) throw new Error(d.error || 'replay step failed');
        setReplayResults((prev) => {
          const next = [...prev];
          next[i] = { maxLevel: d.maxLevel, alerts: d.alertsFired, sms: d.sms, escalated: d.escalated };
          return next;
        });
        qc.invalidateQueries();
        return d as InjectResult;
      } catch (err) {
        lastErr = err as Error;
        if (attempt < 2) await new Promise((r) => setTimeout(r, 1000));
      }
    }
    throw lastErr ?? new Error('replay step failed');
  };

  const playReplay = async () => {
    if (replayPlaying) return;
    setReplayPlaying(true);
    setReplayBusy(true);
    setReplayResults([]);
    setReplayIdx(0);
    try {
      // start from calm — decay whatever is currently over Noney
      await fetch('/api/simulate/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ district: 'Noney' }),
      }).catch(() => {});
      qc.invalidateQueries();
      await new Promise((r) => setTimeout(r, 1500));

      for (let i = 0; i < REPLAY_STEPS.length; i++) {
        setReplayIdx(i);
        await replayStep(i);
        if (i < REPLAY_STEPS.length - 1) await new Promise((r) => setTimeout(r, 1200));
      }
      setToast('Scenario complete — watch the Noney drill-down in Risk Explorer');
    } catch (e) {
      setToast((e as Error).message);
    } finally {
      setReplayPlaying(false);
      setReplayBusy(false);
    }
  };

  const firstWarnIdx = replayResults.findIndex((r) => r && r.maxLevel >= 3);
  const leadHours = firstWarnIdx >= 0 ? Math.max(0, (REPLAY_STEPS.length - 1 - firstWarnIdx) * 12) : null;

  return (
    <Box sx={{ p: { xs: 1.5, md: 2.5 }, maxWidth: 1280, mx: 'auto' }}>
      {/* header */}
      <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', mb: 0.5 }}>
        <ScienceIcon sx={{ color: 'primary.main' }} />
        <Box sx={{ flex: 1 }}>
          <Typography variant="h6" sx={{ fontWeight: 800 }}>Scenario Simulation</Typography>
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>
            Inject conditions manually — the same production engine processes them (thresholds → hysteresis → alerts → SMS). Nothing pre-recorded.
          </Typography>
        </Box>
        <Tooltip title="Every other section of this dashboard reads live state — this is the only place conditions can be injected.">
          <Chip size="small" label="single control point" variant="outlined" sx={{ fontWeight: 700 }} />
        </Tooltip>
      </Stack>

      <Stack direction={{ xs: 'column', lg: 'row' }} spacing={2} sx={{ mt: 2 }}>
        {/* ── left: manual input form ── */}
        <Paper variant="outlined" sx={{ p: 2, flex: { lg: '0 0 400px' } }}>
          <Typography variant="subtitle2" sx={{ mb: 1.5 }}>Manual model input</Typography>

          <Stack spacing={2}>
            <FormControl size="small" fullWidth>
              <InputLabel>District (scope)</InputLabel>
              <Select value={district} label="District (scope)" onChange={(e) => { setDistrict(e.target.value); setZoneScope('all'); }}>
                {districts.map((d) => (
                  <MenuItem key={d} value={d}>{d}</MenuItem>
                ))}
              </Select>
            </FormControl>

            <FormControl size="small" fullWidth>
              <InputLabel>Zone (scope)</InputLabel>
              <Select value={zoneScope} label="Zone (scope)" onChange={(e) => setZoneScope(e.target.value)}>
                <MenuItem value="all">All zones in district ({districtZones.length})</MenuItem>
                {districtZones.slice(0, 60).map((z) => (
                  <MenuItem key={z.properties.zoneCode} value={z.properties.zoneCode}>
                    {z.properties.zoneCode} · L{z.properties.hazardLevel} · {z.properties.name}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>

            <Divider />
            {([
              { label: 'Rainfall intensity (1 h)', value: rain1h, set: setRain1h, max: 80, unit: 'mm/h' },
              { label: 'Rainfall accumulation (24 h)', value: rain24h, set: setRain24h, max: 320, unit: 'mm' },
              { label: 'Antecedent rain (72 h)', value: rain72h, set: setRain72h, max: 480, unit: 'mm' },
              { label: 'Soil saturation', value: soil, set: setSoil, max: 100, unit: '%' },
            ] as const).map((s) => (
              <Box key={s.label}>
                <Stack direction="row" sx={{ justifyContent: 'space-between', mb: -0.5 }}>
                  <Typography variant="caption" sx={{ color: 'text.secondary' }}>{s.label}</Typography>
                  <Typography variant="caption" sx={{ fontWeight: 800, fontFamily: 'monospace' }}>
                    {s.value} {s.unit}
                  </Typography>
                </Stack>
                <Slider
                  size="small"
                  min={0}
                  max={s.max}
                  step={1}
                  value={s.value}
                  onChange={(_, v) => s.set(v as number)}
                  valueLabelDisplay="auto"
                  sx={{ '& .MuiSlider-valueLabel': { fontSize: 10 } }}
                />
              </Box>
            ))}

            <FormControlLabel
              control={<Switch size="small" checked={seismic} onChange={(e) => setSeismic(e.target.checked)} />}
              label={<Typography variant="caption">Seismic trigger — M ≥ 4.0 quake (probability prior +2.5 logit)</Typography>}
            />

            {/* presets */}
            <Box>
              <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mb: 0.75 }}>Presets</Typography>
              <Stack direction="row" spacing={0.75} useFlexGap sx={{ flexWrap: 'wrap', rowGap: 0.75 }}>
                {PRESETS.map((p) => (
                  <Tooltip key={p.id} title={p.hint}>
                    <Chip
                      size="small"
                      icon={p.id === 'seismic' ? <EarthquakeIcon sx={{ fontSize: 13 }} /> : p.id === 'dry' ? <RestartAltIcon sx={{ fontSize: 13 }} /> : <WaterDropIcon sx={{ fontSize: 13 }} />}
                      label={p.label}
                      variant="outlined"
                      onClick={() => {
                        setRain1h(p.values.rain1h);
                        setRain24h(p.values.rain24h);
                        setRain72h(p.values.rain72h);
                        setSoil(p.values.soil);
                        setSeismic(!!p.values.seismic);
                      }}
                      sx={{ fontWeight: 700 }}
                    />
                  </Tooltip>
                ))}
              </Stack>
            </Box>

            <Stack direction="row" spacing={1}>
              <Button
                variant="outlined"
                fullWidth
                disabled={busy !== null}
                startIcon={<ScienceIcon />}
                onClick={() => predictMut.mutate()}
              >
                {busy === 'predict' ? 'Computing…' : 'Run prediction'}
              </Button>
              <Button
                variant="contained"
                color="warning"
                fullWidth
                disabled={busy !== null}
                startIcon={<ThunderstormIcon />}
                onClick={() => injectMut.mutate()}
              >
                {busy === 'inject' ? 'Engine running…' : 'Push to live engine'}
              </Button>
            </Stack>
            <Typography variant="caption" sx={{ color: 'text.secondary', lineHeight: 1.4 }}>
              <b>Run prediction</b> is a dry-run (no data changes — try arbitrary numbers). <b>Push to live engine</b> writes real observation rows, re-runs the engine and fans out alerts + SMS.
            </Typography>
          </Stack>
        </Paper>

        {/* ── right: results ── */}
        <Stack spacing={2} sx={{ flex: 1, minWidth: 0 }}>
          {!pred && !inj && (
            <Paper variant="outlined" sx={{ p: 3, textAlign: 'center' }}>
              <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                Set conditions on the left and run a prediction. The model will fuse I-D thresholds with the calibrated
                probability prior for the selected zone — change any number and the output changes. That is the point.
              </Typography>
            </Paper>
          )}

          {/* prediction card */}
          {pred && (
            <Paper variant="outlined" sx={{ p: 2 }}>
              <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', mb: 1.5, flexWrap: 'wrap', rowGap: 0.5 }}>
                <Chip size="small" label={`L${pred.fusedLevel} ${['Normal', 'Watch', 'Alert', 'Warning', 'Emergency'][pred.fusedLevel]}`} sx={{ height: 24, fontWeight: 800, fontSize: 11, bgcolor: `${hazardColor(pred.fusedLevel)}22`, color: hazardColor(pred.fusedLevel) }} />
                <Typography variant="subtitle2" sx={{ flex: 1 }}>
                  Dry-run prediction {pred.zone ? `— ${pred.zone.zoneCode} (${pred.zone.name})` : ''}
                </Typography>
                <Chip size="small" label={`current: L${pred.zone?.currentLevel ?? 0}`} variant="outlined" sx={{ fontWeight: 700 }} />
              </Stack>

              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ mb: 1.5 }}>
                <Paper variant="outlined" sx={{ p: 1.5, flex: 1, bgcolor: 'rgba(148,163,184,.04)' }}>
                  <Typography variant="overline" sx={{ color: 'text.secondary', lineHeight: 1 }}>P(landslide in 24 h)</Typography>
                  <Typography variant="h3" sx={{ fontWeight: 800, fontFamily: 'monospace', color: hazardColor(pred.fusedLevel), lineHeight: 1.15 }}>
                    {fmtP(pred.probability)}
                  </Typography>
                  <Typography variant="caption" sx={{ color: 'text.secondary', fontFamily: 'monospace', fontSize: 9.5 }}>{pred.formula}</Typography>
                </Paper>
                <Paper variant="outlined" sx={{ p: 1.5, flex: 1, bgcolor: 'rgba(148,163,184,.04)' }}>
                  <Typography variant="overline" sx={{ color: 'text.secondary', lineHeight: 1 }}>Fusion tiers</Typography>
                  <Stack spacing={0.5} sx={{ mt: 0.5 }}>
                    {[
                      ['I-D threshold tier', `L${pred.thresholdTier}`, pred.thresholdTier],
                      ['ML prior tier', `L${pred.mlPriorTier}`, pred.mlPriorTier],
                      ['Fused (max) + hysteresis', `L${pred.fusedLevel}`, pred.fusedLevel],
                    ].map(([k, v, lvl]) => (
                      <Stack key={k as string} direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center' }}>
                        <Typography variant="caption" sx={{ color: 'text.secondary' }}>{k}</Typography>
                        <Chip size="small" label={v} sx={{ height: 18, fontSize: 10, fontWeight: 800, bgcolor: `${hazardColor(lvl as number)}20`, color: hazardColor(lvl as number) }} />
                      </Stack>
                    ))}
                    <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: 9.5, mt: 0.25 }}>
                      susceptibility band: <b>{pred.suscBand}</b> — thresholds scale per band
                    </Typography>
                  </Stack>
                </Paper>
              </Stack>

              {/* I-D thresholds table */}
              <Typography variant="caption" sx={{ fontWeight: 700, display: 'block', mb: 0.5 }}>
                I-D thresholds for this band — which gates your numbers just crossed
              </Typography>
              <Paper variant="outlined" sx={{ mb: 1.5, overflow: 'hidden' }}>
                <Table size="small" padding="none">
                  <TableHead>
                    <TableRow>
                      {['Level', '24 h threshold', 'breached?', 'Intensity gate', 'breached?'].map((h) => (
                        <TableCell key={h} sx={{ fontWeight: 700, fontSize: 10.5, px: 1 }}>{h}</TableCell>
                      ))}
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {pred.idThresholds.map((t) => (
                      <TableRow key={t.level}>
                        <TableCell sx={{ px: 1 }}><Chip size="small" label={`L${t.level}`} sx={{ height: 17, fontSize: 9.5, fontWeight: 800, bgcolor: `${hazardColor(t.level)}20`, color: hazardColor(t.level) }} /></TableCell>
                        <TableCell sx={{ px: 1, fontSize: 11 }}>{t.rain24h} mm</TableCell>
                        <TableCell sx={{ px: 1 }}>{t.breached24h ? <Chip size="small" label="YES" color="error" sx={{ height: 17, fontSize: 9, fontWeight: 800 }} /> : <Chip size="small" label="no" variant="outlined" sx={{ height: 17, fontSize: 9 }} />}</TableCell>
                        <TableCell sx={{ px: 1, fontSize: 11 }}>≥60% of 24 h + {t.rain1h} mm/h</TableCell>
                        <TableCell sx={{ px: 1 }}>{t.breachedIntensity ? <Chip size="small" label="YES" color="error" sx={{ height: 17, fontSize: 9, fontWeight: 800 }} /> : <Chip size="small" label="no" variant="outlined" sx={{ height: 17, fontSize: 9 }} />}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Paper>

              {/* drivers */}
              <Typography variant="caption" sx={{ fontWeight: 700, display: 'block', mb: 0.5 }}>
                Driver contributions (what pushes the risk)
              </Typography>
              <Stack spacing={0.6} sx={{ mb: 1 }}>
                {pred.drivers.slice(0, 6).map((d) => (
                  <Box key={d.feature}>
                    <Stack direction="row" sx={{ justifyContent: 'space-between', mb: 0.2 }}>
                      <Typography variant="caption" sx={{ fontWeight: 600 }}>{d.name}</Typography>
                      <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                        {d.value} · {Math.round((d.contribution || 0) * 100)}%
                      </Typography>
                    </Stack>
                    <LinearProgress variant="determinate" value={Math.round((d.contribution || 0) * 100)} sx={{ height: 5, borderRadius: 3, bgcolor: 'rgba(148,163,184,.12)' }} />
                  </Box>
                ))}
              </Stack>
              <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                Same code path as the engine pass — <b>src/lib/risk-engine.ts</b>. Change a number, re-run, watch it move.
              </Typography>
            </Paper>
          )}

          {/* engine result card */}
          {inj && (
            <Paper variant="outlined" sx={{ p: 2 }}>
              <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', mb: 1.5, flexWrap: 'wrap', rowGap: 0.5 }}>
                <TrendingUpIcon sx={{ fontSize: 19, color: '#f59e0b' }} />
                <Typography variant="subtitle2" sx={{ flex: 1 }}>
                  Engine pass complete — {inj.scope}
                </Typography>
                <Chip size="small" label={`max L${inj.maxLevel}`} sx={{ height: 22, fontWeight: 800, bgcolor: `${hazardColor(inj.maxLevel)}22`, color: hazardColor(inj.maxLevel) }} />
              </Stack>

              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} useFlexGap sx={{ flexWrap: 'wrap', mb: 1.5 }}>
                {[
                  ['zones injected', inj.zonesInjected, '#38bdf8'],
                  ['escalated', inj.escalated, '#f59e0b'],
                  ['stood down', inj.deescalated, '#34d399'],
                  ['alerts fired', inj.alertsFired, '#ef4444'],
                  ['notifications', inj.notifications, '#a78bfa'],
                  ['SMS dispatched', inj.sms, '#34d399'],
                ].map(([label, val, tone]) => (
                  <Paper key={label as string} variant="outlined" sx={{ p: 1.25, flex: { sm: '1 1 140px' } }}>
                    <Typography variant="overline" sx={{ display: 'block', lineHeight: 1, fontSize: 9.5, color: 'text.secondary' }}>{label}</Typography>
                    <Typography variant="h6" sx={{ fontWeight: 800, fontFamily: 'monospace', color: tone as string }}>{(val as number).toLocaleString('en-IN')}</Typography>
                  </Paper>
                ))}
              </Stack>

              {inj.changes.length > 0 ? (
                <>
                  <Typography variant="caption" sx={{ fontWeight: 700, display: 'block', mb: 0.5 }}>
                    Before → after (top changes)
                  </Typography>
                  <TableContainer>
                    <Table size="small" padding="none">
                      <TableHead>
                        <TableRow>
                          {['Zone', 'District', 'Before', 'After', 'P (24 h)'].map((h) => (
                            <TableCell key={h} sx={{ fontWeight: 700, fontSize: 10.5, px: 1 }}>{h}</TableCell>
                          ))}
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {inj.changes.slice(0, 14).map((c) => (
                          <TableRow key={c.zoneCode}>
                            <TableCell sx={{ px: 1, fontFamily: 'monospace', fontWeight: 700, fontSize: 11 }}>{c.zoneCode}</TableCell>
                            <TableCell sx={{ px: 1, fontSize: 11, color: 'text.secondary' }}>{c.district}</TableCell>
                            <TableCell sx={{ px: 1 }}>
                              <Chip size="small" label={`L${c.before}`} sx={{ height: 17, fontSize: 9.5, fontWeight: 800, bgcolor: `${hazardColor(c.before)}18`, color: hazardColor(c.before) }} />
                            </TableCell>
                            <TableCell sx={{ px: 1 }}>
                              <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
                                <ArrowRightAltIcon sx={{ fontSize: 14, color: 'text.secondary' }} />
                                <Chip size="small" label={`L${c.after}`} sx={{ height: 17, fontSize: 9.5, fontWeight: 800, bgcolor: `${hazardColor(c.after)}22`, color: hazardColor(c.after) }} />
                              </Stack>
                            </TableCell>
                            <TableCell sx={{ px: 1, fontFamily: 'monospace', fontSize: 11 }}>{fmtP(c.probability)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableContainer>
                </>
              ) : (
                <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                  No zone changed level this pass — the engine&apos;s anti-flapping hysteresis requires consecutive
                  ticks above threshold before escalating (try higher values, or push twice).
                </Typography>
              )}
              <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mt: 1 }}>
                Every dashboard tab now reflects this state — check <b>Operations → Comms &amp; SMS</b> for the fan-out.
              </Typography>
            </Paper>
          )}

          {/* ── historic scenario replay ── */}
          <Paper variant="outlined" sx={{ p: 2, borderColor: 'rgba(245,158,11,.3)' }}>
            <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', mb: 0.75 }}>
              <HistoryIcon sx={{ fontSize: 19, color: '#f59e0b' }} />
              <Box sx={{ flex: 1 }}>
                <Typography variant="subtitle2">Historic scenario replay — Noney / Tupul 2022</Typography>
                <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                  72-hour antecedent rainfall rebuild, replayed through the live engine — the evacuation warning window appears on its own.
                </Typography>
              </Box>
              <Button
                size="small"
                variant="contained"
                color="warning"
                disabled={replayBusy || replayPlaying}
                startIcon={replayBusy ? <LinearProgress sx={{ width: 14 }} /> : <PlayArrowIcon />}
                onClick={playReplay}
              >
                {replayBusy ? `Replaying… (${replayIdx + 1}/${REPLAY_STEPS.length})` : 'Play scenario'}
              </Button>
              <Button
                size="small"
                variant="outlined"
                disabled={resetMut.isPending}
                startIcon={<RestartAltIcon />}
                onClick={() => resetMut.mutate('Noney')}
              >
                Reset
              </Button>
            </Stack>

            {/* timeline strip */}
            <Stack direction="row" spacing={0.75} sx={{ overflowX: 'auto', pb: 0.5, pt: 0.25 }}>
              {REPLAY_STEPS.map((s, i) => {
                const r = replayResults[i];
                const active = replayIdx === i && (replayPlaying || replayBusy);
                const done = !!r;
                return (
                  <Paper
                    key={s.t}
                    variant="outlined"
                    sx={{
                      p: 1, minWidth: 148, flexShrink: 0,
                      borderColor: active ? 'primary.main' : done ? `${hazardColor(r.maxLevel)}66` : 'rgba(148,163,184,.18)',
                      bgcolor: done ? `${hazardColor(r.maxLevel)}0d` : 'transparent',
                    }}
                  >
                    <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center', mb: 0.25 }}>
                      <Typography variant="caption" sx={{ fontWeight: 800, fontFamily: 'monospace' }}>{s.t}</Typography>
                      {done && <Chip size="small" label={`L${r.maxLevel}`} sx={{ height: 16, fontSize: 9, fontWeight: 800, bgcolor: `${hazardColor(r.maxLevel)}22`, color: hazardColor(r.maxLevel) }} />}
                      {i === firstWarnIdx && <Chip size="small" label="first warning" color="error" sx={{ height: 16, fontSize: 8.5, fontWeight: 800 }} />}
                    </Stack>
                    <Typography variant="caption" sx={{ display: 'block', lineHeight: 1.25, fontSize: 10 }}>
                      {s.label}
                    </Typography>
                    <Typography variant="caption" sx={{ display: 'block', color: 'text.secondary', fontSize: 9.5, lineHeight: 1.3, mt: 0.25 }}>
                      {s.rain1h} mm/h · {s.rain24h} mm/24h · soil {s.soil}%{done ? ` · ${r.escalated} zones up · ${r.sms} SMS` : ''}
                    </Typography>
                  </Paper>
                );
              })}
            </Stack>

            {leadHours != null && (
              <Paper variant="outlined" sx={{ mt: 1, p: 1.25, borderColor: 'rgba(52,211,153,.4)', bgcolor: 'rgba(52,211,153,.05)', display: 'flex', alignItems: 'flex-start', gap: 0.75 }}>
                <CampaignIcon sx={{ fontSize: 15, mt: 0.25, color: '#34d399' }} />
                <Typography variant="caption" sx={{ lineHeight: 1.5 }}>
                  The engine issued its first <b>L3+ warning {REPLAY_STEPS[firstWarnIdx].t}</b> — a{' '}
                  <b>{leadHours}-hour evacuation window</b> before the event peak. Every step above was a real
                  engine pass, not a recording.
                </Typography>
              </Paper>
            )}
          </Paper>

          {/* reset */}
          <Paper variant="outlined" sx={{ p: 1.75 }}>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ alignItems: 'center' }}>
              <Box sx={{ flex: 1 }}>
                <Typography variant="subtitle2">Return to calm</Typography>
                <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                  Decay injected rainfall to drizzle — zones stand down and all-clear notifications fire.
                </Typography>
              </Box>
              <ToggleButtonGroup
                size="small"
                exclusive
                value={district}
                onChange={(_, v) => v && setDistrict(v)}
                sx={{ flexWrap: 'wrap' }}
              >
                {districts.map((d) => (
                  <ToggleButton key={d} value={d} sx={{ px: 1.25, py: 0.35, fontSize: 10.5 }}>{d.split(' ')[0]}</ToggleButton>
                ))}
              </ToggleButtonGroup>
              <Button size="small" variant="outlined" color="success" disabled={resetMut.isPending} startIcon={<RestartAltIcon />} onClick={() => resetMut.mutate(district)}>
                Decay {district.split(' ')[0]}
              </Button>
            </Stack>
          </Paper>
        </Stack>
      </Stack>

      {toast && (
        <Paper variant="outlined" sx={{ position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)', p: 1.25, bgcolor: '#0e1522', zIndex: 50, maxWidth: 480 }}>
          <Typography variant="caption" sx={{ fontWeight: 700 }}>{toast}</Typography>
        </Paper>
      )}
    </Box>
  );
}
