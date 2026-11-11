#!/usr/bin/env bash
# Licensed under PASVL-1.0. SPDX-License-Identifier: LicenseRef-PASVL-1.0
set -u

failed=0

check_outcome() {
  local step="$1"
  local outcome="$2"
  local message="$3"

  if [[ "$outcome" != "success" ]]; then
    printf '::error::%s: %s (outcome: %s)\n' "$step" "$message" "$outcome"
    failed=1
  fi
}

check_outcome "driver" "${DRIVER_OUTCOME:-missing}" "Pinned PyMySQL installation failed; diagnostics were not run."
check_outcome "audit_chain" "${AUDIT_CHAIN_OUTCOME:-missing}" "Audit chain remains incomplete or the diagnostic failed; this is not a verified result."
check_outcome "orphans" "${ORPHANS_OUTCOME:-missing}" "Orphan check failed or found orphan rows."
check_outcome "retention" "${RETENTION_OUTCOME:-missing}" "Read-only retention report failed."

exit "$failed"
