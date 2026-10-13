// Dated, illustrative monthly model, NOT a provider invoice or traffic forecast.
const gib=1e9/2**30;
export function monthly(S){
  const N=S*1000,P=20*N,D=.2*N,W=.1*N;
  const sourceTransfer=.05*gib*2.7*S,appTransfer=.05*gib*2.6*S;
  const replitStorage=.015*gib*S;
  // Conservative reading of the documentation: updates Basic, retrieval Advanced.
  const replitOps=W*.0004/1000+(P+D)*.005/1000;
  const r2Storage=Math.max(0,S-10)*.015;
  const a=Math.max(0,W-1e6)*4.5/1e6;
  const b=q=>Math.max(0,q-10e6)*.36/1e6;
  const worker=q=>5+Math.max(0,q-10e6)*.3/1e6+Math.max(0,q*2-30e6)*.02/1e6;
  const r2ProxyOps=a+b(2*(P+D)+2*W);
  const cachedOps=a+b(.1*P+2*D+2*W);
  const authTransfer=.05*gib*(P*1024)/1e9; // 1 KiB/control exchange assumption, not 93-byte payload.
  const protectedAppTransfer=.05*gib*.8*S;
  const protectedControl=.05*gib*(D*2*1024)/1e9;
  return {GB:S,replitStorage,r2Storage,replitOps,sourceTransfer,appTransfer,
    replitProxy:replitStorage+replitOps+sourceTransfer+appTransfer,
    r2Proxy:r2Storage+r2ProxyOps+appTransfer,
    r2EdgePreviewWithProtectedProxy:r2Storage+cachedOps+worker(P)+authTransfer+protectedAppTransfer,
    theoreticalPrivateEdgeNotEnabled:r2Storage+cachedOps+worker(P+D)+authTransfer+protectedControl,
    R2ClassA:a,R2ProxyClassB:b(2*(P+D)+2*W),R2CachedClassB:b(.1*P+2*D+2*W),workerPreview:worker(P),
    previewRequests:P,downloads:D,writes:W};
}
console.log(JSON.stringify({date:"2026-10-12",currency:"USD",GB:"decimal, TB=1000 GB",
  assumptions:"Average stored object 1 MB; 20 preview requests/object/month; 0.2 downloads of 4 MB/object; previews 90 KB; 10% monthly writes; 90% cache hits; 2 ms Worker CPU/request; account-wide free tiers unused elsewhere; no tax/credits/VM/DB/AI/retained source included",
  sources:["https://developers.cloudflare.com/r2/pricing/","https://developers.cloudflare.com/workers/platform/pricing/",
    "https://docs.replit.com/billing/object-storage-billing","https://docs.replit.com/billing/aug-cloud-billing-updates"],
  models:[100,500,1000,5000].map(monthly)},null,2));
