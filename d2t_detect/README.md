# D2T teaching model

This folder contains a portable, teaching-only classifier of established D2T RA versus remission. It is not a prospective risk model and must not be used for clinical decisions.

## Files to use

- `d2t_teaching_augmented_firth_v1.json` - primary, language-neutral specification for a web application.
- `d2t_teaching_augmented_firth_v1.rds` - equivalent minimal bundle for an R backend.
- `d2t_teaching_augmented_firth_v1_test_cases.csv` - synthetic inputs and expected probabilities for implementation testing.
- `../../scripts/WRK_20_export_d2t_teaching_model.R` - reproducibly refits and exports the bundle.

The older `elisa03_varB_*` files are legacy analysis objects and must not be used for this web prototype.

## Model inputs

The augmented Firth logistic model requires five numeric inputs:

1. `DAS28_FW_fup` - DAS28-ESR score
2. `CRP_fup` - CRP in mg/L
3. `duration_trt_ombi` - trt duration in months
4. `orm1` - ORM1/orosomucoid in ng/mL
5. `fstl1` - FSTL1 in ng/mL

Exact labels, units, observed training ranges, and missing-value medians are stored in the JSON `input_schema`.

## What the web agent should do

1. Load the JSON specification.
2. Read the five raw inputs in the units above.
3. Replace a missing input with its `imputation_median` from `input_schema`.
4. Calculate:

   ```text
   eta = raw_scale_intercept + sum(raw_scale[predictor] * input[predictor])
   p_d2t = 1 / (1 + exp(-eta))
   p_rem = 1 - p_d2t
   ```

5. Display `100 * p_d2t` as a teaching D2T-class probability, not as future D2T risk.
6. Run all rows in the test-case CSV and require agreement with `.pred_d2t` within `1e-10` before deployment.

No additional standardisation is needed: the deployment coefficients are already converted to the raw input scale. The files contain no patient rows or identifiers.

## Rebuild

From the project root:

```powershell
Rscript --vanilla scripts/WRK_20_export_d2t_teaching_model.R
```

Known source-data issue: the training cohort contains a negative `duration_trt_ombi` value retained for manuscript reproducibility. The web form should accept only non-negative months.
