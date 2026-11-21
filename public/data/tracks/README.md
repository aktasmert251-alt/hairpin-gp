# HAIRPIN GP derived track data

istanbul.raw.json, lombardia.raw.json and bosphorus.raw.json are the derived databases used by the game. Geometry and scenery footprints (and coastline/bridge positions for the original Bosphorus layout) derive from © OpenStreetMap contributors. These derived databases are available under ODbL 1.0: https://opendatacommons.org/licenses/odbl/1-0/

Source and attribution: https://www.openstreetmap.org/copyright

Elevation and terrain use Copernicus EU-DEM v1.1: (c) European Union, Copernicus Land Monitoring Service. Produced using Copernicus data and information funded by the European Union; served via OpenTopoData.

The three files match src/track/data/*.raw.json. When changing those files, copy them here again; tests/arch/legal-release.test.ts checks byte equality.
