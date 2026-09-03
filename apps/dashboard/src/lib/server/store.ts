// In-memory demo world: 6 NER districts, 43 response zones (hexes), sensors,
// roads, shelters, citizen reports, alerts, live events, 5 demo users.
// Deterministic seed => identical world on every boot / demo reset.
import { mulberry32, haversineKm } from "./rng";

export interface DistrictCfg {
  district: string;
  state: string;
  code: string; // zone_code prefix, e.g. "MH-EKH"
  center: [number, number]; // lon, lat
  radiusDeg: number;
  suscBase: number;
  suscSpread: number;
  stormBias: number;
  nHexes: number;
  names: string[];
}

export interface Zone {
  id: string;
  zone_code: string;
  name: string;
  district: string;
  state: string;
  center: [number, number];
  hex: number[][][]; // one ring of 6 pts
  suscMean: number;
  suscP90: number;
  hazardLevel: number; // fused + hysteresis level L0..L4
  thresholdTier: number;
  mlTier: number;
  prob24h: number;
  population: number;
  roadKm: number;
  rainIntensity: number; // mm/h now
  rain24h: number; // mm rolling 24h
  antecedent: number; // mm 7-day antecedent index
  soilMoisture: number; // % VWC
  creepMmYear: number; // PSInSAR LOS velocity
  isolationScore: number; // 0..1
  floodIndex: number; // 0..1
  roadClass: "NH" | "SH" | "MDR";
  stormRamp: number; // demo storm multiplier (1 = none)
  escVotes: number; // hysteresis counters
  descVotes: number;
  history: { t: number; level: number; rain: number; prob: number }[];
}

export interface SensorReading {
  sensor_id: string;
  zone_id: string;
  soil: number; // %
  rain_mm_h: number;
  battery: number;
  online: boolean;
}

export interface AlertRec {
  id: number;
  zone_id: string;
  zone_code: string;
  zone_name: string;
  district: string;
  level: number;
  lang: string;
  message: string;
  channels: string[];
  created_at: number;
  ack: boolean;
  ack_by?: string;
}

export interface CitizenReport {
  id: number;
  zone_id: string;
  reporter: string;
  type: "crack" | "water" | "slope_movement" | "road_block" | "checkin";
  note: string;
  lat: number;
  lon: number;
  photo?: string; // data URL
  verdict?: { label: string; confidence: number };
  status: "pending" | "verified" | "rejected";
  created_at: number;
}

export interface RoadSeg {
  id: string;
  name: string;
  from_zone: string;
  to_zone: string;
  km: number;
  cls: "NH" | "SH" | "MDR";
  forcedBlocked: boolean;
}

export interface ShelterRec {
  id: string;
  name: string;
  district: string;
  lat: number;
  lon: number;
  capacity: number;
  occupancy: number;
  shelter_type: "school" | "community" | "church";
  has_medical: boolean;
  water_l: number;
  ration_packets: number;
  slope_deg: number;
  distance_to_steep_slope_m: number;
}

export interface LiveEvent {
  id: number;
  kind: "alert" | "risk_diff" | "sensor" | "allclear" | "ops" | "demo";
  text: string;
  ts: number;
  level?: number;
  zone_code?: string;
}

export interface DemoUser {
  id: string;
  email: string;
  password: string;
  full_name: string;
  role: "admin" | "district_admin" | "field_official" | "citizen";
  district: string | null;
}

export interface RegistryRec {
  model: string;
  layer: string;
  approach: string;
  val_metric: string;
  status: "deployed" | "training" | "planned";
  note: string;
}

export interface Store {
  bootedAt: number;
  districts: DistrictCfg[];
  zones: Zone[];
  sensors: SensorReading[];
  alerts: AlertRec[];
  reports: CitizenReport[];
  roads: RoadSeg[];
  shelters: ShelterRec[];
  events: LiveEvent[];
  users: DemoUser[];
  registry: RegistryRec[];
  teams: string[];
  opsLog: { ts: number; text: string }[];
  chat: ChatMsg[];
  alertSeq: number;
  reportSeq: number;
  eventSeq: number;
  lastTick: number;
  stormActive: boolean;
}

export interface ChatMsg {
  id: string;
  sender_name: string;
  location: string;
  message: string;
  role: string;
  timestamp: string;
}

// ---------------------------------------------------------------- districts
const DISTRICTS: DistrictCfg[] = [
  {
    district: "East Khasi Hills", state: "Meghalaya", code: "MH-EKH",
    center: [91.9, 25.5], radiusDeg: 0.09, suscBase: 72, suscSpread: 16,
    stormBias: 1.25, nHexes: 9,
    names: ["Sohra", "Mawsynram", "Cherrapunji Rd", "Laitlyngkot", "Mawkynrew",
      "Pynursla", "Mawlynnong", "Umlyngka", "Lumshyiap"],
  },
  {
    district: "Noney", state: "Manipur", code: "MN-NON",
    center: [93.58, 24.9], radiusDeg: 0.085, suscBase: 66, suscSpread: 18,
    stormBias: 1.15, nHexes: 8,
    names: ["Tupul", "Noney Bazaar", "Khoupum", "Nungba", "Haochong",
      "Longmai", "Bishnupur Rd", "Thingra"],
  },
  {
    district: "Aizawl", state: "Mizoram", code: "MZ-AIZ",
    center: [92.72, 23.73], radiusDeg: 0.075, suscBase: 66, suscSpread: 18,
    stormBias: 0.9, nHexes: 11,
    names: ["Durtlang", "Sairang", "Thenzawl", "Aibawk", "Thingsai",
      "Chhinga Veng", "Kolasib Rd", "Sihphui", "Muar Veng", "Rangvamual",
      "Zemabawk"],
  },
  {
    district: "Imphal West", state: "Manipur", code: "MN-IMP",
    center: [93.9, 24.8], radiusDeg: 0.07, suscBase: 48, suscSpread: 20,
    stormBias: 0.8, nHexes: 5,
    names: ["Lamphelpat", "Patsoi", "Koirengai", "Sekmai", "Phayeng"],
  },
  {
    district: "Kohima", state: "Nagaland", code: "NL-KOH",
    center: [94.1, 25.6], radiusDeg: 0.075, suscBase: 54, suscSpread: 20,
    stormBias: 1.0, nHexes: 5,
    names: ["Jotsoma", "Kigwema", "Chedema", "Zubza", "Mima"],
  },
  {
    district: "Gangtok", state: "Sikkim", code: "SK-GTS",
    center: [88.6, 27.33], radiusDeg: 0.07, suscBase: 58, suscSpread: 16,
    stormBias: 0.95, nHexes: 5,
    names: ["Tadong", "Ranipool", "Namli", "Burtuk", "Ranka"],
  },
];

const USERS: DemoUser[] = [
  { id: "u1", email: "admin@bhrakshak.in", password: "Admin@123",
    full_name: "Platform Admin", role: "admin", district: null },
  { id: "u2", email: "dc.aizawl@bhrakshak.in", password: "District@123",
    full_name: "DC Aizawl", role: "district_admin", district: "Aizawl" },
  { id: "u3", email: "dc.ekh@bhrakshak.in", password: "District@123",
    full_name: "DC East Khasi Hills", role: "district_admin",
    district: "East Khasi Hills" },
  { id: "u4", email: "field.noney@bhrakshak.in", password: "Field@123",
    full_name: "Field Official Noney", role: "field_official", district: "Noney" },
  { id: "u5", email: "citizen@bhrakshak.in", password: "Citizen@123",
    full_name: "Demo Citizen", role: "citizen", district: "Noney" },
];

const SHELTER_SEED: Omit<ShelterRec, "id" | "district">[] = [
  { name: "Govt Mizo High School Relief Camp", lat: 23.732, lon: 92.715,
    capacity: 850, occupancy: 42, shelter_type: "school", has_medical: true,
    water_l: 9000, ration_packets: 1600, slope_deg: 6.2,
    distance_to_steep_slope_m: 810 },
  { name: "Aizawl Civil Hospital Annex", lat: 23.727, lon: 92.72, capacity: 400,
    occupancy: 15, shelter_type: "community", has_medical: true, water_l: 5000,
    ration_packets: 700, slope_deg: 9.5, distance_to_steep_slope_m: 640 },
  { name: "Sohra Community Hall", lat: 25.28, lon: 91.73, capacity: 600,
    occupancy: 0, shelter_type: "community", has_medical: false, water_l: 4000,
    ration_packets: 900, slope_deg: 5.0, distance_to_steep_slope_m: 950 },
  { name: "Mawsynram PWD Rest House", lat: 25.28, lon: 91.87, capacity: 250,
    occupancy: 8, shelter_type: "school", has_medical: false, water_l: 2500,
    ration_packets: 500, slope_deg: 7.8, distance_to_steep_slope_m: 720 },
  { name: "Tupul Baptist Church Camp", lat: 24.87, lon: 93.55, capacity: 700,
    occupancy: 96, shelter_type: "church", has_medical: false, water_l: 6000,
    ration_packets: 1200, slope_deg: 6.9, distance_to_steep_slope_m: 560 },
  { name: "Noney Bazaar Indoor Stadium", lat: 24.92, lon: 93.58, capacity: 1200,
    occupancy: 31, shelter_type: "community", has_medical: true, water_l: 11000,
    ration_packets: 2300, slope_deg: 4.2, distance_to_steep_slope_m: 1300 },
  { name: "Khoupum Valley School", lat: 24.83, lon: 93.47, capacity: 450,
    occupancy: 0, shelter_type: "school", has_medical: false, water_l: 3000,
    ration_packets: 650, slope_deg: 8.4, distance_to_steep_slope_m: 470 },
  { name: "Jotsoma Angami Hall", lat: 25.64, lon: 94.06, capacity: 500,
    occupancy: 12, shelter_type: "community", has_medical: false, water_l: 3500,
    ration_packets: 800, slope_deg: 5.5, distance_to_steep_slope_m: 890 },
  { name: "Zubza GH Camp", lat: 25.63, lon: 94.02, capacity: 300, occupancy: 4,
    shelter_type: "school", has_medical: true, water_l: 2000, ration_packets: 450,
    slope_deg: 6.1, distance_to_steep_slope_m: 700 },
  { name: "Ranipool Sikkim Community Centre", lat: 27.31, lon: 88.63,
    capacity: 550, occupancy: 20, shelter_type: "community", has_medical: true,
    water_l: 4800, ration_packets: 1000, slope_deg: 3.9,
    distance_to_steep_slope_m: 1500 },
  { name: "Ranka Senior Secondary School", lat: 27.29, lon: 88.63, capacity: 400,
    occupancy: 6, shelter_type: "school", has_medical: false, water_l: 2600,
    ration_packets: 600, slope_deg: 7.2, distance_to_steep_slope_m: 620 },
  { name: "Patsoi Municipal Hall", lat: 24.79, lon: 93.9, capacity: 350,
    occupancy: 2, shelter_type: "community", has_medical: false, water_l: 2200,
    ration_packets: 500, slope_deg: 5.8, distance_to_steep_slope_m: 980 },
];

const REGISTRY: RegistryRec[] = [
  { model: "Model A", layer: "L1 Susceptibility",
    approach: "XGBoost / LightGBM, 24 terrain+geology+land-cover features, 30 m cells",
    val_metric: "LODO AUC 0.87", status: "deployed",
    note: "Leave-one-district-out spatial CV; GSI-compatible 5-class output" },
  { model: "Model B", layer: "L2 Hazard Nowcast",
    approach: "Physical logistic prior + LightGBM residual, isotonic calibration",
    val_metric: "OOF event-day percentile 0.875", status: "deployed",
    note: "Champion under one-SE rule; fused with I-D thresholds + hysteresis" },
  { model: "Model C", layer: "L3 Deformation",
    approach: "Sentinel-1 PSInSAR LOS velocity, robust z-score + DBSCAN",
    val_metric: "Tupul creep cluster recovered", status: "deployed",
    note: "Active creep zones auto +1 hazard tier upgrade" },
  { model: "Model D", layer: "L4 Exposure",
    approach: "Hazard x population x road criticality x isolation score",
    val_metric: "Priority queue AUC 0.79", status: "deployed",
    note: "Ranked response priorities + blocked-road prediction" },
  { model: "Model V", layer: "Verification",
    approach: "Geo-photo AI classifier (crack / seepage / scarp / road block)",
    val_metric: "Field validation 0.81", status: "deployed",
    note: "Pre-screens citizen photo reports before official verification" },
];

// ---------------------------------------------------------------- build
function hexRing(center: [number, number], radiusDeg: number): number[][][] {
  const pts: number[][] = [];
  for (let i = 0; i < 6; i++) {
    const ang = (Math.PI / 3) * i;
    pts.push([
      center[0] + radiusDeg * Math.cos(ang),
      center[1] + (radiusDeg * Math.sin(ang)) / 0.9,
    ]);
  }
  pts.push(pts[0].slice());
  return [pts];
}

// Flat-top hex grid (matches hexRing's vertex layout) with the /0.9 latitude
// stretch compensated + a small safety margin — zone hexes TILE instead of
// overlapping. Column spacing 1.56R, row spacing 2.0R, odd columns shifted
// by R vertically (the correct offset for flat-top hexes).
function hexGrid(n: number, discDeg: number): { centers: [number, number][]; R: number } {
  const cols = Math.max(1, Math.ceil(Math.sqrt(1.28 * n)));
  const rows = Math.ceil(n / cols);
  const R = Math.min(
    0.03,
    (2.1 * discDeg) / ((cols - 1) * 1.56 + 2),
    (2.1 * discDeg) / ((rows - 1) * 2.0 + 2),
  );
  const centers: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const c = i % cols;
    const r = Math.floor(i / cols);
    centers.push([
      (c - (cols - 1) / 2) * 1.56 * R,
      (r - (rows - 1) / 2) * 2.0 * R + (c % 2 === 1 ? R : 0),
    ]);
  }
  return { centers, R };
}

function buildZones(rng: () => number): Zone[] {
  const zones: Zone[] = [];
  for (const d of DISTRICTS) {
    const grid = hexGrid(d.nHexes, d.radiusDeg);
    for (let i = 0; i < d.nHexes; i++) {
      const center: [number, number] = [
        +(d.center[0] + grid.centers[i][0]).toFixed(4),
        +(d.center[1] + grid.centers[i][1]).toFixed(4),
      ];
      const susc = Math.max(
        12,
        Math.min(96, d.suscBase + (rng() - 0.5) * 2 * d.suscSpread),
      );
      const hexR = grid.R;
      const elevated =
        (d.district === "East Khasi Hills" && i < 3) ||
        (d.district === "Noney" && i < 2);
      const level = elevated ? (rng() > 0.5 ? 2 : 1) : rng() > 0.82 ? 1 : 0;
      const baseRain = d.stormBias * (6 + rng() * 14);
      const zone: Zone = {
        id: crypto.randomUUID(),
        zone_code: `${d.code}-${String(i + 1).padStart(3, "0")}`,
        name: d.names[i % d.names.length],
        district: d.district,
        state: d.state,
        center,
        hex: hexRing(center, hexR),
        suscMean: +susc.toFixed(1),
        suscP90: +Math.min(99, susc + 6 + rng() * 10).toFixed(1),
        hazardLevel: level,
        thresholdTier: level,
        mlTier: level,
        prob24h: +(0.05 + level * 0.18 + rng() * 0.08).toFixed(3),
        population: Math.round(400 + rng() * 5200),
        roadKm: +(3 + rng() * 18).toFixed(1),
        rainIntensity: +baseRain.toFixed(1),
        rain24h: +(baseRain * (4 + rng() * 8)).toFixed(0),
        antecedent: +(60 + rng() * 90).toFixed(0),
        soilMoisture: +(38 + rng() * 46).toFixed(0),
        creepMmYear: +(rng() * (susc > 60 ? 26 : 12)).toFixed(1),
        isolationScore: +(rng() * 0.8 + (susc > 70 ? 0.15 : 0)).toFixed(2),
        floodIndex: +(rng() * 0.5).toFixed(2),
        roadClass: rng() > 0.72 ? "NH" : rng() > 0.45 ? "SH" : "MDR",
        stormRamp: 1,
        escVotes: 0,
        descVotes: 0,
        history: Array.from({ length: 12 }, (_, k) => ({
          t: Date.now() - (12 - k) * 3600_000,
          level: Math.max(0, level - (k < 8 ? 1 : 0)),
          rain: Math.round(baseRain * (0.6 + rng() * 0.8)),
          prob: +(0.05 + level * 0.16 + rng() * 0.1).toFixed(2),
        })),
      };
      zones.push(zone);
    }
  }
  // keep Noney zone #2 = Tupul (backtest fixture anchor MN-NON-002)
  const tupul = zones.find((z) => z.zone_code === "MN-NON-002");
  if (tupul) {
    tupul.name = "Tupul";
    tupul.suscMean = 78.2;
    tupul.creepMmYear = 23.5;
    tupul.hazardLevel = 2;
    tupul.thresholdTier = 2;
    tupul.mlTier = 1;
    tupul.rainIntensity = 19.5;
    tupul.rain24h = 174;
    tupul.soilMoisture = 71;
  }
  return zones;
}

function buildRoads(zones: Zone[]): RoadSeg[] {
  const roads: RoadSeg[] = [];
  let n = 0;
  for (const z of zones) {
    const same = zones
      .filter((o) => o.district === z.district && o.id !== z.id)
      .map((o) => ({ o, km: haversineKm(z.center, o.center) }))
      .sort((a, b) => a.km - b.km)
      .slice(0, 2);
    for (const { o, km } of same) {
      if (roads.some((r) =>
        (r.from_zone === o.id && r.to_zone === z.id) ||
        (r.from_zone === z.id && r.to_zone === o.id))) continue;
      roads.push({
        id: `rd-${++n}`,
        name: `${z.roadClass === "NH" ? "NH" : z.roadClass === "SH" ? "SH" : "MDR"} ${z.name}–${o.name}`,
        from_zone: z.id, to_zone: o.id,
        km: +km.toFixed(1),
        cls: z.roadClass === "NH" || o.roadClass === "NH" ? "NH"
          : z.roadClass === "SH" || o.roadClass === "SH" ? "SH" : "MDR",
        forcedBlocked: false,
      });
    }
  }
  return roads;
}

function buildSensors(zones: Zone[], rng: () => number): SensorReading[] {
  const sensors: SensorReading[] = [];
  for (const z of zones) {
    const n = z.suscMean > 60 ? 2 : 1;
    for (let i = 0; i < n; i++) {
      sensors.push({
        sensor_id: `SEN-${z.zone_code}-${i + 1}`,
        zone_id: z.id,
        soil: +Math.min(96, z.soilMoisture + (rng() - 0.5) * 8).toFixed(0),
        rain_mm_h: +(Math.max(0, z.rainIntensity + (rng() - 0.5) * 4)).toFixed(1),
        battery: Math.round(58 + rng() * 42),
        online: true,
      });
    }
  }
  return sensors;
}

function seedAlerts(store: Omit<Store, "alerts">, zones: Zone[]): AlertRec[] {
  // 18 historical alerts from the last 24h — "alerts_today" baseline.
  const out: AlertRec[] = [];
  const template = (z: Zone, level: number) => ({
    zone_id: z.id, zone_code: z.zone_code, zone_name: z.name,
    district: z.district, level,
    lang: "en",
    message: `Watch: landslide risk ${["Normal", "Watch", "Alert", "Warning", "Emergency"][level]} near ${z.name}. - BhuRakshak`,
    channels: level >= 3 ? ["sms", "ivr", "siren"] : level === 2 ? ["sms", "app"] : ["app"],
    created_at: Date.now() - (1 + (out.length % 12)) * 3600_000,
    ack: level < 2,
  });
  const watch = zones.filter((z) => z.hazardLevel >= 1);
  for (const z of watch.slice(0, 18)) {
    out.push({ id: ++store.alertSeq, ...template(z, z.hazardLevel) } as AlertRec);
  }
  while (out.length < 18) {
    const z = zones[out.length % zones.length];
    out.push({ id: ++store.alertSeq, ...template(z, 1) } as AlertRec);
  }
  return out;
}

function seedReports(store: Omit<Store, "reports">, zones: Zone[]): CitizenReport[] {
  const pick = (code: string) => zones.find((z) => z.zone_code === code)!;
  const mk = (
    z: Zone, type: CitizenReport["type"], note: string,
    ageMin: number, status: CitizenReport["status"],
    verdict?: CitizenReport["verdict"],
  ): CitizenReport => ({
    id: ++store.reportSeq, zone_id: z.id, reporter: "citizen@bhrakshak.in",
    type, note,
    lat: z.center[1], lon: z.center[0], status, verdict,
    created_at: Date.now() - ageMin * 60_000,
  });
  const tupul = pick("MN-NON-002");
  const sohra = pick("MH-EKH-001");
  const durtlang = pick("MZ-AIZ-001");
  return [
    mk(tupul, "slope_movement",
      "Fresh scarp ~2m visible on the hillside above the road, stones rolling since morning.",
      34, "verified",
      { label: "Landslide scarp — active movement", confidence: 0.87 }),
    mk(sohra, "water",
      "Heavy muddy water seeping from the slope near the church, ground is saturated.",
      67, "pending",
      { label: "Slope seepage — saturation likely", confidence: 0.74 }),
    mk(durtlang, "crack",
      "Tension cracks widening on the retaining wall of the school playground.",
      112, "pending",
      { label: "Structural crack — monitor closely", confidence: 0.66 }),
  ];
}

function buildEvents(store: Store): LiveEvent[] {
  const push = (kind: LiveEvent["kind"], text: string, level?: number) => {
    store.events.unshift({ id: ++store.eventSeq, kind, text, ts: Date.now() - store.eventSeq * 60_000, level });
  };
  push("sensor", "62 IoT soil-moisture sensors online across 6 districts");
  push("risk_diff", "Noney MN-NON-002 (Tupul) held at L2 — PSInSAR creep 23.5 mm/yr", 2);
  push("risk_diff", "East Khasi Hills 3 zones under L1–L2 watch after 96 mm/24h", 2);
  push("alert", "18 alerts dispatched in the last 24h (SMS / app / IVR)", 2);
  return store.events;
}

function buildStore(): Store {
  const rng = mulberry32(20260903);
  const zones = buildZones(rng);
  const base: Store = {
    bootedAt: Date.now(),
    districts: DISTRICTS,
    zones,
    sensors: buildSensors(zones, rng),
    alerts: [],
    reports: [],
    roads: buildRoads(zones),
    shelters: SHELTER_SEED.map((s, i) => {
      const d =
        s.name.includes("Mizo") || s.name.includes("Aizawl") ? "Aizawl"
        : s.name.includes("Sohra") || s.name.includes("Mawsynram") ? "East Khasi Hills"
        : s.name.includes("Tupul") || s.name.includes("Noney") || s.name.includes("Khoupum") ? "Noney"
        : s.name.includes("Jotsoma") || s.name.includes("Zubza") ? "Kohima"
        : s.name.includes("Sikkim") || s.name.includes("Ranka") ? "Gangtok"
        : "Imphal West";
      return { id: `sh-${i + 1}`, district: d, ...s };
    }),
    events: [],
    users: USERS,
    registry: REGISTRY,
    teams: ["NDRF Alpha (Guwahati)", "NDRF Bravo (Guwahati)", "SDRF-14 Kohima",
      "SDRF-MZ Aizawl", "DDMA Noney", "DDMA EKH"],
    opsLog: [],
    chat: [],
    alertSeq: 0,
    reportSeq: 0,
    eventSeq: 0,
    lastTick: Date.now(),
    stormActive: false,
  };
  base.alerts = seedAlerts(base, zones);
  base.reports = seedReports(base, zones);
  base.chat = seedChat();
  buildEvents(base);
  return base as Store;
}

// ---------------------------------------------------------------- live chat
const FIELD_FEED: { who: string; loc: string; role: string; msg: string }[] = [
  { who: "SDRF QRT Commander", loc: "Tupul Station Yard (Noney)", role: "field_official", msg: "HQ, QRT Team 1 in position at NH-37 choke point. Satellite comms active." },
  { who: "DC Control Room", loc: "Aizawl HQ", role: "admin", msg: "Copy QRT 1. Ramping rainfall expected. Keep evacuation channels open." },
  { who: "BRO Supervisor", loc: "NH-44 EKH km 18", role: "field_official", msg: "Slip debris 60% cleared. Suggest watch level for Sohra stretch tonight." },
  { who: "Village Volunteer (Mawkynrew)", loc: "Mawkynrew", role: "citizen", msg: "Water seepage increased near the school slope. Photo uploaded via app." },
  { who: "MW i/c Aizawl", loc: "Durtlang Relay", role: "field_official", msg: "Rain 38 mm/h and rising. Creep gauge 24 mm/yr — flagged to ops queue." },
];

function seedChat(): ChatMsg[] {
  const now = Date.now();
  return FIELD_FEED.map((f, i) => ({
    id: `seed-${i + 1}`,
    sender_name: f.who,
    location: f.loc,
    message: f.msg,
    role: f.role,
    timestamp: new Date(now - (FIELD_FEED.length - i) * 240_000).toISOString(),
  }));
}

/** Slow simulated field chatter: appends at most one message per 40 s. */
export function tickChat(store: Store) {
  const last = store.chat[store.chat.length - 1];
  const lastTs = last ? Date.parse(last.timestamp) : 0;
  if (Date.now() - lastTs < 40_000) return;
  const f = FIELD_FEED[(store.chat.length + 1) % FIELD_FEED.length];
  store.chat.push({
    id: `feed-${Date.now()}`,
    sender_name: f.who,
    location: f.loc,
    message: f.msg,
    role: f.role,
    timestamp: new Date().toISOString(),
  });
  store.chat = store.chat.slice(-80);
}

// ---------------------------------------------------------------- singleton
const g = globalThis as unknown as { __bhuStore?: Store };

export function getStore(): Store {
  if (!g.__bhuStore) g.__bhuStore = buildStore();
  return g.__bhuStore;
}

/** Re-seed the world deterministically (demo reset). Keeps event feed alive. */
export function resetStore(): Store {
  const fresh = buildStore();
  const old = g.__bhuStore;
  if (old) {
    // carry over recent events so the ticker doesn't jump backwards
    fresh.events = [
      ...old.events.filter((e) => e.kind === "demo" || Date.now() - e.ts < 900_000)
        .slice(0, 6),
      ...fresh.events,
    ];
    fresh.eventSeq = old.eventSeq;
  }
  fresh.events.unshift({
    id: ++fresh.eventSeq, kind: "demo", ts: Date.now(),
    text: "Demo storm reset — world re-seeded to live-gauge baseline",
  });
  g.__bhuStore = fresh;
  return fresh;
}
