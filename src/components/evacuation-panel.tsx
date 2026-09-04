'use client';

import { useState } from 'react';
import {
  Box, Typography, Stack, Chip, Paper, Button, TextField, MenuItem, LinearProgress,
  Alert, Divider, Tooltip, IconButton,
} from '@mui/material';
import NearMeIcon from '@mui/icons-material/NearMe';
import RouteIcon from '@mui/icons-material/Route';
import StreetviewIcon from '@mui/icons-material/Streetview';
import ShelterIcon from '@mui/icons-material/NightShelter';
import TimerIcon from '@mui/icons-material/Timer';
import { useMutation } from '@tanstack/react-query';
import { hazardColor } from './theme';

export interface EvacResponse {
  origin: { lat: number; lon: number };
  destination: {
    id: string; name: string; district: string; lat: number; lon: number;
    shelterType: string; capacity: number; occupancy: number; hasMedical: boolean;
    slopeDeg: number; distToSlopeM: number;
  };
  safetyScore: number;
  route: [number, number][];
  routeLengthKm: number;
  etaMinutes: number;
  meanHazardAlongRoute: number;
  maxHazardAlongRoute: number;
  avoidedLevels: number[];
  alternatives: Array<{ shelterId: string; name: string; safety: number; distanceKm: number }>;
  avoidedZones: Array<{ zoneCode: string; name: string; hazardLevel: number }>;
  shelters: Array<{
    id: string; name: string; district: string; lat: number; lon: number; shelterType: string;
    capacity: number; occupancy: number; free: number; hasMedical: boolean; safety: number; distanceKm: number;
  }>;
  model: string;
}

const DISTRICTS = ['East Khasi Hills', 'Aizawl', 'Noney', 'Imphal West', 'Gangtok'];

const QUICK_ORIGINS: Array<{ label: string; lat: number; lon: number; district: string }> = [
  { label: 'Sohra (Cherrapunji) — storm cell', lat: 25.2779, lon: 91.7248, district: 'East Khasi Hills' },
  { label: 'Mawkdok valley point', lat: 25.34, lon: 91.68, district: 'East Khasi Hills' },
  { label: 'Noney town — NH-37', lat: 24.9887, lon: 93.6838, district: 'Noney' },
  { label: 'Aizawl city center', lat: 23.7271, lon: 92.7179, district: 'Aizawl' },
];

export default function EvacuationPanel({
  origin,
  onSetOrigin,
  route,
  onClear,
  originMode,
  onToggleOriginMode,
}: {
  origin: { lat: number; lon: number } | null;
  onSetOrigin: (o: { lat: number; lon: number }) => void;
  route: EvacResponse | null;
  onClear: () => void;
  originMode: boolean;
  onToggleOriginMode: () => void;
}) {
  const [latStr, setLatStr] = useState('');
  const [lonStr, setLonStr] = useState('');
  const [error, setError] = useState<string | null>(null);

  const planMut = useMutation({
    mutationFn: async (o: { lat: number; lon: number }) => {
      const res = await fetch('/api/evacuation/route', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(o),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Routing failed');
      return data as EvacResponse;
    },
    onError: (e: Error) => setError(e.message),
  });

  const setOrigin = (lat: number, lon: number) => {
    setError(null);
    onSetOrigin({ lat, lon });
    planMut.mutate({ lat, lon });
  };

  return (
    <Paper variant="outlined" sx={{ p: 1.75, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
        <RouteIcon sx={{ color: 'primary.main', fontSize: 20 }} />
        <Box sx={{ flex: 1 }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>Evacuation route planner</Typography>
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>
            A* hazard-weighted path to the safest shelter
          </Typography>
        </Box>
        {route && (
          <Button size="small" onClick={onClear} color="inherit">
            Clear
          </Button>
        )}
      </Stack>

      {/* quick origins */}
      <Stack spacing={0.5}>
        <Typography variant="overline" sx={{ fontWeight: 700, color: 'text.secondary', lineHeight: 1 }}>
          Quick origins
        </Typography>
        {QUICK_ORIGINS.map((q) => (
          <Button
            key={q.label}
            size="small"
            variant="outlined"
            fullWidth
            onClick={() => setOrigin(q.lat, q.lon)}
            sx={{ justifyContent: 'flex-start', textTransform: 'none', py: 0.55 }}
          >
            <NearMeIcon sx={{ fontSize: 14, mr: 0.75, color: 'text.secondary' }} />
            <Typography variant="caption" sx={{ fontWeight: 600 }}>{q.label}</Typography>
          </Button>
        ))}
      </Stack>

      <Divider />

      {/* manual / map origin */}
      <Stack direction="row" spacing={1}>
        <TextField
          label="Lat"
          size="small"
          value={latStr}
          onChange={(e) => setLatStr(e.target.value)}
          sx={{ flex: 1 }}
          placeholder="25.30"
        />
        <TextField
          label="Lon"
          size="small"
          value={lonStr}
          onChange={(e) => setLonStr(e.target.value)}
          sx={{ flex: 1 }}
          placeholder="91.70"
        />
        <Button
          variant="contained"
          size="small"
          onClick={() => {
            const lat = parseFloat(latStr);
            const lon = parseFloat(lonStr);
            if (isNaN(lat) || isNaN(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
              setError('Enter valid coordinates');
              return;
            }
            setOrigin(lat, lon);
          }}
          sx={{ px: 2 }}
        >
          Route
        </Button>
      </Stack>
      <Button
        variant={originMode ? 'contained' : 'outlined'}
        size="small"
        onClick={onToggleOriginMode}
        startIcon={<NearMeIcon />}
      >
        {originMode ? 'Click the map now…' : 'Pick origin on map'}
      </Button>

      {error && <Alert severity="error" variant="outlined" sx={{ py: 0.25 }}>{error}</Alert>}
      {planMut.isPending && <LinearProgress />}

      {/* result */}
      {route && (
        <Stack spacing={1.25}>
          <Box sx={{ p: 1.25, borderRadius: 2, bgcolor: 'rgba(16,185,129,.08)', border: '1px solid rgba(16,185,129,.3)' }}>
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
              <ShelterIcon sx={{ color: 'success.main', fontSize: 18 }} />
              <Typography variant="body2" sx={{ fontWeight: 700, flex: 1 }}>
                {route.destination.name}
              </Typography>
              <Tooltip title="Open Google Street View at the shelter (new tab)">
                <IconButton
                  size="small"
                  aria-label="Open Street View at shelter"
                  component="a"
                  target="_blank"
                  rel="noopener"
                  href={`https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${route.destination.lat},${route.destination.lon}`}
                >
                  <StreetviewIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            </Stack>
            <Stack direction="row" spacing={0.75} useFlexGap sx={{ flexWrap: 'wrap', mt: 0.75, rowGap: 0.5 }}>
              <Chip size="small" icon={<TimerIcon sx={{ fontSize: 13 }} />} label={`${route.etaMinutes} min walk`} sx={{ height: 22, fontSize: 11 }} />
              <Chip size="small" label={`${route.routeLengthKm} km`} variant="outlined" sx={{ height: 22, fontSize: 11 }} />
              <Chip size="small" label={`safety ${Math.round(route.safetyScore * 100)}%`} variant="outlined" sx={{ height: 22, fontSize: 11 }} />
              <Chip size="small" label={`${route.destination.capacity - route.destination.occupancy} free beds`} variant="outlined" sx={{ height: 22, fontSize: 11 }} />
              {route.destination.hasMedical && <Chip size="small" label="medical on-site" color="success" variant="outlined" sx={{ height: 22, fontSize: 11 }} />}
            </Stack>
          </Box>

          <Stack direction="row" spacing={0.75} useFlexGap sx={{ flexWrap: 'wrap', rowGap: 0.5 }}>
            <Chip size="small" label={`route hazard ${route.meanHazardAlongRoute.toFixed(2)}`} variant="outlined" sx={{ height: 20, fontSize: 10 }} />
            {route.avoidedLevels.length > 0 && (
              <Chip
                size="small"
                label={`bends around L${route.avoidedLevels.join('/L')} zones`}
                sx={{ height: 20, fontSize: 10, bgcolor: 'rgba(239,68,68,.12)', color: '#ef4444' }}
              />
            )}
          </Stack>

          {route.avoidedZones.length > 0 && (
            <Stack spacing={0.5}>
              <Typography variant="overline" sx={{ fontWeight: 700, color: 'text.secondary', lineHeight: 1 }}>
                Avoided hazard zones
              </Typography>
              {route.avoidedZones.map((z) => (
                <Stack key={z.zoneCode} direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                  <Chip
                    size="small"
                    label={`L${z.hazardLevel}`}
                    sx={{ height: 18, fontSize: 9.5, fontWeight: 800, bgcolor: `${hazardColor(z.hazardLevel)}22`, color: hazardColor(z.hazardLevel) }}
                  />
                  <Typography variant="caption" sx={{ fontFamily: 'monospace' }}>{z.zoneCode}</Typography>
                  <Typography variant="caption" sx={{ color: 'text.secondary', flex: 1 }}>{z.name}</Typography>
                </Stack>
              ))}
            </Stack>
          )}

          {route.alternatives.length > 0 && (
            <Stack spacing={0.5}>
              <Typography variant="overline" sx={{ fontWeight: 700, color: 'text.secondary', lineHeight: 1 }}>
                Alternative shelters (ranked by safety)
              </Typography>
              {route.alternatives.map((a, i) => (
                <Stack key={a.shelterId} direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                  <Chip size="small" label={`#${i + 2}`} variant="outlined" sx={{ height: 18, fontSize: 9.5 }} />
                  <Typography variant="caption" sx={{ flex: 1, fontWeight: 600 }}>{a.name}</Typography>
                  <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                    {a.distanceKm} km · safety {Math.round(a.safety * 100)}%
                  </Typography>
                </Stack>
              ))}
            </Stack>
          )}

          <Typography variant="caption" sx={{ color: 'text.secondary' }}>
            {route.model}
          </Typography>
        </Stack>
      )}
    </Paper>
  );
}
