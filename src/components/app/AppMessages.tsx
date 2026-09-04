'use client';

import { useState } from 'react';
import { Box, Stack, Typography, Chip, Paper, Button, TextField, Divider, CircularProgress } from '@mui/material';
import VolunteerActivismIcon from '@mui/icons-material/VolunteerActivism';
import SosIcon from '@mui/icons-material/Sos';
import React from 'react';
import InfoIcon from '@mui/icons-material/Info';
import SpeedIcon from '@mui/icons-material/Speed';
import GrainIcon from '@mui/icons-material/Grain';
import SendIcon from '@mui/icons-material/Send';
import ReplyIcon from '@mui/icons-material/Reply';
import GavelIcon from '@mui/icons-material/Gavel';
import { hazardColor } from '@/components/theme';
import type { AppFieldMessage } from './types';

interface Props {
  messages: AppFieldMessage[];
  online: boolean;
  queuedCount: number;
  userPos: { lat: number; lon: number } | null;
  sending: boolean;
  onSend: (category: string, body: string) => Promise<boolean>;
  onSafeCheckin: (message?: string) => Promise<void>;
  onGaugeSubmit: (rain1h: number, rain24h: number, soil: number) => Promise<void>;
}

const CATEGORIES: Array<{ id: string; label: string; color: string; icon: React.ReactElement }> = [
  { id: 'sos', label: 'SOS', color: '#ef4444', icon: <SosIcon sx={{ fontSize: 16 }} /> },
  { id: 'help', label: 'Help', color: '#f59e0b', icon: <VolunteerActivismIcon sx={{ fontSize: 16 }} /> },
  { id: 'status', label: 'Status', color: '#38bdf8', icon: <SpeedIcon sx={{ fontSize: 16 }} /> },
  { id: 'info', label: 'Info', color: '#94a3b8', icon: <InfoIcon sx={{ fontSize: 16 }} /> },
];

const CAT_COLOR: Record<string, string> = {
  sos: '#ef4444',
  help: '#f59e0b',
  status: '#38bdf8',
  info: '#94a3b8',
  gauge: '#a78bfa',
};

function timeAgo(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${Math.floor(s)}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString();
}

export default function AppMessages({
  messages, online, queuedCount, userPos, sending, onSend, onSafeCheckin, onGaugeSubmit,
}: Props) {
  const [category, setCategory] = useState('status');
  const [text, setText] = useState('');
  const [checkinMsg, setCheckinMsg] = useState('');
  const [checkinOpen, setCheckinOpen] = useState(false);
  const [checkinBusy, setCheckinBusy] = useState(false);
  const [gaugeOpen, setGaugeOpen] = useState(false);
  const [gaugeBusy, setGaugeBusy] = useState(false);
  const [rain1h, setRain1h] = useState('35');
  const [rain24h, setRain24h] = useState('120');
  const [soil, setSoil] = useState('70');

  const send = async () => {
    if (!text.trim() || sending) return;
    const ok = await onSend(category, text.trim());
    if (ok) setText('');
  };

  const safeCheckin = async () => {
    setCheckinBusy(true);
    try {
      await onSafeCheckin(checkinMsg.trim() || undefined);
      setCheckinMsg('');
      setCheckinOpen(false);
    } finally {
      setCheckinBusy(false);
    }
  };

  const gauge = async () => {
    setGaugeBusy(true);
    try {
      await onGaugeSubmit(Number(rain1h) || 0, Number(rain24h) || 0, (Number(soil) || 0) / 100);
      setGaugeOpen(false);
    } finally {
      setGaugeBusy(false);
    }
  };

  return (
    <Box sx={{ p: 1.5, overflowY: 'auto', height: '100%' }}>
      <Stack spacing={1.5}>
        {/* ── I'M SAFE check-in ── */}
        <Paper
          variant="outlined"
          sx={{ p: 1.25, borderColor: 'rgba(34,197,94,.4)', bgcolor: 'rgba(34,197,94,.07)' }}
        >
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <VolunteerActivismIcon sx={{ fontSize: 22, color: '#22c55e' }} />
            <Typography variant="caption" sx={{ flex: 1, fontWeight: 700, lineHeight: 1.2 }}>
              {checkinOpen ? 'Send your safe check-in' : 'Mark yourself SAFE — command sees it instantly'}
              {userPos && (
                <Typography component="span" variant="caption" sx={{ display: 'block', fontSize: 9.5, color: 'text.secondary' }}>
                  from your set position · nearest zone attributed
                </Typography>
              )}
            </Typography>
            <Button
              size="small"
              variant={checkinOpen ? 'text' : 'contained'}
              color="success"
              onClick={() => setCheckinOpen(!checkinOpen)}
            >
              {checkinOpen ? 'Cancel' : "I'M SAFE"}
            </Button>
          </Stack>
          {checkinOpen && (
            <Stack direction="row" spacing={1} sx={{ mt: 1, alignItems: 'center' }}>
              <TextField
                size="small"
                placeholder="optional note (e.g. '6 families moved to Tupul camp')"
                value={checkinMsg}
                onChange={(e) => setCheckinMsg(e.target.value)}
                sx={{ flex: 1, '& .MuiInput-root': { fontSize: 12.5 } }}
              />
              <Button size="small" variant="contained" color="success" disabled={checkinBusy || !online} onClick={safeCheckin}>
                {checkinBusy ? <CircularProgress size={16} color="success" /> : 'Send'}
              </Button>
            </Stack>
          )}
        </Paper>

        {/* ── rain gauge (manual field observation → live engine) ── */}
        <Paper variant="outlined" sx={{ p: 1.25, borderColor: 'rgba(167,139,250,.35)' }}>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <GrainIcon sx={{ fontSize: 20, color: '#a78bfa' }} />
            <Typography variant="caption" sx={{ flex: 1, fontWeight: 700, lineHeight: 1.2 }}>
              Rain gauge reading
              <Typography component="span" variant="caption" sx={{ display: 'block', fontSize: 9.5, color: 'text.secondary' }}>
                your mm numbers run the real risk engine
              </Typography>
            </Typography>
            <Button size="small" onClick={() => setGaugeOpen(!gaugeOpen)} sx={{ color: '#a78bfa' }}>
              {gaugeOpen ? 'Close' : 'Report'}
            </Button>
          </Stack>
          {gaugeOpen && (
            <Box sx={{ mt: 1 }}>
              <Stack direction="row" spacing={1}>
                {[
                  { label: 'mm / 1h', value: rain1h, set: setRain1h },
                  { label: 'mm / 24h', value: rain24h, set: setRain24h },
                  { label: 'soil %', value: soil, set: setSoil },
                ].map((f) => (
                  <TextField
                    key={f.label}
                    size="small"
                    type="number"
                    label={f.label}
                    value={f.value}
                    onChange={(e) => f.set(e.target.value)}
                    sx={{ flex: 1, '& input': { fontSize: 13, p: '8px 10px' } }}
                  />
                ))}
              </Stack>
              <Button
                fullWidth size="small" variant="contained" disabled={gaugeBusy || !online || !userPos}
                onClick={gauge} sx={{ mt: 1, bgcolor: '#a78bfa', color: '#1b1032', fontWeight: 800 }}
              >
                {gaugeBusy ? <CircularProgress size={16} /> : !userPos ? 'Set your position on the map first' : 'Submit reading → engine'}
              </Button>
            </Box>
          )}
        </Paper>

        <Divider sx={{ borderColor: 'rgba(148,163,184,.12)' }} />

        {/* ── composer ── */}
        <Stack direction="row" spacing={0.75} sx={{ flexWrap: 'wrap', gap: 0.75 }}>
          {CATEGORIES.map((c) => (
            <Chip
              key={c.id}
              size="small"
              icon={c.icon}
              label={c.label}
              onClick={() => setCategory(c.id)}
              sx={{
                height: 26, fontWeight: 800, fontSize: 11,
                bgcolor: category === c.id ? `${c.color}26` : 'rgba(148,163,184,.08)',
                color: category === c.id ? c.color : 'text.secondary',
                border: `1px solid ${category === c.id ? `${c.color}66` : 'rgba(148,163,184,.2)'}`,
                '& .MuiChip-icon': { color: category === c.id ? c.color : 'text.secondary', ml: 0.5 },
              }}
            />
          ))}
        </Stack>

        <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-start' }}>
          <TextField
            multiline
            minRows={2}
            maxRows={4}
            placeholder={
              category === 'sos'
                ? 'EMERGENCY — people/property at risk. Command is notified on priority.'
                : 'Message the command center…'
            }
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) send(); }}
            sx={{ flex: 1, '& .MuiInput-root': { fontSize: 13 } }}
          />
          <Button
            size="small"
            variant="contained"
            disabled={!text.trim() || sending}
            onClick={send}
            sx={{ mt: 0.5, bgcolor: category === 'sos' ? '#ef4444' : undefined, fontWeight: 800, minWidth: 40 }}
          >
            {sending ? <CircularProgress size={16} /> : <SendIcon sx={{ fontSize: 16 }} />}
          </Button>
        </Stack>

        {!online && (
          <Typography variant="caption" sx={{ color: '#f59e0b', px: 0.5 }}>
            Offline — messages queue on-device and auto-send when the network returns.
            {queuedCount > 0 && ` ${queuedCount} message${queuedCount > 1 ? 's' : ''} waiting.`}
          </Typography>
        )}

        {/* ── thread ── */}
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
          <GavelIcon sx={{ fontSize: 16, color: 'text.secondary' }} />
          <Typography variant="subtitle2" sx={{ flex: 1 }}>
            Command centre thread
          </Typography>
        </Stack>

        {messages.length === 0 && (
          <Typography variant="caption" sx={{ color: 'text.secondary', px: 1 }}>
            No messages yet. Anything you send appears in the website&apos;s Operations inbox —
            replies from command land here.
          </Typography>
        )}

        {messages.map((m) => {
          const mine = m.authorRole === 'field';
          const color = CAT_COLOR[m.category] ?? '#94a3b8';
          return (
            <Paper
              key={m.id}
              variant="outlined"
              sx={{
                p: 1.25,
                borderLeft: `3px solid ${mine ? (m.priority > 0 ? '#ef4444' : color) : '#22c55e'}`,
                bgcolor: mine ? 'transparent' : 'rgba(34,197,94,.05)',
                borderColor: mine ? undefined : 'rgba(34,197,94,.25)',
              }}
            >
              <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center', mb: 0.3 }}>
                {mine
                  ? (m.category === 'sos' ? <SosIcon sx={{ fontSize: 15, color: '#ef4444' }} /> :
                     m.category === 'gauge' ? <GrainIcon sx={{ fontSize: 15, color: '#a78bfa' }} /> :
                     <SendIcon sx={{ fontSize: 14, color }} />)
                  : <ReplyIcon sx={{ fontSize: 15, color: '#22c55e' }} />}
                <Typography variant="caption" sx={{ fontWeight: 800, flex: 1, lineHeight: 1.2 }}>
                  {mine ? 'You' : m.authorName} {m.category === 'gauge' && mine ? '· gauge' : ''}
                  {m.zoneCode && (
                    <Typography component="span" variant="caption" sx={{ color: 'text.secondary', fontWeight: 600, fontSize: 10 }}>
                      {' '}· {m.zoneCode}
                    </Typography>
                  )}
                </Typography>
                <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: 10 }}>{timeAgo(m.createdAt)}</Typography>
              </Stack>
              <Typography variant="body2" sx={{ fontSize: 12.5, lineHeight: 1.45, whiteSpace: 'pre-wrap' }}>
                {m.body}
              </Typography>
              {m.priority > 0 && mine && m.category === 'sos' && (
                <Chip size="small" label="PRIORITY — command notified" sx={{ height: 18, mt: 0.5, fontSize: 9, fontWeight: 800, bgcolor: 'rgba(239,68,68,.12)', color: '#ef4444' }} />
              )}
            </Paper>
          );
        })}
      </Stack>
    </Box>
  );
}
