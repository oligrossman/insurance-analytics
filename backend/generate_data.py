"""
Generate dummy insurance reserving data in long (tidy) format.

Output schema — records table (each row is one observation):
    Class               – line of business (e.g. Motor, Property)
    Cohort              – origin period   (e.g. 2022Q1)
    Development_Period  – integer quarters since origin
    Type                – "Actual" or "Expected"
    Value               – cumulative claim amount

Output schema — ultimates table (one row per Class × Cohort × Method):
    Class    – line of business
    Cohort   – origin period
    Method   – method key (e.g. "Pegged / Unpegged / Fixed")
    Pattern  – pattern assumption (Pegged / Unpegged / Fixed)
    IE       – initial expected assumption (Pegged / Unpegged / Fixed)
    Approach – method assumption (Pegged / Unpegged / Fixed)
    Ultimate – estimated ultimate claims from that method

Output schema — method_scores table (one row per Class × Method):
    Class          – line of business
    Method         – method key
    Pattern, IE, Approach – assumption labels
    Reserve_Det    – reserve determination score [0, 1]
    Proj_Quality   – projection quality score [0, 1]

Methods are defined by three assumption dimensions:
    - Pattern:  Pegged / Unpegged / Fixed
    - IE:       Pegged / Unpegged / Fixed
    - Approach: Pegged / Unpegged / Fixed
    → 3 × 3 × 3 = 27 combinations

Best Practices:
    - numpy seed for reproducibility
    - itertools.product for clean combinatorics
    - pd.DataFrame built once, not row-by-row
    - pathlib for cross-platform paths
    - __main__ guard so the module can also be imported
"""

from pathlib import Path
from itertools import product
import json
from datetime import datetime

import numpy as np
import pandas as pd


# ------------------------------------------------------------------ #
#  Configuration
# ------------------------------------------------------------------ #
SEED = 42
MAX_DEV_PERIOD = 12
VALUATION_DATE = "2026Q1"

CLASSES = {
    "Motor": {
        "base_ultimate": 1_200_000,
        "growth_rate": 0.04,
        "dev_speed": 0.22,
        "volatility": 0.03,
        "trend_accel": 0.012,
        "large_loss_threshold": 100_000,
    },
    "Property": {
        "base_ultimate": 900_000,
        "growth_rate": 0.06,
        "dev_speed": 0.30,
        "volatility": 0.04,
        "trend_accel": 0.015,
        "large_loss_threshold": 75_000,
    },
    "Liability": {
        "base_ultimate": 1_500_000,
        "growth_rate": 0.03,
        "dev_speed": 0.15,
        "volatility": 0.05,
        "trend_accel": 0.010,
        "large_loss_threshold": 150_000,
    },
}

COHORTS = [
    "2022Q1", "2022Q2", "2022Q3", "2022Q4",
    "2023Q1", "2023Q2", "2023Q3", "2023Q4",
    "2024Q1", "2024Q2", "2024Q3", "2024Q4",
    "2025Q1",
]

# --- Three assumption dimensions ---
ASSUMPTIONS = ["Pegged", "Unpegged", "Fixed"]

# Each assumption value has a characteristic effect on the ultimate.
# These biases combine multiplicatively across the three dimensions.
ASSUMPTION_EFFECTS = {
    "Pattern": {
        "Pegged":   {"bias": 1.00, "noise": 0.02},
        "Unpegged": {"bias": 1.02, "noise": 0.04},
        "Fixed":    {"bias": 0.98, "noise": 0.01},
    },
    "IE": {
        "Pegged":   {"bias": 1.01, "noise": 0.03},
        "Unpegged": {"bias": 0.99, "noise": 0.05},
        "Fixed":    {"bias": 1.00, "noise": 0.015},
    },
    "Approach": {
        "Pegged":   {"bias": 1.00, "noise": 0.025},
        "Unpegged": {"bias": 1.01, "noise": 0.04},
        "Fixed":    {"bias": 0.97, "noise": 0.02},
    },
}

# Synthetic scoring model — each assumption choice contributes to
# Reserve Determination and Projection Quality scores.
# In production these would come from actual models.
SCORE_CONTRIBUTIONS = {
    "Pattern": {
        "Pegged":   {"res_det": 0.30, "proj_qual": 0.35},
        "Unpegged": {"res_det": 0.25, "proj_qual": 0.28},
        "Fixed":    {"res_det": 0.33, "proj_qual": 0.20},
    },
    "IE": {
        "Pegged":   {"res_det": 0.28, "proj_qual": 0.32},
        "Unpegged": {"res_det": 0.22, "proj_qual": 0.25},
        "Fixed":    {"res_det": 0.35, "proj_qual": 0.18},
    },
    "Approach": {
        "Pegged":   {"res_det": 0.30, "proj_qual": 0.30},
        "Unpegged": {"res_det": 0.20, "proj_qual": 0.22},
        "Fixed":    {"res_det": 0.32, "proj_qual": 0.15},
    },
}


def build_method_key(pattern: str, ie: str, approach: str) -> str:
    """Compact method identifier for dropdowns and lookups."""
    return f"{pattern} / {ie} / {approach}"


# ------------------------------------------------------------------ #
#  Helpers
# ------------------------------------------------------------------ #
def cohort_index(cohort: str) -> int:
    year = int(cohort[:4])
    quarter = int(cohort[-1])
    return (year - 2022) * 4 + (quarter - 1)


def valuation_index() -> int:
    return cohort_index(VALUATION_DATE)


def cumulative_development_curve(
    dev_periods: np.ndarray,
    ultimate: float,
    speed: float,
) -> np.ndarray:
    proportion_developed = 1 - np.exp(-speed * dev_periods)
    return ultimate * proportion_developed


# ------------------------------------------------------------------ #
#  Records generator
# ------------------------------------------------------------------ #
def generate_long_data(rng: np.random.Generator) -> tuple[pd.DataFrame, dict]:
    """Build the flight-path records and true ultimate map."""
    val_idx = valuation_index()
    rows: list[dict] = []
    ult_map: dict[tuple[str, str], float] = {}

    for cls_name, params in CLASSES.items():
        for cohort in COHORTS:
            c_idx = cohort_index(cohort)
            max_observed = val_idx - c_idx
            if max_observed < 0:
                continue
            max_observed = min(max_observed, MAX_DEV_PERIOD)

            growth_factor = (1 + params["growth_rate"]) ** (c_idx / 4)
            noise = rng.normal(1, params["volatility"])
            cohort_ultimate = params["base_ultimate"] * growth_factor * noise
            ult_map[(cls_name, cohort)] = cohort_ultimate

            expected_ultimate = round(cohort_ultimate, -3)

            # More recent cohorts develop faster → fanning-out trend
            cohort_speed = params["dev_speed"] + params.get("trend_accel", 0) * c_idx

            dev_periods = np.arange(0, max_observed + 1)
            base_curve = cumulative_development_curve(
                dev_periods, cohort_ultimate, cohort_speed
            )
            noise_scale = params["volatility"] * cohort_ultimate * 0.02
            perturbation = rng.normal(0, noise_scale, size=len(dev_periods))
            perturbation[0] = 0
            actuals = np.maximum(0, base_curve + np.cumsum(perturbation))
            actuals = np.maximum.accumulate(actuals)

            for dp, val in zip(dev_periods, actuals):
                rows.append({
                    "Class": cls_name,
                    "Cohort": cohort,
                    "Development_Period": int(dp),
                    "Type": "Actual",
                    "Value": round(float(val), 2),
                })

            for dp in dev_periods:
                rows.append({
                    "Class": cls_name,
                    "Cohort": cohort,
                    "Development_Period": int(dp),
                    "Type": "Expected",
                    "Value": float(expected_ultimate),
                })

    return pd.DataFrame(rows), ult_map


# ------------------------------------------------------------------ #
#  Ultimates generator — 27 methods
# ------------------------------------------------------------------ #
def generate_ultimates(
    rng: np.random.Generator,
    ult_map: dict[tuple[str, str], float],
) -> tuple[pd.DataFrame, pd.DataFrame]:
    """
    Generate ultimate estimates for every Class × Cohort × Method.
    Each method = (Pattern, IE, Approach) combination.

    Returns (current_ultimates, prior_ultimates) where prior_ultimates
    represent last valuation's estimates — same structure but with a
    correlated perturbation simulating one fewer quarter of data.
    """
    rows: list[dict] = []
    prior_rows: list[dict] = []

    for (cls_name, cohort), true_ult in ult_map.items():
        for pattern, ie, approach in product(ASSUMPTIONS, repeat=3):
            p_eff = ASSUMPTION_EFFECTS["Pattern"][pattern]
            i_eff = ASSUMPTION_EFFECTS["IE"][ie]
            a_eff = ASSUMPTION_EFFECTS["Approach"][approach]

            combined_bias = p_eff["bias"] * i_eff["bias"] * a_eff["bias"]
            combined_noise = (p_eff["noise"] ** 2 + i_eff["noise"] ** 2 + a_eff["noise"] ** 2) ** 0.5

            factor = combined_bias * rng.normal(1, combined_noise)
            ultimate = true_ult * factor

            method_key = build_method_key(pattern, ie, approach)
            method_type = "Claims-based" if approach in ("Pegged", "Unpegged") else "Premium-based"
            rows.append({
                "Class": cls_name,
                "Cohort": cohort,
                "Method": method_key,
                "Pattern": pattern,
                "IE": ie,
                "Approach": approach,
                "Method_Type": method_type,
                "Ultimate": round(float(ultimate), 2),
            })

            c_idx = cohort_index(cohort)
            maturity = min((valuation_index() - c_idx) / MAX_DEV_PERIOD, 1.0)
            drift_sigma = 0.04 * (1 - maturity) + 0.005
            prior_factor = 1 + rng.normal(0, drift_sigma)
            prior_ultimate = ultimate * prior_factor

            prior_rows.append({
                "Class": cls_name,
                "Cohort": cohort,
                "Method": method_key,
                "Ultimate": round(float(prior_ultimate), 2),
            })

    return pd.DataFrame(rows), pd.DataFrame(prior_rows)


# ------------------------------------------------------------------ #
#  Premiums generator — per Class × Cohort for DAG
# ------------------------------------------------------------------ #
def generate_premiums(
    rng: np.random.Generator,
    ult_map: dict[tuple[str, str], float],
) -> pd.DataFrame:
    """
    Generate written/earned premium per Class × Cohort.
    Derived from base ultimate and a loss-ratio assumption (~65–75%)
    so the DAG can compute premium change %.
    """
    LOSS_RATIO_MEAN = 0.70
    LOSS_RATIO_SIGMA = 0.04
    PRIOR_EARNED_DRIFT = 0.03  # prior earned typically a bit lower

    rows: list[dict] = []
    for (cls_name, cohort), true_ult in ult_map.items():
        loss_ratio = rng.normal(LOSS_RATIO_MEAN, LOSS_RATIO_SIGMA)
        loss_ratio = np.clip(loss_ratio, 0.55, 0.85)
        earned = true_ult / loss_ratio
        written = earned * rng.uniform(1.00, 1.08)
        prior_earned = earned * (1 - rng.uniform(0, PRIOR_EARNED_DRIFT))

        rows.append({
            "Class": cls_name,
            "Cohort": cohort,
            "Written": round(float(written), 2),
            "Earned": round(float(earned), 2),
            "Prior_Earned": round(float(prior_earned), 2),
        })

    return pd.DataFrame(rows)


# ------------------------------------------------------------------ #
#  Cohort claim counts — current count from claims, prior synthetic
# ------------------------------------------------------------------ #
def generate_cohort_claim_counts(
    df_claims: pd.DataFrame,
    rng: np.random.Generator,
) -> pd.DataFrame:
    """
    One row per Class × Cohort: Count_Current from actual claims,
    Count_Prior a synthetic value (current +/- small delta) for DAG.
    """
    agg = df_claims.groupby(["Class", "Cohort"]).size().reset_index(name="Count_Current")
    prior_delta = rng.integers(-2, 3, size=len(agg))
    agg["Count_Prior"] = np.maximum(0, agg["Count_Current"] + prior_delta)
    return agg


# ------------------------------------------------------------------ #
#  Method scores generator — Reserve Det & Proj Quality
# ------------------------------------------------------------------ #
def generate_method_scores(
    rng: np.random.Generator,
    classes: list[str],
) -> pd.DataFrame:
    """
    Generate Reserve Determination and Projection Quality scores
    for each Class × Method combination.

    Scores are in [0, 1]. Each assumption's contribution is summed
    then capped and perturbed with class-specific noise.
    """
    SHAP_FEATURES = [
        "Hist. Ult. Volatility",
        "Incurred % of Yr 1",
        "Incurred % of Ult",
    ]

    rows: list[dict] = []

    for cls_name in classes:
        cls_noise = rng.normal(0, 0.03, size=2)

        for pattern, ie, approach in product(ASSUMPTIONS, repeat=3):
            p_sc = SCORE_CONTRIBUTIONS["Pattern"][pattern]
            i_sc = SCORE_CONTRIBUTIONS["IE"][ie]
            a_sc = SCORE_CONTRIBUTIONS["Approach"][approach]

            raw_res_det   = p_sc["res_det"] + i_sc["res_det"] + a_sc["res_det"]
            raw_proj_qual = p_sc["proj_qual"] + i_sc["proj_qual"] + a_sc["proj_qual"]

            res_det   = np.clip(raw_res_det + cls_noise[0] + rng.normal(0, 0.02), 0, 1)
            proj_qual = np.clip(raw_proj_qual + cls_noise[1] + rng.normal(0, 0.02), 0, 1)

            # Synthetic SHAP-like contributions for Reserve Determination.
            # Each feature gets a share of the final score, perturbed so
            # different methods show meaningfully different breakdowns.
            raw_shap = rng.dirichlet([3.0, 2.0, 2.5]) * res_det
            sign_flips = rng.choice([-1, 1], size=len(SHAP_FEATURES), p=[0.25, 0.75])
            shap_vals = raw_shap * sign_flips

            shap_dict = {
                feat: round(float(val), 4)
                for feat, val in zip(SHAP_FEATURES, shap_vals)
            }

            prior_res_det = np.clip(res_det + rng.normal(0, 0.04), 0, 1)

            rows.append({
                "Class": cls_name,
                "Method": build_method_key(pattern, ie, approach),
                "Pattern": pattern,
                "IE": ie,
                "Approach": approach,
                "Reserve_Det": round(float(res_det), 3),
                "Prior_Reserve_Det": round(float(prior_res_det), 3),
                "Proj_Quality": round(float(proj_qual), 3),
                "SHAP": shap_dict,
            })

    return pd.DataFrame(rows)


# ------------------------------------------------------------------ #
#  Individual claims generator
# ------------------------------------------------------------------ #
CLAIM_STATUSES = ["Open", "Closed", "Reopened"]
CLAIM_STATUS_WEIGHTS = [0.35, 0.55, 0.10]

def generate_claims(
    rng: np.random.Generator,
    ult_map: dict[tuple[str, str], float],
) -> pd.DataFrame:
    """
    Generate synthetic individual claims per Class × Cohort.

    Each cohort gets 5–12 claims whose total roughly aligns with the
    cumulative actuals. A subset of claims are given large movements
    between prior and current valuation to surface in the dashboard.
    """
    rows: list[dict] = []
    claim_counter = 1000

    for (cls_name, cohort), true_ult in ult_map.items():
        c_idx = cohort_index(cohort)
        max_observed = valuation_index() - c_idx
        if max_observed < 0:
            continue

        maturity = min(max_observed / MAX_DEV_PERIOD, 1.0)
        n_claims = rng.integers(5, 13)

        # Split the total incurred across claims using a Dirichlet
        total_incurred = true_ult * maturity * rng.uniform(0.85, 1.05)
        shares = rng.dirichlet(np.ones(n_claims) * 1.5)
        claim_incurreds = total_incurred * shares

        for i in range(n_claims):
            claim_counter += 1
            claim_id = f"CLM-{claim_counter:05d}"

            current = round(float(claim_incurreds[i]), 2)

            status = rng.choice(
                CLAIM_STATUSES, p=CLAIM_STATUS_WEIGHTS
            )

            # Prior incurred: most claims move modestly, a few move a lot
            is_large_mover = rng.random() < 0.15
            if is_large_mover:
                drift = rng.choice([-1, 1]) * rng.uniform(0.20, 0.60)
            else:
                drift = rng.normal(0, 0.05)

            prior = max(0, current * (1 - drift))

            if status == "Reopened":
                prior = current * rng.uniform(0.02, 0.15)

            rows.append({
                "Class": cls_name,
                "Cohort": cohort,
                "Claim_ID": claim_id,
                "Status": status,
                "Incurred_Current": round(float(current), 2),
                "Incurred_Prior": round(float(prior), 2),
            })

    return pd.DataFrame(rows)


# ------------------------------------------------------------------ #
#  Export
# ------------------------------------------------------------------ #
def export_json(
    df_records: pd.DataFrame,
    df_ultimates: pd.DataFrame,
    df_prior_ultimates: pd.DataFrame,
    df_scores: pd.DataFrame,
    df_claims: pd.DataFrame,
    df_premiums: pd.DataFrame,
    df_claim_counts: pd.DataFrame,
    output_path: Path,
) -> None:
    """
    Write dashboard-ready JSON.

    Structure includes records, ultimates (with Method_Type), prior_ultimates,
    method_scores, claims, premiums, cohort_claim_counts.
    """
    large_loss_thresholds = {
        cls_name: params["large_loss_threshold"]
        for cls_name, params in CLASSES.items()
    }

    payload = {
        "title": "Insurance Analytics Dashboard",
        "subtitle": "A vs E Flight Path — Actual vs Expected to Ultimate",
        "last_updated": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "classes": sorted(df_records["Class"].unique().tolist()),
        "methods": sorted(df_ultimates["Method"].unique().tolist()),
        "large_loss_thresholds": large_loss_thresholds,
        "records": df_records.to_dict(orient="records"),
        "ultimates": df_ultimates.to_dict(orient="records"),
        "prior_ultimates": df_prior_ultimates.to_dict(orient="records"),
        "method_scores": df_scores.to_dict(orient="records"),
        "claims": df_claims.to_dict(orient="records"),
        "premiums": df_premiums.to_dict(orient="records"),
        "cohort_claim_counts": df_claim_counts.to_dict(orient="records"),
    }
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(payload, indent=2))

    n_rec = len(df_records)
    n_ult = len(df_ultimates)
    n_pri = len(df_prior_ultimates)
    n_sc = len(df_scores)
    n_clm = len(df_claims)
    n_prem = len(df_premiums)
    n_cc = len(df_claim_counts)
    print(f"✓ Wrote {n_rec} records + {n_ult} ultimates + {n_pri} prior + {n_sc} scores + {n_clm} claims + {n_prem} premiums + {n_cc} claim_counts to {output_path}")


# ------------------------------------------------------------------ #
#  Entry point
# ------------------------------------------------------------------ #
if __name__ == "__main__":
    rng = np.random.default_rng(SEED)

    df_records, ult_map = generate_long_data(rng)
    df_ultimates, df_prior_ultimates = generate_ultimates(rng, ult_map)
    df_scores = generate_method_scores(rng, sorted(CLASSES.keys()))
    df_claims = generate_claims(rng, ult_map)
    df_premiums = generate_premiums(rng, ult_map)
    df_claim_counts = generate_cohort_claim_counts(df_claims, rng)

    # Preview
    print("=== Records (first 10) ===")
    print(df_records.head(10).to_string(index=False))
    print(f"\nTotal: {len(df_records)} rows")

    print("\n=== Ultimates (first 10) ===")
    print(df_ultimates.head(10).to_string(index=False))
    print(f"\nTotal: {len(df_ultimates)} rows")
    print(f"Methods ({len(df_ultimates['Method'].unique())}): {df_ultimates['Method'].unique().tolist()[:5]}...")

    print("\n=== Prior Ultimates (first 10) ===")
    print(df_prior_ultimates.head(10).to_string(index=False))
    print(f"\nTotal: {len(df_prior_ultimates)} rows")

    print("\n=== Claims (first 10) ===")
    print(df_claims.head(10).to_string(index=False))
    print(f"\nTotal: {len(df_claims)} rows")

    print("\n=== Method Scores (first 10) ===")
    print(df_scores.head(10).to_string(index=False))
    print(f"\nTotal: {len(df_scores)} rows")
    print()

    out = Path(__file__).resolve().parent.parent / "data" / "analytics.json"
    export_json(df_records, df_ultimates, df_prior_ultimates, df_scores, df_claims, df_premiums, df_claim_counts, out)
