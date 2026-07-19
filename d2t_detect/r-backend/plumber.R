# plumber API for the D2T teaching classifier.
# Loads the .rds bundle once at startup and exposes it over HTTP.
# Launch with run.R (do not source this file directly).

library(plumber)

# Load pure model logic + bundle once, shared across all requests.
source(file.path("R", "predict.R"), chdir = TRUE)
BUNDLE <- load_bundle()

DISCLAIMER <- paste(
  "Teaching-only cross-sectional class probability, not a prospective D2T risk",
  "and not for clinical decisions."
)

#* @apiTitle D2T teaching classifier
#* @apiDescription R backend consuming the d2t_teaching_augmented_firth_v1 .rds bundle.

#* Enable permissive CORS so the static frontend can call this API from a browser.
#* @filter cors
function(req, res) {
  res$setHeader("Access-Control-Allow-Origin", "*")
  if (req$REQUEST_METHOD == "OPTIONS") {
    res$setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
    res$setHeader("Access-Control-Allow-Headers", "Content-Type")
    res$status <- 200
    return(list())
  }
  plumber::forward()
}

#* Liveness + model identity.
#* @get /health
function() {
  list(
    status = "ok",
    model_id = BUNDLE$model_id,
    version = BUNDLE$version,
    disclaimer = DISCLAIMER
  )
}

#* Input schema + metadata, so clients can build a form from the bundle.
#* @get /schema
#* @serializer unboxedJSON
function() {
  s <- BUNDLE$input_schema
  list(
    model_id = BUNDLE$model_id,
    version = BUNDLE$version,
    positive_class = BUNDLE$positive_class,
    negative_class = BUNDLE$negative_class,
    predictors = BUNDLE$predictors,
    inputs = lapply(seq_len(nrow(s)), function(i) {
      list(
        name = s$name[i], label = s$label[i], unit = s$unit[i],
        imputation_median = s$imputation_median[i],
        observed_min = s$observed_min[i], observed_max = s$observed_max[i]
      )
    }),
    disclaimer = DISCLAIMER
  )
}

#* Predict the teaching D2T-class probability from raw inputs.
#* Body: JSON object with any of the 5 predictors; omit or null -> training median.
#* @post /predict
#* @serializer unboxedJSON
function(req, res) {
  raw <- req$postBody
  if (is.null(raw) || !nzchar(raw)) raw <- "{}"     # empty body == no inputs
  body <- tryCatch(
    jsonlite::fromJSON(raw, simplifyVector = TRUE),
    error = function(e) NULL
  )
  if (is.null(body) || !is.list(body)) {
    res$status <- 400
    return(list(error = "Body must be a JSON object with numeric predictor fields."))
  }

  # Coerce provided fields to numeric; reject non-numeric junk explicitly.
  inputs <- list()
  for (p in BUNDLE$predictors) {
    if (!is.null(body[[p]])) {
      v <- suppressWarnings(as.numeric(body[[p]]))
      if (is.na(v)) {
        res$status <- 400
        return(list(error = sprintf("Field '%s' is not numeric.", p)))
      }
      inputs[[p]] <- v
    }
  }

  out <- predict_d2t(BUNDLE, inputs)
  list(
    p_d2t = out$p_d2t,
    p_rem = out$p_rem,
    percent_d2t = 100 * out$p_d2t,          # display value: teaching class probability
    predicted_class = out$predicted_class,
    imputed = as.list(out$imputed),
    out_of_range = as.list(out$out_of_range),
    disclaimer = DISCLAIMER
  )
}

#* Deployment gate: run the synthetic test cases and report agreement.
#* @get /selftest
#* @serializer unboxedJSON
function(res) {
  tol <- 1e-10
  csv <- file.path("..", "d2t_teaching_augmented_firth_v1_test_cases.csv")
  cases <- utils::read.csv(csv, check.names = FALSE)
  results <- lapply(seq_len(nrow(cases)), function(i) {
    row <- cases[i, ]
    inputs <- list()
    for (p in BUNDLE$predictors) {
      val <- row[[p]]
      if (!is.na(val)) inputs[[p]] <- as.numeric(val)
    }
    p_d2t <- predict_d2t(BUNDLE, inputs)$p_d2t
    diff <- abs(p_d2t - as.numeric(row[[".pred_d2t"]]))
    list(case_id = row[["case_id"]], p_d2t = p_d2t, diff = diff, pass = diff <= tol)
  })
  worst <- max(vapply(results, function(r) r$diff, numeric(1)))
  fails <- sum(!vapply(results, function(r) r$pass, logical(1)))
  if (fails > 0) res$status <- 500
  list(
    tolerance = tol,
    n = length(results),
    failures = fails,
    max_diff = worst,
    pass = fails == 0,
    cases = results
  )
}

# Small null-coalescing helper used above.
`%||%` <- function(a, b) if (is.null(a) || length(a) == 0) b else a
