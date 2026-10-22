const RUN_KEY = "hskSafeAutofill.quickRun.v1";
const params = new URLSearchParams(location.search);
const isRunnerWindow = params.get("runner") === "1";
const autoStart = params.get("autostart") === "1";
let targetTabId = Number(params.get("tabId")) || null;

const pageName = document.querySelector("#page-name");
const fieldCount = document.querySelector("#field-count");
const status = document.querySelector("#status");
const quickRunButton = document.querySelector("#quick-run");
const fillButton = document.querySelector("#fill");
const stopButton = document.querySelector("#stop-run");
const runPanel = document.querySelector("#run-panel");
const runProgress = document.querySelector("#run-progress");
const progressPercent = document.querySelector("#progress-percent");
const runMessage = document.querySelector("#run-message");
const runDetail = document.querySelector("#run-detail");
const extensionVersion = document.querySelector("#extension-version");
extensionVersion.textContent = `v${chrome.runtime.getManifest().version}`;
if (isRunnerWindow) document.body.classList.add("runner-window");

let busy = false;
let latestRun = null;

function setBusy(value) {
  busy = value;
  document.querySelectorAll("button:not(#stop-run)").forEach((button) => {
    button.disabled = value || Boolean(latestRun?.active);
  });
  stopButton.disabled = !latestRun?.active;
}

function setStatus(message, kind = "") {
  status.textContent = message;
  status.className = `status ${kind}`.trim();
}

async function currentTab() {
  if (targetTabId) {
    const tab = await chrome.tabs.get(targetTabId);
    if (tab?.url?.startsWith("https://www.chinesetest.cn/")) return tab;
  }
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab.url?.startsWith("https://www.chinesetest.cn/")) {
    throw new Error("Hãy mở một trang trên www.chinesetest.cn trước.");
  }
  targetTabId = tab.id;
  return tab;
}

async function send(type, extra = {}) {
  const tab = await currentTab();
  const result = await chrome.tabs.sendMessage(tab.id, { type, targetTabId: tab.id, ...extra });
  if (result?.error) throw new Error(result.error);
  return result;
}

function renderRun(run) {
  latestRun = run || null;
  if (!run) {
    runPanel.hidden = true;
    quickRunButton.disabled = busy;
    fillButton.disabled = busy;
    return;
  }

  runPanel.hidden = false;
  const progress = Math.max(0, Math.min(100, Number(run.progress) || 0));
  runProgress.value = progress;
  runProgress.textContent = `${progress}%`;
  progressPercent.textContent = `${progress}%`;
  runMessage.textContent = run.status || (run.active ? "Đang chạy…" : "Đã kết thúc.");
  const fieldPart = run.fieldTotal ? ` · trường ${run.fieldIndex || 0}/${run.fieldTotal}` : "";
  runDetail.textContent = `Bước ${run.step || "—"}${fieldPart} · đã điền ${run.filled || 0} · giữ nguyên ${run.skipped || 0} · bỏ qua ${run.omitted || 0}`;
  stopButton.hidden = !run.active;
  stopButton.disabled = !run.active;
  quickRunButton.disabled = busy || run.active;
  fillButton.disabled = busy || run.active;

  if (!run.active && run.outcome === "completed") setStatus(run.status, "success");
  if (!run.active && run.outcome === "stopped") setStatus(run.status, "");
  if (!run.active && run.outcome === "error") setStatus(run.status, "error");
}

async function refreshRun() {
  try {
    const stored = await chrome.storage.local.get(RUN_KEY);
    renderRun(stored[RUN_KEY]);
  } catch (error) {
    setStatus(error.message || "Không thể đọc tiến độ.", "error");
  }
}

async function scan(showResult = true) {
  setBusy(true);
  try {
    const result = await send("HSK_AUTOFILL_SCAN");
    pageName.textContent = result.pageTitle;
    fieldCount.textContent = String(result.count);
    if (showResult && !latestRun?.active) {
      setStatus(`Đã nhận diện ${result.count} trường; content v${result.version || "?"}; bỏ qua ${result.skipped} trường nhạy cảm/không hỗ trợ.`, "success");
    }
  } catch (error) {
    setStatus(`${error.message || "Không thể đọc trang hiện tại."} Nếu vừa Reload extension, hãy tải lại tab ChineseTest.`, "error");
  } finally {
    setBusy(false);
  }
}

async function startRunHere() {
  setBusy(true);
  try {
    const result = await send("HSK_AUTOFILL_QUICK_RUN");
    await refreshRun();
    setStatus(
      result.stoppedAtConfirm
        ? "Đang ở bước 4. Đã khóa tự động trước Submit."
        : "Đã bắt đầu. Bạn có thể bấm Dừng ngay bất cứ lúc nào.",
      "success"
    );
  } catch (error) {
    setStatus(`${error.message || "Không thể chạy tự động."} Nếu vừa Reload extension, hãy tải lại tab ChineseTest.`, "error");
  } finally {
    setBusy(false);
  }
}

async function openPersistentRunner() {
  setBusy(true);
  try {
    const tab = await currentTab();
    const url = chrome.runtime.getURL(`popup.html?runner=1&autostart=1&tabId=${tab.id}`);
    await chrome.windows.create({ url, type: "popup", width: 390, height: 610, focused: true });
  } catch (error) {
    setStatus(error.message || "Không thể mở cửa sổ tiến độ.", "error");
    setBusy(false);
  }
}

document.querySelector("#settings").addEventListener("click", async () => {
  setBusy(true);
  try {
    await chrome.runtime.openOptionsPage();
  } catch (error) {
    setStatus(error.message || "Không thể mở trang hồ sơ.", "error");
  } finally {
    setBusy(false);
  }
});

fillButton.addEventListener("click", async () => {
  setBusy(true);
  try {
    const result = await send("HSK_AUTOFILL_PROFILE_FILL");
    const suffix = result.missing?.length ? `; thiếu ${result.missing.join(", ")}` : "";
    setStatus(`Đã điền ${result.filled} trường, giữ nguyên ${result.skipped || 0}, bỏ qua ${result.omitted || 0} trường chưa cấu hình${suffix}.`, result.missing?.length ? "error" : "success");
  } catch (error) {
    setStatus(error.message || "Không thể điền dữ liệu.", "error");
  } finally {
    setBusy(false);
  }
});

quickRunButton.addEventListener("click", () => {
  if (isRunnerWindow) void startRunHere();
  else void openPersistentRunner();
});

stopButton.addEventListener("click", async () => {
  stopButton.disabled = true;
  try {
    const stored = await chrome.storage.local.get(RUN_KEY);
    const run = stored[RUN_KEY] || latestRun || {};
    targetTabId = targetTabId || run.targetTabId || null;
    const stopped = {
      ...run,
      active: false,
      stopRequested: true,
      outcome: "stopped",
      status: "Đã dừng theo yêu cầu của người dùng.",
      updatedAt: Date.now()
    };
    try {
      await send("HSK_AUTOFILL_STOP");
    } catch (_error) {
      // The persisted stop flag prevents the next page from resuming even if it is navigating.
    }
    await chrome.storage.local.set({ [RUN_KEY]: stopped });
    renderRun(stopped);
  } catch (error) {
    setStatus(error.message || "Không thể dừng phiên chạy.", "error");
  }
});

document.querySelector("#scan").addEventListener("click", () => void scan(true));

async function initialize() {
  await refreshRun();
  await scan(false);
  if (isRunnerWindow && autoStart && !latestRun?.active) await startRunHere();
  setInterval(() => { void refreshRun(); }, 200);
}

void initialize();
