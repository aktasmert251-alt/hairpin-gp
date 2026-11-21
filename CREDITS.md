# HAIRPIN GP: Katkılar ve Lisanslar

HAIRPIN GP'deki tüm takımlar, sürücüler, sponsorlar, logolar ve araç tasarımları **kurgusaldır**. Gerçek bir takım, kişi veya markayla ilgisi yoktur. Logolar, simgeler ve araç boyamaları bu proje için üretilmiş özgün CSS/SVG/canvas geometrisidir.

## Yazılım kütüphaneleri

| Bileşen | Lisans |
|---|---|
| three.js | MIT |
| postprocessing | Zlib |
| n8ao | CC0 1.0 (package.json field: ISC) |
| lil-gui (dağıtılan sandbox sahneleri) | MIT |
| GSAP | GreenSock Standard "no charge" lisansı (https://gsap.com/standard-license/); GSAP, GreenSock'a aittir |
| Vite, Vitest, Playwright, TypeScript | MIT / Apache-2.0 (yalnız geliştirme) |

## Veri

- Pist geometrisi ve çevre ayak izleri OpenStreetMap verisinden türetilmiştir: © OpenStreetMap contributors, ODbL 1.0. Türetilen `*.raw.json` dosyaları da ODbL altında sunulur.
- Yükseklik verisi: EU-DEM v1.1, Avrupa Birliği tarafından finanse edilen Copernicus verisi ve bilgisiyle üretilmiştir; OpenTopoData üzerinden alınmıştır.
- Dokular: Poly Haven, CC0 1.0 (atıf zorunlu değil, yine de teşekkürler).
- Yazı tipi: Barlow ve Barlow Condensed (Jeremy Tribby / The Barlow Project Authors), SIL Open Font License 1.1.

Aşağıdaki bölümler `public/assets/*/CREDITS.part.md` dosyalarından birleştirilmiştir.

---

<!-- public/assets/env/CREDITS.part.md -->
# Environment (Çevre) credits

## Data
| File | Source | Licence | Author |
|---|---|---|---|
| `src/track/data/istanbul.raw.json` (track, pit lane, scenery footprints) | OpenStreetMap: ways 179048507, 295742111 via https://overpass-api.de/api/interpreter; scenery via https://api.openstreetmap.org/api/0.6/map.json?bbox=29.396,40.945,29.425,40.966 | ODbL 1.0 | © OpenStreetMap contributors |
| `src/track/data/istanbul.raw.json` (centreline + 3 × 3 km terrain elevation) | EU-DEM v1.1 via https://api.opentopodata.org/v1/eudem25m | Copernicus data, free use with attribution | European Union, Copernicus Land Monitoring Service; served by OpenTopoData |

Attribution strings (also stored in the JSON `attribution` field and in `TrackData.attribution`):
- Track geometry derived from OpenStreetMap data © OpenStreetMap contributors (ODbL 1.0). The derived file istanbul.raw.json is also provided under ODbL.
- Elevation: EU-DEM v1.1, produced using Copernicus data and information funded by the European Union; served via OpenTopoData.

## Textures (Poly Haven, CC0 1.0, 1K JPG; 9.25 MB total)
| File | Source | Licence | Author |
|---|---|---|---|
| `public/assets/env/textures/asphalt_track_diffuse_1k.jpg` | https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/asphalt_track/asphalt_track_diff_1k.jpg (https://polyhaven.com/a/asphalt_track) | CC0 | Dimitrios Savva (Poly Haven) |
| `public/assets/env/textures/asphalt_track_nor_gl_1k.jpg` | https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/asphalt_track/asphalt_track_nor_gl_1k.jpg (https://polyhaven.com/a/asphalt_track) | CC0 | Dimitrios Savva (Poly Haven) |
| `public/assets/env/textures/asphalt_track_rough_1k.jpg` | https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/asphalt_track/asphalt_track_rough_1k.jpg (https://polyhaven.com/a/asphalt_track) | CC0 | Dimitrios Savva (Poly Haven) |
| `public/assets/env/textures/concrete_floor_worn_001_diffuse_1k.jpg` | https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/concrete_floor_worn_001/concrete_floor_worn_001_diff_1k.jpg (https://polyhaven.com/a/concrete_floor_worn_001) | CC0 | Dimitrios Savva, Rico Cilliers (Poly Haven) |
| `public/assets/env/textures/concrete_floor_worn_001_nor_gl_1k.jpg` | https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/concrete_floor_worn_001/concrete_floor_worn_001_nor_gl_1k.jpg (https://polyhaven.com/a/concrete_floor_worn_001) | CC0 | Dimitrios Savva, Rico Cilliers (Poly Haven) |
| `public/assets/env/textures/concrete_floor_worn_001_rough_1k.jpg` | https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/concrete_floor_worn_001/concrete_floor_worn_001_rough_1k.jpg (https://polyhaven.com/a/concrete_floor_worn_001) | CC0 | Dimitrios Savva, Rico Cilliers (Poly Haven) |
| `public/assets/env/textures/gravel_ground_01_diffuse_1k.jpg` | https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/gravel_ground_01/gravel_ground_01_diff_1k.jpg (https://polyhaven.com/a/gravel_ground_01) | CC0 | Rob Tuytel (Poly Haven) |
| `public/assets/env/textures/gravel_ground_01_nor_gl_1k.jpg` | https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/gravel_ground_01/gravel_ground_01_nor_gl_1k.jpg (https://polyhaven.com/a/gravel_ground_01) | CC0 | Rob Tuytel (Poly Haven) |
| `public/assets/env/textures/withered_grass_diffuse_1k.jpg` | https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/withered_grass/withered_grass_diff_1k.jpg (https://polyhaven.com/a/withered_grass) | CC0 | Charlotte Baglioni (Poly Haven) |
| `public/assets/env/textures/withered_grass_nor_gl_1k.jpg` | https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/withered_grass/withered_grass_nor_gl_1k.jpg (https://polyhaven.com/a/withered_grass) | CC0 | Charlotte Baglioni (Poly Haven) |
| `public/assets/env/textures/sparse_grass_diffuse_1k.jpg` | https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/sparse_grass/sparse_grass_diff_1k.jpg (https://polyhaven.com/a/sparse_grass) | CC0 | Amal Kumar (Poly Haven) |
| `public/assets/env/textures/dry_ground_01_diffuse_1k.jpg` | https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/dry_ground_01/dry_ground_01_diff_1k.jpg (https://polyhaven.com/a/dry_ground_01) | CC0 | Rob Tuytel (Poly Haven) |
| `public/assets/env/textures/dry_ground_01_nor_gl_1k.jpg` | https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/dry_ground_01/dry_ground_01_nor_gl_1k.jpg (https://polyhaven.com/a/dry_ground_01) | CC0 | Rob Tuytel (Poly Haven) |

All other environment textures (kerbs, lines, billboards, crowd atlas, sky, clouds) are generated procedurally at load time.

## Lombardy Park Circuit (tracks.md Ek B)
- Lombardy Park Circuit: track geometry and scenery footprints derived from OpenStreetMap data © OpenStreetMap contributors (ODbL 1.0). The derived file lombardia.raw.json is also provided under ODbL. (Source: OSM relation 284565 and way 38168747 via api.openstreetmap.org; scenery via map.json bbox 9.2755,45.6083,9.3020,45.6350.)
- Lombardy Park Circuit elevation: EU-DEM v1.1, produced using Copernicus data and information funded by the European Union; served via OpenTopoData.

## Bosphorus Shore Circuit (tracks.md Ek B)
- Bosphorus Shore Circuit: original layout by the HAIRPIN GP team. Shoreline, buildings and bridge positions derived from OpenStreetMap data © OpenStreetMap contributors (ODbL 1.0). The derived file bosphorus.raw.json is also provided under ODbL. (Source: Overpass API, natural=coastline in bbox 29.000,41.030,29.080,41.090 and the two suspension-bridge outlines; names not stored.)
- Bosphorus Shore Circuit terrain: EU-DEM v1.1, produced using Copernicus data and information funded by the European Union; served via OpenTopoData.

## Ardennes Forest Circuit
- Track geometry, pit lane and scenery derived from OpenStreetMap data © OpenStreetMap contributors (ODbL 1.0), relation 284560 and way 323851541. Derived database: `public/data/tracks/ardennes.raw.json` (ODbL 1.0); https://www.openstreetmap.org/copyright.
- Elevation and terrain: EU-DEM v1.1, produced using Copernicus data and information funded by the European Union, Copernicus Land Monitoring Service; served via OpenTopoData.

---

<!-- public/assets/gra/CREDITS.part.md -->
# Credits: Graphics (GRA) assets

## Fonts

| Asset | Files (`public/assets/gra/fonts/`) | Author | License | Source |
|---|---|---|---|---|
| Barlow Condensed v1.408 (500, 600, 700, 800; latin + latin-ext subsets) | `barlow-condensed-{latin,latin-ext}-{500,600,700,800}-normal.woff2` | Jeremy Tribby / The Barlow Project Authors (https://github.com/jpt/barlow) | SIL Open Font License 1.1 (`fonts/OFL.txt`) | https://github.com/google/fonts/tree/main/ofl/barlowcondensed · files via fontsource `@fontsource/barlow-condensed@5.3.0` on jsDelivr: https://cdn.jsdelivr.net/npm/@fontsource/barlow-condensed@5.3.0/files/ |
| Barlow v1.408 (400, 600; latin + latin-ext subsets) | `barlow-{latin,latin-ext}-{400,600}-normal.woff2` | Jeremy Tribby / The Barlow Project Authors (https://github.com/jpt/barlow) | SIL Open Font License 1.1 (`fonts/OFL.txt`) | https://github.com/google/fonts/tree/main/ofl/barlow · files via fontsource `@fontsource/barlow@5.3.0` on jsDelivr: https://cdn.jsdelivr.net/npm/@fontsource/barlow@5.3.0/files/ |

- `OFL.txt` was taken verbatim from `https://raw.githubusercontent.com/google/fonts/main/ofl/barlowcondensed/OFL.txt`. It is byte-identical to the Barlow copy: Copyright 2017 The Barlow Project Authors.
- The fonts are unmodified. They are served as the Google Fonts subsets distributed by fontsource.
- Downloaded 2026-10-05 by Grafik Dizaynlayıcı (Sprint 0).

## Other GRA assets
- The HAIRPIN GP wordmark, icons, liveries and sponsor marks are original CSS/SVG/canvas geometry made for this project. No third-party logos are used.

---


## Sunucu / Server

- ws: MIT (tam bildirim: `server/THIRD-PARTY-LICENSES.txt`).

## Ek atıflar / Other attribution

- Fragman müziği ve ses efektleri: özgün, sentezlenmiş / original, synthesized.
- Dağıtılan tam lisans bildirimleri: `public/THIRD-PARTY-LICENSES.txt`.
- İstanbul Circuit, Lombardy Park Circuit, Bosphorus Shore Circuit ve Ardennes Forest Circuit: © OpenStreetMap contributors, ODbL 1.0; https://www.openstreetmap.org/copyright. Dört pistin türetilmiş veri dosyaları: `public/data/tracks/` (ODbL 1.0).
- Dört pistin yükseklik/zemin verisi: Copernicus EU-DEM v1.1, © European Union, Copernicus Land Monitoring Service. Produced using Copernicus data and information funded by the European Union; served via OpenTopoData.
