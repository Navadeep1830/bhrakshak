'use client';

import { useEffect, useRef, useState } from 'react';
import {
  Box, Stack, Typography, Chip, Button, TextField, Paper, CircularProgress, IconButton,
} from '@mui/material';
import PhotoCameraIcon from '@mui/icons-material/PhotoCameraFront';
import DeleteIcon from '@mui/icons-material/Delete';
import CloudUploadIcon from '@mui/icons-material/CloudUpload';
import CloudOffIcon from '@mui/icons-material/CloudOff';
import GpsFixedIcon from '@mui/icons-material/GpsFixed';
import { compressPhoto, dataUrlToBlob } from '@/lib/offline-store';
import { CATEGORY_LABELS, AppZone, SubmitOutcome } from './types';

interface Props {
  online: boolean;
  zones: AppZone[];
  userPos: { lat: number; lon: number } | null;
  onUserPos: (p: { lat: number; lon: number }) => void;
  deviceId: string;
  onQueueChange: () => void;
  onToast: (msg: string, sev?: 'success' | 'error' | 'info') => void;
}

const CATEGORIES = Object.keys(CATEGORY_LABELS);

export default function AppReport({ online, zones, userPos, onUserPos, deviceId, onQueueChange, onToast }: Props) {
  const [category, setCategory] = useState<string>('crack');
  const [notes, setNotes] = useState('');
  const [photo, setPhoto] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<SubmitOutcome | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const pos = userPos ?? (zones.length ? { lat: zones[0].lat, lon: zones[0].lon } : null);
  const nearestZone = pos
    ? zones.reduce<AppZone | null>((best, z) => {
        const d = (z: AppZone) => Math.hypot(z.lat - pos.lat, z.lon - pos.lon);
        if (!best || d(z) < d(best)) return z;
        return best;
      }, null)
    : null;

  // auto-locate once
  useEffect(() => {
    if (userPos || !navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (p) => onUserPos({ lat: p.coords.latitude, lon: p.coords.longitude }),
      () => {},
      { timeout: 6000 }
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pickPhoto = async (f: File | null) => {
    if (!f) return;
    try {
      const dataUrl = await compressPhoto(f);
      setPhoto(dataUrl);
      setOutcome(null);
    } catch {
      onToast('Could not read that image', 'error');
    }
  };

  const submit = async () => {
    if (!pos) { onToast('No location set — tap Locate on the map', 'error'); return; }
    setBusy(true);
    const clientCreatedAt = new Date().toISOString();
    try {
      if (online) {
        const fd = new FormData();
        fd.set('category', category);
        fd.set('notes', notes);
        fd.set('lat', String(pos.lat));
        fd.set('lon', String(pos.lon));
        fd.set('deviceId', deviceId);
        if (photo) {
          const blob = dataUrlToBlob(photo);
          fd.set('photo', blob, 'crack.jpg');
        }
        const res = await fetch('/api/app/report', { method: 'POST', body: fd });
        const d = await res.json();
        if (!res.ok || d.error) throw new Error(d.error || 'Submission failed');
        setOutcome({ ok: true, ...(d.report ?? {}) });
        onToast(`Report sent — AI: ${d.report?.aiPreScreen === 'flagged' ? 'FLAGGED' : 'OK'}`, d.report?.aiPreScreen === 'flagged' ? 'success' : 'info');
        reset();
      } else {
        // offline → queue
        const { addToQueue } = await import('@/lib/offline-store');
        await addToQueue({
          id: `q-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          category,
          notes: notes || null,
          lat: pos.lat,
          lon: pos.lon,
          photoDataUrl: photo,
          clientCreatedAt,
          zoneHint: nearestZone?.zoneCode ?? null,
        });
        onQueueChange();
        setOutcome({ ok: true, aiPreScreen: 'queued' });
        onToast('Saved to offline queue — will auto-send when network returns', 'info');
        reset();
      }
    } catch (e) {
      setOutcome({ ok: false, error: (e as Error).message });
      onToast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const reset = () => {
    setNotes('');
    setPhoto(null);
    if (fileRef.current) fileRef.current.value = '';
  };

  return (
    <Box sx={{ p: 1.5, overflowY: 'auto', height: '100%' }}>
      <Stack spacing={1.5}>
        {/* camera */}
        <Paper variant="outlined" sx={{ p: 1.25 }}>
          <Stack direction="row" spacing={1.25} sx={{ alignItems: 'center' }}>
            <Box
              onClick={() => fileRef.current?.click()}
              sx={{
                width: 92, height: 92, borderRadius: 2.5, flexShrink: 0, cursor: 'pointer',
                border: '1.5px dashed rgba(148,163,184,.4)', display: 'grid', placeItems: 'center',
                overflow: 'hidden', position: 'relative', bgcolor: 'rgba(148,163,184,.05)',
              }}
            >
              {photo ? (
                <Box component="img" src={photo} alt="crack photo preview" sx={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              ) : (
                <Stack spacing={0.5} sx={{ alignItems: 'center' }}>
                  <PhotoCameraIcon sx={{ fontSize: 26, color: 'text.secondary' }} />
                  <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 600, fontSize: 9.5 }}>
                    Take photo
                  </Typography>
                </Stack>
              )}
            </Box>
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography variant="subtitle2" sx={{ mb: 0.3 }}>Photo of the crack</Typography>
              <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', lineHeight: 1.35, mb: photo ? 0.75 : 0 }}>
                The AI vision pre-screener analyses the photo on arrival. Works offline — photo is stored and sent when the network returns.
              </Typography>
              {photo && (
                <Button size="small" color="error" startIcon={<DeleteIcon sx={{ fontSize: 15 }} />} onClick={() => { setPhoto(null); if (fileRef.current) fileRef.current.value = ''; }}>
                  Remove
                </Button>
              )}
            </Box>
          </Stack>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            capture="environment"
            style={{ display: 'none' }}
            onChange={(e) => pickPhoto(e.target.files?.[0] ?? null)}
          />
        </Paper>

        {/* category */}
        <Box>
          <Typography variant="subtitle2" sx={{ mb: 0.6 }}>What do you see?</Typography>
          <Stack direction="row" spacing={0.5} useFlexGap sx={{ flexWrap: 'wrap' }}>
            {CATEGORIES.map((c) => (
              <Chip
                key={c}
                size="small"
                label={CATEGORY_LABELS[c]}
                variant={category === c ? 'filled' : 'outlined'}
                color={category === c ? 'primary' : 'default'}
                onClick={() => setCategory(c)}
                sx={{ fontWeight: 700 }}
              />
            ))}
          </Stack>
        </Box>

        {/* notes */}
        <TextField
          multiline
          minRows={3}
          size="small"
          label="Describe what you see"
          placeholder="e.g. long crack on the slope below the school, ~40 cm wide, growing after last night's rain, water seeping out"
          value={notes}
          onChange={(e) => setNotes(e.target.value.slice(0, 2000))}
        />

        {/* location */}
        <Paper variant="outlined" sx={{ p: 1.1 }}>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <GpsFixedIcon sx={{ fontSize: 17, color: '#38bdf8' }} />
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography variant="caption" sx={{ display: 'block', lineHeight: 1.2 }}>
                {pos ? `${pos.lat.toFixed(4)}, ${pos.lon.toFixed(4)}` : 'no position'}
              </Typography>
              <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: 10, lineHeight: 1 }}>
                {nearestZone ? `nearest zone ${nearestZone.zoneCode} · ${nearestZone.district}` : ''}
              </Typography>
            </Box>
          </Stack>
        </Paper>

        {/* result */}
        {outcome && (
          <Paper
            variant="outlined"
            sx={{
              p: 1.25,
              borderColor: outcome.aiPreScreen === 'flagged' ? 'rgba(239,68,68,.45)' : outcome.ok ? 'rgba(16,185,129,.4)' : 'rgba(239,68,68,.45)',
              bgcolor: outcome.aiPreScreen === 'flagged' ? 'rgba(239,68,68,.07)' : outcome.ok ? 'rgba(16,185,129,.05)' : 'transparent',
            }}
          >
            {outcome.aiPreScreen === 'queued' ? (
              <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                <CloudOffIcon sx={{ fontSize: 18, color: '#f59e0b' }} />
                <Typography variant="caption" sx={{ fontWeight: 700 }}>Queued offline — auto-syncs when online</Typography>
              </Stack>
            ) : outcome.ok ? (
              <>
                <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 0.4 }}>
                  <Chip
                    size="small"
                    label={outcome.aiPreScreen === 'flagged' ? 'AI: FLAGGED' : 'AI: OK'}
                    color={outcome.aiPreScreen === 'flagged' ? 'error' : 'success'}
                    sx={{ height: 20, fontWeight: 800 }}
                  />
                  <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                    confidence {Math.round((outcome.aiConfidence ?? 0) * 100)}% · {outcome.aiSource}
                  </Typography>
                </Stack>
                {outcome.aiFindings && (
                  <Typography variant="caption" sx={{ display: 'block', mb: 0.4, lineHeight: 1.4 }}>
                    “{outcome.aiFindings}”
                  </Typography>
                )}
                {outcome.fanOut && outcome.fanOut.sms > 0 && (
                  <Typography variant="caption" sx={{ color: '#f59e0b', fontWeight: 700 }}>
                    ⚑ {outcome.fanOut.notifications} notifications + {outcome.fanOut.sms} SMS dispatched to officials
                  </Typography>
                )}
                {outcome.zoneCode && (
                  <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block' }}>
                    snapped to {outcome.zoneCode} ({outcome.zoneName})
                  </Typography>
                )}
              </>
            ) : (
              <Typography variant="caption" sx={{ color: 'error.main' }}>{outcome.error}</Typography>
            )}
          </Paper>
        )}

        {/* submit */}
        <Button
          fullWidth
          size="large"
          variant="contained"
          disabled={busy}
          startIcon={busy ? <CircularProgress size={17} sx={{ color: 'inherit' }} /> : online ? <CloudUploadIcon /> : <CloudOffIcon />}
          onClick={submit}
          sx={{ py: 1.1, fontWeight: 800 }}
        >
          {busy ? 'Sending…' : online ? 'Send report now' : 'Save to offline queue'}
        </Button>
      </Stack>
    </Box>
  );
}
