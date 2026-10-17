import type { GalleryOwnership } from "@shared/gallery-ownership";

/** Internal, server-validated facts only. Never pass request metadata directly.
 * This module neither extracts metadata nor validates RAW containers. */
export type CaptureEvidence = {
  capturedAtMs:number;
  cameraMake:string;
  cameraModel:string;
  cameraSerial?:string;
};
export type RawPairSelection = {
  intent:"explicit";
  mediaId:number;
  sourceVersion:number;
  jpegKey:string;
  jpegSha256:string;
  rawKey:string;
  rawSha256:string;
};
type Candidate = {
  mediaId:number;
  ownership:GalleryOwnership;
  sourceVersion:number;
  jpegKey:string;
  jpegSha256:string;
  filename:string;
  evidence?:CaptureEvidence;
};
const digest=(value:unknown)=>typeof value==="string"&&/^[a-f0-9]{64}$/.test(value);
const id=(value:number)=>Number.isSafeInteger(value)&&value>0&&value<=2_147_483_647;
const key=(value:string,extension:string)=>typeof value==="string"&&
  new RegExp(`^media-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\\.(${extension})$`).test(value);
const rawExtensions="dng|cr2|cr3|nef|arw|raf|orf|rw2"; // Vocabulary, not an enabled format policy.
const text=(value:unknown)=>typeof value==="string"&&value.length<=200?
  value.trim().normalize("NFC").toLowerCase():"";
const scope=(value:GalleryOwnership)=>id(value.galleryId)&&
  (value.category==="OFFICIAL_VCO"?value.ownerId===null:value.category==="CREATOR"&&id(value.ownerId!));
const sameScope=(a:GalleryOwnership,b:GalleryOwnership)=>scope(a)&&scope(b)&&
  a.galleryId===b.galleryId&&a.category===b.category&&a.ownerId===b.ownerId;
function stem(filename:string,extensions:string){
  if(typeof filename!=="string"||filename.length>255||/[/\\\u0000-\u001f\u007f]/.test(filename))return "";
  const match=new RegExp(`^(.+)\\.(${extensions})$`,"i").exec(filename.trim());
  return match?text(match[1]):"";
}
function captureMatches(a?:CaptureEvidence,b?:CaptureEvidence){
  if(!a||!b||!Number.isSafeInteger(a.capturedAtMs)||!Number.isSafeInteger(b.capturedAtMs)||
    a.capturedAtMs<0||b.capturedAtMs<0||Math.abs(a.capturedAtMs-b.capturedAtMs)>2000)return false;
  if(!text(a.cameraMake)||!text(a.cameraModel)||text(a.cameraMake)!==text(b.cameraMake)||
    text(a.cameraModel)!==text(b.cameraModel))return false;
  // Different known bodies veto a suggestion; a missing serial is not proof
  // of equality. Capture time + make/model + stem still only suggests a pair.
  if(a.cameraSerial&&b.cameraSerial&&(!text(a.cameraSerial)||text(a.cameraSerial)!==text(b.cameraSerial)))return false;
  return true;
}

/** Bounded suggestions, never automatic association, authorization or approval.
 * Times must already be normalized by a trusted extractor; do not guess zones.
 * A two-second tolerance is a suggestion heuristic, not an upload acceptance rule.
 */
export function suggestRawPairs(raw:{ownership:GalleryOwnership;filename:string;evidence?:CaptureEvidence},
  candidates:readonly Candidate[]){
  if(!scope(raw.ownership)||candidates.length>200)throw new Error("Invalid pairing candidate scope or bound");
  const seen=new Set<string>();
  const rawStem=stem(raw.filename,rawExtensions);
  const matches:Omit<RawPairSelection,"intent"|"rawKey"|"rawSha256">[]=[];
  for(const candidate of candidates){
    const identity=`${candidate.mediaId}:${candidate.sourceVersion}`;
    if(seen.has(identity))throw new Error("Duplicate pairing candidate");
    seen.add(identity);
    if(!rawStem||!sameScope(raw.ownership,candidate.ownership)||!id(candidate.mediaId)||
      !id(candidate.sourceVersion)||!key(candidate.jpegKey,"jpg")||!digest(candidate.jpegSha256)||
      stem(candidate.filename,"jpg|jpeg")!==rawStem||!captureMatches(raw.evidence,candidate.evidence))continue;
    matches.push({mediaId:candidate.mediaId,sourceVersion:candidate.sourceVersion,
      jpegKey:candidate.jpegKey,jpegSha256:candidate.jpegSha256});
  }
  return {status:matches.length===0?"manual_selection_required":matches.length===1?"suggested":"ambiguous",
    requiresExplicitSelection:true as const,matches};
}

/** Rechecked against locked server facts at attachment time. A selection is
 * not authentication, file validation, independent safety or delivery consent.
 * Explicit selection can differ from heuristic suggestions. */
export function assertRawPairSelection(selection:RawPairSelection|undefined,expected:{
  mediaId:number;sourceVersion:number;jpegKey:string;jpegSha256:string;rawKey:string;rawSha256:string;
}){
  if(!selection||selection.intent!=="explicit"||!id(expected.mediaId)||!id(expected.sourceVersion)||
    !key(expected.jpegKey,"jpg")||!key(expected.rawKey,rawExtensions)||
    !digest(expected.jpegSha256)||!digest(expected.rawSha256)||
    selection.mediaId!==expected.mediaId||selection.sourceVersion!==expected.sourceVersion||
    selection.jpegKey!==expected.jpegKey||selection.jpegSha256!==expected.jpegSha256||
    selection.rawKey!==expected.rawKey||selection.rawSha256!==expected.rawSha256)
    throw new Error("Explicit RAW pairing selection is missing or stale");
}
