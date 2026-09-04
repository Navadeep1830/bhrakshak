'use client';

import { useMemo, useState } from 'react';
import {
  Drawer, Box, Typography, Stack, Chip, Divider, IconButton, Tooltip, Button, Link,
  LinearProgress, Tabs, Tab, Paper,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import MapIcon from '@mui/icons-material/Map';
import ReactECharts from 'echarts-for-react';
import { useQuery } from '@tanstack/react-query';
import { hazardColor } from './theme';

export interface DossierData {
  zone: {
    zoneCode: string;
    name: string;
    district: string;
    state: string;
    centroidLat: number;
    centroidLon: number;
    suscMean: number;
    suscP90: number;
    population: number;
    roadKm: number;
    criticalInfra: { schools: number; phcs: number; bridges: number };
  };
  hazard: {
    level: number;
    levelName: string;
    probability: number;
    idThresholdTier: number;
    floodLevel: number;
    isolation: number;
    recommendedAction: string;
    modelVersion: string;
    updatedAt: string | null;
  };
  drivers: Array<{ feature: string; name: string; value: string; contribution: number; description: string; missing?: boolean }>;
  rainfall: Array<{ ts: string; rain1h: number; rain24h: number; soilMoisture: number | null }>;
  alerts: Array<{ id: string; level: number; title: string; message: string; status: string; channels: string[]; createdAt: string }>;
  reports: Array<{ id: string; category: string; notes: string | null; status: string; lat: number; lon: number; createdAt: string }>;
  sensors: Array<{ ts: string; soilMoisture: number | null; tiltDeg: number | null; rainMm: number | null; battery: number | null }>;
  directive: {
    level: number; urgency: string; headline: string; evacuationPlan: string; ndrfDeployment: string;
    machineryPositioning: string; trafficAdvisory: string; medicalStandby: string;
    demographics: { totalPopulation: number; elderly: number; childrenUnder5: number; specialNeeds: number; ambulances: number };
    sopChecklist: Array<{ dept: string; task: string }>;
  };
}

const CATEGORY_LABELS: Record<string, string> = {
  crack: 'Ground crack',
  slope_movement: 'Slope movement',
  blocked_road: 'Blocked road',
  past_slide: 'Past slide',
  water_seepage: 'Water seepage',
};

export default function DossierDrawer({
  zoneCode,
  onClose,
}: {
  zoneCode: string | null;
  onClose: () => void;
}) {
  const { data, isLoading } = useQuery<DossierData>({
    queryKey: ['dossier', zoneCode],
    queryFn: async () => {
      const res = await fetch(`/api/zones/${zoneCode}`);
      if (!res.ok) throw new Error((await res.json()).error || 'Failed to load dossier');
      return res.json();
    },
    enabled: !!zoneCode,
    refetchInterval: 15_000,
  });

  return (
    <Drawer
      anchor="right"
      open={!!zoneCode}
      onClose={onClose}
      sx={{ '& .MuiDrawer-paper': { width: { xs: '100%', sm: 430, md: 470 }, bgcolor: '#0e1522', borderLeft: '1px solid rgba(148,163,184,.16)' } }}
    >
      {isLoading || !data ? (
        <Box sx={{ p: 3 }}>
          <LinearProgress />
          <Typography variant="body2" sx={{ mt: 2, color: 'text.secondary' }}>Loading zone dossier…</Typography>
        </Box>
      ) : (
        <DossierBody data={data} onClose={onClose} />
      )}
    </Drawer>
  );
}

function DossierBody({ data, onClose }: { data: DossierData; onClose: () => void }) {
  const [tab, setTab] = useState(0);
  const { zone, hazard, drivers, rainfall, alerts, reports, sensors, directive } = data;
  const color = hazardColor(hazard.level);

  const driversOption = useMemo(
    () => ({
      backgroundColor: 'transparent',
      grid: { left: 8, right: 30, top: 8, bottom: 8, containLabel: true },
      xAxis: { type: 'value', show: false, max: Math.max(...drivers.map((d) => d.contribution), 0.01) },
      yAxis: {
        type: 'category',
        data: drivers.map((d) => d.name),
        axisLabel: { color: '#94a3b8', fontSize: 10, width: 110, overflow: 'truncate' },
        axisLine: { show: false }, axisTick: { show: false },
      },
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        backgroundColor: '#0b1120',
        borderColor: 'rgba(148,163,184,.3)',
        textStyle: { color: '#e2e8f0', fontSize: 11 },
        formatter: (p: any) => {
          const d = drivers[p[0].dataIndex];
          return `<b>${d.feature}</b><br/>${d.value} · contributes ${(d.contribution * 100).toFixed(1)}%<br/><span style="color:#94a3b8">${d.description}</span>`;
        },
      },
      series: [
        {
          type: 'bar',
          data: drivers.map((d) => d.contribution),
          itemStyle: { color: '#10b981', borderRadius: [0, 4, 4, 0] },
          barWidth: 12,
          label: {
            show: true, position: 'right', color: '#94a3b8', fontSize: 10,
            formatter: (p: any) => `${(p.value * 100).toFixed(0)}%`,
          },
        },
      ],
    }),
    [drivers]
  );

  const rainOption = useMemo(
    () => ({
      backgroundColor: 'transparent',
      grid: { left: 8, right: 8, top: 28, bottom: 8, containLabel: true },
      tooltip: { trigger: 'axis', backgroundColor: '#0b1120', borderColor: 'rgba(148,163,184,.3)', textStyle: { color: '#e2e8f0', fontSize: 11 } },
      legend: { textStyle: { color: '#94a3b8', fontSize: 10 }, top: 0, itemWidth: 12, itemHeight: 8 },
      xAxis: {
        type: 'time',
        axisLabel: { color: '#64748b', fontSize: 9, formatter: '{HH}:{mm}' },
        axisLine: { lineStyle: { color: 'rgba(148,163,184,.2)' } },
      },
      yAxis: { type: 'value', axisLabel: { color: '#64748b', fontSize: 9 }, splitLine: { lineStyle: { color: 'rgba(148,163,184,.08)' } } },
      series: [
        {
          name: 'mm/24h (rolling)', type: 'line', smooth: true, symbol: 'none',
          data: rainfall.map((r) => [new Date(r.ts).getTime(), r.rain24h]),
          lineStyle: { color: '#38bdf8', width: 2 }, areaStyle: { color: 'rgba(56,189,248,.12)' },
        },
        {
          name: 'mm/1h', type: 'bar',
          data: rainfall.map((r) => [new Date(r.ts).getTime(), r.rain1h]),
          itemStyle: { color: 'rgba(245,158,11,.7)' },
          barWidth: '55%',
        },
      ],
    }),
    [rainfall]
  );

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* header */}
      <Box sx={{ p: 2, pb: 1.5, borderBottom: '1px solid rgba(148,163,184,.14)' }}>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-start' }}>
          <Box sx={{ flex: 1 }}>
            <Stack direction="row" spacing={1} sx={{ mb: 0.5, alignItems: 'center' }}>
              <Chip
                size="small"
                label={`L${hazard.level} ${hazard.levelName}`}
                sx={{ bgcolor: `${color}20`, color, border: `1px solid ${color}55`, fontWeight: 800 }}
              />
              <Typography variant="caption" sx={{ color: 'text.secondary' }}>{zone.zoneCode}</Typography>
            </Stack>
            <Typography variant="h6" sx={{ fontWeight: 700 }}>{zone.name}</Typography>
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
              {zone.district}, {zone.state}
            </Typography>
          </Box>
          <Stack direction="row" spacing={0.5}>
            <Tooltip title="Open Google Street View at this zone (new tab)">
              <IconButton
                size="small"
                aria-label="Open Street View at zone"
                component="a"
                target="_blank"
                rel="noopener"
                href={`https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${zone.centroidLat},${zone.centroidLon}`}
              >
                <MapIcon fontSize="small" />
              </IconButton>
            </Tooltip>
            <IconButton size="small" aria-label="Close dossier" onClick={onClose}>
              <CloseIcon fontSize="small" />
            </IconButton>
          </Stack>
        </Stack>

        <Stack direction="row" spacing={1} useFlexGap sx={{ mt: 1.5, flexWrap: 'wrap' }}>
          <Chip size="small" label={`P(24h) ${(hazard.probability * 100).toFixed(1)}%`} sx={{ fontWeight: 700 }} />
          <Chip size="small" label={`susc ${Math.round(zone.suscMean)}/100`} variant="outlined" />
          <Chip size="small" label={`pop ${zone.population.toLocaleString('en-IN')}`} variant="outlined" />
          <Chip size="small" label={`flood F${hazard.floodLevel}`} variant="outlined" />
          <Chip size="small" label={`isolation ${hazard.isolation}`} variant="outlined" />
        </Stack>
      </Box>

      <Tabs value={tab} onChange={(_, v) => setTab(v)} variant="fullWidth" sx={{ borderBottom: '1px solid rgba(148,163,184,.14)' }}>
        <Tab label="Risk" sx={{ minHeight: 44, fontSize: 12.5 }} />
        <Tab label="Field" sx={{ minHeight: 44, fontSize: 12.5 }} />
        <Tab label="DC SOP" sx={{ minHeight: 44, fontSize: 12.5 }} />
      </Tabs>

      <Box sx={{ flex: 1, overflowY: 'auto', p: 2 }}>
        {tab === 0 && (
          <Stack spacing={2}>
            <Paper variant="outlined" sx={{ p: 1.5 }}>
              <Typography variant="subtitle2" sx={{ mb: 1 }}>
                Why this level — driver contributions
              </Typography>
              <ReactECharts option={driversOption} style={{ height: 190 }} notMerge />
              <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mt: 0.5 }}>
                I-D threshold tier: {hazard.idThresholdTier} · fused level L{hazard.level} · {hazard.modelVersion}
              </Typography>
            </Paper>

            <Paper variant="outlined" sx={{ p: 1.5 }}>
              <Typography variant="subtitle2" sx={{ mb: 1 }}>Rainfall — last 48 h</Typography>
              <ReactECharts option={rainOption} style={{ height: 170 }} notMerge />
            </Paper>

            <Paper variant="outlined" sx={{ p: 1.5 }}>
              <Typography variant="subtitle2" sx={{ mb: 1 }}>Recommended action</Typography>
              <Typography variant="body2" sx={{ fontWeight: 600, color: 'primary.light' }}>
                {hazard.recommendedAction}
              </Typography>
            </Paper>

            {alerts.length > 0 && (
              <Paper variant="outlined" sx={{ p: 1.5 }}>
                <Typography variant="subtitle2" sx={{ mb: 1 }}>Alert history (this zone)</Typography>
                <Stack spacing={1}>
                  {alerts.map((a) => (
                    <Box key={a.id} sx={{ borderLeft: `3px solid ${hazardColor(a.level)}`, pl: 1.25 }}>
                      <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                        <Chip size="small" label={`L${a.level}`} sx={{ height: 18, fontSize: 10, bgcolor: `${hazardColor(a.level)}22`, color: hazardColor(a.level) }} />
                        <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                          {new Date(a.createdAt).toLocaleString()} · {a.status}
                        </Typography>
                      </Stack>
                      <Typography variant="body2" sx={{ mt: 0.25 }}>{a.message}</Typography>
                    </Box>
                  ))}
                </Stack>
              </Paper>
            )}
          </Stack>
        )}

        {tab === 1 && (
          <Stack spacing={2}>
            <Paper variant="outlined" sx={{ p: 1.5 }}>
              <Typography variant="subtitle2" sx={{ mb: 1 }}>Ground sensors</Typography>
              {sensors.length === 0 ? (
                <Typography variant="body2" sx={{ color: 'text.secondary' }}>No sensor deployed in this zone.</Typography>
              ) : (
                <Stack spacing={0.5}>
                  {sensors.slice(0, 6).map((s, i) => (
                    <Stack key={i} direction="row" spacing={1} sx={{ justifyContent: 'space-between', alignItems: 'center' }}>
                      <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                        {new Date(s.ts).toLocaleString()}
                      </Typography>
                      <Stack direction="row" spacing={0.5}>
                        {s.soilMoisture != null && <Chip size="small" label={`soil ${Math.round(s.soilMoisture)}%`} sx={{ height: 18, fontSize: 10 }} />}
                        {s.tiltDeg != null && <Chip size="small" label={`tilt ${s.tiltDeg}°`} sx={{ height: 18, fontSize: 10 }} />}
                        {s.battery != null && <Chip size="small" label={`bat ${Math.round(s.battery)}%`} sx={{ height: 18, fontSize: 10 }} />}
                      </Stack>
                    </Stack>
                  ))}
                </Stack>
              )}
            </Paper>

            <Paper variant="outlined" sx={{ p: 1.5 }}>
              <Typography variant="subtitle2" sx={{ mb: 1 }}>Citizen field reports</Typography>
              {reports.length === 0 ? (
                <Typography variant="body2" sx={{ color: 'text.secondary' }}>No reports for this zone yet.</Typography>
              ) : (
                <Stack spacing={1}>
                  {reports.map((r) => (
                    <Box key={r.id}>
                      <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                        <Chip
                          size="small"
                          label={CATEGORY_LABELS[r.category] ?? r.category}
                          sx={{ height: 18, fontSize: 10 }}
                        />
                        <Chip
                          size="small"
                          label={r.status}
                          sx={{
                            height: 18, fontSize: 10,
                            bgcolor: r.status === 'verified' ? 'rgba(16,185,129,.15)' : r.status === 'rejected' ? 'rgba(239,68,68,.15)' : 'rgba(234,179,8,.15)',
                            color: r.status === 'verified' ? '#34d399' : r.status === 'rejected' ? '#ef4444' : '#eab308',
                          }}
                        />
                        <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                          {new Date(r.createdAt).toLocaleDateString()}
                        </Typography>
                      </Stack>
                      {r.notes && (
                        <Typography variant="body2" sx={{ mt: 0.25, color: 'text.secondary' }}>{r.notes}</Typography>
                      )}
                    </Box>
                  ))}
                </Stack>
              )}
            </Paper>

            <Paper variant="outlined" sx={{ p: 1.5 }}>
              <Typography variant="subtitle2" sx={{ mb: 0.5 }}>Zone context</Typography>
              <Stack spacing={0.5}>
                {[
                  ['Population', zone.population.toLocaleString('en-IN')],
                  ['Road length', `${zone.roadKm} km`],
                  ['Critical infra', `${zone.criticalInfra.schools} schools · ${zone.criticalInfra.phcs} PHCs · ${zone.criticalInfra.bridges} bridges`],
                  ['Coordinates', `${zone.centroidLat.toFixed(3)}, ${zone.centroidLon.toFixed(3)}`],
                ].map(([k, v]) => (
                  <Stack key={k as string} direction="row" sx={{ justifyContent: 'space-between' }}>
                    <Typography variant="caption" sx={{ color: 'text.secondary' }}>{k}</Typography>
                    <Typography variant="caption" sx={{ fontWeight: 600 }}>{v}</Typography>
                  </Stack>
                ))}
              </Stack>
              <Button
                size="small"
                variant="outlined"
                sx={{ mt: 1 }}
                startIcon={<OpenInNewIcon />}
                component="a"
                target="_blank"
                rel="noopener"
                href={`https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${zone.centroidLat},${zone.centroidLon}`}
              >
                Open Street View here
              </Button>
            </Paper>
          </Stack>
        )}

        {tab === 2 && (
          <Stack spacing={1.5}>
            <Paper variant="outlined" sx={{ p: 1.5, borderColor: `${color}55` }}>
              <Typography variant="subtitle2" sx={{ color, fontWeight: 800 }}>{directive.urgency}</Typography>
              <Typography variant="body2" sx={{ fontWeight: 600, mt: 0.5 }}>{directive.headline}</Typography>
            </Paper>
            <Stack direction="row" spacing={0.5} useFlexGap sx={{ flexWrap: 'wrap', rowGap: 0.5 }}>
              <Chip size="small" label={`pop ${directive.demographics.totalPopulation.toLocaleString('en-IN')}`} />
              <Chip size="small" label={`elderly ${directive.demographics.elderly}`} variant="outlined" />
              <Chip size="small" label={`children ${directive.demographics.childrenUnder5}`} variant="outlined" />
              <Chip size="small" label={`special needs ${directive.demographics.specialNeeds}`} variant="outlined" />
              <Chip size="small" label={`ambulances ${directive.demographics.ambulances}`} variant="outlined" />
            </Stack>
            {[
              ['Evacuation', directive.evacuationPlan],
              ['SDRF / NDRF', directive.ndrfDeployment],
              ['Machinery', directive.machineryPositioning],
              ['Traffic', directive.trafficAdvisory],
              ['Medical', directive.medicalStandby],
            ].map(([k, v]) => (
              <Paper key={k} variant="outlined" sx={{ p: 1.25 }}>
                <Typography variant="overline" sx={{ fontWeight: 700, color: 'primary.light' }}>{k}</Typography>
                <Typography variant="body2" sx={{ mt: 0.25 }}>{v}</Typography>
              </Paper>
            ))}
            {directive.sopChecklist.length > 0 && (
              <Paper variant="outlined" sx={{ p: 1.5 }}>
                <Typography variant="subtitle2" sx={{ mb: 1 }}>DDMA SOP checklist</Typography>
                <Stack spacing={1}>
                  {directive.sopChecklist.map((s, i) => (
                    <Stack key={i} direction="row" spacing={1} sx={{ alignItems: 'flex-start' }}>
                      <Chip size="small" label={s.dept} sx={{ height: 20, fontSize: 10, minWidth: 92, fontWeight: 700 }} />
                      <Typography variant="body2" sx={{ flex: 1 }}>{s.task}</Typography>
                    </Stack>
                  ))}
                </Stack>
              </Paper>
            )}
          </Stack>
        )}
      </Box>
    </Box>
  );
}
