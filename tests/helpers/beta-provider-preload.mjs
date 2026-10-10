// Only import into disposable test servers. Never send test mail or call real AI.
process.env.RESEND_API_KEY="synthetic-resend-key";
process.env.RESEND_FROM="verification@example.test";
process.env.PUBLIC_SITE_URL="https://beta-fixture.example.test";
process.env.AI_INTEGRATIONS_OPENAI_API_KEY="synthetic-openai-key";
process.env.AI_INTEGRATIONS_OPENAI_BASE_URL="https://beta-provider.example.test/v1";
const original=globalThis.fetch;
const mocked=async(url,options)=>{
  if(String(url).startsWith("https://api.resend.com/")) return new Response('{"id":"synthetic-mail"}',{status:200});
  if(String(url).startsWith("https://beta-provider.example.test/")) {
    const safety=JSON.parse(options.body).messages[0]?.content?.includes("publication safety reviewer");
    return new Response(JSON.stringify({choices:[{finish_reason:"stop",message:{content:JSON.stringify(safety?{
      sexualized:"clear",pornography:"clear",racistOrDehumanizing:"clear",hateSymbolsOrGlorification:"clear",visibleTextAndSymbolsReviewed:true,
    }:{tags:["Day","Sim Racing"],vehicles:[],discipline:"Sim Racing",manufacturer:null,racingClass:null})}}]}),{headers:{"Content-Type":"application/json"}});
  }
  return original(url,options);
};
globalThis.fetch=mocked;
if (process.env.CREATOR_UPLOAD_TEST_SUFFIX) {
  const names=["owner","outsider"].map(role=>`upload_smoke_${role}_${process.env.CREATOR_UPLOAD_TEST_SUFFIX}`);
  const {setAnalysisQueueTestScope}=await import("../../server/analysis-jobs.ts");
  setAnalysisQueueTestScope(names);
  const {storage}=await import("../../server/storage.ts");
  const {db}=await import("../../server/db.ts");
  const {users}=await import("../../shared/schema.ts");
  const {inArray}=await import("drizzle-orm");
  const cleanup=storage.cleanupObjects.bind(storage);
  storage.cleanupObjects=async()=>cleanup((await db.select({id:users.id}).from(users).where(inArray(users.username,names))).map(row=>row.id));
}
