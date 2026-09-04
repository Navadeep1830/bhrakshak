'use client';

import { useState } from 'react';
import {
  Box, Typography, Stack, Chip, Paper, Button, TextField, MenuItem, Alert, Snackbar,
  LinearProgress, Divider, Card, CardContent, IconButton, Tooltip,
} from '@mui/material';
import WhereToVoteIcon from '@mui/icons-material/WhereToVote';
import MyLocationIcon from '@mui/icons-material/MyLocation';
import DoneIcon from '@mui/icons-material/Done';
import NotificationsActiveIcon from '@mui/icons-material/NotificationsActive';
import SmsIcon from '@mui/icons-material/Sms';
import CampaignIcon from '@mui/icons-material/Campaign';
import ReportIcon from '@mui/icons-material/Report';
import WhereToVoteIconAlt from '@mui/icons-material/PersonPinCircle';
import { useMutation, useQuery } from '@tanstack/react-query';

interface ActivityItem {
  id: string;
  kind: 'report' | 'alert' | 'sms' | 'checkin';
  ts: string;
  title: string;
  detail: string;
  photoId?: string | null;
  zoneCode?: string | null;
  district?: string | null;
  level?: number;
  aiFlagged?: boolean;
  offline?: boolean;
}

const CATEGORIES = [
  { value: 'crack', label: 'Ground crack', hint: 'New or widening tension crack on a slope' },
  { value: 'slope_movement', label: 'Slope movement', hint: 'Visible bulge, creep or tilted trees/poles' },
  { value: 'blocked_road', label: 'Blocked road', hint: 'Debris, fallen rock or landslide blocking a route' },
  { value: 'past_slide', label: 'Past slide', hint: 'Evidence of an earlier landslide event' },
  { value: 'water_seepage', label: 'Water seepage', hint: 'Muddy water emerging at a slope base' },
];

export default function FieldView({ onMapPick }: { onMapPick: () => void }) {
  const [category, setCategory] = useState('crack');
  const [notes, setNotes] = useState('');
  const [coords, setCoords] = useState<{ lat: number; lon: number } | null>(null);
  const [geoBusy, setGeoBusy] = useState(false);
  const [toast, setToast] = useState<{ msg: string; sev: 'success' | 'error' | 'info' } | null>(null);
  const [lastResult, setLastResult] = useState<{ zoneCode: string | null; zoneName: string | null; aiPreScreen: string | null; aiConfidence: number | null; aiFindings: string | null; distanceKm: number } | null>(null);

  const activityQ = useQuery<{ items: ActivityItem[] }>({
    queryKey: ['field-activity'],
    queryFn: async () => (await fetch('/api/activity')).json(),
    refetchInterval: 5_000,
  });

  const locate = () => {
    if (!navigator.geolocation) {
      setToast({ msg: 'Geolocation unavailable in this browser — pick on map instead', sev: 'error' });
      return;
    }
    setGeoBusy(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setCoords({ lat: pos.coords.latitude, lon: pos.coords.longitude });
        setGeoBusy(false);
        setToast({ msg: `Location locked: ${pos.coords.latitude.toFixed(4)}, ${pos.coords.longitude.toFixed(4)} (demo zones are in NER India)`, sev: 'info' });
      },
      () => {
        // fall back to a sensible demo origin (East Khasi Hills storm area)
        setCoords({ lat: 25.4, lon: 91.65 });
        setGeoBusy(false);
        setToast({ msg: 'Location denied — using demo origin in East Khasi Hills', sev: 'info' });
      },
      { timeout: 6000 }
    );
  };

  const reportMut = useMutation({
    mutationFn: async () => {
      if (!coords) throw new Error('Set your location first');
      const res = await fetch('/api/reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category, notes, lat: coords.lat, lon: coords.lon }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Submission failed');
      return data;
    },
    onSuccess: (d) => {
      setLastResult(d.report);
      setToast({ msg: `Report stored — routed to zone ${d.report.zoneCode ?? 'unassigned'}`, sev: 'success' });
      setNotes('');
    },
    onError: (e: Error) => setToast({ msg: e.message, sev: 'error' }),
  });

  const safeMut = useMutation({
    mutationFn: async () => {
      if (!coords) throw new Error('Set your location first');
      const res = await fetch('/api/checkin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lat: coords.lat, lon: coords.lon, message: 'I am safe' }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Check-in failed');
      return data;
    },
    onSuccess: (d) => setToast({ msg: `Safe check-in registered (${d.zoneCode ?? 'no zone'}) — responders can see you are OK`, sev: 'success' }),
    onError: (e: Error) => setToast({ msg: e.message, sev: 'error' }),
  });

  return (
    <Box sx={{ p: { xs: 1.5, md: 2.5 }, maxWidth: 720, mx: 'auto' }}>
      <Stack spacing={2}>
        <Paper variant="outlined" sx={{ p: 2 }}>
          <Stack direction="row" spacing={1.5} sx={{ mb: 1.5, alignItems: 'center' }}>
            <WhereToVoteIcon sx={{ color: 'primary.main' }} />
            <Box>
              <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>Field hazard report</Typography>
              <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                Geo-tagged report — nearest zone computed server-side, AI pre-screened
              </Typography>
            </Box>
          </Stack>

          <Stack spacing={2}>
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
              <Button
                variant="contained"
                startIcon={<MyLocationIcon />}
                onClick={locate}
                disabled={geoBusy}
                sx={{ py: 1 }}
              >
                {geoBusy ? 'Locating…' : 'Use my location'}
              </Button>
              <Button variant="outlined" onClick={onMapPick} sx={{ py: 1 }}>
                Pick on map instead
              </Button>
              {coords && (
                <Chip size="small" label={`${coords.lat.toFixed(3)}, ${coords.lon.toFixed(3)}`} color="success" variant="outlined" />
              )}
            </Stack>

            <TextField
              select
              label="What do you see?"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              size="small"
              fullWidth
            >
              {CATEGORIES.map((c) => (
                <MenuItem key={c.value} value={c.value}>
                  <Box>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>{c.label}</Typography>
                    <Typography variant="caption" sx={{ color: 'text.secondary' }}>{c.hint}</Typography>
                  </Box>
                </MenuItem>
              ))}
            </TextField>

            <TextField
              label="Notes (optional)"
              multiline
              minRows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. 30 cm wide crack above the school, growing since yesterday…"
              size="small"
              fullWidth
            />

            <Button
              variant="contained"
              size="large"
              disabled={!coords || reportMut.isPending}
              onClick={() => reportMut.mutate()}
              sx={{ py: 1.2, fontWeight: 700 }}
            >
              {reportMut.isPending ? 'Submitting…' : 'Submit hazard report'}
            </Button>

            {lastResult && (
              <Alert severity="success" variant="outlined" icon={<DoneIcon fontSize="small" />}>
                Routed to <b>{lastResult.zoneCode ?? '—'}</b> ({lastResult.zoneName ?? 'unassigned'},
                {' '}{lastResult.distanceKm?.toFixed?.(1) ?? '—'} km away) · AI pre-screen:{' '}
                <b>{lastResult.aiPreScreen}</b>
                {lastResult.aiConfidence != null ? ` · confidence ${(lastResult.aiConfidence * 100).toFixed(0)}%` : ''}
              </Alert>
            )}
          </Stack>
        </Paper>

        <Paper variant="outlined" sx={{ p: 2 }}>
          <Stack direction="row" spacing={1.5} sx={{ mb: 1, alignItems: 'center' }}>
            <DoneIcon sx={{ color: 'success.main' }} />
            <Box>
              <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>I&apos;m safe — check in</Typography>
              <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                Tells responders you are OK so search effort goes where it is needed
              </Typography>
            </Box>
          </Stack>
          <Button
            variant="outlined"
            color="success"
            size="large"
            fullWidth
            disabled={!coords || safeMut.isPending}
            onClick={() => safeMut.mutate()}
            sx={{ py: 1.2, fontWeight: 700 }}
          >
            {safeMut.isPending ? 'Sending…' : '✓ I\u2019m safe — send check-in'}
          </Button>
        </Paper>

        <Alert severity="info" variant="outlined">
          Reports sync through the same API the ops console uses — verify one from the{' '}
          <b>Operations → Report inbox</b> tab (field official / DC account) and watch it feed the zone dossier.
          Open the <b>Field App</b> (phone button in the header) to capture crack photos offline from a phone.
        </Alert>

        {/* live activity feed — phone app ↔ website communication */}
        <Paper variant="outlined" sx={{ p: 2 }}>
          <Stack direction="row" spacing={1.5} sx={{ mb: 1.5, alignItems: 'center' }}>
            <NotificationsActiveIcon sx={{ color: 'info.main' }} />
            <Box sx={{ flex: 1 }}>
              <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>Live activity — app ↔ website</Typography>
              <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                Everything the phones send lands here in seconds: offline-synced crack photos, AI flags, alerts, SMS dispatch
              </Typography>
            </Box>
            <Chip size="small" label="refresh 5s" variant="outlined" />
          </Stack>
          <Stack spacing={1} sx={{ maxHeight: 460, overflowY: 'auto', pr: 0.5 }}>
            {(activityQ.data?.items ?? []).slice(0, 40).map((it) => (
              <Stack
                key={it.id}
                direction={{ xs: 'column', sm: 'row' }}
                spacing={1}
                sx={{
                  alignItems: { sm: 'center' }, p: 1, borderRadius: 1.5,
                  bgcolor: it.kind === 'report' && it.aiFlagged ? 'rgba(239,68,68,.06)' : 'rgba(148,163,184,.05)',
                  borderLeft: `3px solid ${
                    it.kind === 'report' ? (it.aiFlagged ? '#ef4444' : '#f59e0b')
                    : it.kind === 'alert' ? '#f97316'
                    : it.kind === 'sms' ? '#34d399'
                    : '#38bdf8'
                  }`,
                }}
              >
                {it.photoId ? (
                  <Box
                    component="img"
                    src={`/api/media/${it.photoId}`}
                    alt="phone photo"
                    onClick={() => window.open(`/api/media/${it.photoId}`, '_blank')}
                    sx={{ width: 56, height: 56, borderRadius: 1.5, objectFit: 'cover', cursor: 'zoom-in', border: '1px solid rgba(148,163,184,.3)', flexShrink: 0 }}
                  />
                ) : (
                  <Box sx={{ width: 34, height: 34, borderRadius: 1.5, display: 'grid', placeItems: 'center', bgcolor: 'rgba(148,163,184,.1)', flexShrink: 0, color: 'text.secondary' }}>
                    {it.kind === 'report' ? <ReportIcon sx={{ fontSize: 16 }} /> :
                     it.kind === 'alert' ? <CampaignIcon sx={{ fontSize: 16 }} /> :
                     it.kind === 'sms' ? <SmsIcon sx={{ fontSize: 16 }} /> :
                     <WhereToVoteIconAlt sx={{ fontSize: 16 }} />}
                  </Box>
                )}
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 0.5 }}>
                    <Typography variant="body2" sx={{ fontWeight: 700, fontSize: 12.5 }}>{it.title}</Typography>
                    {it.aiFlagged && <Chip size="small" label="AI flagged" color="error" sx={{ height: 17, fontSize: 9, fontWeight: 800 }} />}
                    {it.offline && <Chip size="small" label="offline-sync" variant="outlined" sx={{ height: 17, fontSize: 9, fontWeight: 700, color: '#f59e0b', borderColor: 'rgba(245,158,11,.4)' }} />}
                    {it.zoneCode && <Chip size="small" label={it.zoneCode} variant="outlined" sx={{ height: 17, fontSize: 9, fontWeight: 700 }} />}
                  </Stack>
                  <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', lineHeight: 1.35 }}>
                    {it.detail}
                  </Typography>
                </Box>
                <Typography variant="caption" sx={{ color: 'text.secondary', flexShrink: 0, fontSize: 10 }}>
                  {new Date(it.ts).toLocaleTimeString()}
                </Typography>
              </Stack>
            ))}
            {(activityQ.data?.items ?? []).length === 0 && (
              <Typography variant="caption" sx={{ color: 'text.secondary', p: 1 }}>
                Waiting for events — submit a report above or trigger a storm from the Command Center.
              </Typography>
            )}
          </Stack>
        </Paper>
      </Stack>

      <Snackbar
        open={!!toast}
        autoHideDuration={4200}
        onClose={() => setToast(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert severity={toast?.sev ?? 'info'} variant="filled" onClose={() => setToast(null)}>
          {toast?.msg}
        </Alert>
      </Snackbar>
    </Box>
  );
}
