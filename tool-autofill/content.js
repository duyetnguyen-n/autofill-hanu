(() => {
  "use strict";

  const STORAGE_KEY = "hskSafeAutofill.v1";
  const PROFILE_KEY = "hskSafeAutofill.profile.v1";
  const RUN_KEY = "hskSafeAutofill.quickRun.v1";
  const SCRIPT_VERSION = "0.5.0";
  const CONFIRM_PATH = "/signtw0toth";
  const NEXT_ALLOWED_PATHS = new Set(["/kaoshibaoming", "/signtw0totw", "/kshengbminfo"]);
  const SENSITIVE_RE = /(pass(word)?|pwd|otp|captcha|verification|verify.?code|security.?code|cvv|card.?number)/i;
  const CONSENT_RE = /(i have read|i agree|agree to|shall comply|privacy protection|registration and test affairs|receive relevant updates)/i;
  const EXCLUDED_TYPES = new Set(["hidden", "password", "file", "submit", "button", "reset", "image"]);
  const CATALOG_ENDPOINTS = new Map([
    ["/portal/index/getOptionList", new Set()],
    ["/portal/index/getSubjectList", new Set(["projectId"])],
    ["/examinee/enroll/getExamTimeList", new Set(["kmId", "ksType"])],
    ["/examinee/enroll/getZhouList", new Set(["kmId", "ksType", "ksDate"])],
    ["/examinee/enroll/getCountryList", new Set(["kmId", "ksType", "ksDate", "ZId"])],
    ["/examinee/enroll/getProvinceList", new Set(["kmId", "ksType", "ksDate", "ZId", "gjId"])],
    ["/examinee/enroll/getCityList", new Set(["kmId", "ksType", "ksDate", "ZId", "gjId", "proId"])],
    ["/examinee/enroll/getExamSiteList", new Set(["kmId", "ksType", "ksDate", "cityId", "gjId"])]
  ]);

  function getNormalizedPath() {
    const full = (location.pathname + location.search + location.hash).toLowerCase();
    if (full.includes("signtw0toth")) return "/signtw0toth";
    if (full.includes("kshengbminfo")) return "/kshengbminfo";
    if (full.includes("signtw0totw")) return "/signtw0totw";
    if (full.includes("kaoshibaoming")) return "/kaoshibaoming";
    return location.pathname.toLowerCase().replace(/\/+$/, "").split(";")[0] || "/";
  }

  async function waitForPageReady() {
    const currentPath = getNormalizedPath();
    if (currentPath === CONFIRM_PATH) return true;
    await waitForValue(() => {
      const inputs = document.querySelectorAll("input, .el-form-item, .el-select, button");
      return inputs.length > 0 ? true : null;
    }, 8000, 100);
    await sleep(250);
    return true;
  }

  let scriptActive = true;
  let stopRequested = false;
  let lastCatalogRequestAt = 0;
  const catalogCache = new Map();
  let catalogBridgeReadyPromise = null;

  class ExtensionContextEndedError extends Error {
    constructor() {
      super("Extension vừa được cập nhật. Hãy tải lại trang chinesetest.cn để dùng bản mới.");
      this.name = "ExtensionContextEndedError";
    }
  }

  class RunStoppedError extends Error {
    constructor() {
      super("Đã dừng theo yêu cầu của người dùng.");
      this.name = "RunStoppedError";
    }
  }

  function isContextEndedError(error) {
    return error instanceof ExtensionContextEndedError ||
      /extension context invalidated|message port closed|receiving end does not exist/i.test(String(error?.message || error));
  }

  function runtimeAlive() {
    try {
      return scriptActive && Boolean(globalThis.chrome?.runtime?.id);
    } catch (_error) {
      return false;
    }
  }

  function ensureCanContinue() {
    if (stopRequested) throw new RunStoppedError();
    if (!runtimeAlive()) throw new ExtensionContextEndedError();
  }

  // Use the callback form of chrome.storage. Calling the Promise form from a
  // content script that is invalidated during extension reload can itself be
  // reported by Chromium as an unhandled rejected Promise.
  function storageCall(method, argument) {
    return new Promise((resolve, reject) => {
      if (!runtimeAlive()) {
        reject(new ExtensionContextEndedError());
        return;
      }

      let settled = false;
      const finish = (error, value) => {
        if (settled) return;
        settled = true;
        clearInterval(contextWatch);
        clearTimeout(timeoutId);
        if (error) reject(error); else resolve(value);
      };
      const normalizeError = (error) => {
        if (isContextEndedError(error) || !runtimeAlive()) {
          scriptActive = false;
          return new ExtensionContextEndedError();
        }
        return error;
      };
      const callback = (value) => {
        try {
          const lastError = chrome.runtime?.lastError;
          if (lastError) {
            finish(normalizeError(new Error(lastError.message)));
            return;
          }
          finish(null, value);
        } catch (error) {
          finish(normalizeError(error));
        }
      };

      const contextWatch = setInterval(() => {
        if (!runtimeAlive()) finish(new ExtensionContextEndedError());
      }, 50);
      const timeoutId = setTimeout(() => finish(new Error("Storage của extension không phản hồi.")), 5000);

      try {
        const maybePromise = chrome.storage.local[method](argument, callback);
        // Test doubles and a few Chromium variants may still return a Promise.
        // It is always observed here, so it can never become an unhandled rejection.
        if (maybePromise?.then) {
          maybePromise.then((value) => finish(null, value)).catch((error) => finish(normalizeError(error)));
        }
      } catch (error) {
        finish(normalizeError(error));
      }
    });
  }

  const storageGet = (key) => storageCall("get", key);
  const storageSet = (values) => storageCall("set", values);
  const storageRemove = (key) => storageCall("remove", key);

  globalThis.addEventListener?.("unhandledrejection", (event) => {
    if (!isContextEndedError(event.reason)) return;
    event.preventDefault();
    scriptActive = false;
    showRunStatus("Extension vừa được tải lại. Hãy tải lại trang này để tiếp tục.", "error");
  });

  const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
  const compact = (value) => String(value || "").replace(/\s+/g, " ").trim();
  const normalizeChoice = (value) => compact(value)
    .toLowerCase()
    .replace(/[（]/g, "(")
    .replace(/[）]/g, ")")
    .replace(/\s*([()/,-])\s*/g, "$1");

  function sanitizeCatalogValue(value, depth = 0) {
    if (depth > 5 || value === null || value === undefined) return value ?? null;
    if (["string", "number", "boolean"].includes(typeof value)) return value;
    if (Array.isArray(value)) return value.slice(0, 2000).map((item) => sanitizeCatalogValue(item, depth + 1));
    if (typeof value !== "object") return null;
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !/token|cookie|password|authorization|session/i.test(key))
        .slice(0, 100)
        .map(([key, item]) => [key, sanitizeCatalogValue(item, depth + 1)])
    );
  }

  function ensureCatalogBridge() {
    if (catalogBridgeReadyPromise) return catalogBridgeReadyPromise;
    catalogBridgeReadyPromise = new Promise((resolve, reject) => {
      let settled = false;
      const finish = (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutId);
        globalThis.removeEventListener("message", onMessage);
        if (error) reject(error); else resolve();
      };
      const onMessage = (event) => {
        if (event.source !== globalThis) return;
        if (event.data?.source !== "HSK_SAFE_AUTOFILL_PAGE_BRIDGE") return;
        if (event.data?.type === "READY") finish();
      };
      const timeoutId = setTimeout(
        () => finish(new Error("Không thể kết nối lớp API của ChineseTest.")),
        8000
      );

      try {
        ensureCanContinue();
        globalThis.addEventListener("message", onMessage);
        const script = document.createElement("script");
        script.src = chrome.runtime.getURL("page-bridge.js");
        script.async = false;
        script.addEventListener("load", () => script.remove(), { once: true });
        script.addEventListener("error", () => {
          script.remove();
          finish(new Error("ChineseTest đã chặn cầu nối API của extension."));
        }, { once: true });
        (document.head || document.documentElement).append(script);
      } catch (error) {
        finish(isContextEndedError(error) ? new ExtensionContextEndedError() : error);
      }
    }).catch((error) => {
      catalogBridgeReadyPromise = null;
      throw error;
    });
    return catalogBridgeReadyPromise;
  }

  async function callCatalogBridge(path, params) {
    await ensureCatalogBridge();
    ensureCanContinue();
    const requestId = `hsk-catalog-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (error, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutId);
        globalThis.removeEventListener("message", onMessage);
        if (error) reject(error); else resolve(value);
      };
      const onMessage = (event) => {
        if (event.source !== globalThis) return;
        const data = event.data;
        if (data?.source !== "HSK_SAFE_AUTOFILL_PAGE_BRIDGE" || data.requestId !== requestId) return;
        if (data.type !== "RESPONSE") return;
        if (data.error) finish(new Error(String(data.error)));
        else finish(null, data.payload);
      };
      const timeoutId = setTimeout(
        () => finish(new Error("API danh mục ChineseTest không phản hồi.")),
        15000
      );
      globalThis.addEventListener("message", onMessage);
      globalThis.postMessage({
        source: "HSK_SAFE_AUTOFILL_CONTENT",
        type: "CATALOG_READ",
        requestId,
        path,
        params
      }, location.origin);
    });
  }

  async function readCatalog(message = {}) {
    if (!runtimeAlive()) throw new ExtensionContextEndedError();
    const path = String(message.path || "");
    const allowedParams = CATALOG_ENDPOINTS.get(path);
    if (!allowedParams) throw new Error("Endpoint không thuộc danh sách API danh mục an toàn.");

    const url = new URL(path, location.origin);
    const params = {};
    Object.entries(message.params || {}).forEach(([key, value]) => {
      if (!allowedParams.has(key)) throw new Error(`Tham số không được phép: ${key}`);
      if (value !== "" && value !== null && value !== undefined) {
        const safeValue = String(value).slice(0, 200);
        url.searchParams.set(key, safeValue);
        params[key] = safeValue;
      }
    });
    const cacheKey = url.toString();
    const cached = catalogCache.get(cacheKey);
    if (cached && Date.now() - cached.savedAt < 2 * 60 * 1000) return cached.value;

    const waitMs = Math.max(0, 300 - (Date.now() - lastCatalogRequestAt));
    if (waitMs) await sleep(waitMs);
    if (!runtimeAlive()) throw new ExtensionContextEndedError();
    lastCatalogRequestAt = Date.now();

    const payload = await callCatalogBridge(path, params);
    ensureCanContinue();
    if (payload?.code !== undefined && Number(payload.code) !== 200) {
      throw new Error(payload.msg || payload.message || `API danh mục trả về mã ${payload.code}.`);
    }
    const value = {
      code: Number(payload?.code ?? 200),
      data: sanitizeCatalogValue(payload?.data ?? payload)
    };
    catalogCache.set(cacheKey, { savedAt: Date.now(), value });
    return value;
  }

  const visible = (element) => {
    if (!element?.isConnected) return false;
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
  };

  function dismissAlertsAndTips() {
    if (getNormalizedPath() === CONFIRM_PATH) return false;
    const dialogWrappers = document.querySelectorAll(
      ".el-message-box__wrapper, .el-dialog__wrapper, .el-message-box, .el-dialog, [role='dialog'], .ivu-modal-wrap, .layui-layer"
    );
    for (const wrapper of dialogWrappers) {
      if (!visible(wrapper)) continue;
      // Don't auto-dismiss crop dialogs
      if (/(裁剪|剪裁|crop|cutting)/i.test(wrapper.textContent)) continue;
      const buttons = [...wrapper.querySelectorAll("button, .el-button, [role='button']")];
      const dismissBtn = buttons.find((btn) => {
        if (!visible(btn) || btn.disabled) return false;
        const text = compact(btn.textContent).toLowerCase();
        return /(确定|我知道了|确认|关闭|提交|submit|ok|got it|i know|close|agree|同意|yes)/i.test(text);
      });
      if (dismissBtn) {
        dismissBtn.click();
        return true;
      }
    }
    return false;
  }

  function waitForValue(getValue, timeoutMs = 12000, intervalMs = 60) {
    return new Promise((resolve) => {
      let finished = false;
      let observer = null;
      let intervalId = null;
      let timeoutId = null;

      const finish = (value) => {
        if (finished) return;
        finished = true;
        observer?.disconnect();
        if (intervalId) clearInterval(intervalId);
        if (timeoutId) clearTimeout(timeoutId);
        resolve(value);
      };

      const check = () => {
        if (finished) return;
        if (stopRequested) {
          finish(null);
          return;
        }
        if (!runtimeAlive()) {
          scriptActive = false;
          finish(null);
          return;
        }
        try {
          dismissAlertsAndTips();
          const value = getValue();
          if (value) finish(value);
        } catch (_error) {
          // Vue may replace a node during a check; the next mutation retries immediately.
        }
      };

      observer = new MutationObserver(check);
      observer.observe(document.documentElement, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: ["class", "value", "aria-expanded", "disabled"]
      });
      intervalId = setInterval(check, intervalMs);
      timeoutId = setTimeout(() => finish(null), timeoutMs);
      check();
    });
  }

  function textFromLabel(element) {
    const id = element.id;
    if (id) {
      const explicit = document.querySelector(`label[for="${CSS.escape(id)}"]`);
      if (explicit) return compact(explicit.textContent);
    }

    const wrapped = element.closest("label");
    if (wrapped) return compact(wrapped.textContent);

    const formItem = element.closest(".el-form-item, .form-item, [class*='form_item'], [class*='form-item']");
    if (formItem) {
      const label = formItem.querySelector(".el-form-item__label, label, [class*='label']");
      if (label) return compact(label.textContent);
    }

    const group = element.closest("[role='group'], fieldset, td, li, .item");
    if (group) {
      const heading = group.querySelector("legend, label, h1, h2, h3, h4, h5, h6");
      if (heading) return compact(heading.textContent);
    }

    return compact(
      element.getAttribute("aria-label") ||
      element.getAttribute("placeholder") ||
      element.getAttribute("data-type") ||
      element.getAttribute("name") ||
      element.id
    );
  }

  function isSensitive(element, label) {
    const haystack = [
      label,
      element.type,
      element.name,
      element.id,
      element.autocomplete,
      element.getAttribute("data-type"),
      element.placeholder
    ].join(" ");
    return (
      element.type === "password" ||
      SENSITIVE_RE.test(haystack) ||
      ((element.type === "checkbox" || element.type === "radio") && CONSENT_RE.test(haystack))
    );
  }

  function controlKind(element) {
    if (element.matches("select")) return "select";
    if (element.matches("textarea")) return "textarea";
    if (element.closest(".el-select")) return "element-select";
    if (element.type === "checkbox" || element.type === "radio") return element.type;
    return element.type || "text";
  }

  function stableIdentity(element, label, kind, index) {
    const ownIdentity =
      element.getAttribute("data-type") ||
      element.getAttribute("name") ||
      element.id ||
      element.getAttribute("aria-label") ||
      element.getAttribute("placeholder");
    const optionIdentity = kind === "radio" || kind === "checkbox"
      ? `${ownIdentity || "option"}:${element.value}:${label}`
      : ownIdentity || label || `${kind}-${index}`;
    const base = compact(optionIdentity).toLowerCase();
    return `${location.origin}${location.pathname}|${kind}|${base}`;
  }

  function scanControls() {
    const raw = [...document.querySelectorAll("input, textarea, select")];
    const seenCustomSelects = new Set();
    const controls = [];
    let skipped = 0;

    raw.forEach((element, index) => {
      if (!visible(element) || element.disabled || EXCLUDED_TYPES.has(element.type)) {
        skipped += 1;
        return;
      }

      const customSelect = element.closest(".el-select");
      if (customSelect) {
        if (seenCustomSelects.has(customSelect)) return;
        seenCustomSelects.add(customSelect);
      }

      const subject = customSelect || element;
      const valueElement = customSelect?.querySelector("input") || element;
      const label = textFromLabel(subject) || textFromLabel(valueElement);
      if (isSensitive(valueElement, label)) {
        skipped += 1;
        return;
      }

      const kind = controlKind(valueElement);
      controls.push({
        element: subject,
        valueElement,
        kind,
        label: label || `Trường ${controls.length + 1}`,
        key: stableIdentity(valueElement, label, kind, index)
      });
    });

    return { controls, skipped };
  }

  function readControl(control) {
    const { valueElement: element, kind } = control;
    if (kind === "checkbox" || kind === "radio") {
      return { value: element.value, checked: element.checked };
    }
    if (kind === "select") {
      return {
        value: element.value,
        text: compact(element.selectedOptions?.[0]?.textContent)
      };
    }
    return { value: element.value };
  }

  function hasMeaningfulValue(control, data) {
    if (control.kind === "checkbox" || control.kind === "radio") return data.checked;
    return compact(data.value || data.text).length > 0;
  }

  function dispatchValueEvents(element) {
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
    element.dispatchEvent(new Event("blur", { bubbles: true }));
  }

  function setNativeValue(element, value) {
    const prototype = element instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");
    descriptor?.set?.call(element, value);
    if (!descriptor?.set) element.value = value;
    dispatchValueEvents(element);
  }

  async function fillCustomSelect(control, data) {
    const targetText = compact(data.value || data.text);
    if (!targetText) return false;
    const wanted = normalizeChoice(targetText);

    for (let attempt = 0; attempt < 2; attempt += 1) {
      ensureCanContinue();
      if (!control.element.isConnected || !control.valueElement.isConnected) return false;

      // Safety invariant: only the select itself and one dropdown option may be clicked.
      control.element.click();
      let lastActivation = Date.now();

      // Filterable/remote Element UI selects need the desired text before options load.
      if (!control.valueElement.readOnly) {
        setNativeValue(control.valueElement, targetText);
      }

      const option = await waitForValue(() => {
        const options = [...document.querySelectorAll(".el-select-dropdown__item")]
          .filter((candidate) => visible(candidate) && !candidate.classList.contains("is-disabled"));
        const match = options.find((candidate) => normalizeChoice(candidate.textContent) === wanted) || null;
        if (match) return match;

        // A dependent select may exist before the user finishes its prerequisite.
        // Re-open it frequently so the desired option is picked immediately after
        // the user's manual selection unlocks the field.
        if (Date.now() - lastActivation >= 250 && control.element.isConnected) {
          control.element.click();
          lastActivation = Date.now();
        }
        return null;
      }, attempt === 0 ? 12000 : 7000, 50);

      if (option) {
        option.click();
        const selected = await waitForValue(
          () => {
            const actual = compact(control.valueElement.value);
            if (!actual) return false;
            if (normalizeChoice(actual) === wanted) return true;

            // We clicked an exact matching option. Some site components rewrite the
            // display label (punctuation/abbreviation) while committing the value.
            // A closed dropdown plus a non-empty display value is authoritative here.
            const expanded = control.valueElement.getAttribute("aria-expanded") === "true";
            const hasVisibleDropdown = [...document.querySelectorAll(".el-select-dropdown")]
              .some((dropdown) => visible(dropdown));
            return !expanded && !hasVisibleDropdown;
          },
          4000,
          50
        );
        if (selected) return true;
      }

      document.body.click();
      await sleep(120);
    }
    return false;
  }

  async function fillControl(control, data) {
    const { valueElement: element, kind } = control;
    if (kind === "element-select") return fillCustomSelect(control, data);

    if (kind === "checkbox" || kind === "radio") {
      if (!data.checked || element.checked) return Boolean(data.checked);
      element.checked = true;
      dispatchValueEvents(element);
      return true;
    }

    if (kind === "select") {
      const matchingOption = [...element.options].find(
        (option) => option.value === data.value || compact(option.textContent) === compact(data.text)
      );
      if (!matchingOption) return false;
      element.value = matchingOption.value;
      dispatchValueEvents(element);
      return true;
    }

    if (element.readOnly && !element.closest(".el-date-editor")) return false;
    setNativeValue(element, data.value || "");
    if (element.closest(".el-date-editor")) {
      element.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true }));
      element.dispatchEvent(new KeyboardEvent("keyup", { key: "Enter", code: "Enter", bubbles: true }));
    }
    return true;
  }

  function highlight(element) {
    element.classList.add("hsk-safe-autofill-highlight");
    setTimeout(() => element.classList.remove("hsk-safe-autofill-highlight"), 1600);
  }

  function controlSearchText(control) {
    const element = control.valueElement;
    const formText = compact(element.closest(".el-form-item")?.textContent);
    return compact([
      control.label,
      element.name,
      element.id,
      element.placeholder,
      element.getAttribute("data-type"),
      element.getAttribute("aria-label"),
      formText
    ].join(" ")).toLowerCase();
  }

  function findControl(controls, aliases) {
    return controls.find((control) => {
      const haystack = controlSearchText(control);
      return aliases.some((alias) => haystack.includes(alias.toLowerCase()));
    });
  }

  function fallbackControl(controls, fallbackKind, fallbackIndex) {
    if (!fallbackKind || fallbackIndex === undefined) return null;
    return controls.filter((control) => control.kind === fallbackKind)[fallbackIndex] || null;
  }

  function valueMatches(control, value) {
    const wanted = normalizeChoice(value);
    if (control.kind === "radio" || control.kind === "checkbox") {
      return control.valueElement.checked && controlSearchText(control).includes(wanted);
    }
    return normalizeChoice(control.valueElement.value) === wanted;
  }

  function controlAlreadyHasValue(control) {
    const element = control.valueElement;
    if (control.kind === "radio" || control.kind === "checkbox") return element.checked;
    if (control.kind === "select") return compact(element.value).length > 0;
    return compact(element.value).length > 0;
  }

  async function fillMapped(aliases, value, fallbackKind, fallbackIndex, timeoutMs = 22000) {
    if (!compact(value)) return false;
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      ensureCanContinue();
      const { controls } = scanControls();
      const control = findControl(controls, aliases) || fallbackControl(controls, fallbackKind, fallbackIndex);
      if (!control) {
        await sleep(80);
        continue;
      }

      // Never replace data that the candidate or another helper already entered.
      if (controlAlreadyHasValue(control)) return "existing";

      try {
        const didFill = await fillControl(control, { value });
        if (didFill) {
          // fillCustomSelect only returns true after clicking the exact option and
          // observing the committed/closed state. Do not require the site to preserve
          // the profile's exact display punctuation a second time.
          if (control.kind === "element-select") {
            highlight(control.element);
            return "filled";
          }
          const verified = await waitForValue(() => {
            const freshControls = scanControls().controls;
            const fresh = findControl(freshControls, aliases) || fallbackControl(freshControls, fallbackKind, fallbackIndex);
            return fresh && valueMatches(fresh, value) ? fresh : null;
          }, 5000, 60);
          if (verified) {
            highlight(verified.element);
            return "filled";
          }
        }
      } catch (error) {
        if (error instanceof RunStoppedError || isContextEndedError(error)) throw error;
        console.debug("HSK Safe Autofill will retry field:", error);
      }
      await sleep(120);
    }
    return false;
  }

  const GENDER_ALIASES = {
    male: ["male", "男", "1"],
    female: ["female", "女", "2"],
    other: ["other", "其他", "其它", "0"]
  };

  async function fillRadio(value) {
    if (!compact(value)) return false;
    ensureCanContinue();
    if (scanControls().controls.some((control) => control.kind === "radio" && control.valueElement.checked)) {
      return "existing";
    }
    const raw = normalizeChoice(value);
    const aliases = GENDER_ALIASES[raw] || [raw];
    const target = await waitForValue(() => scanControls().controls.find((control) => {
      if (control.kind !== "radio") return false;
      const text = normalizeChoice(controlSearchText(control));
      const val = normalizeChoice(control.valueElement.value);
      return aliases.some((a) => text.includes(a) || val === a);
    }), 12000, 60);
    ensureCanContinue();
    if (!target) return false;
    if (target.valueElement.checked) return "existing";
    const filled = await fillControl(target, { value: target.valueElement.value, checked: true });
    return filled && target.valueElement.checked ? "filled" : false;
  }

  async function uploadPhoto(photoDataUrl, photoName = "photo.jpg") {
    ensureCanContinue();
    if (!compact(photoDataUrl)) return false;

    // 1. Kiểm tra xem ảnh đã được nạp/tải lên trước đó hay chưa
    const existingImg = document.querySelector(
      ".el-upload img, [class*='upload'] img, [class*='avatar'] img, [class*='photo'] img, img#photo, img.user-photo"
    );
    if (existingImg && existingImg.src && !existingImg.src.includes("default") && !existingImg.src.includes("placeholder") && !existingImg.src.endsWith(".svg")) {
      return "existing";
    }

    // 2. Tìm thẻ input file của trang (thường nằm trong el-upload hoặc nhận file ảnh)
    const fileInput = await waitForValue(() => {
      const inputs = [...document.querySelectorAll("input[type='file']")];
      if (inputs.length === 0) return null;
      const imageInput = inputs.find((i) =>
        (i.accept && /image/i.test(i.accept)) ||
        i.closest(".el-upload, [class*='upload'], [class*='photo'], [class*='avatar'], [id*='photo'], [id*='upload']")
      );
      return imageInput || inputs[0];
    }, 12000, 60);

    ensureCanContinue();
    if (!fileInput) return false;

    try {
      const res = await fetch(photoDataUrl);
      const blob = await res.blob();
      const file = new File([blob], photoName || "photo.jpg", { type: blob.type || "image/jpeg" });
      const dt = new DataTransfer();
      dt.items.add(file);
      fileInput.files = dt.files;
      fileInput.dispatchEvent(new Event("input", { bubbles: true }));
      fileInput.dispatchEvent(new Event("change", { bubbles: true }));

      const container = fileInput.closest(".el-upload, .el-form-item, [class*='upload']") || fileInput;
      highlight(container);

      // 3. Nếu ChineseTest mở hộp thoại cắt ảnh (crop dialog), tự động xác nhận
      const cropBtn = await waitForValue(() => {
        const buttons = [...document.querySelectorAll(
          ".el-dialog__wrapper button, .el-dialog button, [class*='crop'] button, [class*='dialog'] button, button"
        )];
        return buttons.find((b) =>
          visible(b) && !b.disabled && /(完成|确定|裁剪|保存|complete|confirm|cutting|crop)/i.test(compact(b.textContent))
        );
      }, 3000, 100);

      if (cropBtn) {
        cropBtn.click();
        await sleep(300);
      }

      return "filled";
    } catch (error) {
      console.debug("HSK Safe Autofill uploadPhoto error:", error);
      return false;
    }
  }

  async function getProfile() {
    const stored = await storageGet(PROFILE_KEY);
    return stored[PROFILE_KEY] || {};
  }

  const ROUTE_PROGRESS = {
    "/kaoshibaoming": { step: 1, base: 2, span: 30, total: 7 },
    "/signtw0totw": { step: 2, base: 34, span: 32, total: 13 },
    "/kshengbminfo": { step: 3, base: 68, span: 27, total: 0 }
  };

  async function updateRunProgress(patch) {
    ensureCanContinue();
    const stored = await storageGet(RUN_KEY);
    const run = stored[RUN_KEY] || {};
    if (!run.active || run.stopRequested) {
      stopRequested = true;
      throw new RunStoppedError();
    }
    ensureCanContinue();
    await storageSet({
      [RUN_KEY]: { ...run, ...patch, active: true, updatedAt: Date.now() }
    });
  }

  async function fillProfile(trackProgress = false) {
    const currentPath = getNormalizedPath();
    if (currentPath === CONFIRM_PATH) {
      return { filled: 0, missing: [], stoppedAtConfirm: true };
    }

    const profile = await getProfile();
    const missing = [];
    let filled = 0;
    let skipped = 0;
    let omitted = 0;
    let completed = 0;
    const routeProgress = ROUTE_PROGRESS[currentPath] || { step: 0, base: 0, span: 0, total: 0 };
    const reportFieldProgress = async (label, after = false) => {
      if (!trackProgress) return;
      const done = completed + (after ? 0 : 0);
      const fraction = routeProgress.total ? done / routeProgress.total : 1;
      await updateRunProgress({
        step: routeProgress.step,
        currentField: label,
        fieldIndex: completed,
        fieldTotal: routeProgress.total,
        progress: Math.round(routeProgress.base + routeProgress.span * fraction),
        filled,
        skipped,
        omitted,
        status: after ? `Đã kiểm tra: ${label}` : `Đang kiểm tra: ${label}…`
      });
    };
    const put = async (
      label,
      aliases,
      value,
      _required = false,
      fallbackKind = null,
      fallbackIndex = undefined
    ) => {
      ensureCanContinue();
      if (!compact(value)) {
        omitted += 1;
        completed += 1;
        showRunStatus(`Bỏ qua ${label}: chưa cấu hình. Đang chờ các lựa chọn thủ công nếu trường sau phụ thuộc…`);
        await reportFieldProgress(label, true);
        return;
      }
      showRunStatus(`Đang chờ và kiểm tra: ${label}…`);
      await reportFieldProgress(label);
      const outcome = await fillMapped(
        aliases,
        value,
        fallbackKind,
        fallbackIndex,
        trackProgress ? 10 * 60 * 1000 : 22000
      );
      if (outcome === "filled") filled += 1;
      else if (outcome === "existing") skipped += 1;
      else missing.push(label);
      completed += 1;
      await reportFieldProgress(label, true);
      // The next field begins observing immediately; no fixed delay is needed.
      await sleep(20);
      ensureCanContinue();
    };
    const putRadio = async (label, value, _required = false) => {
      ensureCanContinue();
      if (!compact(value)) {
        omitted += 1;
        completed += 1;
        showRunStatus(`Bỏ qua ${label}: chưa cấu hình.`);
        await reportFieldProgress(label, true);
        return;
      }
      showRunStatus(`Đang chờ và kiểm tra: ${label}…`);
      await reportFieldProgress(label);
      const outcome = await fillRadio(value);
      if (outcome === "filled") filled += 1;
      else if (outcome === "existing") skipped += 1;
      else missing.push(label);
      completed += 1;
      await reportFieldProgress(label, true);
    };
    const putPhoto = async (label, photoDataUrl, photoName = "photo.jpg") => {
      ensureCanContinue();
      if (!compact(photoDataUrl)) {
        omitted += 1;
        completed += 1;
        showRunStatus(`Bỏ qua ${label}: chưa cấu hình ảnh trong hồ sơ.`);
        await reportFieldProgress(label, true);
        return;
      }
      showRunStatus(`Đang chờ và tải lên: ${label}…`);
      await reportFieldProgress(label);
      const outcome = await uploadPhoto(photoDataUrl, photoName);
      if (outcome === "filled") filled += 1;
      else if (outcome === "existing") skipped += 1;
      else missing.push(label);
      completed += 1;
      await reportFieldProgress(label, true);
      await sleep(30);
      ensureCanContinue();
    };

    if (currentPath === "/kaoshibaoming") {
      // The page rerenders dependent selects after each choice, so every call rescans the DOM.
      await put("loại kỳ thi", ["select test type", "test type", "考试类别", "考试项目"], profile.testType, true, "element-select", 0);
      await put("cấp độ", ["select test level", "test level", "考试级别", "级别"], profile.testLevel, true, "element-select", 1);
      await put("hình thức", ["select test format", "test format", "考试形式"], profile.testFormat, true, "element-select", 2);
      await put("ngày thi", ["select test date", "test date", "考试日期", "日期"], profile.testDate, true, "element-select", 3);
      await put("châu lục", ["select continent", "continent", "大洲", "洲"], profile.continent, true, "element-select", 4);
      await put("quốc gia/khu vực", ["select country/area", "country/area", "国家/地区", "国家"], profile.countryArea, true, "element-select", 5);
      await put("trung tâm thi", ["select test center", "test center", "考点"], profile.testCenter, true, "element-select", 6);
    } else if (currentPath === "/signtw0totw") {
      await put("họ tên", ["fullname on id", "id name", "full name", "fullname", "姓名", "证件姓名", "考生姓名", "真实姓名", "name"], profile.fullName, true);
      await put("tên tiếng Trung", ["chinese name", "中文姓名", "中文名"], profile.chineseName);
      await put("ngày sinh", ["date of birth", "birth", "出生日期", "出生年月", "生日"], profile.dateOfBirth, true);
      await putRadio("giới tính", profile.gender, true);
      await put("quốc tịch", ["select nationality", "nationality", "国籍", "国家"], profile.nationality, true, "element-select", 0);
      await put("loại giấy tờ", ["select type of identification", "type of id", "identification type", "证件类型", "证件种类", "证件"], profile.idType, true, "element-select", 1);
      await put("số giấy tờ", ["id number", "identification number", "id no", "证件号码", "证件号", "护照号码", "护照号", "number"], profile.idNumber, true);
      await put("điện thoại", ["phone number", "phone", "telephone", "mobile", "电话", "联系电话", "手机", "手机号码"], profile.phone, true);
      await put("địa chỉ", ["address", "mailing address", "地址", "联系地址", "通讯地址", "居住地址"], profile.address);
      await put("tiếng mẹ đẻ", ["select mother language", "mother tongue", "native language", "母语"], profile.motherTongue, true, "element-select", 2);
      await put("thời gian học", ["select number of years", "how long learning", "learning duration", "学习汉语时间", "学习时间"], profile.learningDuration, false, "element-select", 3);
      await put("nghề nghiệp", ["select sector", "occupation", "profession", "job", "职业"], profile.occupation, false, "element-select", 4);
      await putPhoto("ảnh thẻ", profile.photoDataUrl || profile.photo, profile.photoName || "photo.jpg");
    } else if (currentPath === "/kshengbminfo" && trackProgress) {
      await updateRunProgress({
        step: 3,
        progress: 94,
        fieldIndex: 0,
        fieldTotal: 0,
        currentField: "bước 3",
        status: "Đang kiểm tra bước 3…",
        filled,
        skipped,
        omitted
      });
    }

    return { filled, skipped, omitted, missing, stoppedAtConfirm: false };
  }

  function showRunStatus(message, kind = "ok") {
    let banner = document.querySelector("#hsk-safe-autofill-status");
    if (!banner) {
      banner = document.createElement("div");
      banner.id = "hsk-safe-autofill-status";
      document.documentElement.appendChild(banner);
    }
    banner.dataset.kind = kind;
    banner.textContent = message;
  }

  async function stopQuickRun(message, kind = "ok", outcome = "completed", progress = 100) {
    const stored = await storageGet(RUN_KEY);
    const run = stored[RUN_KEY] || {};
    await storageSet({
      [RUN_KEY]: {
        ...run,
        active: false,
        stopRequested: outcome === "stopped",
        outcome,
        status: message,
        progress,
        updatedAt: Date.now()
      }
    });
    showRunStatus(message, kind);
  }

  async function reportRunError(error) {
    if (isContextEndedError(error) || !runtimeAlive()) {
      scriptActive = false;
      showRunStatus("Extension vừa được tải lại. Hãy tải lại trang này để tiếp tục.", "error");
      return;
    }
    if (error instanceof RunStoppedError) {
      try {
        await stopQuickRun("Đã dừng theo yêu cầu của người dùng.", "ok", "stopped", 0);
      } catch (_storageError) {
        // The popup already persists the stop request; the local flag still halts DOM actions.
      }
      showRunStatus("Đã dừng theo yêu cầu của người dùng.");
      return;
    }
    try {
      const stored = await storageGet(RUN_KEY);
      const run = stored[RUN_KEY] || {};
      await storageSet({
        [RUN_KEY]: {
          ...run,
          active: false,
          outcome: "error",
          status: error?.message || String(error),
          updatedAt: Date.now()
        }
      });
    } catch (storageError) {
      if (isContextEndedError(storageError)) {
        scriptActive = false;
        showRunStatus("Extension vừa được tải lại. Hãy tải lại trang này để tiếp tục.", "error");
        return;
      }
    }
    showRunStatus(error?.message || String(error), "error");
  }

  async function clickNextSafely() {
    ensureCanContinue();
    const currentPath = getNormalizedPath();
    if (!NEXT_ALLOWED_PATHS.has(currentPath) || currentPath === CONFIRM_PATH) {
      throw new Error("Đã chặn tự động tại bước xác nhận.");
    }
    await updateRunProgress({
      status: "Đang chờ bạn hoàn thành các trường tự chọn để nút Next khả dụng…",
      currentField: "Chờ lựa chọn thủ công"
    });
    const button = await waitForValue(() => [...document.querySelectorAll("button, .el-button")].find(
      (candidate) => {
        const text = compact(candidate.textContent).toLowerCase();
        return (text === "next" || text === "下一步" || candidate.id === "next") && !candidate.disabled;
      }
    ), 10 * 60 * 1000, 60);
    ensureCanContinue();
    if (!button) throw new Error("Nút Next chưa sẵn sàng sau thời gian chờ.");
    if (/(submit|confirm|pay|确认并提交|支付)/i.test(compact(button.textContent))) {
      throw new Error("Đã chặn nút gửi/xác nhận.");
    }
    const nextProgress = currentPath === "/kaoshibaoming"
      ? 33
      : currentPath === "/signtw0totw"
        ? 67
        : 98;
    await updateRunProgress({
      progress: nextProgress,
      status: "Đã kiểm tra xong, đang sang bước kế tiếp…",
      currentField: "Next"
    });
    ensureCanContinue();
    button.click();

    // Chờ trang chuyển sang bước mới (hỗ trợ cả SPA Vue Router và full reload)
    const nextStep = await waitForValue(() => {
      const nowPath = getNormalizedPath();
      if (nowPath !== currentPath && (NEXT_ALLOWED_PATHS.has(nowPath) || nowPath === CONFIRM_PATH)) {
        return nowPath;
      }
      return null;
    }, 15000, 150);

    if (nextStep) {
      await waitForPageReady();
      return executeQuickStep();
    }
  }

  async function executeQuickStep() {
    if (!runtimeAlive()) throw new ExtensionContextEndedError();
    const currentPath = getNormalizedPath();
    if (currentPath === CONFIRM_PATH) {
      await stopQuickRun("Đã dừng an toàn ở bước 4 — chưa chọn đồng ý, chưa Submit.", "ok", "completed", 100);
      return { stoppedAtConfirm: true };
    }
    if (!NEXT_ALLOWED_PATHS.has(currentPath)) {
      await stopQuickRun("Đã dừng: trang hiện tại không thuộc luồng đăng ký.", "error");
      throw new Error("Trang hiện tại không thuộc luồng đăng ký.");
    }

    showRunStatus("Đang điền hồ sơ…");
    const result = await fillProfile(true);
    if (result.missing.length) {
      await stopQuickRun(`Thiếu dữ liệu: ${result.missing.join(", ")}.`, "error", "error", 0);
      throw new Error(`Thiếu dữ liệu: ${result.missing.join(", ")}.`);
    }
    showRunStatus("Đã điền xong, đang sang bước kế tiếp…");
    await clickNextSafely();
    return { ...result, started: true };
  }

  async function startQuickRun(message = {}) {
    stopRequested = false;
    const currentPath = getNormalizedPath();
    if (currentPath === CONFIRM_PATH) {
      await storageSet({
        [RUN_KEY]: {
          active: false,
          startedAt: Date.now(),
          updatedAt: Date.now(),
          version: SCRIPT_VERSION,
          targetTabId: message.targetTabId,
          progress: 100,
          outcome: "completed",
          status: "Đang ở bước 4 — không thực hiện Submit."
        }
      });
      showRunStatus("Đang ở bước 4 — không thực hiện Submit.");
      return { stoppedAtConfirm: true };
    }
    await storageSet({
      [RUN_KEY]: {
        active: true,
        stopRequested: false,
        startedAt: Date.now(),
        updatedAt: Date.now(),
        version: SCRIPT_VERSION,
        targetTabId: message.targetTabId,
        progress: 1,
        step: 1,
        fieldIndex: 0,
        fieldTotal: 0,
        filled: 0,
        skipped: 0,
        omitted: 0,
        status: "Đang khởi động…"
      }
    });
    setTimeout(() => {
      executeQuickStep().catch((error) => {
        void reportRunError(error).catch(() => {});
      });
    }, 20);
    return { started: true, stoppedAtConfirm: false };
  }

  async function requestStop() {
    stopRequested = true;
    try {
      const stored = await storageGet(RUN_KEY);
      const run = stored[RUN_KEY] || {};
      await storageSet({
        [RUN_KEY]: {
          ...run,
          active: false,
          stopRequested: true,
          outcome: "stopped",
          status: "Đã dừng theo yêu cầu của người dùng.",
          updatedAt: Date.now()
        }
      });
    } catch (error) {
      if (!isContextEndedError(error)) throw error;
    }
    showRunStatus("Đã dừng theo yêu cầu của người dùng.");
    return { stopped: true };
  }

  async function scan() {
    const { controls, skipped } = scanControls();
    return {
      count: controls.length,
      skipped,
      pageTitle: compact(document.querySelector("h1, h2, h3, .navigation_box")?.textContent) || document.title,
      version: SCRIPT_VERSION
    };
  }

  async function capture() {
    const { controls } = scanControls();
    const stored = await storageGet(STORAGE_KEY);
    const database = stored[STORAGE_KEY] || { fields: {}, updatedAt: null };
    let saved = 0;

    controls.forEach((control) => {
      const data = readControl(control);
      if (!hasMeaningfulValue(control, data)) return;
      database.fields[control.key] = {
        ...data,
        kind: control.kind,
        label: control.label,
        updatedAt: new Date().toISOString()
      };
      saved += 1;
    });

    database.updatedAt = new Date().toISOString();
    await storageSet({ [STORAGE_KEY]: database });
    return { saved };
  }

  async function fill() {
    const { controls } = scanControls();
    const stored = await storageGet(STORAGE_KEY);
    const fields = stored[STORAGE_KEY]?.fields || {};
    let filled = 0;
    let missing = 0;

    // Sequential filling is intentional because later dropdowns depend on earlier selections.
    for (const control of controls) {
      const data = fields[control.key];
      if (!data) {
        missing += 1;
        continue;
      }
      if (controlAlreadyHasValue(control)) continue;
      if (await fillControl(control, data)) {
        filled += 1;
        highlight(control.element);
      }
    }

    return { filled, missing };
  }

  try {
    chrome.storage.onChanged?.addListener((changes, areaName) => {
      if (areaName !== "local" || !changes[RUN_KEY]) return;
      const run = changes[RUN_KEY].newValue;
      if (run?.stopRequested || (run && run.active === false && run.outcome === "stopped")) {
        stopRequested = true;
      }
    });
  } catch (_error) {
    // A direct stop message still handles browsers without storage change events.
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    const actions = {
      HSK_AUTOFILL_SCAN: () => scan(),
      HSK_AUTOFILL_CAPTURE: () => capture(),
      HSK_AUTOFILL_FILL: () => fill(),
      HSK_AUTOFILL_PROFILE_FILL: () => fillProfile(false),
      HSK_AUTOFILL_QUICK_RUN: () => startQuickRun(message),
      HSK_AUTOFILL_STOP: () => requestStop(),
      HSK_AUTOFILL_CATALOG_READ: () => readCatalog(message)
    };
    const action = actions[message?.type];
    if (!action) return false;

    action()
      .then(sendResponse)
      .catch((error) => {
        void reportRunError(error).catch(() => {});
        try {
          sendResponse({ error: error.message || String(error) });
        } catch (_sendError) {
          // The popup/message channel can disappear while an extension is reloaded.
        }
      });
    return true;
  });

  storageGet(RUN_KEY).then(async (stored) => {
    const run = stored[RUN_KEY];
    if (!run?.active) return;
    if (run.version !== SCRIPT_VERSION) {
      await storageSet({ [RUN_KEY]: { ...run, version: SCRIPT_VERSION } }).catch(() => {});
    }
    if (Date.now() - run.startedAt > 20 * 60 * 1000) {
      stopQuickRun("Phiên chạy nhanh đã hết hạn.", "error", "error", run.progress || 0).catch(reportRunError);
      return;
    }
    await waitForPageReady();
    executeQuickStep().catch((error) => {
      void reportRunError(error).catch(() => {});
    });
  }).catch(reportRunError);

  // Theo dõi điều hướng SPA (chuyển trang không reload trình duyệt)
  let lastWatchedPath = getNormalizedPath();
  setInterval(() => {
    if (stopRequested || !runtimeAlive()) return;
    const nowPath = getNormalizedPath();
    if (nowPath !== lastWatchedPath) {
      lastWatchedPath = nowPath;
      storageGet(RUN_KEY).then((stored) => {
        const run = stored[RUN_KEY];
        if (run?.active && !run?.stopRequested) {
          waitForPageReady().then(() => {
            executeQuickStep().catch((error) => void reportRunError(error).catch(() => {}));
          });
        }
      }).catch(() => {});
    }
  }, 400);
})();
