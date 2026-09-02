"""incident_commander.py - Autonomous Multi-Agent AI Incident Commander
SIH26001 Out-of-the-Box Innovation:
  1. TriageAgent: Auto-triages multi-lingual citizen & field PWA reports (8 NER languages).
  2. ResourceAllocationAgent: Dispatches nearest NDRF battalions, JCB excavators, and detour routing.
  3. OrderDraftingAgent: Drafts official bilingual DDMA Action Orders under DM Act 2005 with SHA-256 tokens.
"""

from dataclasses import dataclass
import datetime
import hashlib
import math
import re
from typing import Any, Literal
import uuid

from app.api.v1.roads import calculate_debris_clearance_estimate, CORRIDOR_PROFILES
from app.services.logistics import optimize_shelter_allocation, ReliefShelter, DEFAULT_SHELTERS


# Regional Language Taxonomy Keywords for Severity Triaging
KEYWORD_TAXONOMY = {
    "CRITICAL_TRAPPED_CASUALTIES": {
        "en": ["trapped", "buried", "people inside", "casualties", "injured", "collapsed home", "screaming"],
        "hi": ["दबे हुए", "फंसे", "मकान गिरा", "घायल", "लोग मलबे में", "मदद"],
        "bn": ["আটকে পড়া", "ধ্বংসস্তূপ", "আহত", "মানুষ চাপা", "বাড়ি ভেঙে"],
        "as": ["আবদ্ধ", "মানুহ পোতা গৈছে", "আহত", "ঘৰ ভাগিছে", "ধ্বংসাৱশেষ"],
        "ne": ["पुरिएका", "मान्छे थुनिएका", "घर भत्कियो", "घाइते", "गुहार"],
        "kha": ["shah ngam", "iap", "mynsaw", "ing ka la kyllon", "ki briew shapoh"],
        "lus": ["tang", "inchhir", "thi", "hliam", "in chim", "tanpui"],
        "mni-Mtei": ["ꯐꯥꯖꯤꯟꯕ", "ꯂꯩꯔꯝꯕ", "ꯑꯁꯣꯛ-ꯑꯄꯟ", "ꯌꯨꯝ ꯇꯨꯈ꯭ꯔꯦ", "ꯃꯇꯦꯡ"],
    },
    "MAJOR_HIGHWAY_BLOCKAGE": {
        "en": ["NH-29", "NH-102", "NH-6", "highway blocked", "nh-29", "nh-102", "road cut", "vehicles stranded", "boulder on road", "landslide block"],
        "hi": ["सड़क अवरुद्ध", "मार्ग बंद", "राष्ट्रीय राजमार्ग", "जमा हुए वाहन", "मलबा सड़क", "NH-29", "NH-102", "NH-6"],
        "bn": ["হাইওয়ে বন্ধ", "রাস্তা অবরুদ্ধ", "যানবাহন আটকে"],
        "as": ["ৰাজপথ বন্ধ", "পথ অৱৰুদ্ধ", "গাড়ী আবদ্ধ"],
        "ne": ["राजमार्ग बन्द", "बाटो बन्द", "गाडी रोकियो"],
        "kha": ["surok khang", "kali sah kut", "maw ba heh ha surok"],
        "lus": ["kawng ping", "lirthei tang", "lung lian kawngah"],
        "mni-Mtei": ["ꯂꯝꯕꯤ ꯊꯤꯡꯕ", "ꯒꯥꯔꯤ ꯂꯩꯔꯝꯕ", "ꯅꯨꯡ ꯂꯩꯕ"],
    },
    "STRUCTURAL_SLOPE_CRACK": {
        "en": ["crack in ground", "wall leaning", "water muddy", "hill moving", "tension crack", "retaining wall break"],
        "hi": ["जमीन में दरार", "दीवार झुकी", "पहाड़ खिसक रहा", "मिट्टी धंस रही"],
        "bn": ["মাটিতে ফাটল", "দেয়াল হেলে পড়া", "পাহাড় ধস"],
        "as": ["মাটিত ফাঁট", "পাহাৰ খহিছে", "দেৱাল হেলনীয়া"],
        "ne": ["जमिन फुट्यो", "पर्खाल ढल्कियो", "पहिरोको चिरा"],
        "kha": ["pait ka khyndew", "ka kynroh kyllon", "lum pait"],
        "lus": ["lei khi", "bang awn", "tlang khi"],
        "mni-Mtei": ["ꯂꯩꯃꯥꯌ ꯇꯦꯛꯄ", "ꯄꯥꯛ ꯇꯦꯛꯄ"],
    },
}


@dataclass
class TriageResult:
    severity_category: Literal["CRITICAL_TRAPPED_CASUALTIES", "MAJOR_HIGHWAY_BLOCKAGE", "VILLAGE_ACCESS_CUTOFF", "STRUCTURAL_SLOPE_CRACK", "GENERAL_MONITORING"]
    priority_score: int  # 1 (lowest) to 5 (highest emergency)
    detected_language: str
    estimated_casualties_flag: bool
    summary_en: str


@dataclass
class BattalionAssignment:
    battalion_name: str
    agency: str
    commander: str
    personnel: int
    specialty_equipment: list[str]
    staging_base: str
    transit_eta_minutes: int
    corridor_detour_used: str | None


@dataclass
class DDMAActionOrder:
    order_id: str
    act_section: str
    date_issued: str
    target_district: str
    incident_sector: str
    priority_level: str
    auth_token: str
    english_order_text: str
    regional_order_text: str
    inter_agency_tasks: list[dict[str, str]]


class TriageAgent:
    """Agent 1: Ingests raw multi-lingual distress text, detects language, and determines emergency tier."""

    def triage_report(self, text_input: str, user_lat: float, user_lon: float) -> TriageResult:
        normalized_text = text_input.lower()
        
        # 1. Detect language by matching keywords
        detected_lang = "en"
        highest_matches = 0

        for category, lang_dict in KEYWORD_TAXONOMY.items():
            for lang, kws in lang_dict.items():
                matches = sum(1 for kw in kws if kw.lower() in normalized_text)
                if matches > highest_matches:
                    highest_matches = matches
                    detected_lang = lang

        # 2. Classify Severity Tier
        severity: Literal["CRITICAL_TRAPPED_CASUALTIES", "MAJOR_HIGHWAY_BLOCKAGE", "VILLAGE_ACCESS_CUTOFF", "STRUCTURAL_SLOPE_CRACK", "GENERAL_MONITORING"] = "GENERAL_MONITORING"
        priority = 1
        casualties_flag = False

        for kw in KEYWORD_TAXONOMY["CRITICAL_TRAPPED_CASUALTIES"].get(detected_lang, []) + KEYWORD_TAXONOMY["CRITICAL_TRAPPED_CASUALTIES"]["en"]:
            if kw in normalized_text:
                severity = "CRITICAL_TRAPPED_CASUALTIES"
                priority = 5
                casualties_flag = True
                break

        if severity == "GENERAL_MONITORING":
            for kw in KEYWORD_TAXONOMY["MAJOR_HIGHWAY_BLOCKAGE"].get(detected_lang, []) + KEYWORD_TAXONOMY["MAJOR_HIGHWAY_BLOCKAGE"]["en"]:
                if kw in normalized_text:
                    severity = "MAJOR_HIGHWAY_BLOCKAGE"
                    priority = 4
                    break

        if severity == "GENERAL_MONITORING":
            for kw in KEYWORD_TAXONOMY["STRUCTURAL_SLOPE_CRACK"].get(detected_lang, []) + KEYWORD_TAXONOMY["STRUCTURAL_SLOPE_CRACK"]["en"]:
                if kw in normalized_text:
                    severity = "STRUCTURAL_SLOPE_CRACK"
                    priority = 3
                    break

        # Generate English summary
        summary_en = f"Triage Alert: {severity.replace('_', ' ')} detected in sector near ({user_lat:.3f}, {user_lon:.3f}). Priority Level: {priority}/5."

        return TriageResult(
            severity_category=severity,
            priority_score=priority,
            detected_language=detected_lang,
            estimated_casualties_flag=casualties_flag,
            summary_en=summary_en,
        )


class ResourceAllocationAgent:
    """Agent 2: Allocates optimal NDRF/SDRF battalions, JCB excavators, and detour routing."""

    AVAILABLE_BATTALIONS = [
        {
            "name": "12th NDRF Battalion (Imphal Detachment)",
            "agency": "NDRF",
            "commander": "Insp. R. K. Singh",
            "personnel": 35,
            "equipment": ["Acoustic Victim Search Cameras", "Life Detectors", "Inflatable Rescue Boats"],
            "base": "Imphal / Noney Forward Post",
            "lat": 24.8105,
            "lon": 93.6820,
        },
        {
            "name": "1st NDRF Battalion (Kohima Sector)",
            "agency": "NDRF",
            "commander": "Asst. Comdt. V. Sharma",
            "personnel": 40,
            "equipment": ["Search & Rescue K9 Unit", "Pneumatic Shoring", "Thermal Drone Pack"],
            "base": "Medziphema Heavy Logistics Base",
            "lat": 25.7550,
            "lon": 93.8700,
        },
        {
            "name": "Mizoram SDRF Platoon 2",
            "agency": "SDRF",
            "commander": "Sub-Insp. K. Lalthanga",
            "personnel": 25,
            "equipment": ["High-Angle Rope Rescue Kit", "Hydraulic Cutters", "Portable Generators"],
            "base": "Aizawl Emergency Center",
            "lat": 23.7325,
            "lon": 92.7155,
        },
        {
            "name": "Meghalaya SDRF Quick Response Unit",
            "agency": "SDRF",
            "commander": "Sub-Insp. D. Marbaniang",
            "personnel": 20,
            "equipment": ["Heavy Dewatering Pumps", "Mud Chainsaws", "Trauma Medical Backpacks"],
            "base": "Sohra Civil Staging Post",
            "lat": 25.2800,
            "lon": 91.7200,
        },
    ]

    def allocate_resources(
        self,
        triage: TriageResult,
        incident_lat: float,
        incident_lon: float,
        district: str,
    ) -> dict[str, Any]:
        # 1. Find nearest NDRF/SDRF battalion via Haversine distance
        def dist_km(b):
            lat1, lon1 = math.radians(incident_lat), math.radians(incident_lon)
            lat2, lon2 = math.radians(b["lat"]), math.radians(b["lon"])
            dlat = lat2 - lat1
            dlon = lon2 - lon1
            a = math.sin(dlat / 2)**2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2)**2
            return 6371.0 * (2 * math.asin(math.sqrt(a)))

        nearest_battalion = min(self.AVAILABLE_BATTALIONS, key=dist_km)
        d_km = dist_km(nearest_battalion)
        
        # Estimate transit time with mountain road transit factor (35 km/h)
        base_transit_mins = max(15, int((d_km / 35.0) * 60))

        # 2. Check if arterial road blockage requires detour routing
        corridor = "NH-29" if ("Kohima" in district or "Dimapur" in district) else ("NH-102" if "Thoubal" in district or "Noney" in district else "NH-6")
        detour_info = CORRIDOR_PROFILES.get(corridor, CORRIDOR_PROFILES["NH-29"])
        
        # 3. Heavy Machinery & Clearance Allocation
        jcb_needed = 4 if triage.priority_score >= 4 else 2
        dump_trucks_needed = jcb_needed * 2
        clearance_est = calculate_debris_clearance_estimate(
            corridor=corridor,
            debris_volume_m3=1600.0 if triage.priority_score >= 4 else 800.0,
            jcb_count=jcb_needed,
            dump_trucks=dump_trucks_needed,
        )

        # 4. Nearest Shelter Allocation
        shelter_plan = optimize_shelter_allocation(
            displaced_population=350 if triage.priority_score >= 4 else 100,
            zone_lat=incident_lat,
            zone_lon=incident_lon,
            district=district,
        )

        assignment = BattalionAssignment(
            battalion_name=nearest_battalion["name"],
            agency=nearest_battalion["agency"],
            commander=nearest_battalion["commander"],
            personnel=nearest_battalion["personnel"],
            specialty_equipment=nearest_battalion["equipment"],
            staging_base=nearest_battalion["base"],
            transit_eta_minutes=base_transit_mins + 20,  # +20 min mountain convoy margin
            corridor_detour_used=f"{detour_info['name']} Bypass Route",
        )

        return {
            "assigned_battalion": assignment,
            "heavy_machinery": {
                "jcb_excavators": jcb_needed,
                "dump_trucks": dump_trucks_needed,
                "staging_depot": clearance_est.machinery_staging_junction,
                "single_lane_eta_hours": clearance_est.single_lane_restoration_hours,
                "full_clearance_eta_hours": clearance_est.full_reopening_eta_hours,
            },
            "shelter_evacuation": shelter_plan,
        }


class OrderDraftingAgent:
    """Agent 3: Drafts official bilingual DDMA Action Orders under DM Act 2005 with cryptographic SHA-256 tokens."""

    def draft_order(
        self,
        triage: TriageResult,
        allocation: dict[str, Any],
        incident_sector: str,
        district: str,
    ) -> DDMAActionOrder:
        order_uuid = uuid.uuid4().hex[:8].upper()
        order_id = f"DDMA/{district.upper()}/EMERG/{datetime.datetime.now().strftime('%Y%m%d')}/{order_uuid}"
        now_str = datetime.datetime.now(datetime.timezone.utc).strftime("%d %B %Y, %H:%M UTC")

        b_assign = allocation["assigned_battalion"]
        heavy = allocation["heavy_machinery"]

        # English Order Text
        en_text = (
            f"OFFICE OF THE DEPUTY COMMISSIONER & CHAIRMAN, DDMA {district.upper()}\n"
            f"ORDER UNDER SECTION 30 & 34 OF DISASTER MANAGEMENT ACT, 2005\n\n"
            f"WHEREAS, an emergent landslide catastrophe (Category: {triage.severity_category}) has been triaged in {incident_sector}.\n"
            f"THEREFORE, IT IS HEREBY ORDERED:\n"
            f"1. {b_assign.battalion_name} under {b_assign.commander} is mobilized immediately with {b_assign.specialty_equipment[0]}.\n"
            f"2. PWD Mechanical Division shall stage {heavy['jcb_excavators']} JCB excavators at {heavy['staging_depot']}.\n"
            f"3. Traffic on blocked corridor shall be diverted via {b_assign.corridor_detour_used}.\n"
            f"4. Evacuees shall be routed to designated relief shelters with immediate food and potable water stockpiling."
        )

        # Regional Language Translation
        lang = triage.detected_language
        if lang == "hi":
            reg_text = (
                f"जिला आपदा प्रबंधन प्राधिकरण (DDMA) {district} - आपातकालीन आदेश\n"
                f"आपदा प्रबंधन अधिनियम 2005 की धारा 30 और 34 के तहत:\n"
                f"{incident_sector} में भूस्खलन की सूचना पर त्वरित कार्रवाई का निर्देश दिया जाता है।\n"
                f"1. {b_assign.battalion_name} को तुरंत घटनास्थल पर खोज एवं बचाव कार्य हेतु तैनात किया जाए।\n"
                f"2. पीडब्ल्यूडी विभाग {heavy['jcb_excavators']} जेसीबी मशीनों को मलबा हटाने हेतु तत्काल रवाना करे।\n"
                f"3. प्रभावित क्षेत्र से नागरिकों को राहत शिविरों में स्थानांतरित किया जाए।"
            )
        elif lang == "kha":
            reg_text = (
                f"KOPHI KA DISTRICT DISASTER MANAGEMENT AUTHORITY (DDMA) {district}\n"
                f"KA HUKUM HAPOH KA KYNDON 30 & 34 JONG KA DISASTER MANAGEMENT ACT, 2005\n"
                f"Namarkaba don ka jingtwad khyndew ha {incident_sector}:\n"
                f"1. Ka kynhun {b_assign.battalion_name} ka dei ban leit mar-mar ban iarap ia ki briew.\n"
                f"2. Ka PWD ka dei ban phah {heavy['jcb_excavators']} tylli ki JCB ban pynkhuid ia ka surok.\n"
                f"3. Rah ia ki briew sha ki jaka shong basa ba la pynkhreh."
            )
        elif lang == "lus":
            reg_text = (
                f"DDMA {district.upper()} THUPEK (DISASTER MANAGEMENT ACT 2005)\n"
                f"{incident_sector} hmuna lei min avanga hmalakna:\n"
                f"1. {b_assign.battalion_name} te chu chanchhuah hna thawk turin tirh nghal an ni.\n"
                f"2. PWD ten JCB {heavy['jcb_excavators']} kawng sial turin an tir nghal ang.\n"
                f"3. Mipuite chu himna hmun/relief camp lamah hruai an ni ang."
            )
        elif lang == "mni-Mtei":
            reg_text = (
                f"DDMA {district.upper()} ꯒꯤ ꯑꯀꯅꯕ ꯊꯧꯔꯥꯡ (DM ACT 2005)\n"
                f"{incident_sector} ꯗ ꯆꯤꯡ ꯂꯦꯟꯕꯒꯤ ꯊꯧꯗꯣꯛꯇ:\n"
                f"1. {b_assign.battalion_name} ꯅ ꯀꯟꯕꯒꯤ ꯊꯕꯛ ꯊꯨꯅ ꯆꯠꯊꯕꯤꯌꯨ।\n"
                f"2. PWD ꯅ JCB {heavy['jcb_excavators']} ꯊꯨꯅ ꯊꯥꯔꯛꯎ।\n"
                f"3. ꯃꯤꯌꯥꯝꯕꯨ ꯁꯦꯐ ꯀꯦꯝꯄꯇ ꯄꯨꯊꯣꯛꯎ।"
            )
        else:
            # Default to Hindi / English Bilingual
            reg_text = (
                f"DDMA {district.upper()} EMERGENCY ACTION DIRECTIVE\n"
                f"Action initiated under DM Act 2005 Sec 30/34. Emergency SDRF/NDRF teams mobilized."
            )

        # Cryptographic Signature Token
        payload_token = f"{order_id}:{triage.severity_category}:{district}:{now_str}"
        auth_hash = f"SHA256:{hashlib.sha256(payload_token.encode()).hexdigest()[:24].upper()}"

        tasks = [
            {"agency": "Police / Traffic Control", "action": f"Close blocked corridor and enforce one-way convoy on {b_assign.corridor_detour_used}."},
            {"agency": "PWD Heavy Mechanical", "action": f"Mobilize {heavy['jcb_excavators']} JCB excavators from {heavy['staging_depot']}."},
            {"agency": "Health & Family Welfare", "action": "Deploy 2 Mobile Medical Units with blood units to staging base."},
            {"agency": "Food & Civil Supplies", "action": "Stockpile 1,000 dry ration packets and 5,000L drinking water at designated relief camps."},
        ]

        return DDMAActionOrder(
            order_id=order_id,
            act_section="DM Act 2005 Section 30 & 34",
            date_issued=now_str,
            target_district=district,
            incident_sector=incident_sector,
            priority_level=f"PRIORITY-{triage.priority_score} (CRITICAL)",
            auth_token=auth_hash,
            english_order_text=en_text,
            regional_order_text=reg_text,
            inter_agency_tasks=tasks,
        )


class AIIncidentCommander:
    """Master Coordinator: Orchestrates Triage, Resource Allocation, and DDMA Order Drafting."""

    def __init__(self):
        self.triage_agent = TriageAgent()
        self.allocation_agent = ResourceAllocationAgent()
        self.order_agent = OrderDraftingAgent()

    def coordinate_incident(
        self,
        report_text: str,
        user_lat: float | None = None,
        user_lon: float | None = None,
        district: str = "Noney",
        incident_sector: str = "Tupul Railway Corridor KM 8.2",
        incident_lat: float | None = None,
        incident_lon: float | None = None,
        **kwargs: Any,
    ) -> dict[str, Any]:
        """Executes full autonomous multi-agent incident command pipeline."""
        lat = user_lat if user_lat is not None else (incident_lat if incident_lat is not None else 25.10)
        lon = user_lon if user_lon is not None else (incident_lon if incident_lon is not None else 93.70)
        # 1. Triage
        triage_res = self.triage_agent.triage_report(report_text, lat, lon)

        # 2. Resource Allocation & Routing
        alloc_res = self.allocation_agent.allocate_resources(triage_res, lat, lon, district)

        # 3. Official Bilingual DDMA Action Order
        order_res = self.order_agent.draft_order(triage_res, alloc_res, incident_sector, district)

        return {
            "status": "TRIAGED_AND_DISPATCHED",
            "triage": {
                "severity_category": triage_res.severity_category,
                "priority_score": triage_res.priority_score,
                "detected_language": triage_res.detected_language,
                "casualties_reported": triage_res.estimated_casualties_flag,
                "summary": triage_res.summary_en,
            },
            "dispatch_plan": {
                "battalion": alloc_res["assigned_battalion"].__dict__,
                "heavy_machinery": alloc_res["heavy_machinery"],
                "shelter_allocation": alloc_res["shelter_evacuation"],
            },
            "ddma_action_order": order_res.__dict__,
        }


# Singleton instance for service usage
incident_commander = AIIncidentCommander()
