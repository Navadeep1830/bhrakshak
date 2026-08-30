"""debris_runout.py - Voellmy-Salm Shallow-Water Debris Flow Hydrodynamics
SIH26001 Zero-API Innovation:
  Computes physical debris avalanche velocity (m/s), inundation depth (m),
  and kinetic impact force (kN/m^2) along downhill terrain cross-sections
  using pure Python/NumPy with zero cloud APIs.
"""

from dataclasses import dataclass
import math
from typing import Any, Literal
import numpy as np


@dataclass
class VoellmyParams:
    """Voellmy-Salm Rheological Parameters for Himalayan Debris & Mud Cascades."""
    coulomb_friction_mu: float = 0.16     # Dry Coulomb friction coefficient (0.10 - 0.25)
    turbulent_drag_xi: float = 450.0      # Turbulent drag coefficient xi (m/s^2)
    debris_density_kg_m3: float = 2000.0  # Saturated colluvium + rock slurry density (kg/m^3)
    structure_drag_coeff_cd: float = 1.8  # Dynamic shape factor on buildings
    gravity: float = 9.81                 # Gravitational acceleration (m/s^2)


@dataclass
class RunoutStep:
    distance_m: float
    elevation_m: float
    slope_deg: float
    velocity_m_s: float
    flow_depth_m: float
    impact_pressure_kpa: float  # kN/m^2
    transit_time_sec: float
    damage_severity: Literal["NEGLIGIBLE", "MODERATE_MASONRY_DAMAGE", "SEVERE_STRUCTURAL_FAILURE", "CATASTROPHIC_OBLITERATION"]


@dataclass
class DownstreamSettlement:
    name: str
    distance_along_path_m: float
    elevation_m: float
    population_at_risk: int


@dataclass
class RunoutSimulationResult:
    scenario_name: str
    total_volume_m3: float
    total_runout_distance_m: float
    peak_velocity_m_s: float
    peak_inundation_depth_m: float
    peak_impact_pressure_kpa: float
    total_transit_duration_sec: float
    profile_steps: list[RunoutStep]
    settlement_impacts: list[dict[str, Any]]
    computational_engine: str = "Voellmy-Salm 1D Hydrodynamic Differential Solver (Pure NumPy)"


def simulate_voellmy_debris_runout(
    initial_volume_m3: float = 1_200_000.0,
    scarp_elevation_m: float = 850.0,
    valley_length_m: float = 2000.0,
    step_size_m: float = 20.0,
    params: VoellmyParams | None = None,
    settlements: list[DownstreamSettlement] | None = None,
    scenario_name: str = "Tupul 2022 Benchmark Landslide Runout",
) -> RunoutSimulationResult:
    """Computes numerical 1D shallow-water Voellmy-Salm debris flow simulation along slope transect.

    Hydrodynamic Equations:
      1. Driving and Resisting Acceleration along path s:
         a(s, v, h) = g * (sin(theta) - mu * cos(theta)) - (g * v^2) / (xi * h)
      2. Velocity Integration:
         v_{i+1} = sqrt(max(0, v_i^2 + 2 * a_i * delta_s))
      3. Dynamic Flow Depth (Mass Conservation & Channel Widening):
         h(s) = h_0 * (W_0 / W(s)) * (v_0 / max(0.5, v(s)))^0.5
      4. Kinetic Impact Pressure on Structures:
         P_impact = 0.5 * C_D * rho_debris * v^2 / 1000.0  [kPa = kN/m^2]
    """
    p = params or VoellmyParams()
    g = p.gravity
    mu = p.coulomb_friction_mu
    xi = p.turbulent_drag_xi
    rho = p.debris_density_kg_m3
    cd = p.structure_drag_coeff_cd

    # Default Himalayan terrain slope profile (concave scarp to alluvial valley transition)
    # Scarp: 38 deg -> Mid-slope: 22 deg -> Valley entrance: 12 deg -> River flat: 3.5 deg
    num_steps = int(valley_length_m / step_size_m) + 1
    s_coords = np.linspace(0.0, valley_length_m, num_steps)

    # Initial slide slab geometry
    initial_depth_h0 = max(2.5, (initial_volume_m3 / 15000.0) ** 0.5)
    initial_width_w0 = 80.0

    profile_steps: list[RunoutStep] = []
    
    current_v = 0.5  # Initial release velocity (m/s)
    current_t = 0.0
    current_elev = scarp_elevation_m
    stopped = False
    runout_distance = valley_length_m

    for i, s in enumerate(s_coords):
        # Piecewise realistic slope morphology
        if s < 300.0:
            slope_deg = 38.0 - (s / 300.0) * 10.0  # 38 -> 28 deg
            channel_w = initial_width_w0 + s * 0.1
        elif s < 900.0:
            slope_deg = 28.0 - ((s - 300.0) / 600.0) * 14.0  # 28 -> 14 deg
            channel_w = 110.0 + (s - 300.0) * 0.15
        elif s < 1500.0:
            slope_deg = 14.0 - ((s - 900.0) / 600.0) * 9.0   # 14 -> 5 deg
            channel_w = 200.0 + (s - 900.0) * 0.2
        else:
            slope_deg = max(2.0, 5.0 - ((s - 1500.0) / 500.0) * 3.0)  # 5 -> 2 deg (Alluvial deposit)
            channel_w = 320.0 + (s - 1500.0) * 0.3

        theta = math.radians(slope_deg)
        current_elev -= step_size_m * math.sin(theta)

        if stopped:
            v_step = 0.0
            h_step = max(0.5, initial_depth_h0 * 0.4)
            p_impact = 0.0
        else:
            # Dynamic flow depth conserving volume
            h_step = float(np.clip(
                initial_depth_h0 * (initial_width_w0 / max(20.0, channel_w)) * ((4.0 / max(0.5, current_v)) ** 0.4),
                0.8,
                24.0,
            ))

            # Voellmy-Salm Acceleration
            driving_accel = g * math.sin(theta)
            coulomb_resist = g * mu * math.cos(theta)
            turbulent_resist = (g * (current_v ** 2)) / max(1.0, xi * h_step)
            net_accel = driving_accel - coulomb_resist - turbulent_resist

            # Integrate velocity
            v_sq = max(0.0, (current_v ** 2) + 2.0 * net_accel * step_size_m)
            v_next = math.sqrt(v_sq)

            # Impact Pressure (kPa = kN/m^2)
            p_impact = float(0.5 * cd * rho * (current_v ** 2) / 1000.0)

            # Transit time
            avg_v = max(0.2, (current_v + v_next) / 2.0)
            current_t += step_size_m / avg_v

            current_v = v_next
            v_step = current_v

            if v_step < 0.2 and s > 400.0:
                stopped = True
                runout_distance = s

        # Damage Severity Classification
        if p_impact > 100.0:
            severity = "CATASTROPHIC_OBLITERATION"
        elif p_impact > 30.0:
            severity = "SEVERE_STRUCTURAL_FAILURE"
        elif p_impact > 5.0:
            severity = "MODERATE_MASONRY_DAMAGE"
        else:
            severity = "NEGLIGIBLE"

        profile_steps.append(RunoutStep(
            distance_m=round(float(s), 1),
            elevation_m=round(float(current_elev), 1),
            slope_deg=round(float(slope_deg), 1),
            velocity_m_s=round(float(v_step), 2),
            flow_depth_m=round(float(h_step), 2),
            impact_pressure_kpa=round(float(p_impact), 2),
            transit_time_sec=round(float(current_t), 1),
            damage_severity=severity,
        ))

    # Evaluate Downstream Settlement Impacts
    default_settlements = settlements or [
        DownstreamSettlement("Tupul 107 Territorial Army Base Camp", 820.0, 560.0, 80),
        DownstreamSettlement("Tupul Railway Bridge Construction Yard", 1150.0, 480.0, 45),
        DownstreamSettlement("Ijei River Confluence Hamlets", 1680.0, 420.0, 150),
    ]

    settlement_results = []
    for stm in default_settlements:
        # Find nearest profile step
        nearest_step = min(profile_steps, key=lambda st: abs(st.distance_m - stm.distance_along_path_m))
        settlement_results.append({
            "settlement_name": stm.name,
            "distance_m": stm.distance_along_path_m,
            "arrival_time_seconds": nearest_step.transit_time_sec,
            "arrival_time_formatted": f"{int(nearest_step.transit_time_sec // 60)}m {int(nearest_step.transit_time_sec % 60)}s",
            "impact_velocity_m_s": nearest_step.velocity_m_s,
            "impact_velocity_km_h": round(nearest_step.velocity_m_s * 3.6, 1),
            "inundation_flow_depth_m": nearest_step.flow_depth_m,
            "kinetic_impact_pressure_kpa": nearest_step.impact_pressure_kpa,
            "structural_damage_assessment": nearest_step.damage_severity,
            "population_at_risk": stm.population_at_risk,
            "mandatory_evacuation_radius_m": round(nearest_step.flow_depth_m * 18.0, 0),
        })

    velocities = [st.velocity_m_s for st in profile_steps]
    depths = [st.flow_depth_m for st in profile_steps]
    pressures = [st.impact_pressure_kpa for st in profile_steps]

    return RunoutSimulationResult(
        scenario_name=scenario_name,
        total_volume_m3=initial_volume_m3,
        total_runout_distance_m=round(runout_distance, 1),
        peak_velocity_m_s=round(float(max(velocities)), 2),
        peak_inundation_depth_m=round(float(max(depths)), 2),
        peak_impact_pressure_kpa=round(float(max(pressures)), 2),
        total_transit_duration_sec=round(float(profile_steps[-1].transit_time_sec), 1),
        profile_steps=profile_steps,
        settlement_impacts=settlement_results,
    )
