import { z } from "zod";
import { parseRecognition } from "./utils/motorsport-recognition";
import type { VideoFrame } from "./video-sampling";
import { VideoAnalysisFailure, type VideoOutputReason } from "./video-failures";

/** Provider structure is constrained separately from independent pixel proof. */
export function videoOutputSchema(frameCount: number) {
  const text = { type: "string", maxLength: 160 };
  return {
    type: "object", additionalProperties: false, required: ["frames"],
    properties: { frames: {
      type: "array", minItems: frameCount, maxItems: frameCount,
      items: {
        type: "object", additionalProperties: false, required: ["index", "tags", "vehicles"],
        properties: {
          index: { type: "integer", enum: Array.from({length:frameCount},(_,i)=>i) },
          tags: { type: "array", maxItems: 12, items: {type:"string"} },
          vehicles: {
            type: "array", maxItems: 12, items: {
              type: "object", additionalProperties: false,
              required: ["number","numberReadable","numberObscured","classReadable","team","vehicle",
                "manufacturer","racingClass","discipline","vehicleRegion"],
              properties: {
                number: {type:"string",pattern:"^[0-9]{0,4}$"},
                numberReadable: {type:"boolean"}, numberObscured: {type:"boolean"},
                classReadable: {type:"boolean"},
                team:text, vehicle:text, manufacturer:text, racingClass:text, discipline:text,
                vehicleRegion: {anyOf:[
                  {type:"array",minItems:4,maxItems:4,items:{type:"number",minimum:0,maximum:1000}},
                  {type:"null"},
                ]},
              },
            },
          },
        },
      },
    } },
  };
}

export function parseVideoOutput(raw: string | null | undefined, finishReason: string | null | undefined,
  frames: VideoFrame[]) {
  const invalid = (outputReason: VideoOutputReason, receivedFrames?: number): never => {
    throw new VideoAnalysisFailure("result_parsing","AI_OUTPUT_INVALID",true,
      {outputReason,finishReason:finishReason || "other",expectedFrames:frames.length,receivedFrames});
  };
  if(finishReason!=="stop") invalid(finishReason==="length" ? "truncated" : "non_stop");
  if(!raw) invalid("empty");
  if(raw!.length>24000) invalid("oversized");
  let json:unknown;
  try {json=JSON.parse(raw!);} catch {invalid("json_syntax");}
  const parsed=z.object({frames:z.array(z.object({
    index:z.number().int(),tags:z.array(z.string()).max(40),vehicles:z.array(z.unknown()).max(12),
  })).max(4)}).safeParse(json);
  if(!parsed.success) invalid("frame_shape");
  const result=parsed.data!;
  if(result.frames.length!==frames.length) invalid("frame_count",result.frames.length);
  if(result.frames.some(f=>f.index<0 || f.index>=frames.length) ||
    new Set(result.frames.map(f=>f.index)).size!==frames.length) invalid("frame_indices",result.frames.length);
  return result.frames.map(f=>{
    let recognized:ReturnType<typeof parseRecognition>;
    try {recognized=parseRecognition(JSON.stringify(f));} catch {invalid("vehicle_shape");}
    return {...recognized!,timestamp:frames[f.index].timestamp,hash:frames[f.index].hash};
  });
}
