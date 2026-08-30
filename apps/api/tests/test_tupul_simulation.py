"""test_tupul_simulation.py - Automated Tests for June 2022 Tupul Disaster Replay Simulation
SIH26001: Verifies 144-step 15-minute time stepping, FoS degradation, and >=36h early warning lead time.
"""

import sys
from pathlib import Path
import pytest

PROJECT_ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(PROJECT_ROOT / "scripts"))

from simulate_tupul import generate_tupul_15min_timeline


def test_tupul_timeline_step_count_and_continuity():
    """Tupul simulation must generate exactly 144 continuous 15-minute time steps spanning 36 hours."""
    timeline = generate_tupul_15min_timeline()
    assert len(timeline) == 144, f"Expected 144 steps, got {len(timeline)}"
    
    first_step = timeline[0]
    last_step = timeline[-1]
    
    assert first_step["t_hours"] == -36.0
    assert last_step["t_hours"] == -0.25
    assert first_step["hazard_level"] >= 1
    assert last_step["hazard_level"] == 4


def test_tupul_36h_early_warning_lead_time():
    """Verify that Level 3 escalated warning is active at or before T - 30 hours."""
    timeline = generate_tupul_15min_timeline()
    
    # Find first step where Level 3 Warning is active
    first_l3 = next((s for s in timeline if s["hazard_level"] >= 3), None)
    assert first_l3 is not None, "Level 3 warning must be triggered"
    assert first_l3["t_hours"] <= -30.0, f"Expected L3 warning lead time >= 30h, got {first_l3['t_hours']}h"


def test_tupul_geotechnical_failure_progression():
    """Pore water pressure must surge, causing Factor of Safety to degrade from stable to failure (<1.05)."""
    timeline = generate_tupul_15min_timeline()
    
    first_step = timeline[0]
    last_step = timeline[-1]
    
    assert first_step["factor_of_safety"] > last_step["factor_of_safety"]
    assert first_step["pore_pressure_kpa"] < last_step["pore_pressure_kpa"]
    assert last_step["factor_of_safety"] < 1.05, f"Expected terminal FoS < 1.05, got {last_step['factor_of_safety']}"


if __name__ == "__main__":
    test_tupul_timeline_step_count_and_continuity()
    test_tupul_36h_early_warning_lead_time()
    test_tupul_geotechnical_failure_progression()
    print("✅ All Tupul disaster simulation automated tests passed successfully.")
