import {
  mkdir,
  readFile,
  writeFile,
  cp,
  chmod,
  stat,
  rm,
  statfs,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
await import("./build-hcmue.mjs");
const version = "24.21.0",
  base = `https://nodejs.org/dist/v${version}`;
const disk = await statfs(".");
if (disk.bavail * disk.bsize < 1024 ** 3)
  throw new Error("Cần ít nhất 1 GB trống để đóng gói.");
const response = await fetch(`${base}/SHASUMS256.txt`);
if (!response.ok) throw new Error("Không tải được checksum Node.js.");
const sums = await response.text();
await mkdir(".runtime", { recursive: true });
await mkdir("releases", { recursive: true });
await mkdir("build/cloud-ui/hcmue-downloads", { recursive: true });
for (const [name, platform, format] of [
  ["mac-arm64", "darwin-arm64", "tar.gz"],
  ["mac-x64", "darwin-x64", "tar.gz"],
  ["windows-x64", "win-x64", "zip"],
]) {
  const filename = `node-v${version}-${platform}.${format}`,
    archive = join(".runtime", filename);
  try {
    await stat(archive);
  } catch {
    const r = await fetch(`${base}/${filename}`);
    if (!r.ok) throw new Error(`Không tải được ${filename}`);
    await writeFile(archive, Buffer.from(await r.arrayBuffer()));
  }
  const expected = sums
      .split("\n")
      .find((l) => l.endsWith(`  ${filename}`))
      ?.split(" ")[0],
    actual = createHash("sha256")
      .update(await readFile(archive))
      .digest("hex");
  if (!expected || expected !== actual)
    throw new Error("Checksum runtime không khớp: " + filename);
  const mac = platform.startsWith("darwin"),
    entry = `node-v${version}-${platform}/${mac ? "bin/node" : "node.exe"}`,
    license = `node-v${version}-${platform}/LICENSE`;
  // Never overwrite the Node executable currently running tests or the manager.
  const staging=join(".runtime","hcmue-package",platform);
  await mkdir(staging,{recursive:true});
  if (mac)
    execFileSync("tar", ["-xzf", archive, "-C", staging, entry, license]);
  else
    execFileSync("unzip", ["-qo", archive, entry, license, "-d", staging]);
  const root = resolve("releases", `HCMUE-${name}`);
  await rm(root, { recursive: true, force: true });
  await mkdir(join(root, "runtime"), { recursive: true });
  await cp("build/hcmue/runner", join(root, "runner"), { recursive: true });
  await cp(
    join(staging, entry),
    join(root, "runtime", mac ? "node" : "node.exe"),
  );
  await cp(join(staging, license), join(root, "runtime", "LICENSE"));
  await cp("docs/hcmue/HUONG-DAN.md", join(root, "HUONG-DAN.md"));
  await writeFile(
    join(root, "NOTICES.txt"),
    `HCMUE Runner uses Node.js ${version} (license in runtime/LICENSE), ws and tough-cookie.\n\n` +
      (await readFile("node_modules/ws/LICENSE", "utf8")) +
      "\n" +
      (await readFile("node_modules/tough-cookie/LICENSE", "utf8")) +
      "\n" +
      (await readFile("node_modules/tldts/LICENSE", "utf8")) +
      "\n" +
      (await readFile("node_modules/tldts-core/LICENSE", "utf8")),
  );
  await writeFile(
    join(root, "BUILD.json"),
    JSON.stringify(
      {
        provider: "hcmue",
        node: version,
        platform,
        builtAt: new Date().toISOString(),
        runtimeArchiveSha256: actual,
        realMachineVerified: false,
      },
      null,
      2,
    ),
  );
  if (mac) {
    await chmod(join(root, "runtime/node"), 0o755);
    await writeFile(
      join(root, "Start HCMUE.command"),
      '#!/bin/sh\nTASK_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)\nexec "$TASK_DIR/runtime/node" "$TASK_DIR/runner/main.mjs" "$@"\n',
    );
    await chmod(join(root, "Start HCMUE.command"), 0o755);
  } else
    await writeFile(
      join(root, "Start HCMUE.cmd"),
      '@echo off\r\n"%~dp0runtime\\node.exe" "%~dp0runner\\main.mjs" %*\r\nif errorlevel 1 pause\r\n',
    );
  await rm(root + ".zip", { force: true });
  if (process.platform === "darwin")
    execFileSync("ditto", ["-c", "-k", "--keepParent", root, root + ".zip"]);
  else execFileSync("zip", ["-q", "-r", root + ".zip", "."], { cwd: root });
  await cp(
    root + ".zip",
    join("build/cloud-ui/hcmue-downloads", `HCMUE-${name}.zip`),
  );
  console.log(
    "Packaged HCMUE " +
      name +
      " (runtime checksum verified; machine certification separate)",
  );
}
await cp("docs/hcmue", "build/cloud-ui/hcmue-downloads", { recursive: true });

const archives = [
  "HCMUE-mac-arm64.zip",
  "HCMUE-mac-x64.zip",
  "HCMUE-windows-x64.zip",
];
const checksums = [];
for (const file of archives)
  checksums.push(
    createHash("sha256")
      .update(await readFile(join("releases", file)))
      .digest("hex") +
      "  " +
      file,
  );
await writeFile("releases/HCMUE-SHA256SUMS.txt", checksums.join("\n") + "\n");
await cp(
  "releases/HCMUE-SHA256SUMS.txt",
  "build/cloud-ui/hcmue-downloads/HCMUE-SHA256SUMS.txt",
);
