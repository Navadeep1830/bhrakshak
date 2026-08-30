"""geotech.py - Geotechnical Physics & IoT Sensor Fusion Engine
SIH26001: Physical Factor-of-Safety (FoS), Pore-Water Pressure, InSAR Creep & Tiltmeter Analytics.
"""

from dataclasses import dataclass
import math
import numpy as np


@dataclass
class GeotechParams:
    cohesion_kpa: float = 12.5       # Effective soil cohesion c' (kPa)
    friction_angle_deg: float = 28.0 # Effective internal friction angle phi' (deg)
    soil_unit_weight: float = 19.0   # Saturated soil unit weight gamma (kN/m^3)
    water_unit_weight: float = 9.81  # Water unit weight gamma_w (kN/m^3)
    slip_depth_m: float = 2.5        # Estimated failure plane depth z (m)
    residual_friction_deg: float = 22.0 # Residual friction angle under high strain
    seismic_kh: float = 0.0          # Pseudo-static horizontal seismic acceleration (Zone V NER: 0.0-0.12g)


@dataclass
class GeotechDiagnostic:
    fos: float
    shear_strength_kpa: float
    driving_stress_kpa: float
    effective_normal_stress_kpa: float
    pore_pressure_kpa: float
    kinematic_softening_factor: float
    pore_pressure_ratio_ru: float
    seepage_ratio_m: float
    stability_regime: str  # "STABLE", "MARGINAL", "CRITICAL", "IMMINENT_FAILURE"


def calculate_infinite_slope_stability(
    slope_angle_deg: float,
    pore_pressure_kpa: float | None = None,
    volumetric_water_content: float | None = None,
    insar_creep_rate_mm_yr: float = 0.0,
    seismic_kh: float = 0.0,
    params: GeotechParams | None = None,
) -> GeotechDiagnostic:
    """Computes physical infinite slope stability fused with Sentinel-1 InSAR kinematic strain-softening and pseudo-static seismic loading.

    Physics Equations:
      1. Seepage Ratio: m = h_water / z
      2. Pseudo-static Normal Stress:
         sigma = gamma_soil * z * cos^2(beta) - kh * gamma_soil * z * sin(beta) * cos(beta)
      3. Effective Normal Stress:
         sigma' = max(0.5, sigma - u)
      4. InSAR Kinematic Strain Softening:
         eta_kinematic = max(0.65, 1.0 - (|v_LOS| / 40.0)) when |v_LOS| >= 8.0 mm/yr
      5. Available Shear Strength:
         tau_resisting = eta_kinematic * (c' + sigma' * tan(phi'))
      6. Driving Shear Stress (Gravitational + Pseudo-Static Inertia):
         tau_driving = gamma_soil * z * sin(beta) * cos(beta) + kh * gamma_soil * z * cos^2(beta)
      7. Factor of Safety:
         FoS = tau_resisting / tau_driving
    """
    p = params or GeotechParams()
    kh = max(0.0, float(seismic_kh or p.seismic_kh))
    beta = math.radians(max(slope_angle_deg, 5.0))
    phi = math.radians(p.friction_angle_deg)

    # 1. Pore-Water Pressure & Seepage Ratio Estimation
    cos2 = math.cos(beta) ** 2

    if pore_pressure_kpa is not None:
        # Measured directly, so it is already a pressure -- no geometry applies.
        u = max(float(pore_pressure_kpa), 0.0)
        h_water = min(p.slip_depth_m, u / p.water_unit_weight / max(cos2, 1e-6))
        seepage_m = h_water / max(0.1, p.slip_depth_m)
    elif volumetric_water_content is not None:
        # Hydrostatic seepage proxy from soil saturation %
        sat_ratio = max(0.0, min(1.0, float(volumetric_water_content) / 100.0))
        seepage_m = max(0.0, min(1.0, (sat_ratio - 0.65) / 0.35))
        h_water = p.slip_depth_m * seepage_m
        # Pore pressure is gamma_w times the VERTICAL depth of water standing
        # above the slip surface. With slip depth taken vertically and seepage
        # parallel to the slope, that head is h_water * cos^2(beta) -- the same
        # cos^2 the normal-stress term below carries. Previously the factor was
        # dropped, overstating u by 1/cos^2 (33% at a 30 degree slope, 100% at
        # 45), which understates FoS and makes the system over-alarm.
        u = h_water * p.water_unit_weight * cos2
    else:
        u = 0.0
        seepage_m = 0.0

    # 2. Stress Tensor Calculations with Pseudo-Static Seismic Loading (Himalayan Zone V)
    w_col = p.soil_unit_weight * p.slip_depth_m
    total_normal_stress = w_col * (math.cos(beta) ** 2) - kh * w_col * math.sin(beta) * math.cos(beta)
    effective_normal_stress = max(total_normal_stress - u, 0.5)
    pore_pressure_ratio = u / max(0.1, w_col)

    # 3. Sentinel-1 InSAR Kinematic Strain-Softening Coefficient
    abs_creep = abs(float(insar_creep_rate_mm_yr))
    if abs_creep >= 8.0:
        # Progressive shear strain degrades peak cohesion towards residual state
        kinematic_factor = max(0.65, 1.0 - ((abs_creep - 8.0) / 32.0) * 0.35)
    else:
        kinematic_factor = 1.0

    # 4. Limit-Equilibrium Resisting vs Driving Shear Stress
    cohesion_effective = p.cohesion_kpa * kinematic_factor
    shear_strength = cohesion_effective + effective_normal_stress * math.tan(phi)
    driving_shear_stress = w_col * math.sin(beta) * math.cos(beta) + kh * w_col * (math.cos(beta) ** 2)

    if driving_shear_stress <= 0.01:
        fos = 5.0
    else:
        fos = float(np.clip(shear_strength / driving_shear_stress, 0.2, 5.0))

    # 5. Geotechnical Stability Regime Classification
    if fos < 1.05:
        regime = "IMMINENT_FAILURE"
    elif fos < 1.30:
        regime = "CRITICAL"
    elif fos < 1.60:
        regime = "MARGINAL"
    else:
        regime = "STABLE"

    return GeotechDiagnostic(
        fos=round(fos, 2),
        shear_strength_kpa=round(shear_strength, 2),
        driving_stress_kpa=round(driving_shear_stress, 2),
        effective_normal_stress_kpa=round(effective_normal_stress, 2),
        pore_pressure_kpa=round(u, 2),
        kinematic_softening_factor=round(kinematic_factor, 3),
        pore_pressure_ratio_ru=round(pore_pressure_ratio, 3),
        seepage_ratio_m=round(seepage_m, 3),
        stability_regime=regime,
    )


def calculate_factor_of_safety(
    slope_angle_deg: float,
    pore_pressure_kpa: float | None = None,
    volumetric_water_content: float | None = None,
    insar_creep_rate_mm_yr: float = 0.0,
    seismic_kh: float = 0.0,
    params: GeotechParams | None = None,
) -> float:
    """Computes the limit-equilibrium Factor of Safety (FoS) for an infinite slope."""
    diag = calculate_infinite_slope_stability(
        slope_angle_deg=slope_angle_deg,
        pore_pressure_kpa=pore_pressure_kpa,
        volumetric_water_content=volumetric_water_content,
        insar_creep_rate_mm_yr=insar_creep_rate_mm_yr,
        seismic_kh=seismic_kh,
        params=params,
    )
    return diag.fos


def calculate_rainfall_id_threshold(
    duration_hours: float,
    alpha: float = 14.82,  # Regional Himalayan / NER scaling parameter
    beta: float = 0.39,   # Power-law slope parameter
) -> float:
    """Computes critical empirical rainfall intensity threshold I_crit (mm/h) for duration D (hours).
    Based on Caine (1980) & Guzzetti (2007) regionalized calibration for North East India.
    I_crit = alpha * (D ^ -beta)
    """
    d = max(0.5, float(duration_hours))
    return round(alpha * (d ** -beta), 2)


def check_rainfall_id_exceedance(
    rain_1h: float,
    rain_24h: float,
    rain_72h: float | None = None,
) -> dict:
    """Checks if observed storm intensities breach empirical Intensity-Duration failure envelopes."""
    i_1h_crit = calculate_rainfall_id_threshold(1.0)
    i_24h_crit = calculate_rainfall_id_threshold(24.0)
    
    i_24h_mean = rain_24h / 24.0
    breach_1h = rain_1h >= i_1h_crit
    breach_24h = i_24h_mean >= i_24h_crit

    return {
        "i_1h_observed": rain_1h,
        "i_1h_critical": i_1h_crit,
        "breach_1h": breach_1h,
        "i_24h_mean_observed": round(i_24h_mean, 2),
        "i_24h_critical": i_24h_crit,
        "breach_24h": breach_24h,
        "any_breach": breach_1h or breach_24h,
    }


def fuse_geotech_insar_hazard(
    ml_hazard_level: int,
    slope_angle_deg: float,
    pore_pressure_kpa: float | None = None,
    volumetric_water_content: float | None = None,
    insar_creep_rate_mm_yr: float | None = None,
    tilt_rate_deg_h: float | None = None,
    rain_1h: float | None = None,
    rain_24h: float | None = None,
) -> tuple[int, dict]:
    """Fuses machine learning nowcast with physical geotechnical FoS, InSAR kinematics, and I-D curves."""
    fos = calculate_factor_of_safety(
        slope_angle_deg=slope_angle_deg,
        pore_pressure_kpa=pore_pressure_kpa,
        volumetric_water_content=volumetric_water_content,
    )
    
    geotech_tier = 0
    if fos < 1.05:
        geotech_tier = 4  # Direct physical failure
    elif fos < 1.30:
        geotech_tier = 3  # Critical creep threshold
    elif fos < 1.55:
        geotech_tier = 2  # Elevated shear stress
    elif fos < 1.80:
        geotech_tier = 1

    # Kinematic & Empirical I-D Escalation
    kinematic_flags = []
    escalation = 0
    
    if insar_creep_rate_mm_yr is not None and abs(insar_creep_rate_mm_yr) >= 8.0:
        escalation = max(escalation, 1)
        kinematic_flags.append(f"InSAR LOS subsidence {insar_creep_rate_mm_yr:.1f} mm/yr exceeds threshold")
        
    if tilt_rate_deg_h is not None and abs(tilt_rate_deg_h) >= 0.35:
        escalation = max(escalation, 2 if abs(tilt_rate_deg_h) >= 1.0 else 1)
        kinematic_flags.append(f"Tiltmeter acceleration {tilt_rate_deg_h:.2f} deg/h detected")

    id_check = None
    if rain_1h is not None and rain_24h is not None:
        id_check = check_rainfall_id_exceedance(rain_1h, rain_24h)
        if id_check["any_breach"] and fos < 1.45:
            escalation = max(escalation, 1)
            kinematic_flags.append("Rainfall Intensity-Duration (I-D) empirical failure envelope breached")

    fused_level = min(4, max(ml_hazard_level, geotech_tier) + escalation)

    summary = {
        "factor_of_safety": fos,
        "geotech_tier": geotech_tier,
        "ml_hazard_level": ml_hazard_level,
        "fused_level": fused_level,
        "pore_pressure_kpa": pore_pressure_kpa,
        "insar_creep_mm_yr": insar_creep_rate_mm_yr,
        "kinematic_flags": kinematic_flags,
        "id_threshold_check": id_check,
    }
    return fused_level, summary
