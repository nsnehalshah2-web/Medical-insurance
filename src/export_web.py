"""Export the trained model and supporting data for the website in docs/.

The Gradient Boosting trees, scaler and encoder are written to JSON so the
browser can reproduce the model's predictions exactly, with no server.

    python -m src.export_web
"""

import json
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import GradientBoostingRegressor, RandomForestRegressor
from sklearn.inspection import permutation_importance
from sklearn.linear_model import LinearRegression
from sklearn.metrics import mean_absolute_error, r2_score, root_mean_squared_error
from sklearn.model_selection import KFold, cross_validate, train_test_split
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler
from xgboost import XGBRegressor

from src.features import CATEGORICAL_FEATURES, NUMERIC_FEATURES, TARGET, add_features

ROOT = Path(__file__).resolve().parent.parent
RANDOM_STATE = 42
RAW_FEATURES = ["age", "sex", "bmi", "children", "smoker", "region"]


def load_split():
    """Same cleaning and split as src/train.py and the notebook."""
    df = add_features(pd.read_csv(ROOT / "data" / "insurance.csv").drop_duplicates())
    X, y = df.drop(columns=[TARGET]), df[TARGET]
    return df, train_test_split(X, y, test_size=0.2, random_state=RANDOM_STATE, stratify=X["smoker"])


def export_trees(model) -> dict:
    pipe = model.regressor_
    pre, gb = pipe.named_steps["preprocess"], pipe.named_steps["model"]
    scaler = pre.named_transformers_["num"]
    encoder = pre.named_transformers_["cat"]

    trees = []
    for est in gb.estimators_[:, 0]:
        t = est.tree_
        trees.append({
            "left": t.children_left.tolist(),
            "right": t.children_right.tolist(),
            "feature": t.feature.tolist(),
            "threshold": t.threshold.tolist(),
            "value": t.value[:, 0, 0].tolist(),
        })

    return {
        "target_transform": "log1p",
        "numeric": {"features": NUMERIC_FEATURES,
                    "mean": scaler.mean_.tolist(), "scale": scaler.scale_.tolist()},
        "categorical": [
            {"feature": f, "categories": cats.tolist(),
             "dropped": None if drop is None else cats[int(drop)]}
            for f, cats, drop in zip(CATEGORICAL_FEATURES, encoder.categories_, encoder.drop_idx_)
        ],
        "feature_names": list(pre.get_feature_names_out()),
        "init": float(gb.init_.constant_.ravel()[0]),
        "learning_rate": gb.learning_rate,
        "trees": trees,
        "params": {k: v for k, v in gb.get_params().items()
                   if k in ("n_estimators", "learning_rate", "max_depth", "min_samples_leaf", "subsample")},
    }


def metrics(y_true, y_pred) -> dict:
    return {"mae": round(mean_absolute_error(y_true, y_pred), 2),
            "rmse": round(root_mean_squared_error(y_true, y_pred), 2),
            "r2": round(r2_score(y_true, y_pred), 4)}


def cv_comparison(X_train, y_train) -> list[dict]:
    def pre(num, cat):
        return ColumnTransformer([("num", StandardScaler(), num),
                                  ("cat", OneHotEncoder(drop="if_binary", handle_unknown="ignore"), cat)])

    feature_sets = {"base": (["age", "bmi", "children"], ["sex", "smoker", "region"]),
                    "engineered": (NUMERIC_FEATURES, CATEGORICAL_FEATURES)}
    models = {
        "Linear Regression": LinearRegression(),
        "Random Forest": RandomForestRegressor(random_state=RANDOM_STATE, n_jobs=-1),
        "Gradient Boosting": GradientBoostingRegressor(random_state=RANDOM_STATE),
        "XGBoost": XGBRegressor(random_state=RANDOM_STATE, n_jobs=-1),
    }
    cv = KFold(5, shuffle=True, random_state=RANDOM_STATE)
    rows = []
    for name, model in models.items():
        for fs, (num, cat) in feature_sets.items():
            s = cross_validate(Pipeline([("preprocess", pre(num, cat)), ("model", model)]), X_train, y_train,
                               cv=cv, scoring={"mae": "neg_mean_absolute_error", "r2": "r2"})
            rows.append({"model": name, "features": fs,
                         "cv_mae": round(-s["test_mae"].mean(), 1), "cv_r2": round(s["test_r2"].mean(), 4)})
    return rows


def main() -> None:
    model = joblib.load(ROOT / "models" / "insurance_model.joblib")
    df, (X_train, X_test, y_train, y_test) = load_split()

    test_pred = model.predict(X_test)
    baseline = Pipeline([
        ("preprocess", ColumnTransformer([
            ("num", StandardScaler(), ["age", "bmi", "children"]),
            ("cat", OneHotEncoder(drop="if_binary", handle_unknown="ignore"), ["sex", "smoker", "region"])])),
        ("model", LinearRegression()),
    ]).fit(X_train, y_train)

    # how far off the model typically is, for people like the one entered
    abs_err = np.abs(y_test - test_pred)
    error_bands = {g: round(float(np.percentile(abs_err[X_test["smoker"] == g], 80)), 0) for g in ("no", "yes")}

    perm = permutation_importance(model, X_test, y_test, n_repeats=20, random_state=RANDOM_STATE,
                                  scoring="neg_mean_absolute_error")
    importance = sorted(({"feature": f, "importance": round(float(m), 1)}
                         for f, m in zip(X_test.columns, perm.importances_mean)),
                        key=lambda r: -r["importance"])

    raw = df[RAW_FEATURES + [TARGET]]
    export = {
        "model": export_trees(model),
        "metrics": {"test": metrics(y_test, test_pred),
                    "baseline_test": metrics(y_test, baseline.predict(X_test)),
                    "n_train": len(X_train), "n_test": len(X_test)},
        "error_bands_80": error_bands,
        "cv": cv_comparison(X_train, y_train),
        "importance": importance,
        "ranges": {"age": [int(raw.age.min()), int(raw.age.max())],
                   "bmi": [float(raw.bmi.min()), float(raw.bmi.max())],
                   "children": [int(raw.children.min()), int(raw.children.max())]},
        "categories": {"sex": ["female", "male"], "smoker": ["no", "yes"],
                       "region": ["northeast", "northwest", "southeast", "southwest"]},
        "people": raw.round({"bmi": 2, TARGET: 2}).to_dict(orient="split")["data"],
        "people_columns": RAW_FEATURES + [TARGET],
    }

    out = ROOT / "docs" / "data" / "model.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(export))
    # same data as a script, so docs/index.html also works when opened from disk (file://)
    out.with_suffix(".js").write_text("window.INSURANCE_MODEL = " + json.dumps(export) + ";\n")

    print("Test metrics:", export["metrics"]["test"], "| baseline:", export["metrics"]["baseline_test"])
    print("80% error band by smoker:", error_bands)
    print(f"Wrote {out.relative_to(ROOT)} ({out.stat().st_size / 1024:.0f} KB) and model.js")


if __name__ == "__main__":
    main()
