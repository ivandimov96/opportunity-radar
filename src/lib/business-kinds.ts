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
  { key: "trades", label: "Trades and building", kinds: [...k("Roofers", "Electricians", "Plumbers", "Builders", "Scaffolding companies", "Flooring companies", "Glaziers", "Fencing contractors", "Kitchen installers"), { label: "Heating, plumbing and electrical", preset: "home_services" }, { label: "Landscaping and lawn care", preset: "landscaping" }] },
  { key: "making", label: "Making and industry", kinds: k("Metal fabricators", "Sign makers", "Printers", "Woodworking shops", "Engineering companies", "Powder coating", "Packaging suppliers", "Machine shops", "Plastics manufacturers") },
  { key: "vehicles", label: "Vehicles and transport", kinds: [{ label: "Car repair shops", preset: "auto_repair" }, ...k("Van rental", "Moving companies", "Couriers", "Bus charter companies", "Vehicle body shops", "Dumpster rental", "Trucking companies")] },
  { key: "property", label: "Property and upkeep", kinds: k("Rental agencies", "Real estate agencies", "Cleaning companies", "Fire protection services", "Security systems installers", "Pest control", "Elevator maintenance", "Property management companies") },
  { key: "professional", label: "Professional services", kinds: k("Accountants", "Law firms", "Architects", "Land surveyors", "Recruitment agencies", "Insurance brokers", "IT support companies", "Bookkeepers") },
  { key: "health", label: "Health and care", kinds: [{ label: "Dental clinics", preset: "dental" }, ...k("Physiotherapists", "Opticians", "Veterinary clinics", "Nursing homes", "Private clinics", "Chiropractors", "Home care agencies")] },
  { key: "training", label: "Training and childcare", kinds: k("Forklift training", "Driving schools", "First aid training", "Daycare centers", "Tutoring centers", "Health and safety training", "Dance schools") },
  { key: "events", label: "Events and food", kinds: k("Caterers", "Event rentals", "Wedding venues", "Tent rentals", "Bakeries", "Florists", "Print and embroidery shops") },
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
  { field: "Vehicles", types: t("Car dealers, Used car dealers, Car repair shops, Car body shops, Car washes, Car detailing services, Car rental agencies, Van rental, Tire shops, Vehicle inspection centers, Motorcycle dealers, Motorcycle repair shops, Auto parts stores, Auto electricians, Windshield repair services, Vehicle wrapping services, Towing services, Truck repair shops, Trailer dealers, RV dealers, Boat dealers, Boat repair shops, Bicycle shops, Bicycle repair shops, Driving schools, Electric vehicle charging installers") },
  { field: "Building and trades", types: t("Builders, General contractors, Roofers, Electricians, Plumbers, Heating contractors, Air conditioning contractors, Painters, Plasterers, Carpenters, Woodworkers, Bricklayers, Tilers, Flooring companies, Carpet installers, Glaziers, Window installers, Door suppliers, Garage door suppliers, Kitchen installers, Bathroom remodelers, Scaffolding companies, Fencing contractors, Paving contractors, Driveway contractors, Excavation contractors, Demolition contractors, Insulation contractors, Waterproofing contractors, Attic conversion contractors, Sunroom installers, Solar panel installers, Swimming pool contractors, Stonemasons, Locksmiths, Handyman services, Home builders, Store fixture installers, Civil engineering companies, Drainage services, Chimney sweeps, Gutter cleaning services, Tree services, Landscapers, Landscape designers, Lawn care services") },
  { field: "Making and industry", types: t("Metal fabricators, Steel fabricators, Welders, Machine shops, Engineering companies, Sheet metal contractors, Powder coating services, Sign makers, Printers, Commercial printers, Screen printers, Embroidery services, Packaging suppliers, Plastics manufacturers, Furniture makers, Woodworking shops, Cabinet makers, Upholsterers, Glass manufacturers, Tool makers, Electronics manufacturers, Food manufacturers, Clothing manufacturers, Textile mills, Chemical manufacturers, Industrial equipment suppliers, Hydraulic repair services, Electric motor repair shops, Laser cutting services, 3D printing services, Injection molding companies, Foundries, Sawmills, Lumber yards, Building supply stores, Wholesalers, Recycling centers, Scrap metal dealers") },
  { field: "Transport and storage", types: t("Moving companies, Couriers, Trucking companies, Freight forwarders, Logistics companies, Warehouses, Self storage facilities, Bus charter companies, Minibus rental, Taxi services, Chauffeur services, Dumpster rental, Waste management services, Pallet suppliers, Shipping companies, Customs brokers, Forklift dealers, Forklift training, Equipment rental, Tool rental, Crane rental") },
  { field: "Property and upkeep", types: t("Real estate agencies, Rental agencies, Commercial real estate agencies, Property management companies, Land surveyors, Cleaning companies, Commercial cleaning services, Window cleaners, Carpet cleaning services, Pest control services, Fire protection services, Fire alarm suppliers, Security system installers, CCTV installers, Security guard services, Elevator maintenance companies, Facilities management companies, Electrical testing services, Asbestos removal services, Pressure washing services, Janitorial services, Serviced offices, Coworking spaces, Vacation rental agencies, Property developers, Home inspectors, Interior designers, Blind and curtain shops") },
  { field: "Professional services", types: t("Accountants, Bookkeepers, Tax advisors, Law firms, Lawyers, Notaries, Architects, Structural engineers, Planning consultants, Construction cost consultants, Recruitment agencies, Employment agencies, Insurance brokers, Insurance agencies, Financial advisors, Mortgage brokers, Business consultants, Management consultants, Marketing agencies, Advertising agencies, Web designers, Graphic designers, IT support companies, Software companies, Telecommunications companies, Translation services, Photographers, Videographers, Public relations firms, Market researchers, Patent attorneys, Private investigators, Payroll services, HR consultants, Health and safety consultants, Environmental consultants, Energy consultants, Debt collection agencies, Auctioneers, Appraisers") },
  { field: "Health and care", types: t("Dental clinics, Orthodontists, Dental laboratories, Doctors, Private clinics, Medical centers, Physiotherapists, Chiropractors, Osteopaths, Podiatrists, Opticians, Hearing aid shops, Pharmacies, Psychologists, Counselors, Speech therapists, Occupational therapists, Dietitians, Acupuncture clinics, Massage therapists, Cosmetic clinics, Skin care clinics, Hair removal services, Nursing homes, Assisted living facilities, Home care agencies, Medical laboratories, Medical supply shops, Mobility equipment stores, Veterinary clinics, Animal hospitals, Sports injury clinics, Fertility clinics, Rehabilitation centers") },
  { field: "Beauty and personal care", types: t("Hair salons, Barber shops, Beauty salons, Nail salons, Spas, Tanning salons, Tattoo shops, Make-up artists, Eyelash salons, Wig shops, Laundries, Dry cleaners, Tailors, Shoe repair shops, Funeral homes, Personal trainers, Yoga studios, Pilates studios, Gyms, Fitness centers, Martial arts schools, Dance schools, Swimming schools, Weight loss services") },
  { field: "Training and education", types: t("Daycare centers, Preschools, Childcare providers, Private schools, Tutoring centers, Language schools, Music schools, Art schools, Driving instructors, First aid training, Health and safety training, Vocational training centers, Computer training schools, Cooking schools, Flight schools, Sailing schools, Riding schools, Training providers, After-school programs, Educational consultants, Exam centers") },
  { field: "Food and drink", types: t("Restaurants, Cafes, Coffee shops, Bakeries, Butchers, Fish markets, Produce markets, Delicatessens, Caterers, Takeout restaurants, Pizza restaurants, Pubs, Bars, Wine bars, Breweries, Distilleries, Wineries, Wine shops, Tea rooms, Ice cream shops, Sandwich shops, Food trucks, Farm shops, Health food shops, Candy stores, Cake shops, Food wholesalers, Coffee roasters, Juice bars, Catering equipment suppliers") },
  { field: "Events and leisure", types: t("Wedding venues, Event venues, Conference centers, Event planners, Wedding planners, Tent rentals, Event rentals, Party supply shops, Florists, DJs, Bands, Photo booth rentals, Bounce house rentals, Children's party venues, Escape rooms, Bowling alleys, Golf clubs, Golf courses, Tennis clubs, Climbing centers, Trampoline parks, Indoor playgrounds, Go-kart tracks, Paintball centers, Cinemas, Theaters, Art galleries, Museums, Travel agencies, Tour operators, Boat rentals, Fishing lakes, Equestrian centers, Campgrounds, RV parks") },
  { field: "Places to stay", types: t("Hotels, Guest houses, Bed and breakfasts, Hostels, Vacation rentals, Serviced apartments, Resorts, Motels, Inns, Lodges, Glamping sites") },
  { field: "Shops", types: t("Furniture shops, Kitchen showrooms, Bathroom showrooms, Bed shops, Carpet shops, Tile shops, Lighting shops, Hardware shops, Home improvement stores, Garden centers, Electrical appliance shops, Electronics shops, Computer shops, Mobile phone shops, Phone repair shops, Clothing shops, Bridal shops, Shoe shops, Jewelers, Watch repair shops, Gift shops, Toy shops, Bookstores, Stationery shops, Art supply shops, Craft shops, Music shops, Sports shops, Outdoor shops, Fishing tackle shops, Pet shops, Dog groomers, Kennels, Cat boarding, Dog trainers, Antique shops, Thrift stores, Pawn shops, Vape shops, Newsstands, Convenience stores, Supermarkets, Cosmetics shops, Perfume shops, Baby shops, Fabric shops, Sewing shops, Picture framers, Trophy shops, Workwear suppliers, Uniform suppliers, Office supply shops, Office furniture suppliers, Farm supply shops, Agricultural machinery dealers, Pool and spa shops, Fireplace shops, Mattress shops, Piano shops, Second-hand shops") },
  { field: "Farming and outdoors", types: t("Farms, Plant nurseries, Agricultural contractors, Livestock dealers, Feed suppliers, Fencing suppliers, Forestry services, Fisheries, Stables, Vineyards, Orchards, Garden machinery dealers, Irrigation contractors, Land brokers") },
];

/** Every type of the long list, once, A to Z. */
export const ALL_BUSINESS_TYPE_COUNT = new Set(ALL_BUSINESS_TYPES.flatMap((f) => f.types.map((x) => x.toLowerCase()))).size;

/** The long list narrowed to what was typed; fields with nothing left are dropped. */
export function filterBusinessTypes(text: string): { field: string; types: string[] }[] {
  const q = fold(text);
  if (!q) return ALL_BUSINESS_TYPES;
  return ALL_BUSINESS_TYPES.map((f) => ({ field: f.field, types: f.types.filter((x) => fold(x).includes(q) || fold(f.field).includes(q)) })).filter((f) => f.types.length);
}
