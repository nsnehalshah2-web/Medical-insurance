// Re-implements the trained scikit-learn pipeline in the browser:
// feature engineering -> StandardScaler + OneHotEncoder -> Gradient Boosting trees -> expm1.
// Model parameters come from data/model.js (written by `python -m src.export_web`).
(function (root) {
  "use strict";

  // must match src/features.py
  function bmiCategory(bmi) {
    if (bmi < 18.5) return "underweight";
    if (bmi < 25) return "normal";
    if (bmi < 30) return "overweight";
    return "obese";
  }

  function addFeatures(p) {
    const isSmoker = p.smoker === "yes" ? 1 : 0;
    return { ...p, bmi_category: bmiCategory(p.bmi), bmi_smoker: p.bmi * isSmoker, age_smoker: p.age * isSmoker };
  }

  function createPredictor(model) {
    const { numeric, categorical, trees, init, learning_rate: lr } = model;

    function encode(person) {
      const row = addFeatures(person);
      const x = numeric.features.map((f, i) => (row[f] - numeric.mean[i]) / numeric.scale[i]);
      for (const c of categorical) {
        for (const cat of c.categories) {
          if (cat === c.dropped) continue;
          x.push(row[c.feature] === cat ? 1 : 0);
        }
      }
      // scikit-learn trees compare float32 inputs against their thresholds
      return x.map(Math.fround);
    }

    function treeValue(t, x) {
      let node = 0;
      while (t.left[node] !== -1) node = x[t.feature[node]] <= t.threshold[node] ? t.left[node] : t.right[node];
      return t.value[node];
    }

    function predict(person) {
      const x = encode(person);
      let raw = init;
      for (const t of trees) raw += lr * treeValue(t, x);
      return Math.expm1(raw);
    }

    return { predict, encode, bmiCategory };
  }

  root.createInsurancePredictor = createPredictor;
  if (typeof module !== "undefined") module.exports = { createPredictor };
})(typeof window !== "undefined" ? window : globalThis);
