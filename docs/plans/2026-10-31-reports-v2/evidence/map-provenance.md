# Map provenance record (D5 §5)

Recorded 2026-11-04 from the artifact actually downloaded with `npm pack us-atlas@3.0.1`, into an empty folder outside the repository. The tarball was read as data.

1. **Asset:** us-atlas 3.0.1.
   - Registry `dist.integrity`: `sha512-wEIZCq0ImPvGblTd8gZMqNNCPkQshugMUG/8nkSWXb02+XqNFREg9atHOKP9w6prLZTpqcLhSvdBW81MkV3/0Q==`; shasum `367d64e4b31d3f945827710f1a43813c38e17d6b`.
   - Tarball sha256: `e6daba1800885868303ad3549da62f85a557b8142bb72629ec15651de62f9c5d`.
   - All three equal the D5 expected values.
2. **`package/states-albers-10m.json`:** sha256 `6e7bb086a3c791490361968a3094f377f7726c5d0c4900fec03cc42db2305a3d`, equal to the expected value.
3. **`package/LICENSE`:** sha256 `8048290dfdb6e83fbed17e8985c8cfc4ce9da9b842642f3d3e497280790cfa31`, equal to the expected value. Verbatim:

   ```
   Copyright 2013-2019 Michael Bostock

   Permission to use, copy, modify, and/or distribute this software for any purpose
   with or without fee is hereby granted, provided that the above copyright notice
   and this permission notice appear in all copies.

   THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
   REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND
   FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
   INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS
   OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER
   TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF
   THIS SOFTWARE.
   ```
4. **README source statement**, quoted: "This repository provides a convenient redistribution of the Census Bureau's cartographic boundary shapefiles, 2017 edition as TopoJSON." The states-albers file is described as "projected using d3.geoAlbersUsa" and derived from the Census Bureau's cartographic state boundaries.
5. **Generator** `scripts/geo/build-us-state-paths.mjs`: sha256 `65611806d85cd797b23d757495cdfae16601395fd65a3a43e4e7778ee1917f38`.
   - It uses Node built-ins only and is pinned to the tarball, input and LICENSE hashes.
   - It refuses on a checksum mismatch, a geometry count other than 51, or an unknown FIPS code.
6. **Module** `src/components/reports/regional/usStatePaths.ts`: sha256 `8743d131d5dc8833a9459fd2ab89a112eeeee346e957d628dd22719b5d858ea2`.
   - Reproducible: two runs gave the same hash.
   - 51 states, viewBox `-58 12 1016 596`, bbox -58…957 × 13…607.
   - Paths: 37,350 B raw, 9,912 B gzip.
7. **Historical Census metadata — verified 2026-11-06 00:32 UTC.** Documentation-only provenance added to the preparation branch; the frozen map asset is unchanged and owner acceptance remains pending.

   - U.S. Census Bureau, **2017 Cartographic Boundary Shapefiles**:
     https://www.census.gov/geographies/mapping-files/2017/geo/carto-boundary-file.html
     Its States section links `cb_2017_us_state_500k.zip`, `cb_2017_us_state_5m.zip` and `cb_2017_us_state_20m.zip`.
   - U.S. Census Bureau, **2017 Cartographic Boundary Files Naming Convention**, page 1:
     https://www2.census.gov/geo/tiger/GENZ2017/2017_file_name_def.pdf
     Relevant quotation: “2017 Cartographic Boundary Files Naming Convention”.
     Pattern `cb_2017_ss_entity_rr.zip`: us denotes national coverage, STATE denotes states/equivalents, and resolutions are 1:500,000, 1:5,000,000 and 1:20,000,000.
   - U.S. Census Bureau, **2017 TIGER/Line Shapefiles Technical Documentation**, Chapter 1, §1.6, printed page 1-2:
     https://www2.census.gov/geo/pdfs/maps-data/data/tiger/tgrshp2017/TGRSHP2017_TechDoc_Ch1.pdf
     Relevant quotation: “Copyright protection is not available for any work of the United States Government (Title 17 U.S.C., Section 105).”
     The paragraph permits reproduction and requests Census Bureau attribution.
   - Upstream edition/transformation bridge: https://github.com/topojson/us-atlas/blob/v3.0.1/README.md
     Read at v3.0.1, Git blob `8e3430082199df3d7be65e795a12a68fcf33d0e6`. The states-albers-10m entry identifies the 2017 state-boundary source and its quantization, Albers USA projection and simplification. The atlas's 10m filename is not evidence of a Census 1:10,000,000 source scale; no such resolution is claimed.

8. **Validation retained.** The frozen generator and generated module were re-hashed and match items 5–6. Upstream tarball/input/license hashes and two-run reproducibility remain recorded 2026-11-04 evidence, not a new re-download this session. No geometry or checksum guard changed. Preserve the full us-atlas license above alongside Census source attribution.

9. **Acceptance.** Source documentation is prepared. The Package F map merge remains blocked until Chris accepts this record and the final visual package.
