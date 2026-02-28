"""
Generate dummy insurance reserving data in long (tidy) format.

Output schema (each row is one observation):
    Class               – line of business (e.g. Motor, Property)
    Cohort              – origin period   (e.g. 2022Q1)
    Development_Period  – integer months since origin
    Type                – "Actual" or "Expected"
    Value               – cumulative claim amount

The Expected rows carry the initial expected-to-ultimate estimate
set at the origin of each cohort — i.e. the "Z" in an A-vs-Z chart.

Best Practices:
    - numpy seed for reproducibility
    - pd.DataFrame built once, not row-by-row (vectorised)
    - pathlib for cross-platform paths
    - __main__ guard so the module can also be imported
"""

from pathlib import Path
import json
from datetime import datetime

import numpy as np
import pandas as pd


# ------------------------------------------------------------------ #
#  Configuration
# ------------------------------------------------------------------ #
SEED = 42
MAX_DEV_PERIOD = 12          # quarters of development
VALUATION_DATE = "2026Q1"    # current valuation quarter

CLASSES = {
    "Motor": {
        "base_ultimate": 1_200_000,
        "growth_rate": 0.04,       # 4 % annual growth
        "dev_speed": 0.22,         # higher = faster development
        "volatility": 0.03,
    },
    "Property": {
        "base_ultimate": 900_000,
        "growth_rate": 0.06,
        "dev_speed": 0.30,
        "volatility": 0.04,
    },
    "Liability": {
        "base_ultimate": 1_500_000,
        "growth_rate": 0.03,
        "dev_speed": 0.15,         # long-tail class
        "volatility": 0.05,
    },
}

COHORTS = [
    "2022Q1", "2022Q2", "2022Q3", "2022Q4",
    "2023Q1", "2023Q2", "2023Q3", "2023Q4",
    "2024Q1", "2024Q2", "2024Q3", "2024Q4",
    "2025Q1",
]


# ------------------------------------------------------------------ #
#  Helpers
# ------------------------------------------------------------------ #
def cohort_index(cohort: str) -> int:
    """Return an integer offset (quarters since 2022Q1)."""
    year = int(cohort[:4])
    quarter = int(cohort[-1])
    return (year - 2022) * 4 + (quarter - 1)


def valuation_index() -> int:
    """How many quarters have elapsed up to the valuation date."""
    return cohort_index(VALUATION_DATE)


def cumulative_development_curve(
    dev_periods: np.ndarray,
    ultimate: float,
    speed: float,
) -> np.ndarray:
    """
    Generate a monotonically increasing development curve
    approaching `ultimate` using a shifted exponential CDF.

    Parameters
    ----------
    dev_periods : array of ints (0, 1, 2, …)
    ultimate    : expected ultimate claims
    speed       : controls how fast claims develop (higher = faster)

    Returns
    -------
    Cumulative claims at each development period.
    """
    proportion_developed = 1 - np.exp(-speed * dev_periods)
    return ultimate * proportion_developed


# ------------------------------------------------------------------ #
#  Main generator
# ------------------------------------------------------------------ #
def generate_long_data() -> pd.DataFrame:
    """
    Build the full long-format DataFrame.

    Returns a DataFrame with columns:
        Class | Cohort | Development_Period | Type | Value
    """
    rng = np.random.default_rng(SEED)
    val_idx = valuation_index()
    rows: list[dict] = []

    for cls_name, params in CLASSES.items():
        for cohort in COHORTS:
            c_idx = cohort_index(cohort)

            # How many development periods have been observed?
            max_observed = val_idx - c_idx
            if max_observed < 0:
                continue  # cohort hasn't started yet

            max_observed = min(max_observed, MAX_DEV_PERIOD)

            # Cohort-specific ultimate (grows over time + noise)
            growth_factor = (1 + params["growth_rate"]) ** (c_idx / 4)
            noise = rng.normal(1, params["volatility"])
            cohort_ultimate = params["base_ultimate"] * growth_factor * noise

            # Expected to Ultimate — set at origin, stays flat
            expected_ultimate = round(cohort_ultimate, -3)  # round to nearest 1000

            # Actual development with slight random perturbation
            dev_periods = np.arange(0, max_observed + 1)
            base_curve = cumulative_development_curve(
                dev_periods, cohort_ultimate, params["dev_speed"]
            )
            # Add realistic noise: small at early periods, larger later
            noise_scale = params["volatility"] * cohort_ultimate * 0.02
            perturbation = rng.normal(0, noise_scale, size=len(dev_periods))
            perturbation[0] = 0  # period 0 is always 0
            actuals = np.maximum(0, base_curve + np.cumsum(perturbation))

            # Ensure monotonically increasing
            actuals = np.maximum.accumulate(actuals)

            # --- Actual rows ---
            for dp, val in zip(dev_periods, actuals):
                rows.append({
                    "Class": cls_name,
                    "Cohort": cohort,
                    "Development_Period": int(dp),
                    "Type": "Actual",
                    "Value": round(float(val), 2),
                })

            # --- Expected rows (flat line from period 0 to max observed) ---
            for dp in dev_periods:
                rows.append({
                    "Class": cls_name,
                    "Cohort": cohort,
                    "Development_Period": int(dp),
                    "Type": "Expected",
                    "Value": float(expected_ultimate),
                })

    df = pd.DataFrame(rows)
    return df


# ------------------------------------------------------------------ #
#  Export
# ------------------------------------------------------------------ #
def export_json(df: pd.DataFrame, output_path: Path) -> None:
    """
    Write dashboard-ready JSON.

    Structure:
    {
        "title": "...",
        "subtitle": "...",
        "last_updated": "...",
        "classes": ["Motor", "Property", "Liability"],
        "records": [ {Class, Cohort, Development_Period, Type, Value}, … ]
    }
    """
    payload = {
        "title": "Insurance Analytics Dashboard",
        "subtitle": "A vs E Flight Path — Actual vs Expected to Ultimate",
        "last_updated": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "classes": sorted(df["Class"].unique().tolist()),
        "records": df.to_dict(orient="records"),
    }
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(payload, indent=2))
    print(f"✓ Wrote {len(df)} records to {output_path}")


# ------------------------------------------------------------------ #
#  Entry point
# ------------------------------------------------------------------ #
if __name__ == "__main__":
    df = generate_long_data()

    # Preview
    print(df.head(20).to_string(index=False))
    print(f"\nTotal rows : {len(df)}")
    print(f"Classes    : {df['Class'].unique().tolist()}")
    print(f"Cohorts    : {df['Cohort'].unique().tolist()}")
    print(f"Types      : {df['Type'].unique().tolist()}")
    print()

    # Export
    out = Path(__file__).resolve().parent.parent / "data" / "analytics.json"
    export_json(df, out)
