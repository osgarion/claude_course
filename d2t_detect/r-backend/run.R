#!/usr/bin/env Rscript
# Entry point: launch the plumber API.
#   Rscript run.R            # defaults to port 8138
#   PORT=9000 Rscript run.R
#
# Run from the r-backend/ directory so relative paths (R/, ../*.rds/.csv) resolve.

if (!requireNamespace("plumber", quietly = TRUE)) {
  stop("Package 'plumber' is required. Install with: install.packages('plumber')")
}

port <- as.integer(Sys.getenv("PORT", "8138"))
host <- Sys.getenv("HOST", "127.0.0.1")

pr <- plumber::plumb("plumber.R")
message(sprintf("D2T teaching classifier API on http://%s:%d", host, port))
pr$run(host = host, port = port)
