import math
import sys
from pathlib import Path
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.services.geotech import (
    calculate_factor_of_safety,
    calculate_infinite_slope_stability,
    calculate_rainfall_id_threshold,
    check_rainfall_id_exceedance,
    fuse_geotech_insar_hazard,
    GeotechDiagnostic,
    GeotechParams,
)


def test_factor_of_safety_dry_stable_slope():
    """Gentle dry slope (20 deg, 0 kPa pore pressure) must yield FoS > 1.8 (Stable)."""
    fos = calculate_factor_of_safety(
        slope_angle_deg=20.0,
        pore_pressure_kpa=0.0,
        volumetric_water_content=35.0,
    )
    assert fos >= 1.8, f"Expected stable FoS >= 1.8, got {fos}"


def test_factor_of_safety_pore_pressure_surge():
    """Steep slope (38 deg) with high pore pressure surge (u = 22 kPa) must trigger critical FoS < 1.05."""
    fos = calculate_factor_of_safety(
        slope_angle_deg=38.0,
        pore_pressure_kpa=22.0,
    )
    assert fos < 1.05, f"Expected critical failure FoS < 1.05, got {fos}"


def test_factor_of_safety_saturation_proxy():
    """High soil moisture saturation (VWC = 95%) should elevate pore pressure and reduce FoS."""
    fos_dry = calculate_factor_of_safety(slope_angle_deg=32.0, volumetric_water_content=40.0)
    fos_saturated = calculate_factor_of_safety(slope_angle_deg=32.0, volumetric_water_content=95.0)
    assert fos_saturated < fos_dry, f"Saturated FoS ({fos_saturated}) must be lower than dry FoS ({fos_dry})"


def test_insar_creep_escalation():
    """Active InSAR LOS creep (-12.4 mm/yr) should escalate ML Level 2 to Level 3."""
    fused_level, summary = fuse_geotech_insar_hazard(
        ml_hazard_level=2,
        slope_angle_deg=30.0,
        pore_pressure_kpa=5.0,
        insar_creep_rate_mm_yr=-12.4,
    )
    assert fused_level >= 3, f"Expected escalated hazard level >= 3, got {fused_level}"
    assert any("InSAR" in flag for flag in summary["kinematic_flags"])


def test_tilt_acceleration_escalation():
    """Rapid tilt acceleration (1.2 deg/h) should trigger emergency escalation."""
    fused_level, summary = fuse_geotech_insar_hazard(
        ml_hazard_level=1,
        slope_angle_deg=34.0,
        tilt_rate_deg_h=1.2,
    )
    assert fused_level >= 3, f"Expected escalated hazard level >= 3, got {fused_level}"
    assert any("Tiltmeter" in flag for flag in summary["kinematic_flags"])


def test_rainfall_id_threshold_exceedance():
    """Heavy downpour (35 mm/h) breaching regional I-D curve must trigger empirical escalation."""
    i_1h_crit = calculate_rainfall_id_threshold(1.0)
    assert i_1h_crit == 14.82, f"Expected 1h threshold 14.82 mm/h, got {i_1h_crit}"
    
    check = check_rainfall_id_exceedance(rain_1h=35.0, rain_24h=160.0)
    assert check["breach_1h"] is True
    assert check["any_breach"] is True

    fused_level, summary = fuse_geotech_insar_hazard(
        ml_hazard_level=1,
        slope_angle_deg=35.0,
        pore_pressure_kpa=10.0,
        rain_1h=35.0,
        rain_24h=160.0,
    )
    assert fused_level >= 2, f"Expected hazard level >= 2 after I-D breach, got {fused_level}"
    assert any("I-D" in flag for flag in summary["kinematic_flags"])


def test_infinite_slope_stability_kinematic_diagnostics():
    """InSAR progressive creep (-24 mm/yr) should soften shear strength and return detailed stress tensor."""
    diag_stable = calculate_infinite_slope_stability(slope_angle_deg=25.0, insar_creep_rate_mm_yr=0.0)
    assert diag_stable.stability_regime == "STABLE"
    assert diag_stable.kinematic_softening_factor == 1.0
    assert diag_stable.fos > 1.8

    diag_softened = calculate_infinite_slope_stability(
        slope_angle_deg=34.0,
        pore_pressure_kpa=16.0,
        insar_creep_rate_mm_yr=-24.0,
    )
    assert diag_softened.kinematic_softening_factor < 1.0
    assert diag_softened.kinematic_softening_factor == 0.825
    assert diag_softened.pore_pressure_kpa == 16.0
    assert diag_softened.stability_regime in ("CRITICAL", "IMMINENT_FAILURE")
    assert diag_softened.fos < 1.15


def test_factor_of_safety_seismic_pseudo_static_loading():
    """Himalayan seismic loading (kh = 0.08g) should reduce FoS due to horizontal inertial driving stress."""
    fos_static = calculate_factor_of_safety(slope_angle_deg=30.0, pore_pressure_kpa=8.0, seismic_kh=0.0)
    fos_seismic = calculate_factor_of_safety(slope_angle_deg=30.0, pore_pressure_kpa=8.0, seismic_kh=0.08)
    assert fos_seismic < fos_static, f"Expected seismic FoS ({fos_seismic}) < static FoS ({fos_static})"
    assert fos_seismic > 0.5


def test_factor_of_safety_transient_seepage_ratio():
    """Rising phreatic surface (m = 0.65) must be captured in seepage_ratio_m and elevate pore pressure."""
    diag = calculate_infinite_slope_stability(
        slope_angle_deg=32.0,
        volumetric_water_content=88.0,
    )
    assert diag.seepage_ratio_m > 0.5
    assert diag.pore_pressure_kpa > 0.0
    assert diag.fos < 1.40


if __name__ == "__main__":
    test_factor_of_safety_dry_stable_slope()
    test_factor_of_safety_pore_pressure_surge()
    test_factor_of_safety_saturation_proxy()
    test_insar_creep_escalation()
    test_tilt_acceleration_escalation()
    test_rainfall_id_threshold_exceedance()
    test_infinite_slope_stability_kinematic_diagnostics()
    test_factor_of_safety_seismic_pseudo_static_loading()
    test_factor_of_safety_transient_seepage_ratio()
    print("✅ All geotechnical physics and InSAR kinematic tests passed successfully.")
