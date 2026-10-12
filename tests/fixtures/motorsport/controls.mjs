// Kept separate from the frozen natural-photo comparison. This is a synthetic
// positive control, not a real race entry or an independent original photograph.
export const review = {
  reviewer:"Replit Agent — direct visual inspection",
  authorization:"Derivative of the already authorized stock-89 fixture; two artificial 007 panels replace its visible numbers.",
  limitations:"Synthetic clear-panel control only, not evidence of sensitivity on natural racing photographs.",
};
export const fixtures = [{
  id:"dual-007",file:"controls/dual-007.webp",
  sha256:"5b64517d7fe25ae442cf63b1c4509ce5ea538e80856033aed25984846caa2321",
  source:"Synthetic stock-89 derivative with white nose and side panels printed 007; source pixels unchanged outside the overlays.",
  evidence:"One stock car, two spatially separate, fully visible 007 panels on nose and side. Every leading zero is printed. No driver or readable specific class.",
  expected:{requiredTagGroups:[],forbiddenTags:["GT3","GT4"],numbers:["007"],
    unknownFields:["drivers","racingClass"],vehicleCount:{min:1,max:1}},
}];
