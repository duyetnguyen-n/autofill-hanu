const key = "hanu-login-guide";
type Stage = "choose" | "return";

export function rememberLoginGuide(stage: Stage) {
  try { sessionStorage.setItem(key, JSON.stringify({ stage, until: Date.now() + 10 * 60_000 })); } catch { /* Optional tab storage. */ }
}

export function loginGuideStage(): Stage | undefined {
  try {
    const value = JSON.parse(sessionStorage.getItem(key) ?? "null");
    if (value?.until > Date.now() && (value.stage === "choose" || value.stage === "return")) return value.stage;
  } catch { /* Optional tab storage. */ }
}

export function clearLoginGuide() {
  try { sessionStorage.removeItem(key); } catch { /* Optional tab storage. */ }
}
