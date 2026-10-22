import { writeFile, chmod } from "node:fs/promises";
import { join } from "node:path";

// Ships an explicit, one-time URL-handler installer. It creates no startup task/service.
export async function writeRunnerLauncher(root, provider, mac) {
  const label = provider === "hcmue" ? "HCMUE" : "ChineseTest";
  const source = `import { execFileSync } from 'node:child_process';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
const provider = ${JSON.stringify(provider)}, label = ${JSON.stringify(label)};
const scheme = 'hanu-' + provider;
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const main = join(root, 'runner', 'main.mjs');
if (process.platform === 'win32') {
  const key = 'HKCU\\\\Software\\\\Classes\\\\' + scheme;
  const reg = (args) => execFileSync('reg.exe', ['add', ...args, '/f'], {stdio:'pipe'});
  reg([key, '/ve', '/d', 'URL:HANU ' + label + ' Runner']);
  reg([key, '/v', 'URL Protocol', '/d', '']);
  reg([key + '\\\\shell\\\\open\\\\command', '/ve', '/d', '"' + process.execPath + '" "' + main + '" --launch-url="%1"']);
} else if (process.platform === 'darwin') {
  const directory = join(homedir(), 'Applications');
  const app = join(directory, 'HANU ' + label + ' Launcher.app');
  await mkdir(directory, {recursive:true});
  const script = join(root, 'runner', 'web-launch.applescript');
  const quote = value => JSON.stringify(value);
  const command = 'quoted form of ' + quote(process.execPath) + ' & " " & quoted form of ' + quote(main) + ' & " --launch-url=" & quoted form of launchURL';
  await writeFile(script, 'on open location launchURL\\n  tell application "Terminal"\\n    activate\\n    do script (' + command + ')\\n  end tell\\nend open location\\non run\\n  display dialog "Mở website quản lý và bấm Mở runner trên máy này." buttons {"OK"} default button "OK"\\nend run\\n');
  await rm(app, {recursive:true, force:true});
  execFileSync('/usr/bin/osacompile', ['-o', app, script]);
  const plist = join(app, 'Contents', 'Info.plist');
  for (const command of [
    'Add :CFBundleIdentifier string vn.hanu.' + provider + '.launcher',
    'Add :CFBundleURLTypes array',
    'Add :CFBundleURLTypes:0 dict',
    'Add :CFBundleURLTypes:0:CFBundleURLName string vn.hanu.' + provider,
    'Add :CFBundleURLTypes:0:CFBundleURLSchemes array',
    'Add :CFBundleURLTypes:0:CFBundleURLSchemes:0 string ' + scheme,
  ]) execFileSync('/usr/libexec/PlistBuddy', ['-c', command, plist]);
  execFileSync('/usr/bin/codesign', ['--force', '--sign', '-', app]);
  execFileSync('/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister', ['-f', app]);
} else throw new Error('Chỉ hỗ trợ Windows và macOS.');
console.log('Đã bật nút mở ' + label + ' Runner từ web. Giữ nguyên thư mục gói. Mở Start ' + label + ' và nhập website một lần nếu chưa làm. Không có tác vụ tự khởi động được cài.');
`;
  await writeFile(join(root, "runner/install-web-launch.mjs"), source);
  const filename = mac ? "Enable web launch.command" : "Enable web launch.cmd";
  const wrapper = mac
    ? '#!/bin/sh\nTASK_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)\n"$TASK_DIR/runtime/node" "$TASK_DIR/runner/install-web-launch.mjs"\nprintf "\\nNhấn Enter để đóng..."\nread TASK_REPLY\n'
    : '@echo off\r\n"%~dp0runtime\\node.exe" "%~dp0runner\\install-web-launch.mjs"\r\npause\r\n';
  await writeFile(join(root, filename), wrapper);
  if (mac) await chmod(join(root, filename), 0o755);
}
