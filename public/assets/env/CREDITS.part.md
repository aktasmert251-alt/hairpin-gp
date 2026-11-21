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

## Ardennes Forest Circuit (docs/design/tracks-spa.md §14)
- Ardennes Forest Circuit: track geometry and scenery footprints derived from OpenStreetMap data © OpenStreetMap contributors (ODbL 1.0). The derived file ardennes.raw.json is also provided under ODbL. (Source: OSM relation 284560 and way 323851541 via api.openstreetmap.org; scenery via map.json bbox 5.948,50.424,5.989,50.450; names not stored.)
- Ardennes Forest Circuit elevation: EU-DEM v1.1, produced using Copernicus data and information funded by the European Union; served via OpenTopoData.
