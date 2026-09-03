// DC directive SOPs — standard operating procedures per hazard level.
export interface Sop {
  id: string;
  label: string;
  detail: string;
}

export const SOPS_BY_LEVEL: Record<number, Sop[]> = {
  2: [
    { id: "l2-standby", label: "NDRF standby", detail: "Alert the nearest NDRF battalion (Guwahati / Itanagar) to be on 6h standby." },
    { id: "l2-eoc", label: "Activate EOC", detail: "District Emergency Operation Centre to 24x7 manning; DDMO as incident controller." },
    { id: "l2-patrol", label: "Slope patrols", detail: "Field officials to patrol NH cut-slopes twice daily; photo-log to BhuRakshak." },
  ],
  3: [
    { id: "l3-camp", label: "Open relief camps", detail: "Open school/community relief camps; verify water + ration stock for 72h." },
    { id: "l3-close", label: "Close road stretch", detail: "Close the flagged NH/SH section; deploy barricades + diversion via A* detour." },
    { id: "l3-ndrf", label: "Pre-position NDRF", detail: "Move one NDRF company with dozer + JCB to the staging point 5 km from the zone." },
    { id: "l3-evac", label: "Precautionary evacuation", detail: "Evacuate vulnerable households (within 200 m of slope toe) to shelters." },
  ],
  4: [
    { id: "l4-evac", label: "ORDER EVACUATION", detail: "Mandatory evacuation of the full zone via marked safe routes; sirens + IVR cascade." },
    { id: "l4-heli", label: "Requisition helicopters", detail: "Request IAF/State helicopter support for lift-off of cut-off hamlets." },
    { id: "l4-sdrf", label: "Deploy SDRF companies", detail: "Two SDRF companies with medical teams to the zone; triage point at shelter." },
    { id: "l4-comms", label: "Multilingual cascade", detail: "Fire SMS/IVR/siren in all 8 languages; village headmen confirm receipt." },
  ],
};

export function sopsFor(level: number): Sop[] {
  const out: Sop[] = [];
  for (let l = 2; l <= Math.min(4, level); l++) out.push(...SOPS_BY_LEVEL[l] ?? []);
  return level >= 2 ? out : [{ id: "l1-watch", label: "Continue watch", detail: "Zone under watch — no directive required while L0/L1." }];
}
