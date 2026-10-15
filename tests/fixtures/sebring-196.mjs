// Read-only live snapshot, 15 October 2026. Official registered lineup, not
// physical driver identity. Other rows need only their team for alias ambiguity.
export const sebringEntry = {
  number:"196", team:"BS TURNER", car:"BMW M4 GT3",
  drivers:"Daniel Lafuente, Oskari Rinne", manufacturer:"",
  racingClass:"", discipline:"", session:"", eventName:"",
};
export const sebringEvent = {
  title:"IMSA Esports Global Championship - Round 2 - Sebring",
  date:new Date("2026-10-11"),round:"2",track:"Sebring International Raceway",platform:"iRacing",
};
const teams = [
  "BMW M Verstappen Sim Racing","Mivano","Grid-and-Go.com eSports","Maniti Racing",
  "Bleu Mercure Esport","Verstappen Sim Racing","XBD RACING SIMLAB","SOELPEC Precision Racing",
  "Coanda Esports","Deletraz Automotive by PCdesign","BMW M Team BS COMPETITION",
  "Porsche Coanda Esports Racing Team","Vesta Sport","Tatum Res-Tech MOZA Racing",
  "Tatum Res-Tech NordVPN","P1Sim Pro Team","Risi Competizione by GnG","Team Purple Coanda",
  "MAHLE RACING TEAM","Ronin-Sim-Sport.com","Fiercely Forward","EMM Esports",
  "Altitude FreeM eSports","SDR Simracing","TC Esports","SDR SIMRACING","UNI-G Racing",
  "natural elements by Walkenhorst Motorsport","THE FARM","TC Esports Academy","VØRAX",
  "BMW M Team MOUZ","Zero7 Racing","Alpha One by SX","WSR Esports","Nova Legio Racing",
];
export const sebringDocument = {
  scope:"event",kind:"entry",session:null,updatedAt:new Date("2026-10-15T15:44:38.471Z"),
  rows:[sebringEntry,...teams.map(team=>({...sebringEntry,number:"",team,drivers:"",car:""}))],
};
const unknownHints=[
  {team:"TMS Power",vehicle:"",manufacturer:""},
  {team:"",vehicle:"",manufacturer:"Ford"},
  {team:"Motorsport",vehicle:"",manufacturer:"Unknown Prototype"},
];
const observed=(vehicleRegion,extra={})=>({
  number:"",team:"",drivers:"",vehicle:"Race Car",manufacturer:"",
  discipline:"",racingClass:"",source:"visual",vehicleRegion,...extra,
});
export const sebringObservations = [
  observed([0,708,335,292],{referenceConstraints:unknownHints}),
  observed([307,432,324,350],{number:"196",numberEvidence:"vehicle-crop-v2",
    manufacturer:"BMW",manufacturerEvidence:"same-car-make-v1",
    referenceConstraints:[{team:"Turner",vehicle:"",manufacturer:"BMW"}]}),
  observed([349,331,182,137],{manufacturer:"Ford",manufacturerEvidence:"same-car-make-v1",
    referenceConstraints:unknownHints}),
  observed([710,392,180,169],{referenceConstraints:unknownHints}),
];
