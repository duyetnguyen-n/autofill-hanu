const PROFILE_KEY = "hskSafeAutofill.profile.v1";
const CATALOG_KEY = "hskSafeAutofill.catalog.v1";

const profileForm = document.querySelector("#profile-form");
const saveStatus = document.querySelector("#save-status");
const syncButton = document.querySelector("#sync-catalog");
const catalogStatus = document.querySelector("#catalog-status");

const fieldNames = [
  "testType", "testLevel", "testFormat", "testDate", "continent",
  "countryArea", "testCenter", "fullName", "chineseName", "dateOfBirth",
  "gender", "nationality", "idType", "idNumber", "phone", "address",
  "motherTongue", "learningDuration", "occupation"
];

const fields = Object.fromEntries(
  fieldNames.map((name) => [name, profileForm.elements.namedItem(name)])
);

const lists = {
  projects: document.querySelector("#test-type-options"),
  subjects: document.querySelector("#test-level-options"),
  formats: document.querySelector("#test-format-options"),
  dates: document.querySelector("#test-date-options"),
  continents: document.querySelector("#continent-options"),
  countries: document.querySelector("#country-options"),
  centers: document.querySelector("#test-center-options")
};

const formats = [
  { id: "1", label: "Paper-based Test" },
  { id: "2", label: "Internet-based Test (at center)" },
  { id: "4", label: "Internet-based Test (Home Edition)" }
];

let catalog = {
  projects: [],
  subjects: [],
  dates: [],
  continents: [],
  countries: [],
  centers: []
};

function compact(value) {
  return String(value ?? "").trim();
}

function normalized(value) {
  return compact(value).normalize("NFKC").toLocaleLowerCase();
}

function firstValue(item, keys) {
  for (const key of keys) {
    const value = compact(item?.[key]);
    if (value) return value;
  }
  return "";
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function setCatalogStatus(message, kind = "") {
  catalogStatus.textContent = message;
  catalogStatus.className = kind;
}

function itemId(kind, item) {
  const keys = {
    projects: ["KMID", "projectId", "PROJECTID", "id"],
    subjects: ["KMID", "kmId", "subjectId", "id"],
    continents: ["zId", "ZId", "id"],
    countries: ["gjId", "GJID", "id"],
    centers: ["kdId", "KDID", "id"]
  };
  return firstValue(item, keys[kind] || ["id"]);
}

function itemLabel(kind, item) {
  const keys = {
    projects: ["KMENAME", "KMNAME", "JIANCHENG", "projectName", "name"],
    subjects: ["KMENAME", "KMNAME", "subjectName", "name"],
    dates: ["KTTIME", "ksDate", "date"],
    continents: ["eName", "zName", "name"],
    countries: ["gjEName", "gjName", "name"],
    centers: ["kdEName", "kdName", "name"]
  };
  return firstValue(item, keys[kind] || ["name", "label"]);
}

function renderList(element, items, kind) {
  element.replaceChildren();
  const seen = new Set();
  for (const item of items) {
    const label = kind === "formats" ? compact(item.label) : itemLabel(kind, item);
    if (!label || seen.has(normalized(label))) continue;
    seen.add(normalized(label));
    const option = document.createElement("option");
    option.value = label;
    const alternativeKeys = {
      projects: ["KMNAME", "JIANCHENG"],
      subjects: ["KMNAME"],
      continents: ["zName"],
      countries: ["gjName"],
      centers: ["kdName"]
    };
    const alternative = firstValue(item, alternativeKeys[kind] || []);
    if (alternative && normalized(alternative) !== normalized(label)) option.label = alternative;
    element.append(option);
  }
}

function renderCatalog() {
  renderList(lists.projects, catalog.projects, "projects");
  renderList(lists.subjects, catalog.subjects, "subjects");
  renderList(lists.formats, formats, "formats");
  renderList(lists.dates, catalog.dates, "dates");
  renderList(lists.continents, catalog.continents, "continents");
  renderList(lists.countries, catalog.countries, "countries");
  renderList(lists.centers, catalog.centers, "centers");
}

function findItem(kind, value) {
  const target = normalized(value);
  if (!target) return null;
  const items = kind === "formats" ? formats : catalog[kind];
  return items.find((item) => {
    const labels = kind === "formats"
      ? [item.label, item.id]
      : [itemLabel(kind, item), itemId(kind, item), ...Object.values(item || {})];
    return labels.some((candidate) => normalized(candidate) === target);
  }) || null;
}

async function findChineseTestTab() {
  const tabs = await chrome.tabs.query({ url: "https://www.chinesetest.cn/*" });
  const usable = tabs.filter((tab) => tab.id && tab.url?.startsWith("https://www.chinesetest.cn/"));
  const preferred = usable.find((tab) => new URL(tab.url).pathname === "/kaoshibaoming");
  const tab = preferred || usable[0];
  if (!tab) throw new Error("Hãy mở và đăng nhập ChineseTest trong một tab trước.");
  return tab;
}

async function catalogRead(path, params = {}) {
  const tab = await findChineseTestTab();
  const result = await chrome.tabs.sendMessage(tab.id, {
    type: "HSK_AUTOFILL_CATALOG_READ",
    path,
    params
  });
  if (result?.error) throw new Error(result.error);
  return result;
}

function responseData(response) {
  return response?.data?.data ?? response?.data ?? response;
}

async function persistCatalog() {
  await chrome.storage.local.set({
    [CATALOG_KEY]: {
      ...catalog,
      updatedAt: Date.now()
    }
  });
}

function selectedContext() {
  const project = findItem("projects", fields.testType.value);
  const subject = findItem("subjects", fields.testLevel.value);
  const format = findItem("formats", fields.testFormat.value);
  const continent = findItem("continents", fields.continent.value);
  const country = findItem("countries", fields.countryArea.value);
  return {
    projectId: project ? itemId("projects", project) : "",
    kmId: subject ? itemId("subjects", subject) : "",
    ksType: format?.id || "",
    ksDate: compact(fields.testDate.value),
    ZId: continent ? itemId("continents", continent) : "",
    gjId: country ? itemId("countries", country) : ""
  };
}

async function loadProjects() {
  const response = await catalogRead("/portal/index/getOptionList");
  const data = responseData(response);
  catalog.projects = asArray(data?.projectList);
  renderCatalog();
  return catalog.projects.length;
}

async function loadSubjects() {
  const { projectId } = selectedContext();
  if (!projectId) return 0;
  const response = await catalogRead("/portal/index/getSubjectList", { projectId });
  catalog.subjects = asArray(responseData(response));
  renderCatalog();
  return catalog.subjects.length;
}

async function loadDates() {
  const { kmId, ksType } = selectedContext();
  if (!kmId || !ksType) return 0;
  const response = await catalogRead("/examinee/enroll/getExamTimeList", { kmId, ksType });
  catalog.dates = asArray(responseData(response));
  renderCatalog();
  return catalog.dates.length;
}

async function loadLocations() {
  const { kmId, ksType, ksDate } = selectedContext();
  if (!kmId || !ksType || !ksDate) return 0;
  const [continentsResponse, centersResponse] = await Promise.all([
    catalogRead("/examinee/enroll/getZhouList", { kmId, ksType, ksDate }),
    catalogRead("/examinee/enroll/getExamSiteList", { kmId, ksType, ksDate })
  ]);
  catalog.continents = asArray(responseData(continentsResponse));
  catalog.centers = asArray(responseData(centersResponse));
  renderCatalog();
  return catalog.continents.length + catalog.centers.length;
}

async function loadCountries() {
  const { kmId, ksType, ksDate, ZId } = selectedContext();
  if (!kmId || !ksType || !ksDate || !ZId) return 0;
  const response = await catalogRead("/examinee/enroll/getCountryList", {
    kmId, ksType, ksDate, ZId
  });
  catalog.countries = asArray(responseData(response));
  renderCatalog();
  return catalog.countries.length;
}

async function loadCentersForCountry() {
  const { kmId, ksType, ksDate, gjId } = selectedContext();
  if (!kmId || !ksType || !ksDate || !gjId) return 0;
  const response = await catalogRead("/examinee/enroll/getExamSiteList", {
    kmId, ksType, ksDate, gjId
  });
  catalog.centers = asArray(responseData(response));
  renderCatalog();
  return catalog.centers.length;
}

function friendlyCatalogError(error) {
  const message = error?.message || String(error);
  if (/Receiving end does not exist|message port closed|context invalidated/i.test(message)) {
    return "Extension vừa được cập nhật. Hãy tải lại tab ChineseTest rồi bấm đồng bộ lại.";
  }
  if (/401|403|đăng nhập|login|unauthor/i.test(message)) {
    return "Phiên đăng nhập không dùng được cho danh mục. Hãy đăng nhập lại ChineseTest rồi thử lại.";
  }
  return message;
}

async function runCatalogTask(label, task) {
  syncButton.disabled = true;
  setCatalogStatus(label);
  try {
    const count = await task();
    await persistCatalog();
    setCatalogStatus(`Đã cập nhật danh mục (${count} mục ở bước mới nhất).`, "success");
  } catch (error) {
    setCatalogStatus(friendlyCatalogError(error), "error");
  } finally {
    syncButton.disabled = false;
  }
}

async function syncAvailableCatalog() {
  let newestCount = await loadProjects();
  if (selectedContext().projectId) newestCount = await loadSubjects();
  const contextAfterSubjects = selectedContext();
  if (contextAfterSubjects.kmId && contextAfterSubjects.ksType) newestCount = await loadDates();
  if (selectedContext().ksDate) newestCount = await loadLocations();
  if (selectedContext().ZId) newestCount = await loadCountries();
  if (selectedContext().gjId) newestCount = await loadCentersForCountry();
  return newestCount;
}

syncButton.addEventListener("click", () => {
  void runCatalogTask("Đang đọc danh mục từ ChineseTest…", syncAvailableCatalog);
});

fields.testType.addEventListener("change", () => {
  catalog.subjects = [];
  catalog.dates = [];
  catalog.continents = [];
  catalog.countries = [];
  catalog.centers = [];
  renderCatalog();
  if (selectedContext().projectId) {
    void runCatalogTask("Đang tải cấp độ…", loadSubjects);
  }
});

for (const field of [fields.testLevel, fields.testFormat]) {
  field.addEventListener("change", () => {
    catalog.dates = [];
    catalog.continents = [];
    catalog.countries = [];
    catalog.centers = [];
    renderCatalog();
    const { kmId, ksType } = selectedContext();
    if (kmId && ksType) void runCatalogTask("Đang tải ngày thi…", loadDates);
  });
}

fields.testDate.addEventListener("change", () => {
  catalog.continents = [];
  catalog.countries = [];
  catalog.centers = [];
  renderCatalog();
  if (selectedContext().ksDate) {
    void runCatalogTask("Đang tải khu vực và trung tâm thi…", loadLocations);
  }
});

fields.continent.addEventListener("change", () => {
  catalog.countries = [];
  catalog.centers = [];
  renderCatalog();
  if (selectedContext().ZId) {
    void runCatalogTask("Đang tải quốc gia/khu vực…", loadCountries);
  }
});

fields.countryArea.addEventListener("change", () => {
  catalog.centers = [];
  renderCatalog();
  if (selectedContext().gjId) {
    void runCatalogTask("Đang tải trung tâm thi…", loadCentersForCountry);
  }
});

const photoFileInput = document.querySelector("#photo-file-input");
const choosePhotoBtn = document.querySelector("#choose-photo-btn");
const removePhotoBtn = document.querySelector("#remove-photo-btn");
const photoPreview = document.querySelector("#photo-preview");
const photoPlaceholder = document.querySelector("#photo-placeholder");
const photoInfo = document.querySelector("#photo-info");

let currentPhoto = {
  dataUrl: "",
  name: "",
  size: 0
};

function updatePhotoUI() {
  if (currentPhoto.dataUrl) {
    photoPreview.src = currentPhoto.dataUrl;
    photoPreview.style.display = "block";
    photoPlaceholder.style.display = "none";
    removePhotoBtn.style.display = "inline-block";
    const kb = (currentPhoto.size / 1024).toFixed(1);
    photoInfo.textContent = `✓ Đã chọn: ${currentPhoto.name || "photo.jpg"} (${kb} KB - chuẩn JPEG)`;
    photoInfo.className = "photo-info ready";
  } else {
    photoPreview.src = "";
    photoPreview.style.display = "none";
    photoPlaceholder.style.display = "flex";
    removePhotoBtn.style.display = "none";
    photoInfo.textContent = "Định dạng JPG/PNG, nền trắng. Sẽ tự nén về JPEG < 100KB.";
    photoInfo.className = "photo-info";
    photoFileInput.value = "";
  }
}

function processPhotoFile(file) {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith("image/")) {
      reject(new Error("Vui lòng chọn tệp hình ảnh (.jpg, .png)."));
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const maxW = 480;
        const maxH = 640;
        let w = img.width;
        let h = img.height;
        if (w > maxW || h > maxH) {
          const ratio = Math.min(maxW / w, maxH / h);
          w = Math.round(w * ratio);
          h = Math.round(h * ratio);
        }
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        ctx.fillStyle = "#FFFFFF";
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);

        let dataUrl = canvas.toDataURL("image/jpeg", 0.85);
        let sizeBytes = Math.round((dataUrl.length - dataUrl.indexOf(",") - 1) * 0.75);
        if (sizeBytes > 100 * 1024) {
          dataUrl = canvas.toDataURL("image/jpeg", 0.70);
          sizeBytes = Math.round((dataUrl.length - dataUrl.indexOf(",") - 1) * 0.75);
        }

        const safeName = (file.name || "photo").replace(/\.[^.]+$/, "") + ".jpg";
        resolve({ dataUrl, name: safeName, size: sizeBytes });
      };
      img.onerror = () => reject(new Error("Không thể tải hoặc xử lý định dạng ảnh này."));
      img.src = e.target.result;
    };
    reader.onerror = () => reject(new Error("Không thể đọc tệp ảnh."));
    reader.readAsDataURL(file);
  });
}

choosePhotoBtn.addEventListener("click", () => {
  photoFileInput.click();
});

photoFileInput.addEventListener("change", async () => {
  const file = photoFileInput.files?.[0];
  if (!file) return;
  try {
    photoInfo.textContent = "Đang tối ưu hóa ảnh…";
    const processed = await processPhotoFile(file);
    currentPhoto = processed;
    updatePhotoUI();
  } catch (error) {
    alert(error?.message || "Lỗi xử lý ảnh.");
    updatePhotoUI();
  }
});

removePhotoBtn.addEventListener("click", () => {
  currentPhoto = { dataUrl: "", name: "", size: 0 };
  updatePhotoUI();
});

profileForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const profile = {};
  for (const name of fieldNames) profile[name] = compact(fields[name].value);
  profile.photoDataUrl = currentPhoto.dataUrl || "";
  profile.photoName = currentPhoto.name || "";
  profile.photoSize = currentPhoto.size || 0;
  try {
    await chrome.storage.local.set({ [PROFILE_KEY]: profile });
    saveStatus.textContent = "Đã lưu cục bộ.";
    window.setTimeout(() => { saveStatus.textContent = ""; }, 2200);
  } catch (error) {
    saveStatus.textContent = error?.message || "Không thể lưu hồ sơ.";
  }
});

async function initialize() {
  renderCatalog();
  try {
    const stored = await chrome.storage.local.get([PROFILE_KEY, CATALOG_KEY]);
    const profile = stored[PROFILE_KEY] || {};
    for (const name of fieldNames) {
      if (fields[name] && profile[name] != null) fields[name].value = profile[name];
    }
    if (profile.photoDataUrl) {
      currentPhoto = {
        dataUrl: profile.photoDataUrl,
        name: profile.photoName || "photo.jpg",
        size: profile.photoSize || 0
      };
    }
    updatePhotoUI();

    const savedCatalog = stored[CATALOG_KEY];
    if (savedCatalog) {
      for (const key of Object.keys(catalog)) catalog[key] = asArray(savedCatalog[key]);
      renderCatalog();
      if (savedCatalog.updatedAt) {
        setCatalogStatus(`Đang dùng danh mục đã lưu lúc ${new Date(savedCatalog.updatedAt).toLocaleString("vi-VN")}.`, "success");
      }
    }
  } catch (error) {
    setCatalogStatus(error?.message || "Không thể đọc dữ liệu đã lưu.", "error");
  }
}

void initialize();
