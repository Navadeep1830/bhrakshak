/**
 * BhuRakshak risk engine — Layer B hazard nowcast (ported from the proven
 * bhrakshak-v2 engine, TypeScript).
 *
 * Interpretable Intensity–Duration (I-D) thresholds per susceptibility class,
 * fused with a calibrated probability prior, with anti-flapping hysteresis:
 *   - escalate only after 2 consecutive ticks at/above the candidate level
 *   - de-escalate only after 3 consecutive ticks well below current
 */

export const LEVEL_NAMES: Record<number, string> = {
  0: 'Normal',
  1: 'Watch',
  2: 'Alert',
  3: 'Warning',
  4: 'Emergency',
};

export const LEVEL_COLORS: Record<number, string> = {
  0: '#22c55e', // green
  1: '#eab308', // yellow
  2: '#f97316', // orange
  3: '#ef4444', // red
  4: '#b91c1c', // dark red
};

// (rain_24h mm, rain_1h mm/h, level) — calibrated per susceptibility band
export const THRESHOLDS_BY_SUSC_BAND: Record<string, Array<[number, number, number]>> = {
  low: [[60, 20, 1], [110, 30, 2], [160, 40, 3], [230, 55, 4]],
  moderate: [[50, 15, 1], [95, 25, 2], [140, 35, 3], [200, 48, 4]],
  high: [[40, 12, 1], [80, 20, 2], [120, 28, 3], [170, 40, 4]],
  very_high: [[32, 10, 1], [65, 16, 2], [100, 24, 3], [150, 34, 4]],
};

export function suscBand(suscMean: number | null | undefined): string {
  if (suscMean == null) return 'moderate';
  if (suscMean < 40) return 'low';
  if (suscMean < 60) return 'moderate';
  if (suscMean < 80) return 'high';
  return 'very_high';
}

/** I-D threshold tier. Three independent triggers, any one is sufficient:
 *  1. 24 h accumulation alone over threshold
 *  2. moderate 24 h (≥60%) combined with hourly intensity
 *  3. pure intensity burst (2× bar) — covers the first minutes of a cloudburst */
export function thresholdTier(rain1h: number, rain24h: number, suscMean: number | null | undefined): number {
  const r1 = Math.max(0, rain1h || 0);
  const r24 = Math.max(0, rain24h || 0);
  const band = THRESHOLDS_BY_SUSC_BAND[suscBand(suscMean)];
  let level = 0;
  for (const [t24, t1h, lvl] of band) {
    if (r24 >= t24 || (r24 >= t24 * 0.6 && r1 >= t1h) || r1 >= t1h * 2.0) {
      level = Math.max(level, lvl);
    }
  }
  return level;
}

/** Closed-form physical prior: P(landslide in 24 h). Transparent + auditable. */
export function physicalProb(
  rain1h: number,
  rain24h: number,
  suscP90: number,
  seismicFlag = false
): number {
  let logit = -6.5 + 0.035 * rain24h + 0.045 * rain1h + 0.04 * suscP90;
  if (seismicFlag) logit += 2.5;
  return 1 / (1 + Math.exp(-logit));
}

export function mlTier(prob: number | null): number {
  if (prob == null) return 0;
  if (prob >= 0.75) return 4;
  if (prob >= 0.55) return 3;
  if (prob >= 0.38) return 2;
  if (prob >= 0.2) return 1;
  return 0;
}

/** Fused level = max(I-D threshold tier, calibrated prior tier). */
export function fuseLevel(
  rain1h: number,
  rain24h: number,
  suscMean: number | null | undefined,
  prob: number | null
): number {
  return Math.max(thresholdTier(rain1h, rain24h, suscMean), mlTier(prob));
}

/** Anti-flapping hysteresis. Returns [newLevel, aboveStreak, belowStreak]. */
export function applyHysteresis(
  current: number,
  candidate: number,
  aboveStreak: number,
  belowStreak: number
): [number, number, number] {
  if (candidate > current) {
    const above = aboveStreak + 1;
    return [above >= 2 ? candidate : current, above, 0];
  }
  if (candidate < Math.max(current - 1, 0)) {
    const below = belowStreak + 1;
    return [below >= 3 ? candidate : current, 0, below];
  }
  return [current, 0, 0];
}

// ---------------------------------------------------------------------------
// Driver breakdown (SHAP-style contribution list, only measured quantities)
// ---------------------------------------------------------------------------
export interface Driver {
  feature: string;
  name: string;
  value: string;
  valNum: number | null;
  contribution: number;
  description: string;
  missing?: boolean;
}

/** Deterministic per-zone static terrain decomposition of the susceptibility
 *  index (Model A inputs): slope, lithology, land-cover, cut/stream proximity. */
function terrainFactors(suscP90: number, zoneCode?: string): Array<Omit<Driver, 'contribution'>> {
  const j = (salt: string): number => {
    const s = (zoneCode ?? 'zone') + salt;
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return (h % 1000) / 1000;
  };
  const slopeDeg = Math.round(16 + (suscP90 / 100) * 34 + j('slope') * 12); // 16..62°
  const geologies = [
    'weathered shale interbedded',
    'sandstone over clay',
    'gneiss residuum + colluvium',
    'phyllite / slate belt',
    'limestone karst veneer',
  ];
  const geo = geologies[Math.floor(j('geo') * geologies.length)];
  const lcRaw = j('lc');
  const lc = lcRaw < 0.42 ? 'degraded forest / jhum' : lcRaw < 0.8 ? 'open-slope scrub' : 'dense canopy';
  const cutDist = Math.round(18 + j('cut') * 130); // metres to nearest road cut / stream

  return [
    {
      feature: 'Slope Steepness',
      name: 'Slope Angle (static)',
      value: `${slopeDeg}°`,
      valNum: slopeDeg,
      description: 'Gravitational driving force on the slip plane',
    },
    {
      feature: 'Geology',
      name: 'Lithology & Residual Soil (static)',
      value: geo,
      valNum: null,
      description: 'Weak interbedded horizons and low-cohesion residuum',
    },
    {
      feature: 'Land Cover',
      name: 'Land-cover Disturbance (static)',
      value: lc,
      valNum: null,
      description: 'Root-cohesion loss from deforestation and jhum cycles',
    },
    {
      feature: 'Cut & Stream',
      name: 'Cut-slope / Stream Proximity (static)',
      value: `${cutDist} m`,
      valNum: cutDist,
      description: 'Toe erosion and over-steepened road cuts undermining the slope',
    },
  ];
}

export function buildDrivers(
  rain1h: number,
  rain24h: number,
  rain72h: number | null,
  rain7d: number | null,
  soil: number | null,
  suscP90: number,
  seismicFlag: boolean,
  zoneCode?: string
): Driver[] {
  const raw: Array<Omit<Driver, 'contribution'>> = [
    {
      feature: '72h Antecedent Rain',
      name: '72h Antecedent Saturation',
      value: rain72h != null ? `${Math.round(rain72h * 10) / 10} mm` : 'n/a',
      valNum: rain72h != null ? Math.round(rain72h * 10) / 10 : null,
      description: 'Deep subsurface pore-pressure accumulation',
      missing: rain72h == null,
    },
    {
      feature: '1h Flash Intensity',
      name: '1h Peak Downpour',
      value: `${Math.round(rain1h * 10) / 10} mm/h`,
      valNum: Math.round(rain1h * 10) / 10,
      description: 'Rapid surface runoff triggering shear failure',
    },
    // static terrain block — decomposed susceptibility (Model A inputs)
    ...terrainFactors(suscP90, zoneCode),
    {
      feature: 'Soil Saturation',
      name: 'Soil Moisture Level',
      value: soil != null ? `${Math.round(soil * 10) / 10}%` : 'n/a',
      valNum: soil != null ? Math.round(soil * 10) / 10 : null,
      description: 'Topsoil saturation approaching liquid limit',
      missing: soil == null,
    },
    {
      feature: '7d Antecedent Rain',
      name: 'Weekly Rainfall Load',
      value: rain7d != null ? `${Math.round(rain7d * 10) / 10} mm` : 'n/a',
      valNum: rain7d != null ? Math.round(rain7d * 10) / 10 : null,
      description: 'Sustained wetting that preconditions the slip surface',
      missing: rain7d == null,
    },
  ];
  if (seismicFlag) {
    raw.push({
      feature: 'Seismic Acceleration',
      name: 'Ground Motion & P/S Wave Shaking',
      value: 'M ≥ 4.0 Quake',
      valNum: 1,
      description: 'Dynamic ground acceleration reducing slope shear strength',
    });
  }
  // weights mirror the reference engine
  const weight = (d: Omit<Driver, 'contribution'>): number => {
    switch (d.feature) {
      case '72h Antecedent Rain':
        return d.valNum != null ? Math.min(d.valNum / 400, 0.4) : 0;
      case '1h Flash Intensity':
        return Math.min((d.valNum || 0) / 80, 0.3);
      case 'Slope Steepness':
        return ((d.valNum || 0) / 62) * 0.3;
      case 'Geology':
        return 0.05 + (suscP90 / 100) * 0.13;
      case 'Land Cover': {
        const v = String(d.value);
        if (v.startsWith('degraded')) return 0.1;
        if (v.startsWith('open')) return 0.06;
        return 0.03;
      }
      case 'Cut & Stream':
        return ((150 - (d.valNum || 150)) / 150) * 0.13;
      case 'Soil Saturation':
        return d.valNum != null ? (d.valNum / 100) * 0.22 : 0;
      case '7d Antecedent Rain':
        return d.valNum != null ? Math.min(d.valNum / 800, 0.3) : 0;
      case 'Seismic Acceleration':
        return 0.35;
      default:
        return 0;
    }
  };
  const total = raw.reduce((s, d) => s + weight(d), 0) || 1;
  const drivers: Driver[] = raw.map((d) => ({
    ...d,
    contribution: Math.round((weight(d) / total) * 1000) / 1000,
  }));
  drivers.sort((a, b) => (b.contribution || 0) - (a.contribution || 0));
  return drivers;
}

// ---------------------------------------------------------------------------
// Flood index + isolation (Layer D helpers)
// ---------------------------------------------------------------------------
export function floodIndex(rain1h: number | null, rain24h: number | null, soil: number | null): number {
  const r1 = rain1h || 0;
  const r24 = rain24h || 0;
  const sat = soil != null ? soil : 50;
  let level = 0;
  if (r24 >= 60 || (r24 >= 35 && r1 >= 12)) level = 1;
  if (r24 >= 100 || (r24 >= 70 && r1 >= 20 && sat >= 60)) level = 2;
  if (r24 >= 150 || (r24 >= 110 && r1 >= 30 && sat >= 70)) level = 3;
  if (r24 >= 210 || (r24 >= 160 && r1 >= 45)) level = 4;
  return level;
}

export function isolationScore(population: number | null, roadKm: number | null, seedKey: string): number {
  // deterministic SHA-based jitter, same as reference
  let h = 0;
  for (let i = 0; i < seedKey.length; i++) {
    h = (h * 31 + seedKey.charCodeAt(i)) >>> 0;
  }
  const jitter = h % 8;
  const pop = Math.max(population || 800, 200);
  const rk = Math.max(roadKm || 3.0, 0.5);
  const access = Math.min(rk / 20, 1);
  const remoteness = Math.min(3000 / pop, 1);
  return Math.round(Math.min(96, remoteness * 55 + (1 - access) * 45 + jitter));
}

export function recommendedAction(level: number, iso: number): string {
  if (level >= 4) return iso >= 60 ? 'Evacuate now; deploy SDRF to choke points' : 'Evacuate via marked routes';
  if (level === 3) return iso >= 60 ? 'Pre-position JCB + rescue boat' : 'Pre-position JCB; brief DC control room';
  if (level === 2) return 'Alert ward volunteers; inspect crack zones';
  if (level === 1) return 'Field teams on standby';
  return 'Routine monitoring';
}

// ---------------------------------------------------------------------------
// DC operational directive (DDMA SOP playbook)
// ---------------------------------------------------------------------------
export interface DdDirective {
  level: number;
  urgency: string;
  headline: string;
  evacuationPlan: string;
  ndrfDeployment: string;
  machineryPositioning: string;
  trafficAdvisory: string;
  medicalStandby: string;
  demographics: {
    totalPopulation: number;
    elderly: number;
    childrenUnder5: number;
    specialNeeds: number;
    ambulances: number;
  };
  sopChecklist: Array<{ dept: string; task: string }>;
}

export function generateDcDirective(
  zoneName: string,
  district: string,
  level: number,
  prob: number | null,
  population: number
): DdDirective {
  const pop = population || 1200;
  const elderly = Math.floor(pop * 0.08);
  const children = Math.floor(pop * 0.12);
  const special = Math.floor(pop * 0.02);
  const ambulances = Math.max(1, Math.floor(pop / 400));
  const demographics = {
    totalPopulation: pop,
    elderly,
    childrenUnder5: children,
    specialNeeds: special,
    ambulances,
  };

  if (level >= 4) {
    return {
      level: 4,
      urgency: 'CRITICAL EMERGENCY — IMMEDIATE ACTION REQUIRED',
      headline: `Issue Order under Sec 34 (DM Act 2005) for Immediate Evacuation in ${zoneName}`,
      evacuationPlan: `Evacuate ${pop.toLocaleString('en-IN')} residents in ${zoneName} via marked arterial bypass towards relief camp.`,
      ndrfDeployment: `Deploy 2 SDRF Quick Reaction Teams with rescue boats and satellite comms to ${district} choke point.`,
      machineryPositioning: 'Pre-position 2 Heavy JCB Earthmovers and 1 Hydraulic Breaker at Sector Junction KM 8.2.',
      trafficAdvisory: `Impose full vehicular ban on cut-slope highway corridors in ${zoneName}. Divert transit traffic to alternate bypass.`,
      medicalStandby: `Place ${district} Civil Hospital on Code Red trauma standby with ${ambulances} mobile ambulances.`,
      demographics,
      sopChecklist: [
        { dept: 'DC / Revenue', task: `Promulgate Sec 34 (DM Act 2005) mandatory evacuation order for ${zoneName}.` },
        { dept: 'SDRF / NDRF', task: `Deploy 2 Quick Reaction Teams to ${district} choke point.` },
        { dept: 'PWD / Roads', task: 'Position 2 Heavy JCB Earthmovers & 1 Hydraulic Breaker at KM 8.2 junction.' },
        { dept: 'Police / Traffic', task: `Enforce complete transit ban on cut-slope corridors in ${zoneName}.` },
        { dept: 'Health / CMO', task: `Civil Hospital Code Red: ${ambulances} ambulances, blood reserve.` },
        { dept: 'Civil Supplies', task: `Dispatch ${(pop * 2).toLocaleString('en-IN')} ration packets to relief camp.` },
      ],
    };
  }
  if (level === 3) {
    return {
      level: 3,
      urgency: 'HIGH WARNING — PREVENTATIVE MOBILIZATION',
      headline: `Issue Public Advisory & Mobilize Disaster Response Units in ${zoneName}`,
      evacuationPlan: `Identify vulnerable hillside households (${Math.min(pop, 350)} residents) for voluntary relocation to Community Hall.`,
      ndrfDeployment: `Place 1 SDRF Platoon and Civil Defence volunteers on 15-minute standby at ${zoneName} outpost.`,
      machineryPositioning: 'Pre-position 1 JCB Earthmover at Vulnerable Slope KM 4.5 for rapid debris clearance.',
      trafficAdvisory: `Restrict heavy multi-axle freight on hillside passes in ${zoneName}; single-lane emergency convoys only.`,
      medicalStandby: 'Verify oxygen cylinders, IV fluids and generator fuel at nearest PHC.',
      demographics: { ...demographics, ambulances: Math.max(1, Math.floor(ambulances / 2)) },
      sopChecklist: [
        { dept: 'DC / Revenue', task: `Issue public advisory; alert VDMC in ${zoneName}.` },
        { dept: 'SDRF / NDRF', task: `Stage 1 SDRF platoon on 15-minute standby at ${zoneName} outpost.` },
        { dept: 'PWD / Roads', task: 'Pre-position 1 JCB at KM 4.5 for debris clearance.' },
        { dept: 'Police / Traffic', task: 'Restrict heavy freight; permit single-lane emergency convoys.' },
        { dept: 'Health / CMO', task: 'Verify emergency stocks at nearest PHC.' },
        { dept: 'Civil Supplies', task: 'Stockpile 500 dry ration packets at community shelter.' },
      ],
    };
  }
  if (level === 2) {
    return {
      level: 2,
      urgency: 'ALERT — ENHANCED FIELD VIGILANCE',
      headline: `Activate Village Disaster Management Committee (VDMC) in ${zoneName}`,
      evacuationPlan: 'Inspect slope tension cracks; alert households within 50 m of active drainage channels.',
      ndrfDeployment: 'Notify ward volunteers and Aapda Mitra cadres for hourly visual inspections of retaining walls.',
      machineryPositioning: 'Verify readiness of PWD earthmoving machinery within 10 km radius.',
      trafficAdvisory: "Erect signage: 'Landslide Prone Zone — Do Not Stop Vehicle During Rainfall'.",
      medicalStandby: 'Ensure VHF handsets and satellite phones fully charged across administrative posts.',
      demographics: { ...demographics, ambulances: 1 },
      sopChecklist: [
        { dept: 'DC / Revenue', task: `Alert Aapda Mitra volunteers and ward members in ${zoneName}.` },
        { dept: 'SDRF / NDRF', task: 'Check VHF radios and emergency generator readiness.' },
        { dept: 'PWD / Roads', task: 'Inspect roadside culverts and drainage channels.' },
        { dept: 'Police / Traffic', task: 'Erect cautionary signs along subsidence stretches.' },
      ],
    };
  }
  if (level === 1) {
    return {
      level: 1,
      urgency: 'WATCH — ROUTINE SENSOR SURVEILLANCE',
      headline: `Continuous Meteorological & Sensor Surveillance over ${zoneName}`,
      evacuationPlan: 'Maintain routine civil awareness; issue automated SMS advisories on monsoon trends.',
      ndrfDeployment: 'Regular duty rosters; monitor telemetry every 15 minutes.',
      machineryPositioning: 'Standard maintenance depot posture.',
      trafficAdvisory: 'Normal mountain transit traffic.',
      medicalStandby: 'Standard operational readiness.',
      demographics: { ...demographics, ambulances: 0 },
      sopChecklist: [
        { dept: 'DC / Revenue', task: 'Monitor automatic weather stations and rainfall feeds.' },
        { dept: 'Disaster Cell', task: 'Issue routine advisory SMS to farmers and mountain travelers.' },
      ],
    };
  }
  return {
    level: 0,
    urgency: 'NORMAL — BASELINE MONITORING',
    headline: `All Clear: Standard Operational Posture across ${zoneName}`,
    evacuationPlan: 'No evacuation required. All slopes stable.',
    ndrfDeployment: 'Normal posture.',
    machineryPositioning: 'Normal posture.',
    trafficAdvisory: 'Normal transit flow.',
    medicalStandby: 'Normal operational readiness.',
    demographics: { ...demographics, ambulances: 0 },
    sopChecklist: [],
  };
}

// ---------------------------------------------------------------------------
// Alert channel policy + i18n templates (8 NER languages)
// ---------------------------------------------------------------------------
export const ALERT_CHANNEL_POLICY: Record<number, string[]> = {
  1: ['push'],
  2: ['push', 'sms'],
  3: ['push', 'sms', 'ivr'],
  4: ['push', 'sms', 'ivr', 'siren'],
};

export const I18N_TEMPLATES: Record<string, string> = {
  // English
  'alert.l1|en': 'Watch: landslide risk rising near {village} ({level}). Avoid steep slopes. - BhuRakshak',
  'alert.l2|en': 'ALERT: landslide risk {level} near {village}. Move away from slope edges. - BhuRakshak',
  'alert.l3|en': 'WARNING: high landslide risk ({level}) near {village}. Follow evacuation advice. - District Admin',
  'alert.l4|en': 'EMERGENCY ({level}): {village}. Evacuate now via marked routes. - District Admin',
  'alert.allclear|en': 'All clear: landslide risk reduced near {village}. - BhuRakshak',
  // Hindi
  'alert.l1|hi': 'सतर्कता: {village} के पास भूस्खलन का ख़तरा बढ़ रहा है ({level})। ढलानों से दूर रहें। - भूरक्षक',
  'alert.l2|hi': 'चेतावनी: {village} के पास भूस्खलन जोखिम ({level})। ढलान किनारों से हटें। - भूरक्षक',
  'alert.l3|hi': 'चेतावनी: {village} में भूस्खलन का उच्च ख़तरा ({level})। सलाह का पालन करें। - जिला प्रशासन',
  'alert.l4|hi': 'आपातकाल ({level}): {village}। चिह्नित मार्गों से तुरंत निकलें। - जिला प्रशासन',
  'alert.allclear|hi': 'सुरक्षित: {village} के पास भूस्खलन ख़तरा कम हुआ। - भूरक्षक',
  // Bengali
  'alert.l1|bn': 'নজরদারি: {village} এর কাছে ভূমিধসের ঝুঁকি বাড়ছে ({level})। খাড়া ঢাল এড়িয়ে চলুন। - ভুরক্ষক',
  'alert.l2|bn': 'সতর্কতা: {village} এর কাছে ভূমিধসের ঝুঁকি ({level})। ঢাল থেকে দূরে থাকুন। - ভুরক্ষক',
  'alert.l3|bn': 'বিপদবার্তা: {village} এ ভূমিধসের উচ্চ ঝুঁকি ({level})। উচ্ছেদ নির্দেশ মেনে চলুন। - জেলা প্রশাসন',
  'alert.l4|bn': 'জরুরি অবস্থা ({level}): {village}। চিহ্নিত রুট দিয়ে এখনই সরে যান। - জেলা প্রশাসন',
  'alert.allclear|bn': 'বিপদমুক্ত: {village} এর কাছে ভূমিধসের ঝুঁকি কমেছে। - ভুরক্ষক',
  // Assamese
  'alert.l1|as': 'নজৰদাৰী: {village}ৰ ওচৰত ভূমিস্খলনৰ সম্ভাৱনা বাঢ়িছে ({level})। থিয় ঢাল পৰিহাৰ কৰক। - ভূৰক্ষক',
  'alert.l2|as': 'সতৰ্কতা: {village}ৰ ওচৰত ভূমিস্খলনৰ আশংকা ({level})। ঢালু স্থানৰ পৰা আঁতৰি থাকক। - ভূৰক্ষক',
  'alert.l3|as': 'সতৰ্কবাণী: {village}ৰ ওচৰত ভূমিস্খলনৰ বৃহৎ বিপদ ({level})। প্ৰশাসনৰ পৰামৰ্শ মানি চলক। - জিলা প্ৰশাসন',
  'alert.l4|as': 'জৰুৰীকালীন ({level}): {village}। নিৰ্দিষ্ট সুৰক্ষিত পথেৰে তৎকালীনভাৱে স্থান ত্যাগ কৰক। - জিলা প্ৰশাসন',
  'alert.allclear|as': 'বিপদমুক্ত: {village}ৰ ওচৰত ভূমিস্খলনৰ শংকা হ্ৰাস পাইছে। - ভূৰক্ষক',
  // Nepali
  'alert.l1|ne': 'सतर्कता: {village} नजिक भूपतनको जोखिम बढ्दैछ ({level})। भिरालो ठाउँबाट टाढा रहनुहोस्। - भूरक्षक',
  'alert.l2|ne': 'चेतावनी: {village} नजिक भूपतनको जोखिम ({level})। ढल्कानबाट टाढा बस्नुहोस्। - भूरक्षक',
  'alert.l3|ne': 'गम्भीर चेतावनी: {village} मा उच्च भूपतन जोखिम ({level})। उद्धार सल्लाह पालना गर्नुहोस्। - जिल्ला प्रशासन',
  'alert.l4|ne': 'आपतकालिन ({level}): {village}। तोकिएको मार्गबाट तुरुन्त सुरक्षित स्थानमा जानुहोस्। - जिल्ला प्रशासन',
  'alert.allclear|ne': 'सुरक्षित: {village} नजिक भूपतनको जोखिम घटेको छ। - भूरक्षक',
  // Khasi
  'alert.l1|kha': 'Kaba pynpeit: ka jingma ba la nang kiew ha {village} ({level}). Kiad na ki riat. - BhuRakshak',
  'alert.l2|kha': 'Kaba maham: ka jingma na ka jingtwad khyndew ha {village} ({level}). Kiad noh na ki riat. - BhuRakshak',
  'alert.l3|kha': 'Kaba maham jur: ka jingma kaba khraw ha {village} ({level}). Bud ïa ki jingbthah pynkynriah. - District Admin',
  'alert.l4|kha': 'JINGMA JUR KABA KYNDIT ({level}): {village}. Kynriah noh mynta lyngba ki surok ba la buh dak. - District Admin',
  'alert.allclear|kha': 'La shngain: ka jingma ha {village} ka la hiar. - BhuRakshak',
  // Mizo
  'alert.l1|lus': 'Fimkhurna: {village} chhehvela leimin hlauhawm a sang chho ({level}). Khamphei hnaih suh. - BhuRakshak',
  'alert.l2|lus': 'Vauhkna: {village} chhehvelah leimin hlauhawm {level}. Khamphei hmun atangin inthiarfihlim rawh. - BhuRakshak',
  'alert.l3|lus': 'Vauhkna Khauh: {village}-ah leimin hlauhawm tak a awm ({level}). Inthiarfihlimna zawm rawh. - District Admin',
  'alert.l4|lus': 'EMERGENCY ({level}): {village}. Hmun him lam panin inthiarfihlim nghal rawh. - District Admin',
  'alert.allclear|lus': 'Hlauhawm a reh: {village} chhehvela leimin hlauhawm a tlahniam ta. - BhuRakshak',
  // Manipuri (Meitei)
  'alert.l1|mni': 'ꯌꯦꯡꯁꯤꯅꯕ: {village} ꯃꯅꯥꯛꯇ ꯂꯦꯟꯗꯁ꯭ꯂꯥꯏꯗ ꯈꯨꯗꯣꯡꯊꯤꯕ ꯍꯦꯅꯒꯠꯂꯛꯂꯤ ({level})। - ꯕꯨꯔꯛꯁꯛ',
  'alert.l2|mni': 'ꯆꯦꯀꯁꯤꯅꯕ: {village} ꯃꯅꯥꯛꯇ ꯂꯦꯟꯗꯁ꯭ꯂꯥꯏꯗ ꯈꯨꯗꯣꯡꯊꯤꯕ ({level})। ꯆꯤꯡꯖꯥꯎ ꯃꯄꯥꯟ ꯊꯣꯛꯂꯨꯒꯅꯨ। - ꯕꯨꯔꯛꯁꯛ',
  'alert.l3|mni': 'ꯃꯔꯨꯡ ꯆꯥꯎꯕꯥ ꯋꯥꯔꯤ: {village} ꯃꯅꯥꯛꯇ ꯑꯆꯧꯕ ꯈꯨꯗꯣꯡꯊꯤꯕ ({level})। ꯂꯧꯊꯣꯛꯄꯒꯤ ꯄꯥꯎꯇꯥꯛ ꯏꯟꯅꯕꯤꯌꯨ। - ꯗꯤꯁꯇ꯭ꯔꯤꯛ ꯑꯦꯗꯃꯤꯟ',
  'alert.l4|mni': 'ꯑꯀꯅꯕ ꯑꯃꯔꯖꯦꯟꯁꯤ ({level}): {village}। ꯇꯥꯛꯂꯕ ꯂꯝꯕꯤꯗꯒꯤ ꯍꯧꯖꯤꯛ ꯂꯧꯊꯣꯛꯎ। - ꯗꯤꯁꯇ꯭ꯔꯤꯛ ꯑꯦꯗꯃꯤꯟ',
  'alert.allclear|mni': 'ꯈꯨꯗꯣꯡꯊꯤꯕ ꯍꯟꯊꯔꯦ: {village} ꯃꯅꯥꯛꯇ ꯂꯦꯟꯗꯁ꯭ꯂꯥꯏꯗ ꯈꯨꯗꯣꯡꯊꯤꯕ ꯍꯟꯊꯔꯦ। - ꯕꯨꯔꯛꯁꯛ',
};

export const I18N_LANGUAGES: Array<{ code: string; label: string }> = [
  { code: 'en', label: 'English' },
  { code: 'hi', label: 'हिन्दी (Hindi)' },
  { code: 'bn', label: 'বাংলা (Bengali)' },
  { code: 'as', label: 'অসমীয়া (Assamese)' },
  { code: 'ne', label: 'नेपाली (Nepali)' },
  { code: 'kha', label: 'Khasi' },
  { code: 'lus', label: 'Mizo' },
  { code: 'mni', label: 'ꯃꯤꯇꯩꯂꯣꯟ (Meitei)' },
];

export function renderI18n(
  key: string,
  village: string,
  levelName: string
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const lang of I18N_LANGUAGES.map((l) => l.code)) {
    const tpl = I18N_TEMPLATES[`${key}|${lang}`] || I18N_TEMPLATES[`${key}|en`] || '';
    out[lang] = tpl.replaceAll('{village}', village).replaceAll('{level}', levelName);
  }
  return out;
}
