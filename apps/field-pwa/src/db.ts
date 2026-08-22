import Dexie, { type Table } from "dexie";

export interface QueuedReport {
  client_id: string;
  category: string;
  lat: number | null;
  lon: number | null;
  description?: string;
  taken_at?: string;
  photo_b64?: string;
  status: "pending" | "synced" | "flagged";
  created_at: string;
}

export interface SafeCheckin {
  id?: number;
  ts: string;
  synced: 0 | 1;
}

class BhuDB extends Dexie {
  reports!: Table<QueuedReport, string>;
  checkins!: Table<SafeCheckin, number>;

  constructor() {
    super("bhurakshak");
    this.version(1).stores({
      reports: "client_id, status, created_at",
      checkins: "++id, ts",
    });
  }
}

export const db = new BhuDB();

export function queueReport(r: Omit<QueuedReport, "client_id" | "created_at" | "status">) {
  return db.reports.add({
    ...r,
    client_id: crypto.randomUUID(),
    created_at: new Date().toISOString(),
    status: "pending",
  });
}

export async function syncQueue(apiUrl: string): Promise<{ sent: number }> {
  const pending = await db.reports.where("status").equals("pending").toArray();
  if (!pending.length) return { sent: 0 };
  const payload = {
    batch_id: crypto.randomUUID(),
    reports: pending.map((r) => ({
      client_id: r.client_id,
      category: r.category,
      lat: r.lat ?? 0,
      lon: r.lon ?? 0,
      description: r.description ?? null,
      taken_at: r.taken_at ?? null,
    })),
  };
  try {
    const login = await fetch(`${apiUrl}/api/v1/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "citizen@bhrakshak.in", password: "Citizen@123" }),
    }).then((r) => r.json());
    const res = await fetch(`${apiUrl}/api/v1/reports/sync`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${login.access_token}` },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(`sync failed ${res.status}`);
    await db.reports.bulkPut(pending.map((r) => ({ ...r, status: "synced" as const })));
    return { sent: pending.length };
  } catch {
    return { sent: 0 }; // stay pending; background retry on next 'online'
  }
}
