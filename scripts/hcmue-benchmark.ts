import { Worker, isMainThread, parentPort } from "node:worker_threads";
import { performance } from "node:perf_hooks";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { atDeadline } from "../integrations/hcmue/runner/deadline";
const percentile = (values: number[], p: number) =>
  [...values].sort((a, b) => a - b)[Math.ceil(values.length * p) - 1];
if (!isMainThread) {
  const late: number[] = [],
    spread: number[] = [];
  for (let round = 0; round < 1000; round++) {
    const deadline = performance.now() + 10,
      starts: number[] = [];
    await new Promise<void>((resolve) => {
      for (let account = 0; account < 20; account++)
        atDeadline(deadline, () => {
          const start = performance.now();
          starts.push(start);
          late.push(start - deadline);
          JSON.stringify({
            ma_cap_thi: "HSK4_D1",
            ngay_mo_dang_ky: "2026-10-21 11:00:00",
            answers: [],
          });
          if (starts.length === 20) resolve();
        });
    });
    spread.push(Math.max(...starts) - Math.min(...starts));
  }
  parentPort!.postMessage({
    scope:
      "Dedicated worker monotonic scheduler + payload serialization only. No network, school API, or slot-success measurement.",
    platform: process.platform,
    arch: process.arch,
    rounds: 1000,
    accountsPerRound: 20,
    callbacks: late.length,
    latenessMs: {
      p50: percentile(late, 0.5),
      p95: percentile(late, 0.95),
      p99: percentile(late, 0.99),
      max: Math.max(...late),
    },
    batchSpreadMs: { p95: percentile(spread, 0.95), max: Math.max(...spread) },
    targets: { latenessP95: 25, latenessP99: 50, spreadP95: 25 },
  });
} else {
  const { build } = await import("esbuild");
  await mkdir("test-results/hcmue", { recursive: true });
  const file = resolve("test-results/hcmue/benchmark-worker.mjs");
  await build({
    entryPoints: ["scripts/hcmue-benchmark.ts"],
    outfile: file,
    bundle: true,
    platform: "node",
    format: "esm",
    packages: "external",
  });
  const worker = new Worker(file);
  const report = await new Promise<any>((r, j) => {
    worker.once("message", r);
    worker.once("error", j);
  });
  const passed =
    report.latenessMs.p95 <= 25 &&
    report.latenessMs.p99 <= 50 &&
    report.batchSpreadMs.p95 <= 25;
  report.passed = passed;
  report.measuredAt = new Date().toISOString();
  await writeFile(
    "test-results/hcmue/benchmark.json",
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(JSON.stringify(report, null, 2));
  await worker.terminate();
  if (!passed) process.exitCode = 1;
}
