'use client';

import { useMemo } from 'react';
import {
  Box, Typography, Stack, Chip, Paper, LinearProgress, Table, TableBody, TableCell,
  TableContainer, TableHead, TableRow, Breadcrumbs, Link, Button, Tooltip, Skeleton,
} from '@mui/material';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import HomeIcon from '@mui/icons-material/Home';
import LandscapeIcon from '@mui/icons-material/Landscape';
import FactoryIcon from '@mui/icons-material/Factory';
import { useQuery } from '@tanstack/react-query';
import { hazardColor } from '@/components/theme';
import { DISTRICT_CENTERS } from '@/components/map/map-styles';
import { ZoneFeature } from '@/components/map/MapView';

interface FactorsData {
  scope: string;
  zones: number;
  factors: Array<{ feature: string; name: string; description: string; avgContribution: number; peakContribution: number; sharePct: number }>;
  districts: Array<{
    district: string;
    zones: number;
    levels: number[];
    l3plus: number;
    l4: number;
    population: number;
    atRiskL3: number;
    avgSusc: number;
    worst: { zoneCode: string; name: string; level: number; probability: number } | null;
  }>;
  generatedAt: string;
}

interface Props {
  district: string | null;
  onDistrict: (d: string | null) => void;
  onZoneSelect: (zoneCode: string) => void;
  onFlyTo: (lat: number, lon: number) => void;
}

const FACTOR_COLORS = ['#ef4444', '#f97316', '#eab308', '#84cc16', '#22c55e', '#14b8a6', '#38bdf8', '#a78bfa'];

export default function ExplorerView({ district, onDistrict, onZoneSelect, onFlyTo }: Props) {
  const factorsQ = useQuery<FactorsData>({
    queryKey: ['factors', district],
    queryFn: async () => (await fetch(`/api/factors${district ? `?district=${encodeURIComponent(district)}` : ''}`)).json(),
    refetchInterval: 30_000,
  });

  const zonesQ = useQuery<{ features: ZoneFeature[] }>({
    queryKey: ['zones-explorer'],
    queryFn: async () => (await fetch('/api/zones')).json(),
    refetchInterval: 30_000,
  });

  const districtZones = useMemo(() => {
    const feats = zonesQ.data?.features ?? [];
    return (district ? feats.filter((f) => f.properties.district === district) : feats)
      .slice()
      .sort((a, b) => (b.properties.hazardLevel - a.properties.hazardLevel) || (b.properties.probability - a.properties.probability));
  }, [zonesQ.data, district]);

  const f = factorsQ.data;

  return (
    <Box sx={{ p: { xs: 1.5, md: 2.5 }, maxWidth: 1280, mx: 'auto' }}>
      {/* breadcrumb */}
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 2 }}>
        <Breadcrumbs
          separator={<ArrowForwardIcon sx={{ fontSize: 13, color: 'text.secondary' }} />}
          sx={{ flex: 1, '& .MuiBreadcrumbs-li': { display: 'flex', alignItems: 'center' } }}
        >
          <Link
            underline="hover"
            sx={{ display: 'flex', alignItems: 'center', gap: 0.5, cursor: 'pointer', fontWeight: district ? 600 : 800, color: district ? 'text.secondary' : 'primary.main' }}
            onClick={() => onDistrict(null)}
          >
            <HomeIcon sx={{ fontSize: 14 }} /> Northeast Region
          </Link>
          {district && (
            <Typography sx={{ fontWeight: 800, display: 'flex', alignItems: 'center', gap: 0.5 }}>
              <LandscapeIcon sx={{ fontSize: 15, color: 'primary.main' }} /> {district}
            </Typography>
          )}
        </Breadcrumbs>
        <Chip
          size="small"
          label={`${f?.zones ?? 0} zones · updated ${f ? new Date(f.generatedAt).toLocaleTimeString() : '—'}`}
          sx={{ fontWeight: 700 }}
        />
      </Stack>

      {/* ── region level: district cards ── */}
      {!district && (
        <Stack spacing={2}>
          <Typography variant="h6" sx={{ fontWeight: 800 }}>
            Major landslide zones — district drill-down
          </Typography>
          <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} useFlexGap sx={{ flexWrap: 'wrap' }}>
            {(f?.districts ?? [...Array(5)].map(() => null)).map((d, i) =>
              d ? (
                <Paper
                  key={d.district}
                  onClick={() => onDistrict(d.district)}
                  sx={{
                    p: 1.75, cursor: 'pointer', flex: { md: '1 1 30%' }, minWidth: { md: 280 },
                    borderLeft: `3px solid ${hazardColor(d.l4 > 0 ? 4 : d.l3plus > 0 ? 3 : 2)}`,
                    transition: 'transform .15s, borderColor .15s',
                    '&:hover': { transform: 'translateY(-2px)', borderColor: 'primary.main' },
                  }}
                >
                  <Stack direction="row" spacing={1} sx={{ mb: 1, alignItems: 'center' }}>
                    <Typography variant="subtitle2" sx={{ fontWeight: 800, flex: 1 }}>{d.district}</Typography>
                    <Chip size="small" label={`${d.l3plus} zones L3+`} sx={{ height: 20, fontWeight: 800, bgcolor: 'rgba(239,68,68,.14)', color: '#f87171' }} />
                  </Stack>
                  {/* level distribution bar */}
                  <Stack direction="row" spacing={0.4} sx={{ height: 7, borderRadius: 4, overflow: 'hidden', mb: 1, bgcolor: 'rgba(148,163,184,.1)' }}>
                    {d.levels.map((n, lvl) =>
                      n > 0 ? (
                        <Tooltip key={lvl} title={`L${lvl}: ${n} zones`}>
                          <Box sx={{ flex: Math.max(n, 0.4), bgcolor: hazardColor(lvl) }} />
                        </Tooltip>
                      ) : null
                    )}
                  </Stack>
                  <Stack spacing={0.4}>
                    {[
                      ['Population monitored', d.population.toLocaleString('en-IN')],
                      ['Population at risk (L3+)', d.atRiskL3.toLocaleString('en-IN')],
                      ['Avg susceptibility', `${d.avgSusc}/100`],
                      ['Worst zone', d.worst ? `${d.worst.zoneCode} · L${d.worst.level} · P ${Math.round(d.worst.probability * 100)}%` : '—'],
                    ].map(([k, v]) => (
                      <Stack key={k} direction="row" sx={{ justifyContent: 'space-between' }}>
                        <Typography variant="caption" sx={{ color: 'text.secondary' }}>{k}</Typography>
                        <Typography variant="caption" sx={{ fontWeight: 700, fontFamily: 'monospace' }}>{v}</Typography>
                      </Stack>
                    ))}
                  </Stack>
                </Paper>
              ) : (
                <Skeleton key={i} variant="rounded" sx={{ p: 1.75, flex: { md: '1 1 30%' }, minWidth: { md: 280 }, height: 170 }} />
              )
            )}
          </Stack>
        </Stack>
      )}

      {/* ── district level: zone table ── */}
      {district && (
        <Stack spacing={1.5}>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <Button size="small" onClick={() => onDistrict(null)}>← All districts</Button>
            <Typography variant="h6" sx={{ fontWeight: 800, flex: 1 }}>
              {district} — {districtZones.length} response zones (hex grid ~5 km)
            </Typography>
          </Stack>
          <TableContainer component={Paper} variant="outlined" sx={{ maxHeight: 560 }}>
            <Table size="small" stickyHeader>
              <TableHead>
                <TableRow>
                  {['Zone', 'Hazard', 'P (24 h)', 'Population', 'Suscept.', 'Road km', 'Worst driver'].map((h) => (
                    <TableCell key={h} sx={{ fontWeight: 700, fontSize: 11.5 }}>{h}</TableCell>
                  ))}
                </TableRow>
              </TableHead>
              <TableBody>
                {districtZones.slice(0, 160).map((z) => (
                  <TableRow
                    key={z.id}
                    hover
                    onClick={() => {
                      onZoneSelect(z.properties.zoneCode);
                      onFlyTo(z.properties.centroidLat, z.properties.centroidLon);
                    }}
                    sx={{ cursor: 'pointer' }}
                  >
                    <TableCell>
                      <Typography variant="caption" sx={{ fontWeight: 800, display: 'block' }}>{z.properties.zoneCode}</Typography>
                      <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: 10 }}>{z.properties.name}</Typography>
                    </TableCell>
                    <TableCell>
                      <Chip size="small" label={`L${z.properties.hazardLevel}`} sx={{ height: 19, fontWeight: 800, bgcolor: `${hazardColor(z.properties.hazardLevel)}20`, color: hazardColor(z.properties.hazardLevel) }} />
                    </TableCell>
                    <TableCell>
                      <Typography variant="caption" sx={{ fontFamily: 'monospace', fontWeight: 700 }}>
                        {Math.round(z.properties.probability * 100)}%
                      </Typography>
                    </TableCell>
                    <TableCell><Typography variant="caption" sx={{ fontFamily: 'monospace' }}>{z.properties.population.toLocaleString('en-IN')}</Typography></TableCell>
                    <TableCell><Typography variant="caption" sx={{ fontFamily: 'monospace' }}>{z.properties.suscMean}</Typography></TableCell>
                    <TableCell><Typography variant="caption" sx={{ fontFamily: 'monospace' }}>{z.properties.roadKm}</Typography></TableCell>
                    <TableCell>
                      <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                        {z.properties.topDriver
                          ? `${z.properties.topDriver.name} · ${z.properties.topDriver.sharePct}%`
                          : '—'}
                      </Typography>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>
            Tap any zone to open its dossier — full driver breakdown with percentages, 48 h rainfall, sensors and the DC playbook.
          </Typography>
        </Stack>
      )}

      {/* ── factors panel (always visible) ── */}
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mt: 3, mb: 1.25 }}>
        <FactoryIcon sx={{ fontSize: 18, color: 'primary.main' }} />
        <Typography variant="h6" sx={{ fontWeight: 800, flex: 1 }}>
          What is driving the landslide risk {district ? `— ${district}` : '— region-wide'}
        </Typography>
        <Chip size="small" label="ML driver contributions" variant="outlined" sx={{ fontWeight: 700 }} />
      </Stack>
      <Paper variant="outlined" sx={{ p: { xs: 1.5, md: 2 } }}>
        <Stack spacing={1.25}>
          {(f?.factors ?? [...Array(8)].map(() => null)).map((fac, i) =>
            fac ? (
              <Box key={fac.feature}>
                <Stack direction="row" spacing={1} sx={{ mb: 0.3, alignItems: 'center' }}>
                  <Typography variant="body2" sx={{ fontWeight: 700, flex: 1 }}>
                    {fac.name}
                  </Typography>
                  <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                    avg {Math.round(fac.avgContribution * 100)}% · peak {Math.round(fac.peakContribution * 100)}%
                  </Typography>
                  <Typography variant="body2" sx={{ fontWeight: 800, fontFamily: 'monospace', color: FACTOR_COLORS[i % FACTOR_COLORS.length], width: 58, textAlign: 'right' }}>
                    {fac.sharePct.toFixed(1)}%
                  </Typography>
                </Stack>
                <LinearProgress
                  variant="determinate"
                  value={fac.sharePct}
                  sx={{
                    height: 8, borderRadius: 4, bgcolor: 'rgba(148,163,184,.12)',
                    '& .MuiLinearProgress-bar': { bgcolor: FACTOR_COLORS[i % FACTOR_COLORS.length], borderRadius: 4 },
                  }}
                />
                <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mt: 0.3, lineHeight: 1.35 }}>
                  {fac.description}
                </Typography>
              </Box>
            ) : (
              <Skeleton key={i} variant="rounded" height={44} />
            )
          )}
        </Stack>
      </Paper>
    </Box>
  );
}
