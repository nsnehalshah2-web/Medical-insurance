"""Feature engineering shared by the notebook, training script and predictor."""

import pandas as pd

NUMERIC_FEATURES = ["age", "bmi", "children", "bmi_smoker", "age_smoker"]
CATEGORICAL_FEATURES = ["sex", "smoker", "region", "bmi_category"]
TARGET = "charges"


def bmi_category(bmi: float) -> str:
    """WHO adult BMI bands."""
    if bmi < 18.5:
        return "underweight"
    if bmi < 25:
        return "normal"
    if bmi < 30:
        return "overweight"
    return "obese"


def add_features(df: pd.DataFrame) -> pd.DataFrame:
    """Add domain features. EDA shows cost jumps sharply for smokers,
    and even more for smokers who are obese, so we give the model those
    interactions directly instead of hoping it discovers them."""
    out = df.copy()
    is_smoker = (out["smoker"] == "yes").astype(int)
    out["bmi_category"] = out["bmi"].apply(bmi_category)
    out["bmi_smoker"] = out["bmi"] * is_smoker
    out["age_smoker"] = out["age"] * is_smoker
    return out
