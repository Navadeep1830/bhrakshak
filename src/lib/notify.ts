/**
 * BhuRakshak comms engine — notification fan-out + simulated SMS gateway.
 *
 * When the risk engine escalates a zone (landslide detection), or an AI
 * pre-screen flags a citizen crack photo, this module fans the event out:
 *   1. NotificationEvent rows (in-app notification center, phone + website)
 *   2. SmsMessage rows for every registered device in scope (L3+ alerts and
 *      high-confidence flagged reports) — a *simulated* gateway whose
 *      delivery transitions (sent → delivered) settle over time. In
 *      production the same interface is the slot-in point for a real
 *      Twilio / BSNL SMS gateway.
 */
import { db } from '@/lib/db';
import { randomUUID } from 'crypto';
import { ALERT_CHANNEL_POLICY } from '@/lib/risk-engine';

/* ── demo device fleet (also the slot-in point for real registrations) ── */

const DEMO_DEVICES: Array<{ deviceId: string; name: string; phone: string; district: string | null }> = [
  { deviceId: 'demo-ekh-council', name: 'Mawlynnong Village Council', phone: '+919436123401', district: 'East Khasi Hills' },
  { deviceId: 'demo-ekh-school', name: 'SSA School Head — Sohra', phone: '+919436123402', district: 'East Khasi Hills' },
  { deviceId: 'demo-aizawl-volunteer', name: 'Aizawl Ward Volunteer', phone: '+919436123403', district: 'Aizawl' },
  { deviceId: 'demo-noney-fieldkit', name: 'NH-6 Field Kit — Noney', phone: '+919436123404', district: 'Noney' },
  { deviceId: 'demo-imphal-ddma', name: 'Imphal West DDMA Desk', phone: '+919436123405', district: 'Imphal West' },
  { deviceId: 'demo-gangtok-cdmo', name: 'Gangtok CDMO Office', phone: '+919436123406', district: 'Gangtok' },
  { deviceId: 'demo-broadcast-all', name: 'State EWS Broadcast Desk', phone: '+919436123407', district: null },
];

export async function ensureDemoDevices(): Promise<void> {
  for (const d of DEMO_DEVICES) {
    await db.device.upsert({
      where: { deviceId: d.deviceId },
      create: { ...d, lastSeenAt: new Date() },
      update: { name: d.name, phone: d.phone, district: d.district },
    });
  }
}

/** Flip SMS rows whose simulated delivery moment has arrived. */
export async function settleSms(): Promise<void> {
  try {
    await db.smsMessage.updateMany({
      where: { status: 'sent', deliveredAt: { lte: new Date() } },
      data: { status: 'delivered' },
    });
  } catch {
    /* non-fatal */
  }
}

/* ── SMS body composer (GSM-style, < 160 chars) ── */

function smsBodyAlert(a: AlertFanIn): string {
  const tag = a.level >= 4 ? 'RED' : 'ORANGE';
  const head = `BhuRakshak ${tag} L${a.level} ${a.zoneCode}`;
  const advice = a.level >= 4 ? 'Move to shelter NOW' : 'Avoid the area';
  return `${head}: ${a.message.replace(/\s+/g, ' ').slice(0, 96)} ${advice}. -DDMA`;
}

function smsBodyReport(r: ReportFanIn): string {
  return `BhuRakshak AI FLAG ${r.zoneCode ?? 'field'}: citizen photo flagged ${Math.round(r.confidence * 100)}% (${r.severity ?? 'risk'}). Verify + dispatch. -EWS`;
}

/* ── fan-out interfaces ── */

export interface AlertFanIn {
  zoneId: string;
  zoneCode: string;
  district: string | null;
  level: number;
  title: string;
  message: string;
  probability: number;
  kind?: 'landslide_alert' | 'allclear';
}

export interface ReportFanIn {
  zoneCode: string | null;
  district: string | null;
  confidence: number;
  findings: string | null;
  severity: string | null;
  reportId: string;
  reportTitle: string;
}

export interface FanOutStats {
  notifications: number;
  sms: number;
}

/** Devices in scope for a district-scoped message (null district = all). */
async function devicesInScope(district: string | null) {
  return db.device.findMany({
    where: district ? { OR: [{ district: null }, { district }] } : undefined,
  });
}

/**
 * Fan out escalation alerts: one NotificationEvent each (+ SMS to all
 * in-scope devices when level >= 3). Returns counts for UI feedback.
 */
export async function fanOutAlerts(alerts: AlertFanIn[]): Promise<FanOutStats> {
  let notifications = 0;
  let sms = 0;
  if (!alerts.length) return { notifications, sms };

  await ensureDemoDevices();

  for (const a of alerts) {
    const kind = a.kind ?? 'landslide_alert';
    // full DDMA channel policy: L1 push · L2 push+sms · L3 +ivr · L4 +siren
    const channels = ALERT_CHANNEL_POLICY[a.level] ?? (a.level >= 3 ? ['push', 'sms', 'ivr'] : ['push']);
    const ev = await db.notificationEvent.create({
      data: {
        kind,
        level: a.level,
        title: a.title,
        body: a.message,
        zoneId: a.zoneId,
        zoneCode: a.zoneCode,
        district: a.district,
        probability: a.probability,
        channels: JSON.stringify(channels),
      },
    });
    notifications++;

    if (a.level >= 3) {
      const devices = await devicesInScope(a.district);
      const rows = devices.map((d, i) => {
        const now = Date.now();
        return db.smsMessage.create({
          data: {
            notificationId: ev.id,
            deviceId: d.id,
            phone: d.phone ?? '+910000000000',
            body: smsBodyAlert(a),
            status: 'sent',
            queuedAt: new Date(now),
            sentAt: new Date(now),
            // deterministic-ish delivery latency 5–9 s — visible progress
            deliveredAt: new Date(now + 5000 + ((a.zoneCode.charCodeAt(1) + i * 3) % 5) * 1000),
          },
        });
      });
      await Promise.all(rows);
      sms += rows.length;
    }
  }
  return { notifications, sms };
}

/**
 * Fan out an AI-flagged citizen report (photo of a crack etc.).
 * Push notification always; SMS when confidence >= 0.6.
 */
export async function fanOutReportFlagged(r: ReportFanIn): Promise<FanOutStats> {
  await ensureDemoDevices();
  const wantSms = r.confidence >= 0.6;
  const ev = await db.notificationEvent.create({
    data: {
      kind: 'report_flagged',
      level: 2,
      title: r.reportTitle,
      body: `AI pre-screen flagged a citizen report${r.zoneCode ? ` near ${r.zoneCode}` : ''} (${Math.round(r.confidence * 100)}% confidence). ${r.findings ?? ''}`.slice(0, 400),
      zoneCode: r.zoneCode,
      district: r.district,
      channels: JSON.stringify(wantSms ? ['push', 'sms'] : ['push']),
      reportId: r.reportId,
    },
  });
  if (!wantSms) return { notifications: 1, sms: 0 };

  const devices = await devicesInScope(r.district);
  await Promise.all(
    devices.map((d) => {
      const now = Date.now();
      return db.smsMessage.create({
        data: {
          notificationId: ev.id,
          deviceId: d.id,
          phone: d.phone ?? '+910000000000',
          body: smsBodyReport(r),
          status: 'sent',
          queuedAt: new Date(now),
          sentAt: new Date(now),
          deliveredAt: new Date(now + 6000),
        },
      });
    })
  );
  return { notifications: 1, sms: devices.length };
}

/** Generate a stable device id for a browser (client supplies its own too). */
export function newDeviceId(): string {
  return `dev-${randomUUID().slice(0, 12)}`;
}
