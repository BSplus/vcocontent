/** Vehicle manufacturers, not sponsor/retailer brands or model guesses. */
export const VEHICLE_MAKE_POLICY="same-car-make-v1" as const;
const makes=["Porsche","Ferrari","BMW","Audi","Mercedes-Benz","McLaren","Lamborghini",
  "Aston Martin","Ford","Chevrolet","Toyota","Honda","Nissan","Hyundai","Kia","Lexus",
  "Volkswagen","Renault","Alpine","Peugeot","Citroën","Opel","Vauxhall","Bentley",
  "Bugatti","Maserati","Alfa Romeo","Fiat","Abarth","Lotus","Jaguar","Land Rover",
  "Mazda","Subaru","Mitsubishi","Suzuki","Skoda","SEAT","Cupra","Volvo","Saab",
  "Dodge","Chrysler","Cadillac","Buick","Pontiac","Tesla","Genesis","Holden",
  "Dallara","Ligier","Oreca","Ginetta","Radical","KTM","Lola","Acura"];
const key=(s:string)=>s.normalize("NFKD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]/g,"");
const known=new Map(makes.map(make=>[key(make),make]));
for(const alias of ["Mercedes","Mercedes AMG","Mercedes-Benz AMG"])known.set(key(alias),"Mercedes-Benz");
known.set("vw","Volkswagen");known.set("chevy","Chevrolet");
export function canonicalVehicleMake(value:unknown):string|undefined {
  return typeof value==="string"&&value.length<=160 ? known.get(key(value)) : undefined;
}
