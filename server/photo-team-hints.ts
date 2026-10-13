import type { EntryRow } from "@shared/schema";

const normalize = (value: string) => value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
  .toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const teamCore = (value: string) => normalize(value)
  .replace(/(?:\s+(?:esport|esports|racing|team))+$/, "");
// Only literal manufacturer branding matching the registered car/manufacturer
// is non-team evidence. Arbitrary sponsor strings are NOT exempted.
const brands = new Set(["acura", "alpine", "aston martin", "audi", "bentley", "bmw",
  "cadillac", "chevrolet", "corvette", "ferrari", "ford", "honda", "hyundai",
  "lamborghini", "lexus", "mclaren", "mercedes", "mercedes amg", "mercedes benz",
  "nissan", "peugeot", "porsche", "renault", "toyota", "volkswagen"]);

/** A hint can only veto; the number-backed reference supplies every identity. */
export function photoTeamHintConflict(hint: string, entry: EntryRow, applicableTeams: string[]) {
  const visible = normalize(hint), registered = normalize(entry.team);
  if (!visible || !registered || visible === registered) return false;
  const car = normalize(entry.car), manufacturer = normalize(entry.manufacturer || "");
  if (brands.has(visible) && (manufacturer === visible || car === visible || car.startsWith(`${visible} `)))
    return false;

  // Not substring/fuzzy matching: remove only terminal organisational suffixes.
  // Require a complete >=2-word core and a single spelling in the applicable
  // event/session reference set. Similar teams (e.g. Junior) remain conflicts.
  const core = teamCore(entry.team);
  if (core.split(" ").length >= 2 && teamCore(hint) === core) {
    const candidates = new Set(applicableTeams.filter(team => teamCore(team) === core).map(normalize));
    if (candidates.size === 1 && candidates.has(registered)) return false;
  }
  return true;
}

export function photoManufacturerHintConflict(hint: string, entry: EntryRow) {
  const visible = normalize(hint), registered = normalize(entry.manufacturer || "");
  if (!visible) return false;
  if (registered) return visible !== registered;
  // Entry lists often leave manufacturer empty but name it literally in car.
  // Only recognised explicit brands can veto here; never infer from appearance.
  if (!brands.has(visible)) return false;
  const car = normalize(entry.car);
  const carBrand = Array.from(brands).sort((a, b) => b.length - a.length)
    .find(brand => car === brand || car.startsWith(`${brand} `));
  const family = (brand: string) => brand.startsWith("mercedes") ? "mercedes"
    : brand === "corvette" ? "chevrolet" : brand;
  return !!carBrand && family(visible) !== family(carBrand);
}
