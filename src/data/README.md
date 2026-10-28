# Bundled reference data

- `us-places.json`: US populated places with population ≥ 1000 as `[name, state, population, lat, lon]`,
  sorted by population. Source: GeoNames `cities1000` export (https://www.geonames.org/),
  licensed CC BY 4.0; neighborhood records (PPLX) dropped, one entry per name + state.
  Used only for the city typeahead on the search form. Regenerate: see docs/OPERATIONS.md.
- `countries.json`: `[code, name, continent]` from GeoNames `countryInfo.txt`.
- `regions.json`: `[country, code, name, asciiName]` first-level regions from GeoNames `admin1CodesASCII.txt`
  (US entries use USPS state codes).
- `world-places.json`: `[name, asciiName, country, region, population, lat, lon]` for every place with
  ≥ 15,000 inhabitants outside the US, from GeoNames `cities15000` (CC BY 4.0), sorted by population.
  Build all three with `scripts/build-geo-data.ts`.

