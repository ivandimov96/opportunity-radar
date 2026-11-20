/**
 * Ideas for the "Kind of business" field of a search: common kinds of
 * owner-run businesses, in the words people type into a map, grouped by field.
 * They only fill the field; any other words work just as well. An entry with a
 * `preset` selects that ready-made type (which offers sub-categories) instead.
 */
export interface BusinessKind {
  label: string;
  /** Key of a ready-made type (src/lib/industries) this entry stands for. */
  preset?: string;
}

export interface BusinessKindGroup {
  key: string;
  label: string;
  kinds: BusinessKind[];
}

const k = (...labels: string[]): BusinessKind[] => labels.map((label) => ({ label }));

export const BUSINESS_KIND_GROUPS: BusinessKindGroup[] = [
  { key: "trades", label: "Trades and building", kinds: [...k("Roofers", "Electricians", "Plumbers", "Builders", "Scaffolding companies", "Flooring companies", "Glaziers", "Fencing contractors", "Kitchen fitters"), { label: "Heating, plumbing and electrical", preset: "home_services" }, { label: "Landscaping and lawn care", preset: "landscaping" }] },
  { key: "making", label: "Making and industry", kinds: k("Metal fabricators", "Sign makers", "Printers", "Joinery workshops", "Engineering companies", "Powder coating", "Packaging suppliers", "Machine shops", "Plastics manufacturers") },
  { key: "vehicles", label: "Vehicles and transport", kinds: [{ label: "Car repair garages", preset: "auto_repair" }, ...k("Van hire", "Removal companies", "Couriers", "Coach hire", "Vehicle body shops", "Skip hire", "Haulage companies")] },
  { key: "property", label: "Property and upkeep", kinds: k("Letting agents", "Estate agents", "Cleaning companies", "Fire protection services", "Security systems installers", "Pest control", "Lift maintenance", "Property management companies") },
  { key: "professional", label: "Professional services", kinds: k("Accountants", "Solicitors", "Architects", "Surveyors", "Recruitment agencies", "Insurance brokers", "IT support companies", "Bookkeepers") },
  { key: "health", label: "Health and care", kinds: [{ label: "Dental practices", preset: "dental" }, ...k("Physiotherapists", "Opticians", "Veterinary practices", "Care homes", "Private clinics", "Chiropractors", "Home care agencies")] },
  { key: "training", label: "Training and childcare", kinds: k("Forklift training", "Driving schools", "First aid training", "Nurseries", "Tutoring centres", "Health and safety training", "Dance schools") },
  { key: "events", label: "Events and food", kinds: k("Caterers", "Event hire", "Wedding venues", "Marquee hire", "Bakeries", "Florists", "Print and embroidery shops") },
];

const fold = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Entries whose label contains what was typed (word starts first). Nothing for fewer than two letters or an exact match. */
export function matchBusinessKinds(text: string, limit = 6, groups: BusinessKindGroup[] = BUSINESS_KIND_GROUPS): BusinessKind[] {
  const q = fold(text);
  if (q.length < 2) return [];
  // The short ideas first (they may stand for a ready-made type), then the long list.
  const short = groups.flatMap((g) => g.kinds);
  const seen = new Set(short.map((x) => fold(x.label)));
  const all = [...short, ...(groups === BUSINESS_KIND_GROUPS ? ALL_BUSINESS_TYPES.flatMap((f) => f.types).filter((x) => !seen.has(fold(x)) && seen.add(fold(x))).map((label) => ({ label })) : [])];
  if (all.some((x) => fold(x.label) === q)) return [];
  const starts = all.filter((x) => fold(x.label).split(" ").some((w) => w.startsWith(q)) || fold(x.label).startsWith(q));
  const contains = all.filter((x) => !starts.includes(x) && fold(x.label).includes(q));
  return [...starts, ...contains].slice(0, limit);
}

/**
 * The long list: business types as Google Maps names them (the categories its
 * listings are filed under), by field, in plain plural words. A search passes
 * words to Google Maps, not a code, so this list is a guide and not a limit:
 * anything a customer would type works. Kept broad on purpose; types that are
 * not businesses one can write to (parks, airports, town halls) are left out.
 */
const t = (s: string): string[] => s.split(",").map((x) => x.trim()).filter(Boolean);

export const ALL_BUSINESS_TYPES: { field: string; types: string[] }[] = [
  { field: "Vehicles", types: t("Car dealers, Used car dealers, Car repair garages, Car body shops, Car washes, Car detailing services, Car rental agencies, Van hire, Tyre shops, MOT centres, Motorcycle dealers, Motorcycle repair shops, Auto parts stores, Auto electricians, Windscreen repair services, Vehicle wrapping services, Towing services, Truck repair shops, Trailer dealers, Caravan dealers, Boat dealers, Boat repair shops, Bicycle shops, Bicycle repair shops, Driving schools, Electric vehicle charging installers") },
  { field: "Building and trades", types: t("Builders, General contractors, Roofers, Electricians, Plumbers, Heating engineers, Air conditioning contractors, Painters and decorators, Plasterers, Carpenters, Joiners, Bricklayers, Tilers, Flooring companies, Carpet fitters, Glaziers, Window installers, Door suppliers, Garage door suppliers, Kitchen fitters, Bathroom fitters, Scaffolding companies, Fencing contractors, Paving contractors, Driveway contractors, Groundworks contractors, Demolition contractors, Insulation contractors, Damp proofing specialists, Loft conversion specialists, Conservatory installers, Solar panel installers, Swimming pool contractors, Stonemasons, Locksmiths, Handyman services, Home builders, Shopfitters, Civil engineering companies, Drainage services, Chimney sweeps, Gutter cleaning services, Tree surgeons, Landscapers, Garden designers, Lawn care services") },
  { field: "Making and industry", types: t("Metal fabricators, Steel fabricators, Welders, Machine shops, Engineering companies, Sheet metal contractors, Powder coating services, Sign makers, Printers, Commercial printers, Screen printers, Embroidery services, Packaging suppliers, Plastics manufacturers, Furniture makers, Joinery workshops, Cabinet makers, Upholsterers, Glass manufacturers, Tool makers, Electronics manufacturers, Food manufacturers, Clothing manufacturers, Textile mills, Chemical manufacturers, Industrial equipment suppliers, Hydraulic repair services, Electric motor repair shops, Laser cutting services, 3D printing services, Injection moulding companies, Foundries, Sawmills, Timber merchants, Builders merchants, Wholesalers, Recycling centres, Scrap metal dealers") },
  { field: "Transport and storage", types: t("Removal companies, Couriers, Haulage companies, Freight forwarders, Logistics companies, Warehouses, Self storage facilities, Coach hire companies, Minibus hire, Taxi services, Chauffeur services, Skip hire, Waste management services, Pallet suppliers, Shipping companies, Customs brokers, Forklift dealers, Forklift training, Plant hire, Tool hire, Crane hire") },
  { field: "Property and upkeep", types: t("Estate agents, Letting agents, Commercial property agents, Property management companies, Surveyors, Cleaning companies, Commercial cleaning services, Window cleaners, Carpet cleaning services, Pest control services, Fire protection services, Fire alarm suppliers, Security system installers, CCTV installers, Security guard services, Lift maintenance companies, Facilities management companies, Electrical testing services, Asbestos removal services, Pressure washing services, Janitorial services, Serviced offices, Coworking spaces, Holiday home rental agencies, Property developers, Home inspectors, Interior designers, Blind and curtain shops") },
  { field: "Professional services", types: t("Accountants, Bookkeepers, Tax advisers, Solicitors, Law firms, Notaries, Architects, Structural engineers, Planning consultants, Quantity surveyors, Recruitment agencies, Employment agencies, Insurance brokers, Insurance agencies, Financial advisers, Mortgage brokers, Business consultants, Management consultants, Marketing agencies, Advertising agencies, Web designers, Graphic designers, IT support companies, Software companies, Telecommunications companies, Translation services, Photographers, Videographers, Public relations firms, Market researchers, Patent attorneys, Private investigators, Payroll services, HR consultants, Health and safety consultants, Environmental consultants, Energy consultants, Debt collection agencies, Auctioneers, Valuers") },
  { field: "Health and care", types: t("Dental practices, Orthodontists, Dental laboratories, Doctors, Private clinics, Medical centres, Physiotherapists, Chiropractors, Osteopaths, Podiatrists, Opticians, Hearing aid shops, Pharmacies, Psychologists, Counsellors, Speech therapists, Occupational therapists, Dietitians, Acupuncture clinics, Massage therapists, Cosmetic clinics, Skin care clinics, Hair removal services, Care homes, Nursing homes, Home care agencies, Medical laboratories, Medical supply shops, Mobility shops, Veterinary practices, Animal hospitals, Sports injury clinics, Fertility clinics, Rehabilitation centres") },
  { field: "Beauty and personal care", types: t("Hair salons, Barber shops, Beauty salons, Nail salons, Spas, Tanning salons, Tattoo shops, Make-up artists, Eyelash salons, Wig shops, Laundries, Dry cleaners, Tailors, Shoe repair shops, Funeral directors, Personal trainers, Yoga studios, Pilates studios, Gyms, Fitness centres, Martial arts schools, Dance schools, Swimming schools, Weight loss services") },
  { field: "Training and education", types: t("Nurseries, Preschools, Childminders, Private schools, Tutoring centres, Language schools, Music schools, Art schools, Driving instructors, First aid training, Health and safety training, Vocational training centres, Computer training schools, Cookery schools, Flight schools, Sailing schools, Riding schools, Training providers, After-school clubs, Educational consultants, Exam centres") },
  { field: "Food and drink", types: t("Restaurants, Cafes, Coffee shops, Bakeries, Butchers, Fishmongers, Greengrocers, Delicatessens, Caterers, Takeaways, Pizza takeaways, Pubs, Bars, Wine bars, Breweries, Distilleries, Wineries, Wine merchants, Tea rooms, Ice cream shops, Sandwich shops, Food trucks, Farm shops, Health food shops, Confectioners, Cake shops, Food wholesalers, Coffee roasters, Juice bars, Catering equipment suppliers") },
  { field: "Events and leisure", types: t("Wedding venues, Event venues, Conference centres, Event planners, Wedding planners, Marquee hire, Event hire, Party supply shops, Florists, DJs, Bands, Photo booth hire, Bouncy castle hire, Children's party venues, Escape rooms, Bowling alleys, Golf clubs, Golf courses, Tennis clubs, Climbing centres, Trampoline parks, Soft play centres, Go-kart tracks, Paintball centres, Cinemas, Theatres, Art galleries, Museums, Travel agencies, Tour operators, Boat hire, Fishing lakes, Equestrian centres, Campsites, Caravan parks") },
  { field: "Places to stay", types: t("Hotels, Guest houses, Bed and breakfasts, Hostels, Holiday cottages, Serviced apartments, Holiday parks, Motels, Inns, Lodges, Glamping sites") },
  { field: "Shops", types: t("Furniture shops, Kitchen showrooms, Bathroom showrooms, Bed shops, Carpet shops, Tile shops, Lighting shops, Hardware shops, DIY shops, Garden centres, Electrical appliance shops, Electronics shops, Computer shops, Mobile phone shops, Phone repair shops, Clothing shops, Bridal shops, Shoe shops, Jewellers, Watch repair shops, Gift shops, Toy shops, Book shops, Stationery shops, Art supply shops, Craft shops, Music shops, Sports shops, Outdoor shops, Fishing tackle shops, Pet shops, Dog groomers, Kennels, Catteries, Dog trainers, Antique shops, Charity shops, Pawn shops, Vape shops, Newsagents, Convenience stores, Supermarkets, Cosmetics shops, Perfume shops, Baby shops, Fabric shops, Sewing shops, Picture framers, Trophy shops, Workwear suppliers, Uniform suppliers, Office supply shops, Office furniture suppliers, Farm supply shops, Agricultural machinery dealers, Pool and spa shops, Fireplace shops, Mattress shops, Piano shops, Second-hand shops") },
  { field: "Farming and outdoors", types: t("Farms, Nurseries and plant growers, Agricultural contractors, Livestock dealers, Feed suppliers, Fencing suppliers, Forestry services, Fisheries, Stables, Vineyards, Orchards, Garden machinery dealers, Irrigation contractors, Land agents") },
];

/** Every type of the long list, once, A to Z. */
export const ALL_BUSINESS_TYPE_COUNT = new Set(ALL_BUSINESS_TYPES.flatMap((f) => f.types.map((x) => x.toLowerCase()))).size;

/** The long list narrowed to what was typed; fields with nothing left are dropped. */
export function filterBusinessTypes(text: string): { field: string; types: string[] }[] {
  const q = fold(text);
  if (!q) return ALL_BUSINESS_TYPES;
  return ALL_BUSINESS_TYPES.map((f) => ({ field: f.field, types: f.types.filter((x) => fold(x).includes(q) || fold(f.field).includes(q)) })).filter((f) => f.types.length);
}
