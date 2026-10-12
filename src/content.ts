import { HSK_RULES, getRule } from "./rules";
import { BlockingIssue, ControlKind, ExtensionMessage, FieldRule, FormEvent, FormQuestionSummary, Profile, RunMode, RunState, decideNextAction, hasExactAlias, mappingKey, normalize } from "./shared";
import type { PickerUploadResult } from "./picker-upload";

let active = false;
let activeMode: RunMode = "test";
let submitAttempted = false;
let manualSkipQuestionId: string | undefined;
let executionInFlight = false;
let cancelManualResume: (() => void) | undefined;
const documentEpoch=crypto.randomUUID();
let boundRunId:string|undefined;

// Clean up a one-off live-DOM diagnostic that could have been left by an
// earlier development build when this content script is reloaded in-place.
document.getElementById("hanu-coordinate-diagnostic")?.remove();

interface Question {
  element: HTMLElement;
  id: string;
  label: string;
  required: boolean;
  kind: ControlKind | "unknown";
}

function visible(element: Element): boolean {
  const style = window.getComputedStyle(element);
  const box = (element as HTMLElement).getBoundingClientRect();
  return style.display !== "none"
    && style.visibility !== "hidden"
    && style.opacity !== "0"
    && !element.closest('[aria-hidden="true"]')
    && box.width > 0
    && box.height > 0;
}

function formId(): string {
  return location.pathname.match(/\/d\/e\/([^/]+)/)?.[1] ?? "unknown-form";
}

function pageFingerprint(): string {
  // Google Forms can retain hidden headings from earlier pages. Fingerprint only
  // the currently visible interactive cards so Next is recognized reliably.
  const labels = findQuestionRoots().map(questionLabel).join("|");
  const navigation = Array.from(document.querySelectorAll<HTMLElement>('button, [role="button"]'))
    .filter(visible)
    .map((node) => (node.innerText ?? node.textContent ?? "").trim())
    .join("|");
  return `${location.pathname}:${labels.slice(0, 700)}:${navigation}`;
}

function matchesOrHas(element: Element, selector: string): boolean {
  return element.matches(selector) || Boolean(element.querySelector(selector));
}

function controlsIn(element: HTMLElement, selector: string): Element[] {
  return [element, ...Array.from(element.querySelectorAll(selector))].filter((node) => node.matches(selector));
}

function isGoogleFileUploadCard(element: Element): boolean {
  if (matchesOrHas(element, 'input[type="file"]')) return true;
  // Forms mounts the upload button asynchronously after a page navigation.
  // Keep the known upload card in the scan even before that button exists.
  const heading = element.querySelector('[role="heading"]')?.textContent ?? "";
  if (HSK_RULES.some(rule => rule.kind === "file" && hasExactAlias(heading, rule.aliases))) return true;
  const buttonText = Array.from(element.querySelectorAll<HTMLElement>('button, [role="button"]'))
    .map((button) => `${button.getAttribute("aria-label") ?? ""} ${button.innerText ?? button.textContent ?? ""}`.trim())
    .join(" ");
  const text = (element.textContent ?? "").replace(/\s+/g, " ");
  return /remove file|xóa tệp|delete file/i.test(buttonText)
    || (/add file|thêm tệp|tải tệp/i.test(buttonText) && /upload.*file|tải.*tệp|supported file/i.test(text));
}

function findQuestionRoots(): HTMLElement[] {
  const withControls = (nodes: Element[]): HTMLElement[] => nodes
    .filter((node): node is HTMLElement => node instanceof HTMLElement && visible(node))
    .filter((node) => isGoogleFileUploadCard(node) || matchesOrHas(node, 'select, input:not([type="hidden"]), textarea, [role="radio"], [role="checkbox"], [role="combobox"], [role="listbox"]'));

  // A data-item-id may belong to a section/container that holds several cards.
  // The listitem card is the precise question boundary on rendered Google Forms.
  const listItems = withControls(Array.from(document.querySelectorAll('div[role="listitem"]')));
  const candidates = listItems.length > 0
    ? listItems
    : withControls(Array.from(document.querySelectorAll("[data-item-id]")));

  const standaloneChecks = Array.from(document.querySelectorAll<HTMLElement>('[role="checkbox"]'))
    .filter(visible)
    .filter((node) => !candidates.some((candidate) => candidate.contains(node)));
  candidates.push(...standaloneChecks);

  const unique = candidates.filter((candidate, index) => candidates.indexOf(candidate) === index);
  return unique.filter((candidate) => !unique.some((other) => other !== candidate && other.contains(candidate) && other.querySelector('[role="heading"]')));
}

function questionLabel(element: HTMLElement): string {
  const heading = element.querySelector('[role="heading"]');
  if (heading?.textContent?.trim()) return heading.textContent.trim().replace(/\s+/g, " ");
  const ownLabel = element.getAttribute("aria-label");
  if (ownLabel) return ownLabel.trim();
  const labelled = element.querySelector('[aria-label]')?.getAttribute("aria-label");
  if (labelled) return labelled.trim();
  return (element.innerText.split("\n").find((line) => line.trim()) ?? "").trim();
}

function questionId(element: HTMLElement, label: string): string {
  return element.dataset.itemId
    || element.getAttribute("data-params")
    || element.id
    || element.querySelector('input[name^="entry."]')?.getAttribute("name")
    || `label:${normalize(label)}`;
}

function inferKind(element: HTMLElement): ControlKind | "unknown" {
  if (isGoogleFileUploadCard(element)) return "file";
  // A Google Forms radio question with an "Other" answer contains a text input
  // in the same card. Radio/checkbox must therefore win over a generic text
  // input, otherwise "Quốc tịch" is incorrectly classified as text.
  if (matchesOrHas(element, 'input[type="radio"], [role="radio"]')) return "radio";
  if (matchesOrHas(element, 'input[type="checkbox"], [role="checkbox"]')) return "checkbox";
  if (matchesOrHas(element, 'select, [role="combobox"], [role="listbox"]')) return "dropdown";
  if (matchesOrHas(element, "textarea")) return "textarea";
  if (matchesOrHas(element, 'input[type="date"]')) return "date";
  if (matchesOrHas(element, 'input[type="text"], input[type="email"], input[type="number"], [role="textbox"]')) return "text";
  return "unknown";
}

function isRequired(element: HTMLElement, label: string): boolean {
  if (element.querySelector('[aria-label*="Required" i], [data-required="true"]')) return true;
  return /(^|\s)\*($|\s)|required question|câu hỏi bắt buộc/i.test(label) || /required question|câu hỏi bắt buộc/i.test(element.innerText);
}

function questions(): Question[] {
  return findQuestionRoots().map((element) => {
    const label = questionLabel(element);
    return { element, label, id: questionId(element, label), required: isRequired(element, label), kind: inferKind(element) };
  });
}

function dateFormatFor(question: Question): string | undefined {
  if (question.kind !== "date" && !(question.kind === "text" && /ngày sinh|birth.?date|date of birth|出生日期/i.test(question.label))) return undefined;
  const input = question.element.querySelector<HTMLInputElement>('input:not([type="hidden"])');
  if (input?.type === "date") return "YYYY-MM-DD";
  const hint = `${question.label}\n${question.element.innerText ?? question.element.textContent ?? ""}\n${input?.placeholder ?? ""}`;
  const explicit = hint.match(/(?:yyyy|năm|year)\s*([./-])\s*(?:mm|tháng|month)\s*\1\s*(?:dd|ngày|day)/i);
  if (explicit) return `YYYY${explicit[1]}MM${explicit[1]}DD`;
  const dayFirst = hint.match(/(?:dd|ngày|day)\s*([./-])\s*(?:mm|tháng|month)\s*\1\s*(?:yyyy|năm|year)/i);
  if (dayFirst) return `DD${dayFirst[1]}MM${dayFirst[1]}YYYY`;
  return "YYYY-MM-DD";
}

function scanCurrentForm(): FormQuestionSummary[] {
  return questions().map((question) => {
    const nativeSelect = question.element.querySelector<HTMLSelectElement>("select");
    let options: string[] = [];
    if (nativeSelect) {
      options = Array.from(nativeSelect.options)
        .map((opt) => (opt.text || opt.value || "").trim())
        .filter((val, index, values) => val && !/^(choose|chọn)$/i.test(val) && values.indexOf(val) === index);
    } else {
      const optionSelector = question.kind === "radio" || question.kind === "checkbox"
        ? '[role="radio"], [role="checkbox"], input[type="radio"], input[type="checkbox"]'
        : question.kind === "dropdown" ? '[role="option"]' : "";
      options = optionSelector
        ? controlsIn(question.element, optionSelector)
          .flatMap(choiceValues)
          .filter((value, index, values) => value && !/^(choose|chọn)$/i.test(value) && values.indexOf(value) === index)
        : [];
    }
    return { id: question.id, label: question.label, required: question.required, kind: question.kind, filled: isFilled(question), options, dateFormat: dateFormatFor(question) };
  });
}

function checked(element: Element): boolean {
  return element.getAttribute("aria-checked") === "true" || (element instanceof HTMLInputElement && element.checked);
}

function isFilled(question: Question): boolean {
  const { element, kind } = question;
  if (kind === "text" || kind === "date" || kind === "textarea") {
    return Array.from(element.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input:not([type="hidden"]):not([type="radio"]):not([type="checkbox"]):not([type="file"]), textarea'))
      .some((input) => input.value.trim().length > 0);
  }
  if (kind === "radio" || kind === "checkbox") return controlsIn(element, 'input, [role="radio"], [role="checkbox"]').some(checked);
  if (kind === "dropdown") {
    const nativeSelect = element.querySelector<HTMLSelectElement>("select");
    if (nativeSelect) {
      const selected = nativeSelect.options[nativeSelect.selectedIndex];
      return Boolean(selected && !isPlaceholderChoice(selected));
    }
    const hidden = element.querySelector<HTMLInputElement>('input[type="hidden"][name^="entry."]');
    if (hidden) return Boolean(hidden.value.trim()) && !/^(choose|chọn)$/i.test(hidden.value.trim());
    const selected = Array.from(element.querySelectorAll<HTMLElement>('[role="option"][aria-selected="true"]'));
    if (selected.some((option) => !isPlaceholderChoice(option))) return true;
    return Array.from(element.querySelectorAll<HTMLElement>('[role="combobox"], [role="listbox"]')).some((node) => {
      const selectedId = node.getAttribute("aria-activedescendant");
      const selectedOption = selectedId ? document.getElementById(selectedId) : undefined;
      const value = node.getAttribute("aria-valuetext") ?? selectedOption?.getAttribute("data-value") ?? selectedOption?.textContent ?? "";
      return value.trim().length > 0 && !/^(choose|chọn)$/i.test(value.trim());
    });
  }
  if (kind === "file") {
    if (Array.from(element.querySelectorAll<HTMLInputElement>('input[type="file"]')).some((input) => (input.files?.length ?? 0) > 0)) return true;
    // Google Forms' Picker often removes/isolates its native input after the
    // user selects a file. Its rendered card exposes an Open file / Remove
    // file action instead, which is the reliable visible completion signal.
    const fileActions = Array.from(element.querySelectorAll<HTMLElement>('button, [role="button"]'))
      .map((button) => (button.getAttribute("aria-label") ?? button.innerText ?? button.textContent ?? "").trim())
      .join(" ");
    return /remove file|xóa tệp|xoa tep|delete file/i.test(fileActions);
  }
  return false;
}

function hasUnsatisfiedCaptcha(): boolean {
  const frame = document.querySelector('iframe[src*="recaptcha" i], iframe[src*="hcaptcha" i]');
  if (!frame) return false;
  const response = document.querySelector<HTMLTextAreaElement>('textarea[name="g-recaptcha-response"], textarea[name="h-captcha-response"]');
  return !response?.value.trim();
}

function isVerificationQuestion(question: Question): boolean {
  return /câu hỏi xác thực|verification|captcha|robot|bot|năm nay là năm bao nhiêu|今年是哪一年/i.test(`${question.label}\n${question.element.innerText}`);
}

function compatible(rule: FieldRule, kind: Question["kind"]): boolean {
  const supported = Array.isArray(rule.kind) ? rule.kind : [rule.kind];
  return kind !== "unknown" && supported.includes(kind);
}

function suggestedRules(label: string): string[] {
  const words = new Set(normalize(label).split(" ").filter((word) => word.length > 2));
  return HSK_RULES
    .map((rule) => ({ rule, score: rule.aliases.reduce((best, alias) => Math.max(best, normalize(alias).split(" ").filter((word) => words.has(word)).length), 0) }))
    .filter(({ score }) => score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, 4)
    .map(({ rule }) => rule.key);
}

function findRule(question: Question, profile: Profile): FieldRule | undefined {
  const mapped = profile.mappings[mappingKey(formId(), question.id)];
  if (mapped) return getRule(mapped);
  if (question.kind === "checkbox" && (/^record .+ as the email to be included with my response$/i.test(question.label)
    || /^luu lai .+ duoi dang email de them vao cau tra loi cua toi$/.test(normalize(question.label)))) return getRule("recordGoogleEmail");
  return HSK_RULES.find((rule) => hasExactAlias(question.label, rule.aliases));
}

function customValue(question: Question, profile: Profile): string | undefined {
  const custom = profile.customFields.find((field) => hasExactAlias(question.label, [field.label, ...field.aliases]));
  return custom?.value;
}

function setNativeValue(input: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const prototype = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
  input.dispatchEvent(new Event("blur", { bubbles: true }));
}

function setNativeSelectValue(select: HTMLSelectElement, option: HTMLOptionElement): void {
  // Assign through the native setter so controls managed by React, Angular and
  // older Chromium builds all observe the value change. Setting selectedIndex
  // as a fallback also covers options whose HTML value is an empty string.
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set;
  setter?.call(select, option.value);
  if (select.value !== option.value || select.selectedIndex < 0) select.selectedIndex = option.index;
  option.selected = true;
  select.dispatchEvent(new Event("input", { bubbles: true }));
  select.dispatchEvent(new Event("change", { bubbles: true }));
  select.dispatchEvent(new Event("blur", { bubbles: true }));
}

function formatDateForQuestion(value: string, question: Question): string {
  const format = dateFormatFor(question);
  if (!format) return value;
  const match = value.trim().match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/) ?? value.trim().match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
  if (!match) return value;
  const [year, month, day] = match[1].length === 4
    ? [match[1], match[2].padStart(2, "0"), match[3].padStart(2, "0")]
    : [match[3], match[2].padStart(2, "0"), match[1].padStart(2, "0")];
  if (format.startsWith("DD")) return format.replace("DD", day).replace("MM", month).replace("YYYY", year);
  return format.replace("YYYY", year).replace("MM", month).replace("DD", day);
}

function choiceValues(element: Element): string[] {
  const values = [
    element.getAttribute("data-value"),
    element.getAttribute("aria-label"),
    element instanceof HTMLInputElement ? element.value : undefined,
    element instanceof HTMLOptionElement ? element.value : undefined,
    element.textContent
  ].filter((value): value is string => Boolean(value?.trim()));
  return [...new Set(values.map((value) => value.trim()))];
}

function isPlaceholderChoice(element: Element): boolean {
  const values = choiceValues(element);
  return values.length === 0 || values.every((value) => {
    const normalized = normalize(value).replace(/^[\s\-–—]+|[\s\-–—]+$/g, "");
    return /^(choose|chon|select|please select|vui long chon)(\s+.+)?$/i.test(normalized);
  });
}

function choiceMatchesValue(element: Element, wanted: string, aliases: string[] = []): boolean {
  const targets = [wanted, ...aliases].map(normalize);
  return choiceValues(element).some((value) => {
    const full = normalize(value);
    if (targets.includes(full)) return true;
    // Forms often renders bilingual options such as "Việt Nam | 越南" with
    // variable spacing. Match one complete displayed language segment only.
    return value.split("|").map(normalize).some((segment) => targets.includes(segment));
  });
}

function exactChoice(elements: Element[], wanted: string, aliases: string[] = []): Element | undefined {
  return elements.find((element) => choiceMatchesValue(element, wanted, aliases));
}

async function trustedClick(element: Element): Promise<boolean> {
  const { x, y } = pointerCoordinates(element);
  const result = await chrome.runtime.sendMessage({ type: "TRUSTED_CLICK", x, y } satisfies ExtensionMessage)
    .catch(() => undefined) as { dispatched?: boolean } | undefined;
  return Boolean(result?.dispatched);
}

async function clickIfNeeded(element: Element): Promise<boolean> {
  if (checked(element)) return true;
  (element as HTMLElement).scrollIntoView?.({ block: "center", behavior: "auto" });
  (element as HTMLElement).click();
  if (await waitFor(() => checked(element))) return true;
  if (!active) return false;
  await trustedClick(element);
  return waitFor(() => checked(element));
}

async function waitFor(predicate: () => boolean, attempts = 12): Promise<boolean> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (predicate()) return true;
    if (!active) return false;
    await new Promise((resolve) => window.setTimeout(resolve, 50));
  }
  return predicate();
}

async function activateDropdown(trigger: HTMLElement): Promise<void> {
  // Google Forms' Material select listens on its inner button in some form
  // versions and on the listbox itself in others. Reproduce a real pointer
  // activation (rather than only HTMLElement.click()) for both variants.
  if (trigger.getAttribute("aria-expanded") === "true") return;
  trigger.scrollIntoView({ block: "center", behavior: "auto" });
  // Observed on the live form: jsaction routes activation only through LgbsSe,
  // not through the outer listbox. Never toggle twice after a successful open.
  const activator = trigger.querySelector<HTMLElement>('[jsname="LgbsSe"], [aria-haspopup], [role="button"], button') ?? trigger;
  pointerClick(activator);
  if (!trigger.hasAttribute("aria-expanded")) return;
  if (await waitFor(() => trigger.getAttribute("aria-expanded") === "true", 4)) return;
  if (active) await trustedClick(activator);
  await waitFor(() => trigger.getAttribute("aria-expanded") === "true", 8);
}

function visibleTextChoice(roots: HTMLElement[], value: string, aliases: string[]): Element | undefined {
  // Some Google Forms builds expose select choices as plain nested text nodes
  // without role=option or data-value. Pick the smallest visible matching
  // element; its click bubbles to the Material menu item.
  const onTop = (element: HTMLElement): boolean => {
    const box = element.getBoundingClientRect();
    const hit = document.elementFromPoint?.(box.left + box.width / 2, box.top + box.height / 2);
    return Boolean(hit && (hit === element || element.contains(hit) || hit.contains(element)));
  };
  return roots.flatMap(root => Array.from(root.querySelectorAll<HTMLElement>("div, span, li")))
    .filter(visible)
    .filter((element) => choiceMatchesValue(element, value, aliases))
    // Forms keeps a second, off-screen Material menu in the DOM. It may have
    // a non-zero box, but it is not the element hit by a real pointer.
    .filter(onTop)
    .filter((element) => !Array.from(element.children).some((child) => choiceMatchesValue(child, value, aliases)))
    .sort((left, right) => (left.textContent?.length ?? 0) - (right.textContent?.length ?? 0))[0];
}

function pointerCoordinates(element: Element): { x: number; y: number } {
  const target = element as HTMLElement;
  const box = target.getBoundingClientRect();
  const left = Number.isFinite(box.left) ? box.left : 0;
  const top = Number.isFinite(box.top) ? box.top : 0;
  return { x: left + Math.max(1, box.width / 2), y: top + Math.max(1, box.height / 2) };
}

function pointerClick(element: Element): void {
  const target = element as HTMLElement;
  target.scrollIntoView?.({ block: "nearest", behavior: "auto" });
  const { x: clientX, y: clientY } = pointerCoordinates(target);
  const init = { bubbles: true, cancelable: true, button: 0, clientX, clientY };
  // Material Forms menus ignore a synthetic HTMLElement.click() on several
  // Chrome builds; their handler expects a pointer/mouse press at the item.
  if (typeof PointerEvent !== "undefined") {
    try {
      target.dispatchEvent(new PointerEvent("pointerdown", { ...init, buttons: 1, pointerId: 1, pointerType: "mouse", isPrimary: true }));
    } catch {
      // ignore
    }
  }
  target.dispatchEvent(new MouseEvent("mousedown", { ...init, buttons: 1 }));
  if (typeof PointerEvent !== "undefined") target.dispatchEvent(new PointerEvent("pointerup", { ...init, buttons: 0, pointerId: 1, pointerType: "mouse", isPrimary: true }));
  target.dispatchEvent(new MouseEvent("mouseup", { ...init, buttons: 0 }));
  target.dispatchEvent(new MouseEvent("click", init));
}

function dispatchKeyboardEvent(target: HTMLElement, key: string): void {
  const init = { key, code: key, bubbles: true, cancelable: true };
  target.dispatchEvent(new KeyboardEvent("keydown", init));
  target.dispatchEvent(new KeyboardEvent("keyup", init));
}

async function chooseDropdownOption(question: Question, element: Element, rule: FieldRule, profile: Profile, value: string): Promise<boolean> {
  const target = element as HTMLElement;
  target.scrollIntoView({ block: "nearest", behavior: "auto" });
  // Check the committed value, not merely whether any option is selected.
  // Only use a trusted fallback when the synthetic action did not commit.
  pointerClick(target);
  const matches = () => matchesProfile(question, rule, profile, value);
  if (await waitFor(matches)) return true;
  if (!active || !target.isConnected || !visible(target)) return false;
  await trustedClick(target);
  return waitFor(matches);
}

function dropdownOptionOffset(option: Element, wanted: string, aliases: string[]): number {
  // The rendered Material menu has no stable role on some Forms builds, but
  // its direct children are still ordered choices (including "Choose").
  // Find the closest such sibling group to drive it with trusted keys.
  for (let parent = option.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
    // Separators are not keyboard stops; the first real option has offset zero.
    const children = Array.from(parent.children).filter(child => child.matches('[role="option"]') && child.getAttribute('aria-disabled') !== 'true' && visible(child));
    const index = children.findIndex((child) => child === option || child.contains(option));
    if (index >= 0) return index;
  }
  return -1;
}

async function chooseDropdownWithKeyboard(trigger: HTMLElement, option: Element, wanted: string, aliases: string[]): Promise<void> {
  const offset = dropdownOptionOffset(option, wanted, aliases);
  if (offset < 0 || !active) return;
  // Home returns selection to the menu's initial row. ArrowDown then moves to
  // the intended displayed row and Enter commits it through Forms' own
  // keyboard handler. Prefer trusted CDP events, then fall back to bubbling
  // DOM key events if the browser blocks debugger access.
  const keys = ["Home", ...Array.from({ length: offset }, () => "ArrowDown"), "Enter"];
  (option as HTMLElement).focus();
  const result = await chrome.runtime.sendMessage({ type: "TRUSTED_KEYS", keys } satisfies ExtensionMessage)
    .catch(() => undefined) as { dispatched?: boolean } | undefined;
  if (!result?.dispatched) {
    keys.forEach((key) => dispatchKeyboardEvent(document.activeElement instanceof HTMLElement ? document.activeElement : trigger, key));
  }
}

async function waitForDropdownChoice(trigger: HTMLElement, value: string, aliases: string[]): Promise<Element | undefined> {
  // Forms asynchronously mounts a popup inside the trigger; other controls
  // can use a detached popup. Neither should match the hidden template copy.
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (!active) return undefined;
    const popupSelector = '[jsname="V68bde"], .exportSelectPopup, .OA0qNb';
    const relatedIds = `${trigger.getAttribute("aria-controls") ?? ""} ${trigger.getAttribute("aria-owns") ?? ""}`.trim().split(/\s+/);
    const owned = relatedIds.map(id => document.getElementById(id)).filter((el): el is HTMLElement => Boolean(el));
    const local = Array.from(trigger.querySelectorAll<HTMLElement>(popupSelector));
    const detached = Array.from(document.querySelectorAll<HTMLElement>(`${popupSelector}, [role="listbox"]`))
      .filter(el => el !== trigger && !el.closest('[role="listitem"], [data-item-id]'));
    const roots = [...new Set([...owned, ...local, ...detached])].filter(visible);
    // A known Material menu must actually be open. Its hidden template is not
    // selectable, even when descendants return non-zero bounding rectangles.
    if (!local.length && !roots.length && trigger.getAttribute('aria-expanded') !== 'false') roots.push(trigger);
    const candidates = roots.flatMap(root => Array.from(root.querySelectorAll<HTMLElement>('[role="option"], [data-value]')))
      .filter(el => visible(el) && el.getAttribute('aria-disabled') !== 'true');
    const choice = exactChoice(candidates, value, aliases);
    if (choice) return choice;

    const textChoice = visibleTextChoice(roots, value, aliases);
    if (textChoice) return textChoice;

    await new Promise((resolve) => window.setTimeout(resolve, 60));
  }
  return undefined;
}

function uploadedFileMatches(question: Question, name?: string): boolean {
  const actions = Array.from(question.element.querySelectorAll<HTMLElement>('button, [role="button"]')).filter(visible);
  const removed = actions.some(action => /remove file|xóa tệp|xoa tep|delete file/i.test(`${action.getAttribute("aria-label") ?? ""} ${action.textContent ?? ""}`));
  const text = `${question.element.textContent ?? ""} ${Array.from(question.element.querySelectorAll('[title], [aria-label]'))
    .map(node => `${node.getAttribute("title") ?? ""} ${node.getAttribute("aria-label") ?? ""}`).join(" ")}`;
  return removed && (!name || text.includes(name));
}

function uploadPicker(): HTMLIFrameElement | undefined {
  return Array.from(document.querySelectorAll<HTMLIFrameElement>("iframe[src]")).find(frame => {
    try {
      const url = new URL(frame.src);
      return visible(frame) && url.origin === "https://docs.google.com"
        && /^\/picker(?:\/|$)/.test(url.pathname) && url.searchParams.get("hostId") === "file-upload";
    } catch { return false; }
  });
}

async function fillFile(question: Question, rule: FieldRule, profile: Profile): Promise<boolean> {
  const attachmentKey = rule.attachmentKey;
  const reference = attachmentKey ? profile.attachments[attachmentKey] : undefined;
  delete question.element.dataset.hanuUploadError;
  if (!reference || !active) return false;
  if (uploadedFileMatches(question, reference.name)) return true;
  if (uploadedFileMatches(question)) {
    question.element.dataset.hanuUploadError = `Form đã có tệp khác với ${reference.name}. Hãy kiểm tra và thay tệp thủ công.`;
    return false;
  }
  const input = question.element.querySelector<HTMLInputElement>('input[type="file"]');
  if (input) {
    // Retain support for ordinary/native file inputs. Google Forms' real
    // uploader lives in Picker and is handled below, without an OS chooser.
    const response = await chrome.runtime.sendMessage({ type: "GET_ATTACHMENT", attachmentId: reference.id } satisfies ExtensionMessage) as { dataUrl?: string };
    if (!response?.dataUrl || !active) return false;
    const blob = await (await fetch(response.dataUrl)).blob();
    if (!active) return false;
    const file = new File([blob], reference.name, { type: reference.type || blob.type });
    const transfer = new DataTransfer();
    transfer.items.add(file);
    input.files = transfer.files;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    return (input.files?.length ?? 0) === 1;
  }

  // Never take over a Picker the user already opened for another question.
  if (uploadPicker()) {
    question.element.dataset.hanuUploadError = "Một hộp chọn tệp đang mở. Hãy đóng hoặc hoàn tất nó trước khi chạy lại.";
    return false;
  }
  const findOpener = () => Array.from(question.element.querySelectorAll<HTMLElement>('button, [role="button"]'))
    .find(node => visible(node) && /add file|thêm tệp|tải tệp/i.test(`${node.getAttribute("aria-label") ?? ""} ${node.textContent ?? ""}`));
  await waitFor(() => Boolean(findOpener()), 200);
  const opener = findOpener();
  if (!opener) return false;
  opener.scrollIntoView?.({ block: "center", behavior: "auto" });
  await emit({ type: "progress", message: `Đang mở hộp upload cho ảnh đã lưu: ${reference.name}` });
  if (!active) return false;
  opener.click();
  if (!(await waitFor(() => Boolean(uploadPicker()), 10))) {
    if (!active) return false;
    await trustedClick(opener);
  }
  if (!(await waitFor(() => Boolean(uploadPicker()), 200)) || !active) {
    question.element.dataset.hanuUploadError = "Không mở được Google Picker. Hãy chọn ảnh thủ công rồi bấm Tiếp tục.";
    return false;
  }
  const picker = uploadPicker()!;
  const requestId = crypto.randomUUID();
  let assigned = false;
  for (let attempt = 0; attempt < 40 && active; attempt += 1) {
    if (!picker.isConnected || !visible(picker)) break;
    const result = await chrome.runtime.sendMessage({ type: "UPLOAD_STORED_FILE", attachmentId: reference.id, pickerUrl: picker.src, requestId } satisfies ExtensionMessage)
      .catch(error => ({ state: "error", error: error instanceof Error ? error.message : String(error) })) as PickerUploadResult | { ok: false; error: string };
    if (!active) return false;
    if (result && (("state" in result && result.state === "error") || ("ok" in result && result.ok === false))) {
      question.element.dataset.hanuUploadError = (result as { error: string }).error;
      return false;
    }
    if (result && "state" in result && result.state === "assigned") { assigned = true; break; }
    await new Promise(resolve => window.setTimeout(resolve, 250));
  }
  if (!active) return false;
  if (!assigned) {
    question.element.dataset.hanuUploadError = "Chưa tìm được ô upload trong Picker. Hãy chọn ảnh thủ công rồi bấm Tiếp tục.";
    return false;
  }
  await emit({ type: "progress", message: `Đang tải ${reference.name} lên Google; chờ form xác nhận nhận ảnh.` });
  // Assignment is not completion. Wait for the exact filename and the Forms
  // removal action, and for Picker to close. A slow/failed upload must block
  // Next/Submit instead of allowing a second upload or submission.
  let closedAt: number | undefined;
  for (let attempt = 0; attempt < 480 && active; attempt += 1) {
    const closed = !picker.isConnected || !visible(picker);
    if (uploadedFileMatches(question, reference.name) && closed) return true;
    // Picker can close one render before Forms inserts the committed chip.
    // Allow that final update, without issuing another upload request.
    if (closed) closedAt ??= Date.now();
    if (closedAt !== undefined && Date.now() - closedAt >= 5000) break;
    await new Promise(resolve => window.setTimeout(resolve, 250));
  }
  question.element.dataset.hanuUploadError = "Chưa xác nhận được ảnh đã tải lên hoàn tất. Extension đã dừng; hãy kiểm tra Picker hoặc chọn ảnh thủ công.";
  return false;
}

async function fillQuestion(question: Question, rule: FieldRule, profile: Profile, value: string): Promise<boolean> {
  if (question.kind === "file") return fillFile(question, rule, profile);
  if (question.kind === "text" || question.kind === "date" || question.kind === "textarea") {
    const input = question.element.querySelector<HTMLInputElement | HTMLTextAreaElement>('input:not([type="hidden"]):not([type="radio"]):not([type="checkbox"]):not([type="file"]), textarea');
    if (!input) return false;
    setNativeValue(input, rule.key === "birthDate" ? formatDateForQuestion(value, question) : value);
    return matchesProfile(question, rule, profile, value);
  }
  if (question.kind === "radio" || question.kind === "checkbox") {
    const options = controlsIn(question.element, 'input[type="radio"], input[type="checkbox"], [role="radio"], [role="checkbox"]');
    const wantsBoolean = /^(true|1|co|yes|dong y)$/i.test(normalize(value));
    const aliases = rule.optionAliases?.[value] ?? [];
    // A commitment may be represented as a radio group instead of a single
    // checkbox. Prefer its explicit affirmative wording; only fall back to
    // the first option for a single-option checkbox style control.
    const choice = wantsBoolean ? exactChoice(options, value, aliases) ?? options[0] : exactChoice(options, value, aliases);
    if (!choice) return false;
    return clickIfNeeded(choice);
  }
  if (question.kind === "dropdown") {
    const nativeSelect = question.element.querySelector<HTMLSelectElement>("select");
    if (nativeSelect) {
      const aliases = rule.optionAliases?.[value] ?? [];
      if (nativeSelect.disabled || nativeSelect.multiple) return false;
      const option = Array.from(nativeSelect.options).find((opt) => !opt.disabled && !opt.closest('optgroup[disabled]') && choiceMatchesValue(opt, value, aliases));
      if (option) {
        setNativeSelectValue(nativeSelect, option);
        return matchesProfile(question, rule, profile, value);
      }
      return false;
    }

    const trigger = question.element.querySelector<HTMLElement>('[role="combobox"], [role="listbox"]');
    if (!trigger) return false;
    await activateDropdown(trigger);
    const aliases = rule.optionAliases?.[value] ?? [];
    const option = await waitForDropdownChoice(trigger, value, aliases);
    if (!option) return false;
    if (await chooseDropdownOption(question, option, rule, profile, value)) return true;
    if (!active) return false;
    // Some Forms Material menus ignore the pointer release despite receiving
    // a trusted event. Keep the open menu and commit the same choice via its
    // native keyboard contract before asking the user to intervene.
    await activateDropdown(trigger);
    await new Promise((resolve) => window.setTimeout(resolve, 80));
    const keyboardOption = await waitForDropdownChoice(trigger, value, aliases);
    if (!keyboardOption) return false;
    await chooseDropdownWithKeyboard(trigger, keyboardOption, value, aliases);
    return waitFor(() => matchesProfile(question, rule, profile, value));
  }
  return false;
}

function profileHasValue(rule: FieldRule | undefined, value: string | undefined, profile: Profile): boolean {
  if (rule?.kind === "file") return Boolean(profile.attachments[rule.attachmentKey ?? ""]);
  return Boolean(value?.trim());
}

function matchesProfile(question: Question, rule: FieldRule, profile: Profile, value: string): boolean {
  if (question.kind === "file") {
    const reference = profile.attachments[rule.attachmentKey ?? ""];
    const native = question.element.querySelector<HTMLInputElement>('input[type="file"]');
    return native ? Boolean(native.files?.length && (!reference || native.files[0].name === reference.name))
      : uploadedFileMatches(question, reference?.name);
  }
  if (question.kind === "text" || question.kind === "date" || question.kind === "textarea") {
    const input = question.element.querySelector<HTMLInputElement | HTMLTextAreaElement>('input:not([type="hidden"]):not([type="radio"]):not([type="checkbox"]):not([type="file"]), textarea');
    const expected = rule.key === "birthDate" ? formatDateForQuestion(value, question) : value;
    return Boolean(input && normalize(input.value) === normalize(expected));
  }
  const aliases = rule.optionAliases?.[value] ?? [];
  if (question.kind === "radio" || question.kind === "checkbox") {
    const selected = controlsIn(question.element, 'input[type="radio"], input[type="checkbox"], [role="radio"], [role="checkbox"]').filter(checked);
    const wantsBoolean = /^(true|1|co|yes|dong y)$/i.test(normalize(value));
    return wantsBoolean
      ? (aliases.length > 0 ? selected.some((option) => choiceMatchesValue(option, value, aliases)) : selected.length > 0)
      : selected.some((option) => choiceMatchesValue(option, value, aliases));
  }
  if (question.kind === "dropdown") {
    const nativeSelect = question.element.querySelector<HTMLSelectElement>("select");
    if (nativeSelect) {
      const selectedOpt = nativeSelect.options[nativeSelect.selectedIndex];
      return Boolean(selectedOpt && choiceMatchesValue(selectedOpt, value, aliases));
    }
    const hidden = question.element.querySelector<HTMLInputElement>('input[type="hidden"][name^="entry."]');
    if (hidden) return choiceMatchesValue(hidden, value, aliases);
    const trigger = question.element.querySelector<HTMLElement>('[role="combobox"], [role="listbox"]');
    if (trigger?.getAttribute('aria-expanded') === 'true') return false;
    const selectedOptions = Array.from(question.element.querySelectorAll('[role="option"][aria-selected="true"]'));
    if (selectedOptions.some((option) => !isPlaceholderChoice(option) && choiceMatchesValue(option, value, aliases))) return true;
    if (trigger) {
      const display = trigger.getAttribute('aria-valuetext');
      if (display && [value, ...aliases].map(normalize).some(target => display.split('|').map(normalize).includes(target) || normalize(display) === target)) return true;
    }
    return false;
  }
  return false;
}

function manualIssue(question: Question, reason: BlockingIssue["reason"], message: string): BlockingIssue {
  question.element.dataset.hanuBlocking = "true";
  question.element.style.outline = "3px solid #d93025";
  question.element.style.outlineOffset = "3px";
  question.element.scrollIntoView({ behavior: "smooth", block: "center" });
  if(reason==='file_upload'||reason==='unsupported'&&['radio','checkbox','dropdown'].includes(question.kind))armAutoResume(question);
  return { reason, message, questionId: question.id, questionLabel: question.label, candidates: suggestedRules(question.label) };
}

function armAutoResume(question: Question): void {
  cancelManualResume?.();
  question.element.dataset.hanuResumeArmed = "true";
  let resumed = false;
  let cancelled = false;
  let pending = false;
  const retry = () => {
    if (pending || cancelled) return;
    pending = true;
    window.setTimeout(() => {
      pending = false;
      if (cancelled || resumed || active || !question.element.isConnected || !isFilled(question)) return;
      resumed = true;
      active = true;
      cancelManualResume?.();
      void emit({ type: "progress", message: `Đã nhận thao tác thủ công: ${question.label}` }).then(() => requestExecute());
    }, 180);
  };
  question.element.addEventListener("input", retry, true);
  question.element.addEventListener("change", retry, true);
  question.element.addEventListener("click", retry, true);
  // Google Picker commits the upload asynchronously, without a click/change
  // on the original card. Observe the rendered filename/removal control too.
  const observer = new MutationObserver(retry);
  observer.observe(question.element, { childList: true, subtree: true, attributes: true });
  cancelManualResume = () => {
    cancelled = true;
    observer.disconnect();
    question.element.removeEventListener("input", retry, true);
    question.element.removeEventListener("change", retry, true);
    question.element.removeEventListener("click", retry, true);
    delete question.element.dataset.hanuResumeArmed;
    cancelManualResume = undefined;
  };
}

async function emit(event: FormEvent): Promise<void> {
  const result=await chrome.runtime.sendMessage({ type: "FORM_EVENT", event,...(boundRunId?{runId:boundRunId,epoch:documentEpoch}:{}) } satisfies ExtensionMessage);
  if(result?.ok===false){active=false;throw new Error(result.error);}
}

export function pageAccount():{email?:string;error?:string}{
  const text=document.body.innerText??document.body.textContent??'';
  if(/you need permission|bạn cần có quyền|access denied|quyền truy cập bị từ chối/i.test(text))return {error:'Google chặn truy cập form.'};
  if(/no longer accepting responses|không còn nhận câu trả lời|form.*closed/i.test(text))return {error:'Form đã đóng.'};
  if(document.querySelector('a[href*="accounts.google.com/ServiceLogin"]')&&!document.querySelector('.ms0VFe'))return {error:'Cần đăng nhập Google.'};
  const candidates=Array.from(document.querySelectorAll<HTMLElement>('[data-google-account], .ms0VFe, .XgQ6eb [data-email]'))
    .filter(visible).map(e=>e.dataset.googleAccount??e.getAttribute('data-email')??e.innerText??e.textContent??'');
  for(const link of document.querySelectorAll<HTMLAnchorElement>('a[href*="accounts.google.com/AccountChooser"]')){let parent=link.parentElement;for(let depth=0;parent&&depth<4;depth++,parent=parent.parentElement){if(parent.matches('[role="listitem"]'))break;const text=parent.innerText??parent.textContent??'';if(visible(parent)&&/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(text)){candidates.push(text);break;}}}
  const emails=[...new Set(candidates.flatMap(t=>t.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/ig)??[]).map(e=>e.toLowerCase()))];
  return emails.length===1?{email:emails[0]}:{};
}

function button(kind: "next" | "submit"): HTMLElement | undefined {
  const terms = kind === "next" ? [/^next$/i, /^tiếp/i, /^trang tiếp/i] : [/^submit$/i, /^gửi$/i, /^nộp$/i];
  return Array.from(document.querySelectorAll<HTMLElement>('button, [role="button"]')).find((candidate) => {
    const text = (candidate.innerText ?? candidate.textContent ?? "").trim();
    return visible(candidate) && terms.some((term) => term.test(text));
  });
}

function completedPage(): boolean {
  const text = document.body.innerText ?? document.body.textContent ?? "";
  return /your response has been recorded|đã ghi lại câu trả lời|câu trả lời của bạn đã được ghi lại|response has been recorded/i.test(text);
}

function validationError(): string | undefined {
  const alert = Array.from(document.querySelectorAll('[role="alert"]')).find((node) => visible(node) && node.textContent?.trim());
  if (alert?.textContent) return alert.textContent.trim();
  const text = document.body.innerText ?? document.body.textContent ?? "";
  const match = text.match(/this is a required question|đây là câu hỏi bắt buộc/i);
  return match?.[0];
}

async function waitForPageChange(before: string): Promise<boolean> {
  for (let attempt = 0; attempt < 28; attempt += 1) {
    await new Promise((resolve) => window.setTimeout(resolve, 250));
    if (!active) return false;
    if (pageFingerprint() !== before) return true;
  }
  return false;
}

async function execute(depth = 0): Promise<void> {
  if (!active || depth > 25) return;
  if (completedPage()) {
    active = false;
    await emit({ type: "completed", message: "Google Forms đã xác nhận nhận phản hồi." });
    return;
  }
  if (hasUnsatisfiedCaptcha()) {
    active = false;
    await emit({ type: "block", issue: { reason: "captcha", message: "Phát hiện CAPTCHA chưa hoàn tất. Hãy tự giải rồi bấm Tiếp tục." } });
    return;
  }

  const profile = await chrome.runtime.sendMessage({ type: "GET_PROFILE" } satisfies ExtensionMessage) as Profile;
  if (!profile?.values) throw new Error("Không đọc được hồ sơ. Hãy mở lại extension và lưu hồ sơ.");
  // Forms can shuffle questions: complete ordinary fields before pausing for
  // an upload, even when the upload card happens to be first on the page.
  for (const question of questions().sort((a, b) => Number(a.kind === "file") - Number(b.kind === "file"))) {
    if (!active) return;
    question.element.style.outline = "";
    delete question.element.dataset.hanuBlocking;
    if (question.id === manualSkipQuestionId) {
      manualSkipQuestionId = undefined;
      await emit({ type: "progress", message: `Đã giữ nguyên câu bạn vừa xử lý thủ công: ${question.label}`, skipped: question.id });
      continue;
    }
    const rule = findRule(question, profile);
    const value = rule ? profile.values[rule.key] : customValue(question, profile);
    const wasFilled = isFilled(question);

    // A prefilled value is only authoritative when this profile does not have a
    // value for that question. When it does, correct a wrong default/old answer
    // instead of silently preserving it.
    if (wasFilled && isVerificationQuestion(question)) {
      await emit({ type: "progress", message: `Giữ nguyên câu xác thực đã tự trả lời: ${question.label}`, skipped: question.id });
      continue;
    }
    if (wasFilled && (rule ? !profileHasValue(rule, value, profile) : !value?.trim())) {
      await emit({ type: "progress", message: `Giữ nguyên trường đã có dữ liệu vì hồ sơ không có giá trị thay thế: ${question.label}`, skipped: question.id });
      continue;
    }
    if (isVerificationQuestion(question)) {
      active = false;
      await emit({ type: "block", issue: manualIssue(question, "verification", `Câu xác thực cần tự trả lời: ${question.label}`) });
      return;
    }
    if (!rule && value === undefined) {
      if (question.required) {
        active = false;
        await emit({ type: "block", issue: manualIssue(question, "unknown_required", `Không biết ghép dữ liệu cho câu bắt buộc: ${question.label}`) });
        return;
      }
      await emit({ type: "progress", message: `Bỏ qua câu tùy chọn chưa có dữ liệu: ${question.label}`, skipped: question.id });
      continue;
    }
    if (!rule) {
      if (wasFilled) {
        // A custom field has a profile value, so overwrite its old value too.
        if (question.kind !== "unknown") {
          const customRule: FieldRule = { key: "custom", label: question.label, aliases: [question.label], kind: question.kind };
          if (await fillQuestion(question, customRule, profile, value ?? "")) {
            await emit({ type: "progress", message: `Đã thay thế giá trị sẵn có: ${question.label}`, filled: question.id });
            continue;
          }
        }
      }
      if (question.kind === "unknown") {
        active = false;
        await emit({ type: "block", issue: manualIssue(question, "unsupported", `Không hỗ trợ điều khiển của câu: ${question.label}`) });
        return;
      }
      const customRule: FieldRule = { key: "custom", label: question.label, aliases: [question.label], kind: question.kind };
      if (!(await fillQuestion(question, customRule, profile, value ?? ""))) {
        active = false;
        await emit({ type: "block", issue: manualIssue(question, "unsupported", `Không thể điền câu tùy chỉnh: ${question.label}`) });
        return;
      }
      await emit({ type: "progress", message: `Đã điền trường tùy chỉnh: ${question.label}`, filled: question.id });
      continue;
    }
    if (!compatible(rule, question.kind) && !(rule.key.includes("Commitment") && question.kind === "radio")) {
      if (question.required) {
        active = false;
        await emit({ type: "block", issue: manualIssue(question, "unsupported", `Loại trường không khớp cho ${rule.label}. Hãy tự điền hoặc chỉnh ánh xạ.`) });
        return;
      }
      continue;
    }
    if (rule.kind === "file" && !profile.attachments[rule.attachmentKey ?? ""]) {
      active = false;
      await emit({ type: "block", issue: manualIssue(question, "file_upload", `Chưa có tệp đã lưu cho: ${question.label}`) });
      return;
    }
    if (!value && rule.kind !== "file") {
      if (question.required) {
        active = false;
        await emit({ type: "block", issue: manualIssue(question, "unknown_required", `Hồ sơ chưa có dữ liệu cho câu bắt buộc: ${rule.label}`) });
        return;
      }
      await emit({ type: "progress", message: `Hồ sơ chưa có dữ liệu tùy chọn: ${rule.label}`, skipped: question.id });
      continue;
    }
    if (wasFilled && matchesProfile(question, rule, profile, value ?? "")) {
      await emit({ type: "progress", message: `Giữ nguyên trường đã khớp hồ sơ: ${question.label}`, skipped: question.id });
      continue;
    }
    const filled = await fillQuestion(question, rule, profile, value ?? "");
    if (!active) return;
    if (!filled) {
      active = false;
      const reason = rule.kind === "file" ? "file_upload" : "unsupported";
      await emit({ type: "block", issue: manualIssue(question, reason, question.element.dataset.hanuUploadError ?? `Không thể tự điền ${rule.label}. Hãy hoàn tất thủ công rồi bấm Tiếp tục.`) });
      return;
    }
    await emit({ type: "progress", message: wasFilled ? `Đã thay thế giá trị sẵn có: ${rule.label}` : `Đã điền: ${rule.label}`, filled: question.id });
  }

  if (!active) return;
  const submit = button("submit");
  const next = button("next");
  const action = decideNextAction(activeMode, Boolean(submit && !next), false);
  if (action === "ready") {
    active = false;
    await emit({ type: "ready_to_submit" });
    return;
  }
  if (action === "submit") {
    if (submitAttempted || !submit) return;
    const permit=await chrome.runtime.sendMessage({type:'REQUEST_SUBMIT',runId:boundRunId,epoch:documentEpoch} satisfies ExtensionMessage);
    if(!permit?.granted){active=false;await emit({type:'block',issue:{reason:'submit_uncertain',message:permit?.error??'Chưa có xác nhận khóa gửi; không bấm Gửi.'}});return;}
    submitAttempted = true;
    await emit({ type: "submit_attempt" });
    if(!active)return;
    submit.click();
    for(let i=0;i<80&&!completedPage();i++)await new Promise(r=>window.setTimeout(r,250));
    if (completedPage()) {
      active = false;
      await emit({ type: "completed", message: "Google Forms đã xác nhận nhận phản hồi." });
    } else {
      const error = validationError();
      active = false;
      await emit({ type: "block", issue: { reason: error ? "validation" : "submit_uncertain", message: error ? `Google Forms báo lỗi: ${error}` : "Đã bấm Gửi nhưng chưa thấy xác nhận. Extension sẽ không tự gửi lại." } });
    }
    return;
  }
  if (!next) {
    active = false;
    await emit({ type: "failed", message: "Không tìm thấy nút Tiếp hoặc Gửi trên trang hiện tại." });
    return;
  }
  const before = pageFingerprint();
  next.click();
  const changed = await waitForPageChange(before);
  if (!active) return;
  // Google Forms can retain an old aria-alert in the DOM after the next page
  // renders. A changed page is authoritative; only validate on a failed move.
  const error = changed ? undefined : validationError();
  if (!changed) {
    active = false;
    await emit({ type: "block", issue: { reason: "validation", message: error ? `Google Forms báo lỗi: ${error}` : "Không thể chuyển trang. Hãy kiểm tra câu bắt buộc hoặc điều kiện rẽ nhánh." } });
    return;
  }
  await emit({ type: "page_advanced", fingerprint: pageFingerprint() });
  // Release the per-document lock before running the next page. Google Forms
  // sometimes keeps the document and sometimes replaces it entirely.
  window.setTimeout(() => requestExecute(depth + 1), 0);
}

function requestExecute(depth = 0): void {
  if (executionInFlight) return;
  executionInFlight = true;
  void execute(depth).catch(async (error) => {
    active = false;
    await emit({ type: "failed", message: error instanceof Error ? error.message : String(error) });
  }).finally(() => {
    executionInFlight = false;
  });
}

chrome.runtime.onMessage.addListener((message: ExtensionMessage, _sender, sendResponse) => {
  if(message.type==='PAGE_ACCOUNT'){sendResponse(pageAccount());return;}
  if (message.type === "SCAN_FORM") {
    sendResponse({ questions: scanCurrentForm() });
    return;
  }
  if (message.type === "HALT_RUN") {
    active = false;
    cancelManualResume?.();
    sendResponse?.({ ok: true });
    return;
  }
  if (message.type === "RUN_CURRENT_PAGE") {
    cancelManualResume?.();
    active = true;
    activeMode = message.mode;
    manualSkipQuestionId = message.skipQuestionId;
    if(message.runId!==boundRunId){submitAttempted=false;boundRunId=message.runId;}
    void Promise.resolve(chrome.runtime.sendMessage({type:'CLAIM_DOCUMENT',epoch:documentEpoch} satisfies ExtensionMessage)).then(()=>requestExecute());
    sendResponse?.({ ok: true });
  }
});

// A Google Forms "Next" may replace the entire document (not merely swap
// cards). The old content script is then destroyed mid-run. On every fresh
// document, recover a still-running session from the service worker so page
// advancement never depends on the user pressing Resume again.
void Promise.resolve(chrome.runtime.sendMessage({ type: "CLAIM_DOCUMENT",epoch:documentEpoch } satisfies ExtensionMessage))
  .then(()=>chrome.runtime.sendMessage({ type: "GET_RUN_FOR_TAB" } satisfies ExtensionMessage))
  .then((run: RunState | undefined) => {
    if (run?.status !== "running" ||run.recoveryRequired ||run.submitAttempted) return;
    active = true;
    activeMode = run.mode;
    boundRunId=run.runId;
    requestExecute();
  })
  .catch(() => undefined);
