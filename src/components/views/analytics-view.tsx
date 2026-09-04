'use client';

import { useState } from 'react';
import {
  Box, Typography, Stack, Chip, Paper, Tabs, Tab, Table, TableBody, TableCell, TableContainer,
  TableHead, TableRow, IconButton, Tooltip, Button, Snackbar, Alert, TextField, MenuItem,
  LinearProgress, Badge,
} from '@mui/material';
import CheckIcon from '@mui/icons-material/Check';
import BlockIcon from '@mui/icons-material/Block';
import CampaignIcon from '@mui/icons-material/Campaign';
import MonitorHeartIcon from '@mui/icons-material/MonitorHeart';
import MemoryIcon from '@mui/icons-material/Memory';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { hazardColor } from '../theme';
import ReactECharts from 'echarts-for-react';

interface AnalyticsData {
  priorityQueue: Array<{
    zoneCode: string; name: string; district: string; hazardLevel: number; probability: number;
    rain24h: number; suscMean: number; population: number; isolation: number; score: number;
    reasons: string[]; recommendedAction: string;
  }>;
  districts: Array<{ district: string; zones: number; l2: number; l3: number; l4: number; population: number; maxLevel: number }>;
  alertTimeline: Array<{ bucket: string; count: number; maxLevel: number }>;
  levelDistribution: Record<string, number>;
  totalAlerts: number; activeAlerts: number; ackedAlerts: number;
  engineLive: {
    zones: number; lastRecompute: string | null; levelsNow: Record<string, number>;
    escalations24h: number; allclears24h: number; alerts24h: number; sms24h: number;
    notifications24h: number; reports24h: number; checkins24h: number; passes24h: number;
    ackRate: number; avgLeadTimeMin: number | null;
  };
  registry: Array<{ id: string; name: string; version: string; metrics: Record<string, string | number>; notes: string | null }>;
  recentRuns: Array<{ id: string; at: string; metrics: Record<string, number>; notes: string | null }>;
}

export default function AnalyticsView() {
  const { data, isLoading } = useQuery<AnalyticsData>({
    queryKey: ['analytics'],
    queryFn: async () => (await fetch('/api/analytics')).json(),
    refetchInterval: 20_000,
  });

  const timelineOption = {
    backgroundColor: 'transparent',
    grid: { left: 8, right: 8, top: 26, bottom: 22, containLabel: true },
    tooltip: { trigger: 'axis', backgroundColor: '#0b1120', borderColor: 'rgba(148,163,184,.3)', textStyle: { color: '#e2e8f0', fontSize: 11 } },
    legend: { textStyle: { color: '#94a3b8', fontSize: 10 }, top: 0 },
    xAxis: {
      type: 'category',
      data: (data?.alertTimeline ?? []).map((b) => new Date(b.bucket).toLocaleTimeString([], { hour: '2-digit' })),
      axisLabel: { color: '#64748b', fontSize: 9 },
      axisLine: { lineStyle: { color: 'rgba(148,163,184,.2)' } },
    },
    yAxis: { type: 'value', axisLabel: { color: '#64748b', fontSize: 9 }, splitLine: { lineStyle: { color: 'rgba(148,163,184,.08)' } } },
    series: [
      {
        name: 'alerts fired (6h buckets)', type: 'bar',
        data: (data?.alertTimeline ?? []).map((b) => b.count),
        itemStyle: { color: '#f59e0b', borderRadius: [4, 4, 0, 0] },
        barWidth: '50%',
      },
      {
        name: 'peak level', type: 'line', smooth: true, symbol: 'none',
        data: (data?.alertTimeline ?? []).map((b) => b.maxLevel),
        lineStyle: { color: '#ef4444', width: 2 },
      },
    ],
  };

  const levelOption = {
    backgroundColor: 'transparent',
    tooltip: { backgroundColor: '#0b1120', borderColor: 'rgba(148,163,184,.3)', textStyle: { color: '#e2e8f0', fontSize: 11 } },
    legend: { orient: 'vertical', right: 4, top: 'center', textStyle: { color: '#94a3b8', fontSize: 10 } },
    series: [
      {
        type: 'pie',
        radius: ['52%', '76%'],
        center: ['38%', '50%'],
        itemStyle: { borderColor: '#0e1522', borderWidth: 2 },
        label: { show: false },
        data: (data
          ? Object.entries(data.levelDistribution).map(([k, v]) => ({
              name: k, value: v,
              itemStyle: { color: hazardColor(parseInt(k.slice(1))) },
            }))
          : []
        ).filter((d) => d.value > 0),
      },
    ],
  };

  const el = data?.engineLive;

  return (
    <Box sx={{ p: { xs: 1.5, md: 2.5 }, maxWidth: 1280, mx: 'auto' }}>
      {isLoading && <LinearProgress sx={{ mb: 2 }} />}
      <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} sx={{ mb: 2 }}>
        {[
          { label: 'Alerts fired (total)', value: data?.totalAlerts ?? 0, hint: 'all-time transitions recorded by the engine' },
          { label: 'Active now', value: data?.activeAlerts ?? 0, hint: 'unacknowledged live alerts' },
          { label: 'Acknowledged', value: data?.ackedAlerts ?? 0, hint: 'closed by DC / field officials' },
        ].map((s) => (
          <Paper key={s.label} variant="outlined" sx={{ flex: 1, p: 2 }}>
            <Typography variant="overline" sx={{ color: 'text.secondary', fontWeight: 700 }}>{s.label}</Typography>
            <Typography variant="h4" sx={{ fontWeight: 800, fontFamily: 'var(--font-mono-num), monospace' }}>
              {(s.value ?? 0).toLocaleString('en-IN')}
            </Typography>
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>{s.hint}</Typography>
          </Paper>
        ))}
      </Stack>

      {/* engine live telemetry — recomputed on every request */}
      <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 1.25 }}>
          <MonitorHeartIcon sx={{ fontSize: 17, color: '#34d399' }} />
          <Typography variant="subtitle2" sx={{ flex: 1 }}>Engine telemetry — live</Typography>
          <Chip
            size="small"
            label={el?.lastRecompute ? `recomputed ${new Date(el.lastRecompute).toLocaleTimeString()}` : '—'}
            variant="outlined"
            sx={{ fontWeight: 700 }}
          />
        </Stack>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.25} useFlexGap sx={{ flexWrap: 'wrap', rowGap: 1 }}>
          <Box sx={{ minWidth: 210, flex: '1 1 210px' }}>
            <Typography variant="overline" sx={{ display: 'block', fontSize: 9.5, color: 'text.secondary', lineHeight: 1 }}>Zones by level (now)</Typography>
            <Stack direction="row" spacing={0.5} sx={{ mt: 0.5, flexWrap: 'wrap', gap: 0.5 }}>
              {Object.entries(el?.levelsNow ?? {}).map(([k, v]) => (
                <Chip key={k} size="small" label={`${k}: ${v}`} sx={{ height: 19, fontSize: 10, fontWeight: 800, bgcolor: `${hazardColor(parseInt(k.slice(1)))}18`, color: hazardColor(parseInt(k.slice(1))) }} />
              ))}
            </Stack>
          </Box>
          {[
            ['engine passes 24 h', el?.passes24h ?? 0],
            ['alerts 24 h', el?.alerts24h ?? 0],
            ['SMS 24 h', el?.sms24h ?? 0],
            ['reports 24 h', el?.reports24h ?? 0],
            ['ack rate', `${el?.ackRate ?? 0}%`],
            ['avg lead time', el?.avgLeadTimeMin != null ? `${el.avgLeadTimeMin} min` : 'n/a'],
          ].map(([k, v]) => (
            <Paper key={k as string} variant="outlined" sx={{ p: 1, flex: '1 1 130px', minWidth: 130 }}>
              <Typography variant="overline" sx={{ display: 'block', lineHeight: 1, fontSize: 9.5, color: 'text.secondary' }}>{k}</Typography>
              <Typography variant="body1" sx={{ fontWeight: 800, fontFamily: 'monospace' }}>{String(v)}</Typography>
            </Paper>
          ))}
        </Stack>
      </Paper>

      <Stack direction={{ xs: 'column', lg: 'row' }} spacing={2} sx={{ mb: 2 }}>
        <Paper variant="outlined" sx={{ p: 2, flex: 1.4 }}>
          <Typography variant="subtitle2" sx={{ mb: 1 }}>Alert activity — 72 h timeline</Typography>
          <ReactECharts option={timelineOption} style={{ height: 210 }} notMerge />
        </Paper>
        <Paper variant="outlined" sx={{ p: 2, flex: 1 }}>
          <Typography variant="subtitle2" sx={{ mb: 1 }}>Zone hazard distribution (last 24 h snapshots)</Typography>
          <ReactECharts option={levelOption} style={{ height: 210 }} notMerge />
        </Paper>
      </Stack>

      <Paper variant="outlined" sx={{ mb: 2, overflow: 'hidden' }}>
        <Box sx={{ p: 2, pb: 1 }}>
          <Typography variant="subtitle2">District posture</Typography>
        </Box>
        <TableContainer sx={{ maxHeight: 260 }}>
          <Table size="small" stickyHeader>
            <TableHead>
              <TableRow>
                {['District', 'Zones', 'L2+', 'L3+', 'L4', 'Population', 'Posture'].map((h) => (
                  <TableCell key={h} sx={{ fontWeight: 700, fontSize: 11.5 }}>{h}</TableCell>
                ))}
              </TableRow>
            </TableHead>
            <TableBody>
              {(data?.districts ?? []).map((d) => (
                <TableRow key={d.district} hover>
                  <TableCell sx={{ fontWeight: 600 }}>{d.district}</TableCell>
                  <TableCell>{d.zones}</TableCell>
                  <TableCell>{d.l2}</TableCell>
                  <TableCell>{d.l3}</TableCell>
                  <TableCell>{d.l4}</TableCell>
                  <TableCell>{d.population.toLocaleString('en-IN')}</TableCell>
                  <TableCell>
                    <Chip
                      size="small"
                      label={`max L${d.maxLevel}`}
                      sx={{ height: 20, fontSize: 10, fontWeight: 700, bgcolor: `${hazardColor(d.maxLevel)}22`, color: hazardColor(d.maxLevel) }}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>

      <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 1.5 }}>
          <MemoryIcon sx={{ fontSize: 17, color: '#38bdf8' }} />
          <Typography variant="subtitle2">Model registry — every metric below is recomputed live</Typography>
        </Stack>
        <Stack spacing={1.25}>
          {(data?.registry ?? []).map((m) => (
            <Box key={m.id} sx={{ border: '1px solid rgba(148,163,184,.14)', borderRadius: 2, p: 1.5 }}>
              <Stack direction="row" spacing={1} sx={{ mb: 0.5, alignItems: 'center', flexWrap: 'wrap', rowGap: 0.5 }}>
                <Typography variant="body2" sx={{ fontWeight: 700, flex: 1 }}>{m.name}</Typography>
                <Chip size="small" label={m.version} sx={{ height: 20, fontSize: 10, fontFamily: 'monospace' }} />
              </Stack>
              <Stack direction="row" spacing={0.75} useFlexGap sx={{ flexWrap: 'wrap', rowGap: 0.5 }}>
                {Object.entries(m.metrics ?? {}).map(([k, v]) => (
                  <Chip
                    key={k}
                    size="small"
                    label={`${k}: ${typeof v === 'number' ? v.toLocaleString('en-IN') : String(v)}`}
                    variant="outlined"
                    sx={{ height: 20, fontSize: 10 }}
                  />
                ))}
              </Stack>
              {m.notes && <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mt: 0.5 }}>{m.notes}</Typography>}
            </Box>
          ))}
        </Stack>

        {(data?.recentRuns ?? []).length > 0 && (
          <Box sx={{ mt: 2 }}>
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 0.5 }}>
              <Typography variant="caption" sx={{ fontWeight: 800 }}>Recent engine passes (logged by the engine itself)</Typography>
              <Chip size="small" label={`${data?.recentRuns.length} rows`} variant="outlined" sx={{ height: 17, fontSize: 9, fontWeight: 700 }} />
            </Stack>
            <Paper variant="outlined" sx={{ overflow: 'hidden' }}>
            <TableContainer sx={{ maxHeight: 220 }}>
              <Table size="small" padding="none" stickyHeader>
                <TableHead>
                  <TableRow>
                    {['When', 'Zones', 'Escalated', 'Stood down', 'Alerts', 'Max level', 'Notes'].map((h) => (
                      <TableCell key={h} sx={{ fontWeight: 700, fontSize: 10.5, px: 1 }}>{h}</TableCell>
                    ))}
                  </TableRow>
                </TableHead>
                <TableBody>
                  {(data?.recentRuns ?? []).map((r) => (
                    <TableRow key={r.id}>
                      <TableCell sx={{ px: 1, fontSize: 11 }}>{new Date(r.at).toLocaleString()}</TableCell>
                      <TableCell sx={{ px: 1, fontSize: 11 }}>{r.metrics.zones ?? '—'}</TableCell>
                      <TableCell sx={{ px: 1, fontSize: 11, color: '#f59e0b', fontWeight: 700 }}>{r.metrics.escalated ?? 0}</TableCell>
                      <TableCell sx={{ px: 1, fontSize: 11, color: '#34d399', fontWeight: 700 }}>{r.metrics.deescalated ?? 0}</TableCell>
                      <TableCell sx={{ px: 1, fontSize: 11 }}>{r.metrics.alerts ?? 0}</TableCell>
                      <TableCell sx={{ px: 1 }}><Chip size="small" label={`L${r.metrics.maxLevel ?? 0}`} sx={{ height: 16, fontSize: 9, fontWeight: 800, bgcolor: `${hazardColor(r.metrics.maxLevel ?? 0)}20`, color: hazardColor(r.metrics.maxLevel ?? 0) }} /></TableCell>
                      <TableCell sx={{ px: 1, fontSize: 10.5, color: 'text.secondary' }}>{r.notes ?? ''}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
            </Paper>
          </Box>
        )}
      </Paper>

      <Paper variant="outlined" sx={{ overflow: 'hidden' }}>
        <Box sx={{ p: 2, pb: 1 }}>
          <Typography variant="subtitle2">Response priority queue — hazard × exposure × vulnerability</Typography>
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>
            Ranked live from zone state; reason chips explain every rank
          </Typography>
        </Box>
        <TableContainer sx={{ maxHeight: 420 }}>
          <Table size="small" stickyHeader>
            <TableHead>
              <TableRow>
                {['#', 'Zone', 'District', 'Level', 'Score', 'Rain 24h', 'Population', 'Reasons', 'Action'].map((h) => (
                  <TableCell key={h} sx={{ fontWeight: 700, fontSize: 11.5 }}>{h}</TableCell>
                ))}
              </TableRow>
            </TableHead>
            <TableBody>
              {(data?.priorityQueue ?? []).map((r, i) => (
                <TableRow key={r.zoneCode} hover>
                  <TableCell sx={{ color: 'text.secondary' }}>{i + 1}</TableCell>
                  <TableCell>
                    <Typography variant="body2" sx={{ fontWeight: 600, fontFamily: 'monospace' }}>{r.zoneCode}</Typography>
                    <Typography variant="caption" sx={{ color: 'text.secondary' }}>{r.name}</Typography>
                  </TableCell>
                  <TableCell>{r.district}</TableCell>
                  <TableCell>
                    <Chip size="small" label={`L${r.hazardLevel}`} sx={{ height: 20, fontSize: 10, fontWeight: 700, bgcolor: `${hazardColor(r.hazardLevel)}22`, color: hazardColor(r.hazardLevel) }} />
                  </TableCell>
                  <TableCell sx={{ fontWeight: 700, fontFamily: 'monospace' }}>{r.score.toFixed(1)}</TableCell>
                  <TableCell>{r.rain24h} mm</TableCell>
                  <TableCell>{r.population.toLocaleString('en-IN')}</TableCell>
                  <TableCell>
                    <Stack direction="row" spacing={0.5} useFlexGap sx={{ flexWrap: 'wrap', maxWidth: 210, rowGap: 0.5 }}>
                      {r.reasons.map((reason) => (
                        <Chip key={reason} size="small" label={reason} variant="outlined" sx={{ height: 19, fontSize: 10 }} />
                      ))}
                    </Stack>
                  </TableCell>
                  <TableCell>
                    <Typography variant="caption" sx={{ fontWeight: 600 }}>{r.recommendedAction}</Typography>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>
    </Box>
  );
}
