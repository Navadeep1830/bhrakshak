# BhuRakshak (भूरक्षक) — Scientific & Competitive Research Intelligence

## Executive Summary: Winning the Smart India Hackathon (SIH26001)

This document contains deep scientific research, comparative competitive analysis, and regulatory compliance standards compiled to ensure BhuRakshak represents an indisputable, state-of-the-art solution for landslide early warning in the North Eastern Region (NER).

---

## 1. Competitive Benchmark: BhuRakshak vs. Global & National Systems

| Feature / Dimension | NASA LHASA 2.0 (Global) | GSI NLFC / Bhukosh (India) | Standard Hackathon Projects | **BhuRakshak (भूरक्षक)** |
|---|---|---|---|---|
| **Spatial Resolution** | 1 km Global Grid | District / Sub-division scale | Fixed point mock GPS | **30m DEM + 5km H3 Hex-Grid** |
| **Cross-Validation** | Standard Random Split | Historical empirical curves | Random K-Fold (Data Leakage) | **Spatial Leave-One-District-Out (LODO)** |
| **InSAR Surface Deformation** | ❌ None | Periodic static maps | ❌ None | **Sentinel-1 PSI Line-of-Sight LOS Creep Fusion** |
| **Geotechnical IoT Integration** | ❌ None | Sparse pilot installations | Mock random sliders | **MQTT Telemetry (Borehole Tilt + Piezometer)** |
| **Physics-ML Coupling** | Pure Statistical ML | Empirical Rainfall Thresholds | Basic XGBoost / Random Forest | **Infinite Slope Factor-of-Safety (FoS) + ML** |
| **Multi-Lingual Broadcast** | English only | English / Hindi | English only | **8 NER Regional Languages + Offline TTS** |
| **Logistics & Road Clearance** | ❌ None | Manual radio broadcast | ❌ None | **Dynamic Arterial Detours (NH-29 / NH-102)** |
| **Field Offline Resilience** | ❌ Cloud-dependent | ❌ Web portal only | ❌ Cloud-dependent | **IndexedDB (Dexie.js) Offline PWA Queue** |

---

## 2. Deep Scientific Methodologies

### 2.1 Multi-Temporal InSAR Persistent Scatterer Interferometry (PSI)
- **Ascending vs. Descending Track Geometry**: In the rugged terrain of Meghalaya (East Khasi Hills) and Manipur (Noney), radar shadow and layover significantly distort single-pass SAR. BhuRakshak fuses ascending and descending Sentinel-1 passes to decompose true vertical and east-west displacement vectors.
- **Creep Velocity Thresholds**:
  - Stable: $< 5\text{ mm/year}$
  - Slow Creep (Amber Tier): $5 - 25\text{ mm/year}$
  - Rapid Acceleration (Red Tier): $> 25\text{ mm/year}$ or $> 2\text{ mm/week}$ acceleration.

### 2.2 Hydro-Mechanical Infinite Slope Stability Modeling
The dynamic physical Factor of Safety ($FoS$) is computed as:
$$FoS = \frac{c' + (\gamma \cdot z \cdot \cos^2\beta - u) \cdot \tan\phi'}{\gamma \cdot z \cdot \sin\beta \cdot \cos\beta}$$
Where:
- $c'$: Effective soil cohesion (kPa) derived from lithological strata.
- $\phi'$: Effective internal friction angle ($^\circ$).
- $\gamma$: Unit soil weight ($\text{kN/m}^3$).
- $z$: Failure plane depth ($m$).
- $\beta$: Slope inclination ($^\circ$) from 30m DEM.
- $u$: Dynamic pore-water pressure ($\text{kPa}$) ingested from vibrating wire piezometers or estimated via Antecedent Precipitation Index ($API_{72h}$).

### 2.3 IMD Doppler Weather Radar (DWR) Cloudburst Assimilation
- Integrating radar reflectivity factor ($Z$) from IMD Doppler Radars at Sohra (Cherrapunji), Agartala, and Mohanbari:
$$Z = 200 \cdot R^{1.6}$$
- Providing high-resolution 15-minute precipitation nowcasting over vulnerable arterial corridors.

---

## 3. Regulatory Alignment (NDMA & GSI Guidelines)

1. **National Disaster Management Authority (NDMA) SOP Compliance**:
   - Automated District Collector (DDMA) incident command checklists.
   - SDRF/NDRF staging area deployment prioritization based on road blockage accessibility.
2. **Geological Survey of India (GSI) 1:50,000 Susceptibility Standards**:
   - Harmonized with National Landslide Susceptibility Mapping (NLSM) lithological and structural fault datasets.
3. **Bhashini / AI4Bharat Regional Voice Synthesis**:
   - Automated translation and voice alert dispatch in Khasi, Mizo, Meitei, Assamese, Bengali, Nepali, Hindi, and English.
