import test from "node:test";
import assert from "node:assert/strict";
import { VideoAnalysisFailure, classifyVideoFailure, videoFailureRecord } from "../server/video-failures.ts";
import { videoTool } from "../server/video-sampling.ts";
import { sampleVideo } from "../server/video-sampling.ts";
import { Readable } from "node:stream";
import { randomUUID } from "node:crypto";

test("safe diagnostic records omit raw errors, provider bodies, credentials and unsafe signals",()=>{
  const failure=classifyVideoFailure(Object.assign(new Error("secret-token data:image/jpeg;base64,PRIVATE"),{
    status:429,response:{body:"sensitive provider response"},
  }),"ai_request");
  assert.equal(failure.retryable,true);
  assert.deepEqual(videoFailureRecord(12,2,failure),{
    mediaId:12,attempt:2,stage:"ai_request",code:"AI_REQUEST_FAILED",retryable:true,httpStatus:429,
  });
  const details=new VideoAnalysisFailure("probe","DECODE_FAILED",true,{signal:"credential",exitCode:NaN,httpStatus:999});
  assert.deepEqual(details.details,{});
  assert.doesNotMatch(JSON.stringify(videoFailureRecord(12,2,failure)),/secret-token|PRIVATE|sensitive/);
});

test("transient provider/network/parse/database errors retain retries, deterministic configuration failures do not",()=>{
  for (const status of [408,429,500,502,503]) assert.equal(classifyVideoFailure({status},"ai_request").retryable,true);
  for (const status of [400,401,403,404,422]) assert.equal(classifyVideoFailure({status},"ai_request").retryable,false);
  for (const stage of ["file_access","frame_extraction","result_parsing","database_persistence"])
    assert.equal(classifyVideoFailure(new Error("temporary failure"),stage).retryable,true);
  assert.equal(classifyVideoFailure({code:"ENOENT"},"file_access").code,"SOURCE_MISSING");
  assert.equal(classifyVideoFailure({code:"ENOENT"},"file_access").retryable,false);
});

test("missing tools and unsupported tool options have distinct permanent codes",async()=>{
  const saved=process.env.PATH;
  try {
    process.env.PATH="";
    await assert.rejects(videoTool("ffprobe",["-version"]),
      error=>error.stage==="probe"&&error.code==="TOOL_MISSING"&&error.retryable===false);
  } finally {
    if(saved===undefined) delete process.env.PATH; else process.env.PATH=saved;
  }
  await assert.rejects(videoTool("ffmpeg",["-v","error","-vco-option-that-does-not-exist"]),
    error=>error.stage==="frame_extraction"&&error.code==="TOOL_OPTION_UNSUPPORTED"&&
      Number.isInteger(error.details.exitCode)&&error.details.exitCode>0&&error.retryable===false);
});

test("overall extraction deadline is distinct from a decoder timeout and cleans a stalled source",async t=>{
  let entered;
  const reading=new Promise(resolve=>{entered=resolve;});
  t.mock.timers.enable({apis:["setTimeout"]});
  try {
    const pending=sampleVideo({url:`/api/media/files/media-${randomUUID()}.mp4`},async()=>{
      assert.fail("A stalled download must never reach the provider");
    },()=>{entered();return new Readable({read(){}});});
    const rejected=assert.rejects(pending,error=>error.stage==="file_access"&&
      error.code==="EXTRACTION_TIMEOUT"&&error.retryable===true);
    await reading;
    t.mock.timers.tick(75000);
    await rejected;
  } finally {t.mock.timers.reset();}
});

test("real process timeout and external interruption remain retryable and distinguish their cause",{timeout:22000},async()=>{
  await assert.rejects(videoTool("ffmpeg",["-v","error","-re","-f","lavfi","-i",
    "testsrc=size=16x16:rate=1","-f","null","-"]),
  error=>error.code==="TOOL_TIMEOUT"&&error.retryable===true&&error.details.signal==="SIGKILL");
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),50);
  try {
    await assert.rejects(videoTool("ffmpeg",["-v","error","-re","-f","lavfi","-i",
      "testsrc=size=16x16:rate=1","-f","null","-"],controller.signal),
    error=>error.code==="TOOL_INTERRUPTED"&&error.retryable===true);
  } finally {clearTimeout(timer);}
});
