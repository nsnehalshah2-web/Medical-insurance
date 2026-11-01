"""Train the final model from the command line.

Reproduces the model selected in the notebook (tuned Gradient Boosting on a
log-transformed target) without running the full analysis.

    python -m src.train
"""

import json
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sklearn.compose import ColumnTransformer, TransformedTargetRegressor
from sklearn.ensemble import GradientBoostingRegressor
from sklearn.metrics import mean_absolute_error, r2_score, root_mean_squared_error
from sklearn.model_selection import GridSearchCV, KFold, train_test_split
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler

from src.features import CATEGORICAL_FEATURES, NUMERIC_FEATURES, TARGET, add_features

ROOT = Path(__file__).resolve().parent.parent
RANDOM_STATE = 42

PARAM_GRID = {
    "regressor__model__n_estimators": [100, 200, 400],
    "regressor__model__learning_rate": [0.03, 0.05, 0.1],
    "regressor__model__max_depth": [2, 3, 4],
    "regressor__model__min_samples_leaf": [5, 10, 20],
    "regressor__model__subsample": [0.8, 1.0],
}


def build_model() -> TransformedTargetRegressor:
    preprocess = ColumnTransformer([
        ("num", StandardScaler(), NUMERIC_FEATURES),
        ("cat", OneHotEncoder(drop="if_binary", handle_unknown="ignore"), CATEGORICAL_FEATURES),
    ])
    pipe = Pipeline([
        ("preprocess", preprocess),
        ("model", GradientBoostingRegressor(random_state=RANDOM_STATE)),
    ])
    return TransformedTargetRegressor(regressor=pipe, func=np.log1p, inverse_func=np.expm1)


def main() -> None:
    df = pd.read_csv(ROOT / "data" / "insurance.csv").drop_duplicates()
    df = add_features(df)
    X, y = df.drop(columns=[TARGET]), df[TARGET]
    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, random_state=RANDOM_STATE, stratify=X["smoker"]
    )

    cv = KFold(n_splits=5, shuffle=True, random_state=RANDOM_STATE)
    grid = GridSearchCV(build_model(), PARAM_GRID, cv=cv,
                        scoring="neg_mean_absolute_error", n_jobs=-1, refit=True)
    grid.fit(X_train, y_train)
    model = grid.best_estimator_

    pred = model.predict(X_test)
    metrics = {
        "cv_mae": round(-grid.best_score_, 2),
        "test_mae": round(mean_absolute_error(y_test, pred), 2),
        "test_rmse": round(root_mean_squared_error(y_test, pred), 2),
        "test_r2": round(r2_score(y_test, pred), 4),
        "best_params": {k.split("__")[-1]: v for k, v in grid.best_params_.items()},
    }

    (ROOT / "models").mkdir(exist_ok=True)
    joblib.dump(model, ROOT / "models" / "insurance_model.joblib")
    (ROOT / "models" / "metrics.json").write_text(json.dumps(metrics, indent=2))
    print(json.dumps(metrics, indent=2))


if __name__ == "__main__":
    main()
