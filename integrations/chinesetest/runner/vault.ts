import { join } from "node:path";
import { homedir } from "node:os";
export { Vault, atomicWrite } from "../../hcmue/runner/vault";
import { systemKey as key } from "../../hcmue/runner/vault";
export const runnerDirectory = () => process.env.CHINESETEST_DATA_DIR || join(homedir(), process.platform === "win32" ? "AppData/Local/ChineseTestRunner" : "Library/Application Support/ChineseTestRunner");
export const systemKey = (dir: string) => key(dir, "vn.chinesetest.runner");
