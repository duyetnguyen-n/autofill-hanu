import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const browserBinary = "/Applications/CocCoc.app/Contents/MacOS/CocCoc";

const mime = (filePath) => filePath.endsWith(".js")
  ? "text/javascript"
  : filePath.endsWith(".css")
    ? "text/css"
    : "text/html";

const server = http.createServer(async (request, response) => {
  const routes = {
    "/flow": path.join(root, "tests/site/flow.html"),
    "/personal": path.join(root, "tests/site/personal.html"),
    "/mailing": path.join(root, "tests/site/mailing.html"),
    "/confirm": path.join(root, "tests/site/confirm.html"),
    "/context-invalidated": path.join(root, "tests/site/context-invalidated.html"),
    "/context-invalidated-inflight": path.join(root, "tests/site/context-invalidated-inflight.html"),
    "/stop-inflight": path.join(root, "tests/site/stop-inflight.html"),
    "/catalog-api": path.join(root, "tests/site/catalog-api.html"),
    "/options-catalog": path.join(root, "tests/site/options-catalog.html"),
    "/content.js": path.join(root, "content.js"),
    "/options.js": path.join(root, "options.js"),
    "/page-bridge.js": path.join(root, "page-bridge.js")
  };
  const filePath = routes[new URL(request.url, "http://localhost").pathname];
  if (!filePath) {
    response.writeHead(404).end("not found");
    return;
  }
  response.setHeader("content-type", mime(filePath));
  response.end(await readFile(filePath));
});

function runBrowser(url, profileDir, virtualTimeMs) {
  return new Promise((resolve, reject) => {
    const child = spawn(browserBinary, [
      "--headless=new",
      "--disable-gpu",
      "--disable-breakpad",
      "--disable-crash-reporter",
      "--no-first-run",
      "--no-default-browser-check",
      `--user-data-dir=${profileDir}`,
      `--virtual-time-budget=${virtualTimeMs}`,
      "--dump-dom",
      url
    ]);
    let stdout = "";
    let stderr = "";
    const timeoutId = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`Browser test timed out: ${url}`));
    }, 20000);
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", (error) => {
      clearTimeout(timeoutId);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timeoutId);
      if (code === 0) resolve(stdout);
      else reject(new Error(`Browser exited ${code}: ${stderr.slice(-1200)}`));
    });
  });
}

const profileDir = await mkdtemp(path.join(os.tmpdir(), "hsk-autofill-e2e-"));
try {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();

  console.log("RUN test information flow");
  const flowDom = await runBrowser(`http://127.0.0.1:${port}/flow`, profileDir, 15000);
  assert.match(flowDom, /id="flow-result">NEXT_CLICKED/);
  assert.match(flowDom, /data-next-clicked="true"/);
  assert.match(flowDom, /data-manual-value-preserved="true"/);
  assert.match(flowDom, /data-manual-dependency-selected="true"/);
  assert.match(flowDom, /data-progress="33"/);
  assert.match(flowDom, /data-omitted="2"/);

  console.log("RUN personal information flow");
  const personalDom = await runBrowser(`http://127.0.0.1:${port}/personal`, profileDir, 18000);
  assert.match(personalDom, /id="personal-result">PERSONAL_NEXT_CLICKED/);
  assert.match(personalDom, /data-next-clicked="true"/);
  assert.match(personalDom, /data-photo-uploaded="true"/);

  console.log("RUN mailing information flow");
  const mailingDom = await runBrowser(`http://127.0.0.1:${port}/mailing`, profileDir, 2500);
  assert.match(mailingDom, /id="mailing-result">MAILING_NEXT_CLICKED/);
  assert.match(mailingDom, /data-next-clicked="true"/);

  console.log("RUN step 4 safety guard");
  const confirmDom = await runBrowser(`http://127.0.0.1:${port}/confirm`, profileDir, 2500);
  assert.match(confirmDom, /data-run-stopped="true"/);
  assert.doesNotMatch(confirmDom, /data-submitted="true"/);
  assert.match(confirmDom, /Đã dừng an toàn ở bước 4/);

  console.log("RUN extension reload guard");
  const invalidatedDom = await runBrowser(
    `http://127.0.0.1:${port}/context-invalidated`,
    profileDir,
    2000
  );
  assert.match(invalidatedDom, /Extension vừa được tải lại/);
  assert.doesNotMatch(invalidatedDom, /data-unhandled-rejection="true"/);
  assert.doesNotMatch(invalidatedDom, /data-next-clicked="true"/);

  console.log("RUN extension reload guard while waiting for a field");
  const inflightInvalidatedDom = await runBrowser(
    `http://127.0.0.1:${port}/context-invalidated-inflight`,
    profileDir,
    2500
  );
  assert.match(inflightInvalidatedDom, /Extension vừa được tải lại/);
  assert.doesNotMatch(inflightInvalidatedDom, /data-unhandled-rejection="true"/);
  assert.doesNotMatch(inflightInvalidatedDom, /data-next-clicked="true"/);

  console.log("RUN user stop while waiting for a field");
  const stoppedDom = await runBrowser(
    `http://127.0.0.1:${port}/stop-inflight`,
    profileDir,
    2500
  );
  assert.match(stoppedDom, /data-stop-acknowledged="true"/);
  assert.match(stoppedDom, /Đã dừng theo yêu cầu/);
  assert.doesNotMatch(stoppedDom, /data-unhandled-rejection="true"/);
  assert.doesNotMatch(stoppedDom, /data-next-clicked="true"/);

  console.log("RUN read-only catalog API whitelist");
  const catalogDom = await runBrowser(
    `http://127.0.0.1:${port}/catalog-api`,
    profileDir,
    2500
  );
  assert.match(catalogDom, /id="catalog-result">CATALOG_TEST_DONE/);
  assert.match(catalogDom, /data-read-succeeded="true"/);
  assert.match(catalogDom, /data-only-get="true"/);
  assert.match(catalogDom, /data-blocked-write="true"/);
  assert.match(catalogDom, /data-no-blocked-fetch="true"/);
  assert.match(catalogDom, /data-read-url="\/portal\/index\/getOptionList"/);

  console.log("RUN options dependent catalog chain");
  const optionsCatalogDom = await runBrowser(
    `http://127.0.0.1:${port}/options-catalog`,
    profileDir,
    3500
  );
  assert.match(optionsCatalogDom, /id="options-result">OPTIONS_CATALOG_DONE/);
  assert.match(optionsCatalogDom, /data-all-read-endpoints="true"/);
  assert.match(optionsCatalogDom, /data-full-chain="true"/);
  assert.match(optionsCatalogDom, /data-params-mapped="true"/);
  assert.match(optionsCatalogDom, /data-all-lists-rendered="true"/);
  assert.match(optionsCatalogDom, /data-manual-preserved="true"/);

  console.log("PASS laggy dependent dropdown flow: existing value preserved, remaining fields selected, progress saved, Next clicked");
  console.log("PASS personal information flow: fields selected and Next clicked");
  console.log("PASS mailing information flow: Next clicked");
  console.log("PASS step 4 safety guard: Submit was not clicked");
  console.log("PASS extension reload guard: no unhandled rejection and no page action");
  console.log("PASS in-flight reload guard: waiting stopped without unhandled rejection or Next click");
  console.log("PASS user stop guard: in-flight work stopped without unhandled rejection or Next click");
  console.log("PASS catalog API guard: GET read succeeded and a write endpoint was blocked before any API call");
  console.log("PASS options catalog chain: dependent lists rendered with mapped IDs and manual data preserved");
} finally {
  server.close();
  await rm(profileDir, { recursive: true, force: true });
}
