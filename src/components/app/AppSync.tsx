'use client';

import { useState } from 'react';
import { Box, Stack, Typography, Chip, Paper, Button, Switch, TextField, CircularProgress, Divider } from '@mui/material';
import CloudDoneIcon from '@mui/icons-material/CloudDone';
import CloudOffIcon from '@mui/icons-material/CloudOff';
import SyncIcon from '@mui/icons-material/Sync';
import ThunderstormIcon from '@mui/icons-material/Thunderstorm';
import SmartphoneIcon from '@mui/icons-material/Smartphone';
import { CATEGORY_LABELS } from './types';
import type { QueuedReport } from '@/lib/offline-store';

interface Props {
  online: boolean;
  simOffline: boolean;
  onSimOffline: (v: boolean) => void;
  queue: QueuedReport[];
  syncing: boolean;
  lastSync: string | null;
  onSyncNow: () => void;
  device: { name: string; phone: string; district: string | null };
  onDevice: (d: { name: string; phone: string; district: string | null }) => void;
  canDemo: boolean;
  onStorm: (d: string) => void;
  stormBusy: boolean;
  districts: string[];
}

function timeAgo(iso: string | null): string {
  if (!iso) return 'never';
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${Math.floor(s)}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  return `${Math.floor(s / 3600)} h ago`;
}

export default function AppSync({
  online, simOffline, onSimOffline, queue, syncing, lastSync, onSyncNow,
  device, onDevice, canDemo, onStorm, stormBusy, districts,
}: Props) {
  const [edit, setEdit] = useState(false);
  const [name, setName] = useState(device.name);
  const [phone, setPhone] = useState(device.phone);
  const [district, setDistrict] = useState(device.district ?? '');

  const effectiveOnline = online && !simOffline;
  const photoBytes = queue.reduce((s, q) => s + (q.photoDataUrl?.length ?? 0) * 0.75, 0);

  return (
    <Box sx={{ p: 1.5, overflowY: 'auto', height: '100%' }}>
      <Stack spacing={1.5}>
        {/* network state */}
        <Paper
          variant="outlined"
          sx={{ p: 1.25, borderColor: effectiveOnline ? 'rgba(52,211,153,.35)' : 'rgba(239,68,68,.4)', bgcolor: effectiveOnline ? 'rgba(52,211,153,.05)' : 'rgba(239,68,68,.06)' }}
        >
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            {effectiveOnline ? <CloudDoneIcon sx={{ fontSize: 19, color: '#34d399' }} /> : <CloudOffIcon sx={{ fontSize: 19, color: '#f87171' }} />}
            <Box sx={{ flex: 1 }}>
              <Typography variant="body2" sx={{ fontWeight: 800 }}>
                {effectiveOnline ? 'Online — live' : 'Offline mode'}
              </Typography>
              <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', lineHeight: 1.2 }}>
                {effectiveOnline
                  ? 'zones, alerts and routes update live; queue auto-syncs'
                  : 'map shows last synced state; reports are queued on-device'}
              </Typography>
            </Box>
            <Stack sx={{ alignItems: 'center', flexShrink: 0 }}>
              <Switch size="small" checked={simOffline} onChange={(e) => onSimOffline(e.target.checked)} />
              <Typography variant="caption" sx={{ fontSize: 9, color: 'text.secondary' }}>simulate</Typography>
            </Stack>
          </Stack>
        </Paper>

        {/* queue */}
        <Paper variant="outlined" sx={{ p: 1.25 }}>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 1 }}>
            <SyncIcon sx={{ fontSize: 17, color: queue.length ? '#f59e0b' : 'text.secondary' }} />
            <Typography variant="subtitle2" sx={{ flex: 1 }}>
              Offline queue · {queue.length} pending
            </Typography>
            <Button
              size="small"
              variant="contained"
              disabled={!effectiveOnline || queue.length === 0 || syncing}
              startIcon={syncing ? <CircularProgress size={14} sx={{ color: 'inherit' }} /> : <SyncIcon sx={{ fontSize: 15 }} />}
              onClick={onSyncNow}
            >
              {syncing ? 'Syncing…' : 'Sync now'}
            </Button>
          </Stack>
          <Stack direction="row" spacing={1.5} sx={{ mb: 0.5 }}>
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>last sync: {timeAgo(lastSync)}</Typography>
            {photoBytes > 0 && (
              <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                photos ≈ {(photoBytes / 1024 / 1024).toFixed(1)} MB
              </Typography>
            )}
          </Stack>
          {queue.length > 0 ? (
            <Stack spacing={0.75}>
              {queue.map((q) => (
                <Stack key={q.id} direction="row" spacing={1} sx={{ alignItems: 'center', p: 0.75, borderRadius: 1.5, bgcolor: 'rgba(148,163,184,.06)' }}>
                  {q.photoDataUrl ? (
                    <Box component="img" src={q.photoDataUrl} alt="queued photo" sx={{ width: 44, height: 44, borderRadius: 1, objectFit: 'cover', flexShrink: 0 }} />
                  ) : (
                    <Box sx={{ width: 44, height: 44, borderRadius: 1, bgcolor: 'rgba(148,163,184,.12)', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
                      <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: 9 }}>no img</Typography>
                    </Box>
                  )}
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography variant="caption" sx={{ fontWeight: 700, display: 'block', lineHeight: 1.2 }}>
                      {CATEGORY_LABELS[q.category] ?? q.category}
                    </Typography>
                    <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: 10, lineHeight: 1.2, display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {q.notes ?? '—'} · {q.lat.toFixed(3)}, {q.lon.toFixed(3)}
                    </Typography>
                    <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: 9 }}>
                      captured {new Date(q.clientCreatedAt).toLocaleTimeString()}
                    </Typography>
                  </Box>
                  <Chip size="small" label="waiting" variant="outlined" sx={{ height: 16, fontSize: 9, fontWeight: 700, color: '#f59e0b', borderColor: 'rgba(245,158,11,.4)' }} />
                </Stack>
              ))}
            </Stack>
          ) : (
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>
              Queue is empty. Reports captured while offline appear here and auto-send when the network returns.
            </Typography>
          )}
        </Paper>

        {/* device identity */}
        <Paper variant="outlined" sx={{ p: 1.25 }}>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 0.75 }}>
            <SmartphoneIcon sx={{ fontSize: 16, color: '#38bdf8' }} />
            <Typography variant="subtitle2" sx={{ flex: 1 }}>This phone (SMS target)</Typography>
            <Button size="small" onClick={() => setEdit((v) => !v)}>{edit ? 'done' : 'edit'}</Button>
          </Stack>
          {!edit ? (
            <Stack spacing={0.4}>
              <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                {device.name} · {device.phone || 'no number'} · {device.district ?? 'all districts'}
              </Typography>
              <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                This device receives SMS + push when landslide detection fires.
              </Typography>
            </Stack>
          ) : (
            <Stack spacing={1}>
              <TextField size="small" label="Name" value={name} onChange={(e) => setName(e.target.value)} fullWidth />
              <TextField size="small" label="Phone (SMS)" value={phone} onChange={(e) => setPhone(e.target.value)} fullWidth placeholder="+91…" />
              <TextField
                size="small"
                label="District (blank = all)"
                value={district}
                onChange={(e) => setDistrict(e.target.value)}
                fullWidth
                placeholder="e.g. East Khasi Hills"
              />
              <Button
                size="small"
                variant="contained"
                onClick={() => {
                  onDevice({ name, phone, district: district || null });
                  setEdit(false);
                }}
              >
                Save device
              </Button>
            </Stack>
          )}
        </Paper>

        {canDemo && (
          <>
            <Divider />
            <Paper variant="outlined" sx={{ p: 1.25, borderColor: 'rgba(245,158,11,.35)' }}>
              <Typography variant="subtitle2" sx={{ mb: 0.5 }}>Simulate: trigger landslide detection</Typography>
              <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mb: 1, lineHeight: 1.4 }}>
                Injects a monsoon storm cell → the real risk engine escalates zones → this phone (and every device in the district) gets notification + SMS.
              </Typography>
              <Stack direction="row" spacing={0.75} useFlexGap sx={{ flexWrap: 'wrap' }}>
                {districts.map((d) => (
                  <Button
                    key={d}
                    size="small"
                    variant="outlined"
                    color="warning"
                    disabled={stormBusy}
                    startIcon={stormBusy ? <CircularProgress size={13} sx={{ color: 'inherit' }} /> : <ThunderstormIcon sx={{ fontSize: 14 }} />}
                    onClick={() => onStorm(d)}
                  >
                    {d}
                  </Button>
                ))}
              </Stack>
            </Paper>
          </>
        )}
      </Stack>
    </Box>
  );
}
