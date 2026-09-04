'use client';

import { useState } from 'react';
import {
  Box, Typography, Stack, Chip, Paper, Tabs, Tab, Table, TableBody, TableCell, TableContainer,
  TableHead, TableRow, IconButton, Tooltip, Button, Snackbar, Alert, Select, MenuItem,
  LinearProgress, ToggleButtonGroup, ToggleButton, TextField,
} from '@mui/material';
import CheckIcon from '@mui/icons-material/Check';
import BlockIcon from '@mui/icons-material/Block';
import DoneAllIcon from '@mui/icons-material/DoneAll';
import AltRouteIcon from '@mui/icons-material/AltRoute';
import SmsIcon from '@mui/icons-material/Sms';
import SmartphoneIcon from '@mui/icons-material/Smartphone';
import AccessTimeIcon from '@mui/icons-material/AccessTime';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { hazardColor } from '../theme';

interface AlertRow {
  id: string; level: number; title: string; message: string; status: string;
  probability: number; channels: string[]; languages: Record<string, string>; createdAt: string;
  zone: { zoneCode: string; name: string; district: string; state: string; centroidLat: number; centroidLon: number } | null;
  acks: Array<{ by: string; role: string; at: string; note: string | null }>;
}

interface ReportRow {
  id: string; category: string; notes: string | null; lat: number; lon: number;
  status: string; aiPreScreen: string | null; aiConfidence: number | null;
  aiFindings?: string | null; aiSource?: string | null; photoId?: string | null; offlineQueued?: boolean;
  createdAt: string; verifiedAt: string | null;
  zone: { zoneCode: string; name: string; district: string } | null;
  submitter: { fullName: string; role: string } | null;
}

interface FieldMessageRow {
  id: string; deviceId: string | null; authorName: string; authorRole: string;
  deviceName: string | null; devicePhone: string | null; deviceOnline: boolean;
  district: string | null; category: string; body: string; priority: number;
  lat: number | null; lon: number | null; zoneCode: string | null;
  handled: boolean; handledAt: string | null; createdAt: string;
  replies: Array<{ id: string; authorName: string; authorRole: string; body: string; createdAt: string }>;
}

interface MessagesData {
  messages: FieldMessageRow[];
  open: number;
  sos: number;
}

interface CommsData {
  stats: { total: number; delivered: number; inFlight: number; devices: number; devicesOnline: number; notifications24h: number };
  sms: Array<{ id: string; phone: string; body: string; status: string; deviceName: string | null; queuedAt: string; sentAt: string; deliveredAt: string | null }>;
  notifications: Array<{ id: string; kind: string; level: number; title: string; body: string; zoneCode: string | null; district: string | null; channels: string[]; createdAt: string }>;
  devices: Array<{ id: string; deviceId: string; name: string; phone: string | null; district: string | null; lastSeenAt: string; online: boolean }>;
}

interface RoadDetour {
  available: boolean; reason: string; polyline: [number, number][];
  extraKm: number; delayMinutes: number; clearanceEtaHours: number;
  corridorHazard: number; blockageAt: [number, number] | null;
}

interface RoadRow {
  id: string; roadName: string; district: string; coords: [number, number][];
  status: string; source: string; note: string | null; updatedAt: string;
  detour?: RoadDetour | null;
}

const CATEGORY_LABELS: Record<string, string> = {
  crack: 'Ground crack',
  slope_movement: 'Slope movement',
  blocked_road: 'Blocked road',
  past_slide: 'Past slide',
  water_seepage: 'Water seepage',
};

export default function OpsView({
  canAck,
  canVerify,
  onZoneSelect,
  onFlyTo,
}: {
  canAck: boolean;
  canVerify: boolean;
  onZoneSelect: (zoneCode: string) => void;
  onFlyTo: (lat: number, lon: number) => void;
}) {
  const [tab, setTab] = useState(0);
  const [toast, setToast] = useState<{ msg: string; sev: 'success' | 'error' } | null>(null);
  const qc = useQueryClient();

  const alertsQ = useQuery<{ alerts: AlertRow[] }>({
    queryKey: ['ops-alerts'],
    queryFn: async () => (await fetch('/api/alerts?status=all&limit=80')).json(),
    refetchInterval: 8_000,
  });
  const reportsQ = useQuery<{ reports: ReportRow[] }>({
    queryKey: ['ops-reports'],
    queryFn: async () => (await fetch('/api/reports?status=all')).json(),
    refetchInterval: 12_000,
  });
  const roadsQ = useQuery<{ roads: RoadRow[] }>({
    queryKey: ['ops-roads'],
    queryFn: async () => (await fetch('/api/roads')).json(),
    refetchInterval: 15_000,
  });
  const commsQ = useQuery<CommsData>({
    queryKey: ['ops-comms'],
    queryFn: async () => (await fetch('/api/comms')).json(),
    refetchInterval: 5_000,
  });
  const messagesQ = useQuery<MessagesData>({
    queryKey: ['ops-messages'],
    queryFn: async () => (await fetch('/api/messages')).json(),
    refetchInterval: 5_000,
  });

  const replyMutation = useMutation({
    mutationFn: async ({ replyToId, body }: { replyToId: string; body: string }) => {
      const res = await fetch('/api/messages', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ replyToId, body }),
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Reply failed');
      return res.json();
    },
    onSuccess: () => {
      setToast({ msg: 'Reply sent — visible on the field phone now', sev: 'success' });
      qc.invalidateQueries({ queryKey: ['ops-messages'] });
      qc.invalidateQueries({ queryKey: ['kpis'] });
    },
    onError: (e: Error) => setToast({ msg: e.message, sev: 'error' }),
  });

  const handleMutation = useMutation({
    mutationFn: async ({ id, handled }: { id: string; handled: boolean }) => {
      const res = await fetch(`/api/messages/${id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ handled }),
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Update failed');
      return res.json();
    },
    onSuccess: (_d, v) => {
      setToast({ msg: v.handled ? 'Message marked handled' : 'Message reopened', sev: 'success' });
      qc.invalidateQueries({ queryKey: ['ops-messages'] });
      qc.invalidateQueries({ queryKey: ['kpis'] });
    },
    onError: (e: Error) => setToast({ msg: e.message, sev: 'error' }),
  });

  const ackMutation = useMutation({
    mutationFn: async (alertId: string) => {
      const res = await fetch(`/api/alerts/${alertId}/ack`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      if (!res.ok) throw new Error((await res.json()).error || 'Ack failed');
      return res.json();
    },
    onSuccess: () => {
      setToast({ msg: 'Alert acknowledged — response logged', sev: 'success' });
      qc.invalidateQueries({ queryKey: ['ops-alerts'] });
      qc.invalidateQueries({ queryKey: ['kpis'] });
    },
    onError: (e: Error) => setToast({ msg: e.message, sev: 'error' }),
  });

  const verifyMutation = useMutation({
    mutationFn: async ({ id, approve }: { id: string; approve: boolean }) => {
      const res = await fetch(`/api/reports/${id}/verify`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ approve }),
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Verify failed');
      return res.json();
    },
    onSuccess: (_d, v) => {
      setToast({ msg: v.approve ? 'Report verified — feeds Model B evidence' : 'Report rejected', sev: 'success' });
      qc.invalidateQueries({ queryKey: ['ops-reports'] });
      qc.invalidateQueries({ queryKey: ['kpis'] });
    },
    onError: (e: Error) => setToast({ msg: e.message, sev: 'error' }),
  });

  const roadMutation = useMutation({
    mutationFn: async ({ roadId, status }: { roadId: string; status: string }) => {
      const res = await fetch('/api/roads/status', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roadId, status }),
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Road update failed');
      return res.json();
    },
    onSuccess: (_d, v) => {
      setToast({ msg: `Road set to ${v.status}`, sev: 'success' });
      qc.invalidateQueries({ queryKey: ['ops-roads'] });
      qc.invalidateQueries({ queryKey: ['roads-map'] });
    },
    onError: (e: Error) => setToast({ msg: e.message, sev: 'error' }),
  });

  const activeAlerts = (alertsQ.data?.alerts ?? []).filter((a) => a.status === 'active');
  const pendingReports = (reportsQ.data?.reports ?? []).filter((r) => r.status === 'pending');

  return (
    <Box sx={{ p: { xs: 1.5, md: 2.5 }, maxWidth: 1280, mx: 'auto' }}>
      <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ mb: 2, borderBottom: '1px solid rgba(148,163,184,.14)' }}>
        <Tab
          label={`Alert console${activeAlerts.length ? ` (${activeAlerts.length})` : ''}`}
          sx={{ minHeight: 44, fontSize: 13, fontWeight: 600 }}
        />
        <Tab
          label={`Report inbox${pendingReports.length ? ` (${pendingReports.length})` : ''}`}
          sx={{ minHeight: 44, fontSize: 13, fontWeight: 600 }}
        />
        <Tab
          label={
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              Field messages
              {(messagesQ.data?.sos ?? 0) > 0 && (
                <Chip size="small" label={`${messagesQ.data?.sos} SOS`} color="error" sx={{ height: 17, fontSize: 9, fontWeight: 800 }} />
              )}
              {(messagesQ.data?.open ?? 0) > 0 && (
                <Chip size="small" label={`${messagesQ.data?.open} open`} color="warning" sx={{ height: 17, fontSize: 9, fontWeight: 800 }} />
              )}
            </span>
          }
          sx={{ minHeight: 44, fontSize: 13, fontWeight: 600 }}
        />
        <Tab label="Road network" sx={{ minHeight: 44, fontSize: 13, fontWeight: 600 }} />
        <Tab
          label={
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              Comms & SMS
              {(commsQ.data?.stats.inFlight ?? 0) > 0 && (
                <Chip size="small" label={`${commsQ.data?.stats.inFlight} in flight`} color="warning" sx={{ height: 17, fontSize: 9, fontWeight: 800 }} />
              )}
            </span>
          }
          sx={{ minHeight: 44, fontSize: 13, fontWeight: 600 }}
        />
      </Tabs>

      {(alertsQ.isLoading || reportsQ.isLoading || roadsQ.isLoading) && <LinearProgress sx={{ mb: 1.5 }} />}

      {tab === 0 && (
        <Paper variant="outlined" sx={{ overflow: 'hidden' }}>
          <TableContainer sx={{ maxHeight: 620 }}>
            <Table size="small" stickyHeader>
              <TableHead>
                <TableRow>
                  {['Level', 'Zone', 'Message (EN)', 'Channels', 'Age', 'Status', ''].map((h) => (
                    <TableCell key={h} sx={{ fontWeight: 700, fontSize: 11.5 }}>{h}</TableCell>
                  ))}
                </TableRow>
              </TableHead>
              <TableBody>
                {(alertsQ.data?.alerts ?? []).map((a) => {
                  const age = Math.max(0, Math.round((Date.now() - new Date(a.createdAt).getTime()) / 60000));
                  return (
                    <TableRow key={a.id} hover>
                      <TableCell>
                        <Chip size="small" label={`L${a.level}`} sx={{ height: 20, fontSize: 10, fontWeight: 800, bgcolor: `${hazardColor(a.level)}22`, color: hazardColor(a.level) }} />
                      </TableCell>
                      <TableCell>
                        {a.zone ? (
                          <Tooltip title="Fly to zone on map">
                            <Button
                              size="small"
                              onClick={() => {
                                onZoneSelect(a.zone!.zoneCode);
                                onFlyTo(a.zone!.centroidLat, a.zone!.centroidLon);
                              }}
                              sx={{ p: 0, textTransform: 'none', textAlign: 'left' }}
                            >
                              <Box sx={{ textAlign: 'left' }}>
                                <Typography variant="body2" sx={{ fontFamily: 'monospace', fontWeight: 700 }}>
                                  {a.zone.zoneCode}
                                </Typography>
                                <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                                  {a.zone.district}
                                </Typography>
                              </Box>
                            </Button>
                          </Tooltip>
                        ) : (
                          <Typography variant="body2">—</Typography>
                        )}
                      </TableCell>
                      <TableCell sx={{ maxWidth: 330 }}>
                        <Typography variant="body2" sx={{ fontSize: 12.5 }}>{a.message}</Typography>
                        <Tooltip title={`${Object.keys(a.languages).length} languages: ${Object.keys(a.languages).join(', ')}`}>
                          <Typography variant="caption" sx={{ color: 'text.secondary', cursor: 'help' }}>
                            + translations ({Object.keys(a.languages).length} languages)
                          </Typography>
                        </Tooltip>
                      </TableCell>
                      <TableCell>
                        <Stack direction="row" spacing={0.5}>
                          {a.channels.map((c) => (
                            <Chip key={c} size="small" label={c} variant="outlined" sx={{ height: 18, fontSize: 9.5 }} />
                          ))}
                        </Stack>
                      </TableCell>
                      <TableCell>
                        <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                          {age < 60 ? `${age} min` : `${Math.round(age / 60)} h`}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        <Chip
                          size="small"
                          label={a.status}
                          sx={{
                            height: 20, fontSize: 10, fontWeight: 700,
                            bgcolor: a.status === 'active' ? 'rgba(239,68,68,.14)' : a.status === 'acked' ? 'rgba(16,185,129,.14)' : 'rgba(148,163,184,.14)',
                            color: a.status === 'active' ? '#ef4444' : a.status === 'acked' ? '#34d399' : '#94a3b8',
                          }}
                        />
                        {a.acks.length > 0 && (
                          <Tooltip title={a.acks.map((k) => `${k.by} (${k.role})`).join(', ')}>
                            <Typography variant="caption" sx={{ display: 'block', color: 'text.secondary' }}>
                              by {a.acks[0].by}
                            </Typography>
                          </Tooltip>
                        )}
                      </TableCell>
                      <TableCell>
                        {a.status === 'active' && (
                          <Tooltip title={canAck ? 'Acknowledge this alert' : 'Requires DC / admin / field role'}>
                            <span>
                              <IconButton
                                size="small"
                                color="success"
                                aria-label="Acknowledge this alert"
                                disabled={!canAck || ackMutation.isPending}
                                onClick={() => ackMutation.mutate(a.id)}
                              >
                                <DoneAllIcon fontSize="small" />
                              </IconButton>
                            </span>
                          </Tooltip>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableContainer>
        </Paper>
      )}

      {tab === 1 && (
        <Paper variant="outlined" sx={{ overflow: 'hidden' }}>
          <TableContainer sx={{ maxHeight: 620 }}>
            <Table size="small" stickyHeader>
              <TableHead>
                <TableRow>
                  {['Photo', 'Category', 'Zone', 'Notes', 'AI pre-screen', 'Submitted by', 'Status', ''].map((h) => (
                    <TableCell key={h} sx={{ fontWeight: 700, fontSize: 11.5 }}>{h}</TableCell>
                  ))}
                </TableRow>
              </TableHead>
              <TableBody>
                {(reportsQ.data?.reports ?? []).map((r) => (
                  <TableRow key={r.id} hover>
                    <TableCell>
                      {r.photoId ? (
                        <Tooltip title="Citizen photo (opens)">
                          <Box
                            component="img"
                            src={`/api/media/${r.photoId}`}
                            alt="report photo"
                            onClick={() => window.open(`/api/media/${r.photoId}`, '_blank')}
                            sx={{ width: 52, height: 52, borderRadius: 1.5, objectFit: 'cover', cursor: 'zoom-in', border: '1px solid rgba(148,163,184,.3)' }}
                          />
                        </Tooltip>
                      ) : (
                        <Typography variant="caption" sx={{ color: 'text.secondary' }}>—</Typography>
                      )}
                    </TableCell>
                    <TableCell>
                      <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
                        <Chip size="small" label={CATEGORY_LABELS[r.category] ?? r.category} sx={{ height: 20, fontSize: 10 }} />
                        {r.offlineQueued && (
                          <Tooltip title="Captured offline on the phone, synced when the network returned">
                            <Chip size="small" label="offline-sync" variant="outlined" sx={{ height: 18, fontSize: 9, fontWeight: 700, color: '#f59e0b', borderColor: 'rgba(245,158,11,.4)' }} />
                          </Tooltip>
                        )}
                      </Stack>
                    </TableCell>
                    <TableCell>
                      {r.zone ? (
                        <Tooltip title="Open zone dossier">
                          <Button size="small" onClick={() => onZoneSelect(r.zone!.zoneCode)} sx={{ p: 0 }}>
                            <Typography variant="body2" sx={{ fontFamily: 'monospace', fontWeight: 700 }}>{r.zone.zoneCode}</Typography>
                          </Button>
                        </Tooltip>
                      ) : (
                        <Typography variant="caption" sx={{ color: 'text.secondary' }}>unassigned</Typography>
                      )}
                    </TableCell>
                    <TableCell sx={{ maxWidth: 300 }}>
                      <Typography variant="body2" sx={{ fontSize: 12.5, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                        {r.notes ?? '—'}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      {r.aiPreScreen && (
                        <Chip
                          size="small"
                          label={`${r.aiPreScreen} ${r.aiConfidence ? `${Math.round(r.aiConfidence * 100)}%` : ''}`}
                          sx={{
                            height: 20, fontSize: 10,
                            bgcolor: r.aiPreScreen === 'flagged' ? 'rgba(239,68,68,.14)' : 'rgba(56,189,248,.12)',
                            color: r.aiPreScreen === 'flagged' ? '#ef4444' : '#38bdf8',
                          }}
                        />
                      )}
                    </TableCell>
                    <TableCell>
                      <Typography variant="caption">{r.submitter?.fullName ?? 'anonymous'}</Typography>
                      <Typography variant="caption" sx={{ display: 'block', color: 'text.secondary' }}>
                        {new Date(r.createdAt).toLocaleString()}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Chip
                        size="small"
                        label={r.status}
                        sx={{
                          height: 20, fontSize: 10, fontWeight: 700,
                          bgcolor: r.status === 'verified' ? 'rgba(16,185,129,.14)' : r.status === 'rejected' ? 'rgba(239,68,68,.14)' : 'rgba(234,179,8,.14)',
                          color: r.status === 'verified' ? '#34d399' : r.status === 'rejected' ? '#ef4444' : '#eab308',
                        }}
                      />
                    </TableCell>
                    <TableCell>
                      {r.status === 'pending' && (
                        <Stack direction="row" spacing={0.5}>
                          <Tooltip title={canVerify ? 'Verify (feeds Model B evidence)' : 'Requires field official / DC / admin'}>
                            <span>
                              <IconButton size="small" color="success" aria-label="Verify report" disabled={!canVerify || verifyMutation.isPending} onClick={() => verifyMutation.mutate({ id: r.id, approve: true })}>
                                <CheckIcon fontSize="small" />
                              </IconButton>
                            </span>
                          </Tooltip>
                          <Tooltip title={canVerify ? 'Reject as not-a-hazard' : 'Requires field official / DC / admin'}>
                            <span>
                              <IconButton size="small" color="error" aria-label="Reject report" disabled={!canVerify || verifyMutation.isPending} onClick={() => verifyMutation.mutate({ id: r.id, approve: false })}>
                                <BlockIcon fontSize="small" />
                              </IconButton>
                            </span>
                          </Tooltip>
                        </Stack>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </Paper>
      )}

      {tab === 2 && (
        <Box>
          {messagesQ.isLoading ? (
            <LinearProgress sx={{ mb: 2 }} />
          ) : (
            <Stack spacing={1.5}>
              <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 0.5 }}>
                <Typography variant="body2" sx={{ fontWeight: 700, flex: 1 }}>
                  Field → command messages
                  <Typography component="span" variant="caption" sx={{ color: 'text.secondary', ml: 1 }}>
                    live from the phone app — SOS, help, status, gauge readings · replies land on the phone
                  </Typography>
                </Typography>
                <Chip size="small" label={`${messagesQ.data?.open ?? 0} open`} color={messagesQ.data?.open ? 'warning' : 'default'} sx={{ height: 20, fontWeight: 800 }} />
                <Chip size="small" label={`${messagesQ.data?.sos ?? 0} SOS`} color={messagesQ.data?.sos ? 'error' : 'default'} sx={{ height: 20, fontWeight: 800 }} />
              </Stack>

              {(messagesQ.data?.messages ?? []).length === 0 && (
                <Paper variant="outlined" sx={{ p: 2 }}>
                  <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                    No field messages yet. Send one from the phone app (Comms tab) — it appears here
                    within seconds; reply and the phone sees it instantly.
                  </Typography>
                </Paper>
              )}

              {(messagesQ.data?.messages ?? []).map((m) => (
                <FieldMessageCard
                  key={m.id}
                  m={m}
                  canReply={canVerify}
                  onReply={(body) => replyMutation.mutate({ replyToId: m.id, body })}
                  onHandle={(handled) => handleMutation.mutate({ id: m.id, handled })}
                  onZoneSelect={onZoneSelect}
                  replyBusy={replyMutation.isPending}
                />
              ))}
            </Stack>
          )}
        </Box>
      )}

      {tab === 3 && (
        <Stack spacing={1.5}>
          {(roadsQ.data?.roads ?? []).map((r) => {
            const d = r.detour;
            return (
              <Paper key={r.id} variant="outlined" sx={{ p: 1.75 }}>
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ alignItems: { sm: 'center' }, justifyContent: 'space-between' }}>
                  <Box sx={{ flex: 1 }}>
                    <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 0.5 }}>
                      <Typography variant="body2" sx={{ fontWeight: 700 }}>{r.roadName}</Typography>
                      <Chip
                        size="small"
                        label={r.status}
                        sx={{
                          height: 20, fontSize: 10, fontWeight: 700,
                          bgcolor: r.status === 'open' ? 'rgba(52,211,153,.14)' : r.status === 'watch' ? 'rgba(234,179,8,.14)' : 'rgba(239,68,68,.14)',
                          color: r.status === 'open' ? '#34d399' : r.status === 'watch' ? '#eab308' : '#ef4444',
                        }}
                      />
                      {r.source === 'model' && (
                        <Chip size="small" label="ML-predicted" sx={{ height: 20, fontSize: 10, fontWeight: 700, bgcolor: 'rgba(56,189,248,.14)', color: '#38bdf8', border: '1px solid rgba(56,189,248,.4)' }} />
                      )}
                      {d && d.corridorHazard > 0 && (
                        <Chip size="small" label={`corridor L${d.corridorHazard}`} sx={{ height: 20, fontSize: 10, fontWeight: 700, bgcolor: 'rgba(148,163,184,.12)', color: 'text.secondary' }} />
                      )}
                    </Stack>
                    <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                      {r.district} · source: {r.source}
                      {r.note ? ` · ${r.note}` : ''}
                      {` · updated ${new Date(r.updatedAt).toLocaleString()}`}
                    </Typography>
                    {d?.available && (
                      <Box sx={{ mt: 1, p: 1, borderRadius: 1.5, bgcolor: 'rgba(56,189,248,.07)', border: '1px solid rgba(56,189,248,.28)' }}>
                        <Stack direction="row" spacing={1.5} useFlexGap sx={{ flexWrap: 'wrap', rowGap: 0.5, alignItems: 'center' }}>
                          <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
                            <AltRouteIcon sx={{ fontSize: 15, color: '#38bdf8' }} />
                            <Typography variant="caption" sx={{ fontWeight: 700, color: '#7dd3fc' }}>ALTERNATE ROUTE</Typography>
                          </Stack>
                          <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                            +{d.extraKm} km · <b style={{ color: '#e2e8f0' }}>+{d.delayMinutes} min delay</b> · clearance ETA ~{d.clearanceEtaHours} h
                          </Typography>
                        </Stack>
                        <Typography variant="caption" sx={{ display: 'block', mt: 0.5, color: 'text.secondary', lineHeight: 1.4 }}>
                          {d.reason} — bypass auto-suggested by the corridor-hazard engine, shown dashed cyan on the map.
                        </Typography>
                      </Box>
                    )}
                  </Box>
                  <ToggleButtonGroup
                    size="small"
                    exclusive
                    value={r.status}
                    onChange={(_, v) => v && roadMutation.mutate({ roadId: r.id, status: v })}
                    disabled={!canVerify || roadMutation.isPending}
                  >
                    <ToggleButton value="open" sx={{ px: 1.5, py: 0.4, fontSize: 11 }}>Open</ToggleButton>
                    <ToggleButton value="watch" sx={{ px: 1.5, py: 0.4, fontSize: 11 }}>Watch</ToggleButton>
                    <ToggleButton value="blocked" sx={{ px: 1.5, py: 0.4, fontSize: 11 }}>Blocked</ToggleButton>
                  </ToggleButtonGroup>
                </Stack>
              </Paper>
            );
          })}
          {!canVerify && (
            <Alert severity="info" variant="outlined">
              Road status changes require a field official, DC or admin account.
            </Alert>
          )}
        </Stack>
      )}

      {tab === 4 && (
        <Stack spacing={1.5}>
          {/* stats */}
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} useFlexGap sx={{ flexWrap: 'wrap' }}>
            {[
              ['SMS total (24 h)', commsQ.data?.stats.total ?? 0, '#38bdf8'],
              ['Delivered', commsQ.data?.stats.delivered ?? 0, '#34d399'],
              ['In flight', commsQ.data?.stats.inFlight ?? 0, '#f59e0b'],
              ['Devices registered', commsQ.data?.stats.devices ?? 0, '#a78bfa'],
              ['Devices online', commsQ.data?.stats.devicesOnline ?? 0, '#34d399'],
            ].map(([label, val, tone]) => (
              <Paper key={label as string} variant="outlined" sx={{ p: 1.5, flex: { sm: '1 1 150px' } }}>
                <Typography variant="overline" sx={{ display: 'block', lineHeight: 1, fontSize: 10, color: 'text.secondary' }}>
                  {label}
                </Typography>
                <Typography variant="h6" sx={{ fontWeight: 800, color: tone as string, fontFamily: 'monospace' }}>
                  {(val as number).toLocaleString('en-IN')}
                </Typography>
              </Paper>
            ))}
          </Stack>

          {/* registered devices */}
          <Paper variant="outlined" sx={{ p: 1.75 }}>
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 1 }}>
              <SmartphoneIcon sx={{ fontSize: 17, color: '#a78bfa' }} />
              <Typography variant="subtitle2">Registered field devices (SMS / push targets)</Typography>
            </Stack>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
              {(commsQ.data?.devices ?? []).map((d) => (
                <Stack
                  key={d.id}
                  direction="row"
                  spacing={0.75}
                  sx={{ alignItems: 'center', p: 0.75, borderRadius: 1.5, bgcolor: 'rgba(148,163,184,.06)', minWidth: 210 }}
                >
                  <Box component="span" sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: d.online ? '#34d399' : '#64748b', boxShadow: d.online ? '0 0 6px #34d399' : 'none', flexShrink: 0 }} />
                  <Box sx={{ minWidth: 0 }}>
                    <Typography variant="caption" sx={{ fontWeight: 700, display: 'block', lineHeight: 1.2 }}>
                      {d.name}
                    </Typography>
                    <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: 10, lineHeight: 1.2 }}>
                      {d.phone ?? '—'} · {d.district ?? 'all districts'} · seen {Math.max(0, Math.round((Date.now() - new Date(d.lastSeenAt).getTime()) / 60000))} min ago
                    </Typography>
                  </Box>
                </Stack>
              ))}
            </Stack>
          </Paper>

          {/* SMS outbox */}
          <Paper variant="outlined" sx={{ overflow: 'hidden' }}>
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center', p: 1.5, pb: 0.5 }}>
              <SmsIcon sx={{ fontSize: 17, color: '#34d399' }} />
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography variant="subtitle2">SMS gateway outbox (simulated — Twilio/BSNL slot-in)</Typography>
                <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', lineHeight: 1.3 }}>
                  Every row is generated live by the notification fan-out when the engine escalates a zone (or AI-flags a photo) — none of these messages are pre-scripted.
                </Typography>
              </Box>
              <Chip size="small" label={`refresh 5s`} variant="outlined" sx={{ fontWeight: 700 }} />
            </Stack>
            <TableContainer sx={{ maxHeight: 380 }}>
              <Table size="small" stickyHeader>
                <TableHead>
                  <TableRow>
                    {['Phone', 'Device', 'Message', 'Status', 'Time'].map((h) => (
                      <TableCell key={h} sx={{ fontWeight: 700, fontSize: 11.5 }}>{h}</TableCell>
                    ))}
                  </TableRow>
                </TableHead>
                <TableBody>
                  {(commsQ.data?.sms ?? []).slice(0, 60).map((s) => (
                    <TableRow key={s.id} hover>
                      <TableCell>
                        <Typography variant="caption" sx={{ fontFamily: 'monospace', fontWeight: 700 }}>{s.phone}</Typography>
                      </TableCell>
                      <TableCell>
                        <Typography variant="caption" sx={{ color: 'text.secondary' }}>{s.deviceName ?? '—'}</Typography>
                      </TableCell>
                      <TableCell sx={{ maxWidth: 420 }}>
                        <Typography variant="caption" sx={{ display: 'block', lineHeight: 1.35 }}>{s.body}</Typography>
                      </TableCell>
                      <TableCell>
                        <Chip
                          size="small"
                          icon={s.status === 'delivered' ? <DoneAllIcon sx={{ fontSize: 11 }} /> : <AccessTimeIcon sx={{ fontSize: 11 }} />}
                          label={s.status}
                          variant="outlined"
                          sx={{
                            height: 19, fontSize: 10, fontWeight: 800,
                            color: s.status === 'delivered' ? '#34d399' : '#f59e0b',
                            borderColor: s.status === 'delivered' ? 'rgba(52,211,153,.4)' : 'rgba(245,158,11,.4)',
                          }}
                        />
                      </TableCell>
                      <TableCell>
                        <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                          {new Date(s.queuedAt).toLocaleTimeString()}
                        </Typography>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </Paper>

          {/* notification events */}
          <Paper variant="outlined" sx={{ overflow: 'hidden' }}>
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center', p: 1.5, pb: 1 }}>
              <DoneAllIcon sx={{ fontSize: 17, color: '#38bdf8' }} />
              <Typography variant="subtitle2" sx={{ flex: 1 }}>Notification fan-out events (24 h)</Typography>
            </Stack>
            <TableContainer sx={{ maxHeight: 320 }}>
              <Table size="small" stickyHeader>
                <TableHead>
                  <TableRow>
                    {['Kind', 'Level', 'Title', 'Zone', 'Channels', 'Time'].map((h) => (
                      <TableCell key={h} sx={{ fontWeight: 700, fontSize: 11.5 }}>{h}</TableCell>
                    ))}
                  </TableRow>
                </TableHead>
                <TableBody>
                  {(commsQ.data?.notifications ?? []).slice(0, 60).map((n) => (
                    <TableRow key={n.id} hover>
                      <TableCell>
                        <Chip
                          size="small"
                          label={n.kind}
                          sx={{ height: 19, fontSize: 10, fontWeight: 700, bgcolor: n.kind === 'report_flagged' ? 'rgba(56,189,248,.12)' : 'rgba(239,68,68,.1)', color: n.kind === 'report_flagged' ? '#38bdf8' : '#f87171' }}
                        />
                      </TableCell>
                      <TableCell>
                        <Chip size="small" label={`L${n.level}`} sx={{ height: 19, fontSize: 10, fontWeight: 800, bgcolor: `${hazardColor(Math.max(n.level, 1))}22`, color: hazardColor(Math.max(n.level, 1)) }} />
                      </TableCell>
                      <TableCell sx={{ maxWidth: 380 }}>
                        <Typography variant="caption" sx={{ display: 'block', lineHeight: 1.3 }}>{n.title}</Typography>
                        <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: 10, display: 'block', lineHeight: 1.3 }}>
                          {n.body.slice(0, 90)}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        <Typography variant="caption" sx={{ fontFamily: 'monospace' }}>{n.zoneCode ?? '—'}</Typography>
                      </TableCell>
                      <TableCell>
                        <Stack direction="row" spacing={0.5}>
                          {n.channels.map((c) => (
                            <Chip key={c} size="small" label={c} variant="outlined" sx={{ height: 17, fontSize: 9 }} />
                          ))}
                        </Stack>
                      </TableCell>
                      <TableCell>
                        <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                          {new Date(n.createdAt).toLocaleTimeString()}
                        </Typography>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </Paper>
        </Stack>
      )}

      <Snackbar
        open={!!toast}
        autoHideDuration={3500}
        onClose={() => setToast(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert severity={toast?.sev ?? 'success'} variant="filled" onClose={() => setToast(null)}>
          {toast?.msg}
        </Alert>
      </Snackbar>
    </Box>
  );
}

/* ── Field messages inbox card ─────────────────────────────────────────── */

const MSG_META: Record<string, { label: string; color: string }> = {
  sos: { label: 'SOS', color: '#ef4444' },
  help: { label: 'HELP', color: '#f59e0b' },
  status: { label: 'STATUS', color: '#38bdf8' },
  info: { label: 'INFO', color: '#94a3b8' },
  gauge: { label: 'GAUGE', color: '#a78bfa' },
};

function FieldMessageCard({
  m, canReply, onReply, onHandle, onZoneSelect, replyBusy,
}: {
  m: FieldMessageRow;
  canReply: boolean;
  onReply: (body: string) => void;
  onHandle: (handled: boolean) => void;
  onZoneSelect: (zoneCode: string) => void;
  replyBusy: boolean;
}) {
  const [reply, setReply] = useState('');
  const [open, setOpen] = useState(false);
  const meta = MSG_META[m.category] ?? MSG_META.info;
  const urgent = m.category === 'sos' && !m.handled;

  return (
    <Paper
      variant="outlined"
      sx={{
        p: 1.5,
        borderLeft: `3px solid ${meta.color}`,
        borderColor: urgent ? 'rgba(239,68,68,.55)' : undefined,
        bgcolor: urgent ? 'rgba(239,68,68,.04)' : undefined,
      }}
    >
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 0.75, flexWrap: 'wrap', gap: 0.75 }}>
        <Chip
          size="small"
          label={meta.label}
          sx={{ height: 20, fontWeight: 800, fontSize: 10, bgcolor: `${meta.color}1f`, color: meta.color, border: `1px solid ${meta.color}55` }}
        />
        <Typography variant="body2" sx={{ fontWeight: 800 }}>
          {m.authorName}
          {m.deviceName && m.deviceName !== m.authorName && (
            <Typography component="span" variant="caption" sx={{ color: 'text.secondary', fontWeight: 600 }}>
              {' '}· {m.deviceName}
            </Typography>
          )}
        </Typography>
        {m.deviceOnline && (
          <Chip size="small" label="phone online" sx={{ height: 18, fontSize: 9, fontWeight: 700, bgcolor: 'rgba(52,211,153,.1)', color: '#34d399', border: '1px solid rgba(52,211,153,.3)' }} />
        )}
        {m.district && <Chip size="small" label={m.district} variant="outlined" sx={{ height: 18, fontSize: 9, fontWeight: 700 }} />}
        {m.zoneCode && (
          <Chip
            size="small" label={m.zoneCode} onClick={() => onZoneSelect(m.zoneCode!)}
            sx={{ height: 18, fontSize: 9, fontWeight: 800, cursor: 'pointer', bgcolor: 'rgba(148,163,184,.12)' }}
          />
        )}
        <Box sx={{ flex: 1 }} />
        <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: 10 }}>
          {new Date(m.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </Typography>
        {m.handled ? (
          <Chip size="small" icon={<DoneAllIcon sx={{ fontSize: 12 }} />} label="handled" sx={{ height: 20, fontSize: 10, fontWeight: 700, bgcolor: 'rgba(52,211,153,.1)', color: '#34d399' }} />
        ) : (
          <Chip size="small" label="open" color="warning" sx={{ height: 20, fontSize: 10, fontWeight: 800 }} />
        )}
      </Stack>

      <Typography variant="body2" sx={{ mb: 1, whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>
        {m.body}
      </Typography>

      {m.replies.length > 0 && (
        <Stack spacing={0.75} sx={{ mb: 1, pl: 1.5, borderLeft: '2px solid rgba(52,211,153,.3)' }}>
          {m.replies.map((r) => (
            <Box key={r.id}>
              <Typography variant="caption" sx={{ fontWeight: 800, color: '#34d399' }}>
                {r.authorName} · command{' '}
                <Typography component="span" variant="caption" sx={{ color: 'text.secondary', fontSize: 9.5 }}>
                  {new Date(r.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </Typography>
              </Typography>
              <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>{r.body}</Typography>
            </Box>
          ))}
        </Stack>
      )}

      {canReply && (
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
          {open ? (
            <>
              <TextField
                size="small" autoFocus placeholder="Reply to the field phone…"
                value={reply} onChange={(e) => setReply(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && reply.trim() && !replyBusy) {
                    onReply(reply.trim());
                    setReply('');
                    setOpen(false);
                  }
                }}
                sx={{ flex: 1, '& .MuiInput-root': { fontSize: 13 } }}
              />
              <Button
                size="small" variant="contained" disabled={!reply.trim() || replyBusy}
                onClick={() => { onReply(reply.trim()); setReply(''); setOpen(false); }}
              >
                Send
              </Button>
              <Button size="small" onClick={() => setOpen(false)}>Cancel</Button>
            </>
          ) : (
            <>
              <Button size="small" startIcon={<SmsIcon sx={{ fontSize: 14 }} />} onClick={() => setOpen(true)}>
                Reply
              </Button>
              {m.handled ? (
                <Button size="small" onClick={() => onHandle(false)}>Reopen</Button>
              ) : (
                <Button size="small" color="success" startIcon={<CheckIcon sx={{ fontSize: 14 }} />} onClick={() => onHandle(true)}>
                  Mark handled
                </Button>
              )}
            </>
          )}
        </Stack>
      )}
    </Paper>
  );
}
