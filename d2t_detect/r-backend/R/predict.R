# Pure model logic for the D2T teaching classifier — no web dependencies.
# Consumes the .rds bundle (class "d2t_teaching_firth_bundle"), which mirrors the
# JSON spec: predictors, input_schema (tibble), coefficients$raw_scale(_intercept).
#
# Kept framework-free on purpose so both the plumber API and the self-test can
# source it, and so the model math has exactly one home.

# The bundle lives one level up from r-backend/ (where run.R/selftest.R run from).
# Override with the D2T_BUNDLE env var if the backend is deployed elsewhere.
default_bundle_path <- function() {
  file.path("..", "d2t_teaching_augmented_firth_v1.rds")
}

# Load and lightly validate the bundle once; callers cache the result.
load_bundle <- function(path = Sys.getenv("D2T_BUNDLE", default_bundle_path())) {
  if (!file.exists(path)) stop(sprintf("bundle not found: %s", path))
  bundle <- readRDS(path)
  needed <- c("predictors", "input_schema", "coefficients")
  missing <- setdiff(needed, names(bundle))
  if (length(missing)) stop(sprintf("bundle missing fields: %s", paste(missing, collapse = ", ")))
  bundle
}

# Named numeric vector of imputation medians, keyed by predictor name.
bundle_medians <- function(bundle) {
  s <- bundle$input_schema
  stats::setNames(as.numeric(s$imputation_median), s$name)
}

# Named list of {min, max} observed training ranges, keyed by predictor name.
bundle_ranges <- function(bundle) {
  s <- bundle$input_schema
  stats::setNames(
    Map(function(lo, hi) c(min = lo, max = hi), s$observed_min, s$observed_max),
    s$name
  )
}

# Core prediction. `inputs` is a named list of raw values; NULL/NA means "missing"
# and is replaced by the training median (and reported back in `imputed`).
#
# Returns a list: p_d2t, p_rem, predicted_class, imputed, out_of_range, eta.
predict_d2t <- function(bundle, inputs) {
  coef <- bundle$coefficients$raw_scale
  medians <- bundle_medians(bundle)
  ranges <- bundle_ranges(bundle)

  eta <- as.numeric(bundle$coefficients$raw_scale_intercept)
  imputed <- character(0)
  out_of_range <- character(0)

  for (p in bundle$predictors) {
    v <- if (p %in% names(inputs)) inputs[[p]] else NULL

    if (is.null(v) || (length(v) == 1 && is.na(v))) {
      v <- medians[[p]]                      # median imputation for missing input
      imputed <- c(imputed, p)
    } else {
      v <- as.numeric(v)
      # README: web inputs must be non-negative months; clamp rather than reject.
      if (p == "duration_trt_ombi" && v < 0) v <- 0
      rng <- ranges[[p]]
      if (v < rng[["min"]] || v > rng[["max"]]) out_of_range <- c(out_of_range, p)
    }

    eta <- eta + as.numeric(coef[[p]]) * v
  }

  p_d2t <- stats::plogis(eta)                # 1 / (1 + exp(-eta))
  list(
    p_d2t = p_d2t,
    p_rem = 1 - p_d2t,
    predicted_class = if (p_d2t >= 0.5) bundle$positive_class else bundle$negative_class,
    imputed = imputed,
    out_of_range = out_of_range,
    eta = eta
  )
}
