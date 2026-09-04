'use client';

import { Box, Stack, Typography, Chip, Paper, Button, Divider } from '@mui/material';
import NotificationsActiveIcon from '@mui/icons-material/NotificationsActive';
import SmsIcon from '@mui/icons-material/Sms';
import CampaignIcon from '@mui/icons-material/Campaign';
import ReportIcon from '@mui/icons-material/Report';
import DoneAllIcon from '@mui/icons-material/DoneAll';
import AccessTimeIcon from '@mui/icons-material/AccessTime';
import { hazardColor } from '@/components/theme';
import type { AppNotification, AppSms } from './types';

interface Props {
  notifications: AppNotification[];
  sms: AppSms[];
  unread: number;
  onEnablePush: () => void;
  pushEnabled: boolean;
}

const KIND_ICON: Record<string, React.ReactNode> = {
  landslide_alert: <CampaignIcon sx={{ fontSize: 16 }} />,
  allclear: <DoneAllIcon sx={{ fontSize: 16 }} />,
  report_flagged: <ReportIcon sx={{ fontSize: 16 }} />,
  system: <NotificationsActiveIcon sx={{ fontSize: 16 }} />,
};

function timeAgo(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${Math.floor(s)}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString();
}

export default function AppAlerts({ notifications, sms, unread, onEnablePush, pushEnabled }: Props) {
  const smsForMe = sms.slice(0, 20);
  return (
    <Box sx={{ p: 1.5, overflowY: 'auto', height: '100%' }}>
      <Stack spacing={1.5}>
        {!pushEnabled && (
          <Paper variant="outlined" sx={{ p: 1.25, borderColor: 'rgba(56,189,248,.35)', bgcolor: 'rgba(56,189,248,.06)' }}>
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
              <NotificationsActiveIcon sx={{ fontSize: 18, color: '#38bdf8' }} />
              <Typography variant="caption" sx={{ flex: 1, fontWeight: 600 }}>
                Enable phone notifications for landslide alerts
              </Typography>
              <Button size="small" variant="contained" onClick={onEnablePush}>Enable</Button>
            </Stack>
          </Paper>
        )}

        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
          <NotificationsActiveIcon sx={{ fontSize: 18, color: unread ? '#f59e0b' : 'text.secondary' }} />
          <Typography variant="subtitle2" sx={{ flex: 1 }}>
            Notification centre {unread > 0 && <Chip size="small" label={`${unread} new`} color="warning" sx={{ height: 18, ml: 0.5, fontWeight: 800 }} />}
          </Typography>
        </Stack>

        {notifications.length === 0 && (
          <Typography variant="caption" sx={{ color: 'text.secondary', px: 1 }}>
            No notifications yet. When the risk engine escalates a zone (landslide detection), an alert lands here instantly — plus SMS.
          </Typography>
        )}

        {notifications.slice(0, 40).map((n) => (
          <Paper
            key={n.id}
            variant="outlined"
            sx={{ p: 1.25, borderLeft: `3px solid ${n.kind === 'allclear' ? '#22c55e' : hazardColor(Math.max(n.level, 1))}` }}
          >
            <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center', mb: 0.35 }}>
              <Box sx={{ color: n.kind === 'allclear' ? '#22c55e' : hazardColor(Math.max(n.level, 1)) }}>
                {KIND_ICON[n.kind] ?? KIND_ICON.system}
              </Box>
              <Typography variant="caption" sx={{ fontWeight: 800, flex: 1, lineHeight: 1.2 }}>
                {n.title}
              </Typography>
              <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: 10, flexShrink: 0 }}>
                {timeAgo(n.createdAt)}
              </Typography>
            </Stack>
            <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', lineHeight: 1.45 }}>
              {n.body.slice(0, 160)}
            </Typography>
            <Stack direction="row" spacing={0.5} sx={{ mt: 0.5 }}>
              {n.zoneCode && <Chip size="small" label={n.zoneCode} sx={{ height: 16, fontSize: 9, fontWeight: 700 }} />}
              {n.channels?.includes('sms') && (
                <Chip size="small" icon={<SmsIcon sx={{ fontSize: 11 }} />} label="SMS sent" sx={{ height: 16, fontSize: 9, fontWeight: 700, color: '#34d399', borderColor: 'rgba(52,211,153,.4)' }} variant="outlined" />
              )}
              {n.probability != null && n.level >= 3 && (
                <Chip size="small" label={`P ${Math.round(n.probability * 100)}%`} sx={{ height: 16, fontSize: 9, fontWeight: 700, color: '#f59e0b', borderColor: 'rgba(245,158,11,.4)' }} variant="outlined" />
              )}
            </Stack>
          </Paper>
        ))}

        <Divider sx={{ my: 0.5 }}>
          <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
            <SmsIcon sx={{ fontSize: 14, color: 'text.secondary' }} />
            <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 700 }}>SMS inbox</Typography>
          </Stack>
        </Divider>

        {smsForMe.length === 0 && (
          <Typography variant="caption" sx={{ color: 'text.secondary', px: 1 }}>
            SMS arrives when the engine detects L3+ landslide risk or the AI flags a report — works even without internet.
          </Typography>
        )}

        {smsForMe.map((s) => (
          <Paper key={s.id} variant="outlined" sx={{ p: 1.1 }}>
            <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center', mb: 0.3 }}>
              <SmsIcon sx={{ fontSize: 14, color: '#34d399' }} />
              <Typography variant="caption" sx={{ fontWeight: 700, flex: 1 }}>
                {s.phone}
              </Typography>
              <Chip
                size="small"
                icon={s.status === 'delivered' ? <DoneAllIcon sx={{ fontSize: 11 }} /> : <AccessTimeIcon sx={{ fontSize: 11 }} />}
                label={s.status}
                color={s.status === 'delivered' ? 'success' : 'warning'}
                variant="outlined"
                sx={{ height: 18, fontSize: 10, fontWeight: 800 }}
              />
            </Stack>
            <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', lineHeight: 1.4 }}>
              {s.body}
            </Typography>
          </Paper>
        ))}
      </Stack>
    </Box>
  );
}
