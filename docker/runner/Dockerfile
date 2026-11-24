# Pre-built runner: LibreOffice (headless) + Python deps, so model builds start in seconds
# instead of spending ~10 minutes on apt every run.
FROM ubuntu:24.04
ENV DEBIAN_FRONTEND=noninteractive
RUN rm -f /var/lib/man-db/auto-update \
 && apt-get update -qq \
 && apt-get install -y -qq --no-install-recommends \
      libreoffice-calc-nogui python3-uno python3-pip fonts-liberation git ca-certificates curl \
 && rm -rf /var/lib/apt/lists/*
RUN python3 -m pip install --break-system-packages -q requests pyyaml openpyxl reportlab matplotlib
RUN soffice --headless --terminate_after_init >/dev/null 2>&1 || true
