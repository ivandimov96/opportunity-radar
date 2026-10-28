# Bundled reference data

- `us-places.json`: US populated places with population ≥ 1000 as `[name, state, population, lat, lon]`,
  sorted by population. Source: GeoNames `cities1000` export (https://www.geonames.org/),
  licensed CC BY 4.0; neighborhood records (PPLX) dropped, one entry per name + state.
  Used only for the city typeahead on the search form. Regenerate: see docs/OPERATIONS.md.
