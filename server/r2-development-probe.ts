// Object-only probe: no account API, audit-token access, database imports or media routing.
import { createHash, randomBytes, randomUUID } from "node:crypto";
import sharp from "sharp";
import { r2Config, R2Store, ObjectStoreError, type ObjectStore } from "./object-store";

export function validateDevelopmentProbeConfiguration(env = process.env) {
  // Validate scope BEFORE r2Config can select a credential namespace.
  if (env.MEDIA_STORAGE_ENVIRONMENT !== "development" || env.REPLIT_DEPLOYMENT === "1" ||
      env.NODE_ENV !== "development" ||
      ["R2_PROD_ACCESS_KEY_ID","R2_PROD_SECRET_ACCESS_KEY"].some(key => Object.hasOwn(env,key)) ||
      env.MEDIA_STORAGE_PROVIDER !== "replit" || env.MEDIA_STORAGE_ROUTING !== "disabled" ||
      env.MEDIA_MIGRATION_ISOLATED !== "confirmed" || env.R2_BUCKET_SCOPED_TOKEN_REVIEWED !== "true")
    throw new ObjectStoreError("configuration");
  const config = r2Config(env);
  if (config.bucket !== "vco-content-media-dev") throw new ObjectStoreError("configuration");
  return config; // Internal use only; never serialize this credentials-containing object.
}

export async function runDevelopmentProbe({
  env = process.env, authorized = false,
  makeStore = (configuration: NodeJS.ProcessEnv): ObjectStore => new R2Store(configuration),
  anonymousFetch = fetch,
}: { env?: NodeJS.ProcessEnv; authorized?: boolean; makeStore?: (env: NodeJS.ProcessEnv) => ObjectStore;
     anonymousFetch?: typeof fetch } = {}) {
  const report = {
    date: new Date().toISOString(), connectivity: "FAIL", checks: [] as object[], blockers: [] as string[],
    configurationAudit: "pending-manual-verification",
    isolation: { verified: false, productionRequests: 0, databaseClientsUsed: 0, accountApiUsed: false },
    activeProvider: "not-verified", mediaRouting: "not-verified",
    upload: "NOT RUN", read: "NOT RUN", checksum: "NOT RUN", cleanup: "NOT REQUIRED",
    anonymous: { status: "NOT RUN", httpStatus: null as number | null },
    probe: null as null | { bucket: string; key: string; size: number; mime: string;
      sourceSha256: string; targetSha256?: string },
  };
  let store: ObjectStore | undefined, key: string | undefined, bytes: Buffer | undefined;
  let attempted = false, created = false;
  const proof = async () => {
    const metadata = await store!.metadata(key!);
    if(metadata.size > 100_000 || metadata.mime !== "image/webp")throw new ObjectStoreError("integrity");
    const hash=createHash("sha256");
    let size=0;
    for await(const chunk of store!.open(key!,undefined,metadata.version)) {
      size+=chunk.length;
      if(size>100_000)throw new ObjectStoreError("integrity");
      hash.update(chunk);
    }
    return {size,metadata,sha256:hash.digest("hex")};
  };
  try {
    const config=validateDevelopmentProbeConfiguration(env);
    report.isolation.verified=true;report.activeProvider="replit";report.mediaRouting="disabled";
    report.checks.push({check:"offline-development-isolation",status:"passed"},
      {check:"bucket-only-token-scope",status:"operator-attestation-not-api-audited"});
    if(!authorized)throw new ObjectStoreError("configuration");
    // Store construction and every network operation occur only after all offline gates.
    store=makeStore(env);key=`thumb-${randomUUID()}.webp`;
    const payload: Buffer=await sharp(randomBytes(8*8*3),{raw:{width:8,height:8,channels:3}}).webp().toBuffer();
    bytes=payload;
    report.probe={bucket:config.bucket,key,size:bytes.length,mime:"image/webp",
      sourceSha256:createHash("sha256").update(bytes).digest("hex")};
    // Never overwrite or delete a pre-existing key, even in the event of a UUID collision.
    if(await store.exists(key))throw new ObjectStoreError("integrity");
    attempted=true;
    report.upload="FAIL";
    await store.put(key,bytes,"image/webp",{createOnly:true});
    created=true;report.upload="PASS";
    report.read="FAIL";
    const read=await proof();
    report.read="PASS";report.probe.targetSha256=read.sha256;
    report.checksum="FAIL";
    if(read.size!==bytes.length || read.metadata.size!==bytes.length ||
       read.sha256!==report.probe.sourceSha256)throw new ObjectStoreError("integrity");
    report.checksum="PASS";
    const anonymous=await anonymousFetch(`${config.endpoint}/${config.bucket}/${key}`,{
      redirect:"manual",signal:AbortSignal.timeout(15_000)});
    report.anonymous.httpStatus=anonymous.status;
    await anonymous.body?.cancel();
    report.anonymous.status="FAIL";
    if(![401,403,404].includes(anonymous.status))throw new ObjectStoreError("authorization");
    report.anonymous.status="PASS";
    report.connectivity="PASS";
  } catch(error) {
    report.blockers.push(error instanceof ObjectStoreError
      ? `Development probe stopped: ${error.code}.` : "Development probe stopped: bounded operation failed.");
  } finally {
    if(store && key && attempted) {
      try {
        if(!created) {
          // A lost PUT response is not proof of ownership. Read actual unique random payload
          // before deleting; otherwise leave the candidate alone and report uncertainty.
          const existing=await proof();
          if(existing.sha256!==report.probe!.sourceSha256 || existing.size!==bytes!.length)
            throw new ObjectStoreError("integrity");
        }
        await store.delete(key);
        if(await store.exists(key))throw new ObjectStoreError("integrity");
        report.cleanup="PASS";
      } catch {
        report.cleanup="FAIL";report.connectivity="FAIL";
        report.blockers.push("Probe cleanup or ownership verification failed; inspect only the candidate probe key in this report.");
      }
    }
  }
  return report;
}
