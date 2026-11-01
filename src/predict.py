"""Predict insurance charges for one person using the saved model.

    python -m src.predict --age 35 --sex male --bmi 29.5 --children 2 --smoker no --region southeast
"""

import argparse
from pathlib import Path

import joblib
import pandas as pd

from src.features import add_features

MODEL_PATH = Path(__file__).resolve().parent.parent / "models" / "insurance_model.joblib"


def predict(age: float, sex: str, bmi: float, children: int, smoker: str, region: str) -> float:
    model = joblib.load(MODEL_PATH)
    row = pd.DataFrame([{"age": age, "sex": sex, "bmi": bmi, "children": children,
                         "smoker": smoker, "region": region}])
    return float(model.predict(add_features(row))[0])


def main() -> None:
    p = argparse.ArgumentParser(description="Predict annual medical insurance charges.")
    p.add_argument("--age", type=float, required=True)
    p.add_argument("--sex", choices=["male", "female"], required=True)
    p.add_argument("--bmi", type=float, required=True)
    p.add_argument("--children", type=int, default=0)
    p.add_argument("--smoker", choices=["yes", "no"], required=True)
    p.add_argument("--region", choices=["northeast", "northwest", "southeast", "southwest"], required=True)
    args = p.parse_args()

    charges = predict(**vars(args))
    print(f"Predicted annual charges: ${charges:,.2f}")


if __name__ == "__main__":
    main()
