'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { Box, IconButton, Chip, Stack, Typography, Button, LinearProgress, Paper } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import ThreeSixtyIcon from '@mui/icons-material/ThreeSixty';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import TouchAppIcon from '@mui/icons-material/TouchApp';
import { hazardColor } from '@/components/theme';

export interface StreetViewTarget {
  zoneCode: string;
  name: string;
  district?: string;
  level: number;
  probability: number;
  lat: number;
  lon: number;
  drivers?: Array<{ name: string; value: string; contribution: number }>;
}

interface Props {
  target: StreetViewTarget | null;
  nearbyMarks: Array<{ zoneCode: string; level: number; lat: number; lon: number; name: string; distanceKm: number }>;
  online: boolean;
  onClose: () => void;
}

const PANO_FRAC = 3; // panorama is 3 viewport-widths wide; pan ∈ [-2, 0] (viewport fractions)

/**
 * Street View — draggable ground-level panorama scan of the corridor with
 * landslide-risk marks pinned at their compass bearings. Where real street
 * imagery exists, one tap opens Google Street View (keyless universal link).
 */
export default function StreetViewModal({ target, nearbyMarks, online, onClose }: Props) {
  const [pan, setPan] = useState(0); // viewport-fraction offset
  const [selMark, setSelMark] = useState<string | null>(null);
  const dragRef = useRef<{ x: number; pan: number } | null>(null);
  const [drivers, setDrivers] = useState<Array<{ name: string; value: string; contribution: number }>>(target?.drivers ?? []);

  // reset view state when the target changes (React's reset-on-prop pattern)
  const [prevTarget, setPrevTarget] = useState<StreetViewTarget | null>(target);
  if (target !== prevTarget) {
    setPrevTarget(target);
    setPan(0);
    setSelMark(null);
    setDrivers(target?.drivers ?? []);
  }

  useEffect(() => {
    const t = target;
    if (!t || !online) return;
    let cancelled = false;
    fetch(`/api/zones/${t.zoneCode}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!cancelled && d?.drivers) setDrivers(d.drivers.slice(0, 4));
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [target, online]);

  const viewportRef = useRef<HTMLDivElement | null>(null);

  const onDown = useCallback((e: React.PointerEvent) => {
    dragRef.current = { x: e.clientX, pan };
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  }, [pan]);

  const onMove = useCallback((e: React.PointerEvent) => {
    if (!dragRef.current) return;
    const w = viewportRef.current?.clientWidth ?? 380;
    const dx = (e.clientX - dragRef.current.x) / w; // fraction of viewport
    setPan(Math.max(-(PANO_FRAC - 1), Math.min(0, dragRef.current.pan + dx)));
  }, []);

  const onUp = useCallback(() => { dragRef.current = null; }, []);

  if (!target) return null;
  const leftPct = pan * 100; // viewport fractions → % of viewport

  // marks at deterministic bearings across the panorama
  const marks = nearbyMarks.slice(0, 5);
  const bearingOf = (i: number) => 8 + i * (84 / Math.max(1, marks.length - 1 || 1)) + (target.zoneCode.charCodeAt(3) % 7);

  const googleUrl = `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${target.lat},${target.lon}&heading=0`;

  return (
    <Box
      sx={{
        position: 'absolute', inset: 0, zIndex: 40, bgcolor: '#050a12',
        display: 'flex', flexDirection: 'column', userSelect: 'none', touchAction: 'none',
      }}
    >
      {/* header */}
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', p: 1.25, flexShrink: 0 }}>
        <ThreeSixtyIcon sx={{ fontSize: 20, color: '#f59e0b' }} />
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="body2" sx={{ fontWeight: 800, lineHeight: 1.1 }}>
            Street View — {target.zoneCode}
          </Typography>
          <Typography variant="caption" sx={{ color: 'text.secondary', lineHeight: 1, display: 'block' }}>
            ground-level corridor scan {online ? '' : '· offline'}
          </Typography>
        </Box>
        <IconButton size="small" onClick={onClose}><CloseIcon sx={{ fontSize: 19 }} /></IconButton>
      </Stack>

      {/* panorama viewport */}
      <Box
        ref={viewportRef}
        sx={{ position: 'relative', flex: 1, overflow: 'hidden', cursor: 'grab', bgcolor: '#71a6d8' }}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
      >
        {/* panorama strip: 300% wide */}
        <Box sx={{ position: 'absolute', top: 0, bottom: 0, width: `${PANO_FRAC * 100}%`, left: `${leftPct}%` }}>
          {/* sky */}
          <Box sx={{ position: 'absolute', top: 0, height: '46%', left: 0, right: 0, background: 'linear-gradient(180deg,#3b6ea5 0%,#6d9fce 45%,#a8c6e0 100%)' }} />
          {/* sun glow */}
          <Box sx={{ position: 'absolute', top: '8%', left: '62%', width: 90, height: 90, borderRadius: '50%', background: 'radial-gradient(circle,#fff8e1cc,#fff8e100 70%)' }} />
          {/* far hills */}
          <Box
            component="svg"
            sx={{ position: 'absolute', top: '28%', height: '22%', left: 0, right: 0, width: '100%' }}
            viewBox="0 0 1200 120" preserveAspectRatio="none"
          >
            <path d="M0,120 L0,70 Q80,38 170,62 T340,50 Q430,20 520,54 T700,44 Q800,14 900,58 T1080,52 Q1140,40 1200,64 L1200,120 Z" fill="#4f6b52" />
            <path d="M0,120 L0,92 Q100,68 210,84 T420,78 Q520,56 640,86 T860,80 Q960,62 1080,90 T1200,84 L1200,120 Z" fill="#3c5442" />
          </Box>
          {/* near slope with exposed soil + crack */}
          <Box
            component="svg"
            sx={{ position: 'absolute', top: '48%', height: '26%', left: 0, right: 0, width: '100%' }}
            viewBox="0 0 1200 160" preserveAspectRatio="none"
          >
            <path d="M0,160 L0,60 Q140,30 300,52 T620,40 Q800,22 980,60 T1200,58 L1200,160 Z" fill="#6b5b45" />
            <path d="M0,160 L0,96 Q160,76 330,88 T660,82 Q860,68 1040,92 T1200,90 L1200,160 Z" fill="#7d6a4f" />
            {/* tension crack */}
            <path d="M470,150 Q485,120 470,96 Q462,82 476,64" stroke="#241a12" strokeWidth="7" fill="none" strokeLinecap="round" />
            <path d="M470,150 Q500,138 522,120" stroke="#241a12" strokeWidth="4" fill="none" strokeLinecap="round" />
            {/* seepage stain */}
            <path d="M820,158 Q828,120 812,92 Q810,78 818,70" stroke="#4a5568" strokeWidth="10" fill="none" opacity="0.7" strokeLinecap="round" />
          </Box>
          {/* road */}
          <Box sx={{ position: 'absolute', bottom: 0, height: '26%', left: 0, right: 0, bgcolor: '#31363c' }}>
            <Box sx={{ position: 'absolute', top: '38%', left: 0, right: 0, height: 4, bgcolor: '#c9cdd2', opacity: 0.85, boxShadow: '0 1px 0 #00000088' }} />
            <Box sx={{ position: 'absolute', top: 0, left: 0, right: 0, height: 8, background: 'linear-gradient(180deg,#0006,#0000)' }} />
          </Box>

          {/* hazard marks at bearings */}
          {marks.map((m, i) => {
            const b = bearingOf(i);
            return (
              <Box
                key={m.zoneCode}
                onClick={(e) => { e.stopPropagation(); setSelMark(m.zoneCode === selMark ? null : m.zoneCode); }}
                sx={{
                  position: 'absolute', left: `${b}%`, top: '30%', transform: 'translateX(-50%)', cursor: 'pointer',
                  animation: 'bhrBob 2.4s ease-in-out infinite', animationDelay: `${i * 0.3}s`,
                }}
              >
                <Stack
                 
                  sx={{ alignItems: 'center',
                    px: 0.9, py: 0.4, borderRadius: 2, bgcolor: 'rgba(2,6,23,.82)', border: `1.5px solid ${hazardColor(m.level)}`,
                    boxShadow: `0 0 14px ${hazardColor(m.level)}66`,
                  }}
                >
                  <WarningAmberIcon sx={{ fontSize: 15, color: hazardColor(m.level) }} />
                  <Typography variant="caption" sx={{ fontWeight: 800, color: hazardColor(m.level), lineHeight: 1 }}>
                    L{m.level} · {m.zoneCode}
                  </Typography>
                  {m.distanceKm > 0 && (
                    <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: 9, lineHeight: 1 }}>
                      {m.distanceKm} km {m.zoneCode === target.zoneCode ? '' : '· nearby'}
                    </Typography>
                  )}
                </Stack>
              </Box>
            );
          })}
        </Box>

        {/* drag hint */}
        <Stack
          direction="row" spacing={0.75}
          sx={{ alignItems: 'center', position: 'absolute', bottom: 10, left: '50%', transform: 'translateX(-50%)', px: 1.2, py: 0.4, borderRadius: 9, bgcolor: 'rgba(2,6,23,.72)', pointerEvents: 'none' }}
        >
          <TouchAppIcon sx={{ fontSize: 13, color: '#e2e8f0' }} />
          <Typography variant="caption" sx={{ color: '#e2e8f0', fontWeight: 700 }}>drag to look around</Typography>
        </Stack>
      </Box>

      {/* info card */}
      <Box sx={{ flexShrink: 0, p: 1.25, pt: 1, bgcolor: '#0e1522', borderTop: '1px solid rgba(148,163,184,.16)' }}>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 0.75 }}>
          <Chip size="small" label={`L${target.level}`} sx={{ height: 20, fontWeight: 800, bgcolor: `${hazardColor(target.level)}22`, color: hazardColor(target.level) }} />
          <Typography variant="body2" sx={{ fontWeight: 700, flex: 1 }}>
            {target.name}
          </Typography>
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>
            P(24h) {Math.round(target.probability * 100)}%
          </Typography>
        </Stack>

        {drivers.length > 0 && (
          <Stack spacing={0.5} sx={{ mb: 1 }}>
            {drivers.slice(0, 3).map((d) => (
              <Box key={d.name}>
                <Stack direction="row" sx={{ justifyContent: 'space-between', mb: 0.2 }}>
                  <Typography variant="caption" sx={{ fontWeight: 600 }}>{d.name}</Typography>
                  <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                    {d.value} · {Math.round((d.contribution || 0) * 100)}%
                  </Typography>
                </Stack>
                <LinearProgress
                  variant="determinate"
                  value={Math.round((d.contribution || 0) * 100)}
                  sx={{ height: 4, borderRadius: 2, bgcolor: 'rgba(148,163,184,.14)', '& .MuiLinearProgress-bar': { bgcolor: hazardColor(target.level) } }}
                />
              </Box>
            ))}
          </Stack>
        )}

        <Button
          size="small" variant="outlined" fullWidth startIcon={<OpenInNewIcon sx={{ fontSize: 15 }} />}
          href={googleUrl} target="_blank" rel="noreferrer"
          sx={{ borderColor: 'rgba(56,189,248,.4)', color: '#38bdf8' }}
        >
          Open real Google Street View here
        </Button>
      </Box>

      <style>{`
        @keyframes bhrBob { 0%,100% { transform: translateX(-50%) translateY(0); } 50% { transform: translateX(-50%) translateY(-6px); } }
      `}</style>
    </Box>
  );
}
