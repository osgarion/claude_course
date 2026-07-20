#!/usr/bin/env Rscript
# Deployment gate — the README requirement: every synthetic test case must agree
# with .pred_d2t within 1e-10. Runnable WITHOUT the web server (CI-friendly).
# Exits non-zero on any failure.
#
#   Rscript selftest.R      # from the r-backend/ directory

source(file.path("R", "predict.R"), chdir = TRUE)

bundle <- load_bundle()
tol <- 1e-10
csv <- file.path("..", "d2t_teaching_augmented_firth_v1_test_cases.csv")
cases <- utils::read.csv(csv, check.names = FALSE)

worst <- 0
fails <- 0
for (i in seq_len(nrow(cases))) {
  row <- cases[i, ]
  inputs <- list()
  for (p in bundle$predictors) {
    val <- row[[p]]
    if (!is.na(val)) inputs[[p]] <- as.numeric(val)
  }
  p_d2t <- predict_d2t(bundle, inputs)$p_d2t
  diff <- abs(p_d2t - as.numeric(row[[".pred_d2t"]]))
  worst <- max(worst, diff)
  ok <- diff <= tol
  if (!ok) fails <- fails + 1
  message(sprintf(
    "%-24s p_d2t=%.12f  diff=%.2e  %s",
    row[["case_id"]], p_d2t, diff, if (ok) "PASS" else "FAIL"
  ))
}

message(sprintf("\nmax diff %.2e  (tolerance %.0e)", worst, tol))
if (fails > 0) {
  message(sprintf("SELF-TEST FAILED: %d/%d cases off tolerance", fails, nrow(cases)))
  quit(status = 1)
}
message(sprintf("SELF-TEST PASSED: %d/%d cases within tolerance", nrow(cases), nrow(cases)))
