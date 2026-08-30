"""Unit tests for Module 1 (ml/ingest/weather.py).

Network-free by design: the Open-Meteo calls are exercised through the provider
interface with a stub, so these run offline and in CI.
"""

from __future__ import annotations

from datetime import date, timedelta

import numpy as np
import pandas as pd
import pytest

from ml.config.aois import get_aoi
from ml.ingest.weather import (
    IMDProvider,
    OpenMeteoProvider,
    WeatherIngestor,
    compute_features,
    effective_rainfall,
    get_provider,
)


def _hourly_frame(hours: int = 72, start: str = "2024-06-01") -> pd.DataFrame:
    ts = pd.date_range(start, periods=hours, freq="h", tz="UTC")
    rng = np.random.default_rng(7)
    return pd.DataFrame(
        {
            "ts": ts,
            "precipitation_mm": rng.gamma(0.4, 2.0, hours),
            "soil_moisture": np.linspace(0.30, 0.42, hours),
            "temperature_c": 20 + rng.normal(0, 1, hours),
            "source": "test",
        }
    )


# --- effective rainfall -----------------------------------------------------
def test_effective_rainfall_decays_after_rain_stops():
    # 10 mm in the first hour, then nothing: the index must decay, not stay flat
    series = [10.0] + [0.0] * 200
    eff = effective_rainfall(series, half_life_h=48.0)
    assert eff[0] == pytest.approx(10.0)
    assert eff[48] == pytest.approx(5.0, rel=0.02)   # halves after one half-life
    assert eff[96] == pytest.approx(2.5, rel=0.02)   # halves again
    assert eff[200] < eff[96]


def test_effective_rainfall_accumulates_while_raining():
    eff = effective_rainfall([1.0] * 100, half_life_h=48.0)
    # strictly increasing, and bounded by 1/(1-decay) mm steady state
    assert np.all(np.diff(eff) > 0)
    assert eff[-1] < 1.0 / (1.0 - 0.5 ** (1 / 48.0))


def test_effective_rainfall_handles_nan():
    out = effective_rainfall([np.nan, 5.0, np.nan], half_life_h=48.0)
    assert np.all(np.isfinite(out))


# --- feature engineering ----------------------------------------------------
def test_compute_features_adds_expected_columns():
    out = compute_features(_hourly_frame(72))
    for col in ("rain_1h", "rain_24h", "rain_48h", "rain_72h", "rain_7d",
                "eff_rain", "hour", "day_of_year", "is_monsoon"):
        assert col in out.columns, col


def test_compute_features_is_idempotent():
    once = compute_features(_hourly_frame(96))
    twice = compute_features(once)
    assert len(once) == len(twice)
    pd.testing.assert_series_equal(once["rain_24h"], twice["rain_24h"])


def test_compute_features_deduplicates_timestamps():
    df = _hourly_frame(48)
    dup = pd.concat([df, df.iloc[:10]], ignore_index=True)
    assert len(compute_features(dup)) == 48


def test_rolling_windows_are_sums_not_means():
    df = _hourly_frame(72)
    df["precipitation_mm"] = 1.0            # 1 mm every hour
    out = compute_features(df)
    # 24h window is inclusive of the current hour, so >= 24 mm once warmed up
    assert out["rain_24h"].iloc[-1] == pytest.approx(24.0, rel=0.01)
    assert out["rain_72h"].iloc[-1] == pytest.approx(72.0, rel=0.01)


def test_monsoon_flag_covers_may_to_september():
    ts = pd.date_range("2024-01-01", periods=366, freq="D", tz="UTC")
    df = pd.DataFrame({"ts": ts, "precipitation_mm": 0.0})
    out = compute_features(df)
    monsoon_months = set(out.loc[out["is_monsoon"] == 1, "ts"].dt.month)
    assert monsoon_months == {5, 6, 7, 8, 9}


# --- the unit bug this module fixed ----------------------------------------
def test_soil_moisture_converted_to_percent():
    """Open-Meteo returns m3/m3 (0.386); the app reads percent (38.6)."""
    df = _hourly_frame(24)
    df["soil_moisture"] = 0.386
    out = compute_features(df)
    assert out["soil_moisture"].iloc[0] == pytest.approx(38.6, rel=1e-3)


def test_soil_moisture_conversion_is_not_applied_twice():
    df = _hourly_frame(24)
    df["soil_moisture"] = 38.6
    once = compute_features(df)
    twice = compute_features(once)
    assert twice["soil_moisture"].iloc[0] == pytest.approx(38.6, rel=1e-3)


# --- providers --------------------------------------------------------------
def test_get_provider_defaults_to_open_meteo(monkeypatch):
    monkeypatch.delenv("BHURAKSHAK_WEATHER_PROVIDER", raising=False)
    assert isinstance(get_provider(), OpenMeteoProvider)


def test_get_provider_rejects_unknown():
    with pytest.raises(ValueError):
        get_provider("mausam")


def test_imd_provider_is_an_explicit_stub():
    """The stub must fail loudly rather than return invented weather."""
    p = IMDProvider(api_key=None)
    with pytest.raises(NotImplementedError):
        p.historical_hourly(24.0, 93.0, date(2024, 1, 1), date(2024, 1, 2))
    with pytest.raises(NotImplementedError):
        p.forecast_hourly(24.0, 93.0, 72)


# --- ingestor ---------------------------------------------------------------
class _StubProvider(OpenMeteoProvider):
    """Offline stand-in: same schema, no HTTP."""

    def historical_hourly(self, lat, lon, start, end):  # noqa: D102
        days = (end - start).days + 1
        return _hourly_frame(hours=min(days, 30) * 24, start=str(start))

    def forecast_hourly(self, lat, lon, hours=72):  # noqa: D102
        return _hourly_frame(hours=hours)


def test_cache_is_idempotent(tmp_path):
    aoi = get_aoi("MN-NON")
    ing = WeatherIngestor(aoi, provider=_StubProvider(), cache_dir=tmp_path)

    end = date(2024, 1, 30)
    start = end - timedelta(days=29)
    ing.run(start=start, end=end, forecast_hours=24)
    first = len(ing.load_cache())

    # identical second run must not duplicate or lose rows
    ing.run(start=start, end=end, forecast_hours=24)
    second = len(ing.load_cache())

    assert second == first > 0
    assert ing.load_cache()["ts"].is_unique


def test_run_reports_no_synthetic_when_data_is_real(tmp_path):
    aoi = get_aoi("MN-NON")
    ing = WeatherIngestor(aoi, provider=_StubProvider(), cache_dir=tmp_path)
    res = ing.run(start=date(2024, 1, 1), end=date(2024, 1, 30), forecast_hours=24)
    assert res["synthetic"] is False
    assert res["rows"] > 0
    assert res["db_rows_written"] == 0  # no DATABASE_URL in the test env


def test_upsert_is_a_noop_without_database(tmp_path):
    ing = WeatherIngestor(get_aoi("MN-NON"), provider=_StubProvider(), cache_dir=tmp_path)
    df = compute_features(_hourly_frame(24))
    assert ing.upsert_to_db(df, database_url=None) == 0
