// Only enabled by the isolated local test runner. Never changes app runtime.
import { neonConfig } from "@neondatabase/serverless";
if (process.env.VCO_TEST_PG_PROXY) {
  neonConfig.wsProxy=()=>`127.0.0.1:${process.env.VCO_TEST_PG_PROXY}`;
  neonConfig.useSecureWebSocket=false;
  neonConfig.pipelineTLS=false;
  // Local trust authentication does not request a password. Neon defaults to
  // pipelining one before the server responds, which is invalid for trust.
  neonConfig.pipelineConnect=false;
}
