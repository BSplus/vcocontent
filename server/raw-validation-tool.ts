import {spawn} from "node:child_process";

export type RawValidationCode="invalid_input"|"unsupported"|"integrity"|"invalid_container"|
  "resource_limit"|"cancelled"|"tool_unavailable";
export class RawValidationError extends Error {
  constructor(public readonly code:RawValidationCode){super(`RAW validation: ${code}`);}
}

/** Internal runner, not user-controlled tool execution. Wait for child close
 * after SIGKILL before returning the shared media-work slot to another job. */
export function runRawValidationTool(command:string,args:string[],options:{
  fd:number;signal:AbortSignal;timeoutMs?:number;outputLimit?:number;
}):Promise<string>{
  if(options.signal.aborted)return Promise.reject(new RawValidationError("cancelled"));
  return new Promise((resolve,reject)=>{
    let output="",bytes=0,stderrBytes=0,failure:RawValidationCode|undefined;
    const child=spawn(command,args,{shell:false,detached:true,
      stdio:["ignore","pipe","pipe",options.fd],
      env:{PATH:process.env.PATH,LANG:"C",LC_ALL:"C",TZ:"UTC"}});
    const stop=(code:RawValidationCode)=>{
      failure??=code;
      if(child.pid)try{process.kill(-child.pid,"SIGKILL");}catch{child.kill("SIGKILL");}
    };
    const abort=()=>stop("cancelled");
    const timer=setTimeout(()=>stop("resource_limit"),options.timeoutMs??8000);
    options.signal.addEventListener("abort",abort,{once:true});
    if(options.signal.aborted)abort();
    child.stdout!.on("data",(chunk:Buffer)=>{
      bytes+=chunk.length;
      if(bytes>(options.outputLimit??65536))stop("resource_limit");
      else output+=chunk.toString("utf8");
    });
    // Never retain/log parser diagnostics: they may include private metadata.
    child.stderr!.on("data",(chunk:Buffer)=>{stderrBytes+=chunk.length;if(stderrBytes>8192)stop("resource_limit");});
    child.once("error",()=>{failure??="tool_unavailable";});
    child.once("close",(code,signal)=>{
      clearTimeout(timer);options.signal.removeEventListener("abort",abort);
      if(failure)reject(new RawValidationError(failure));
      else if(signal==="SIGXCPU"||signal==="SIGKILL")reject(new RawValidationError("resource_limit"));
      else if(code!==0||signal||stderrBytes)reject(new RawValidationError("invalid_container"));
      else resolve(output);
    });
  });
}
