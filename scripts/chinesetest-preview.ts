// Local review only: synthetic candidate sessions, never sends to ChineseTest.
import { resolve } from "node:path";
import { httpFixture } from "../tests/cloud/fixture";
import { connectRunner } from "../tests/chinesetest/relay-fixture";
import { fixtureEngine } from "../tests/chinesetest/support";
const app=await httpFixture(resolve("build/cloud-ui"),true,true),runner=await connectRunner(app,()=>fixtureEngine(3));
await app.api("chinesetest/pair",0,{code:runner.code});
console.log(JSON.stringify({preview:app.config.origin+"/chinesetest",fixtureOnly:true,runnerFingerprint:runner.identity.fingerprint}));
async function close(){await runner.close();await app.close();process.exit();}process.on("SIGINT",()=>void close());process.on("SIGTERM",()=>void close());
