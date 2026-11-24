"""
Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
SPDX-License-Identifier: LicenseRef-PASVL-1.0

Every map on screen carries its attribution.

The tiles come from OpenStreetMap, the geocoding from Nominatim and the routing
from OSRM — all free, all conditional on crediting them. A map component without
the attribution element is a licence violation, not a design choice.
"""

from __future__ import annotations

from pathlib import Path

from lib import Finding, read, relative, walk

MAP_MARKERS = ("maplibre", "MaplibreMap", "MapLibre", "osrm", "nominatim")


def check(root: Path) -> list[Finding]:
    findings: list[Finding] = []
    for path in walk(root, {".tsx", ".ts", ".kt"}):
        rel = relative(path, root)
        text = read(path)
        if not any(marker in text for marker in MAP_MARKERS):
            continue
        if "OpenStreetMap" in text:
            continue
        findings.append(Finding("osm-attribution", rel, 0, "map component carries no OpenStreetMap attribution"))
    return findings
