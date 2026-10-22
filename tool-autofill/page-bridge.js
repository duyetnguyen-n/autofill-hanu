(() => {
  "use strict";

  const PAGE_SOURCE = "HSK_SAFE_AUTOFILL_PAGE_BRIDGE";
  const CONTENT_SOURCE = "HSK_SAFE_AUTOFILL_CONTENT";

  function announceReady() {
    window.postMessage({ source: PAGE_SOURCE, type: "READY" }, location.origin);
  }

  if (window.__HSK_SAFE_AUTOFILL_CATALOG_BRIDGE_V1__) {
    announceReady();
    return;
  }
  window.__HSK_SAFE_AUTOFILL_CATALOG_BRIDGE_V1__ = true;
  let cachedApi = null;

  function hasCatalogApi(value) {
    return Boolean(value &&
      typeof value.ApigetOptionList === "function" &&
      typeof value.getSubjectList === "function" &&
      typeof value.getExamTimeList === "function");
  }

  function apiFromVue(value) {
    let current = value;
    for (let depth = 0; current && depth < 12; depth += 1) {
      if (hasCatalogApi(current.$indexApi)) return current.$indexApi;
      current = current.$parent;
    }
    return null;
  }

  function findApi() {
    if (hasCatalogApi(cachedApi)) return cachedApi;
    const candidates = [
      window.$nuxt?.$indexApi,
      window.$nuxt?.context?.$indexApi,
      window.$nuxt?.context?.app?.$indexApi,
      window.$nuxt?.$root?.$indexApi
    ];
    for (const candidate of candidates) {
      if (hasCatalogApi(candidate)) {
        cachedApi = candidate;
        return cachedApi;
      }
    }

    for (const element of document.querySelectorAll("*")) {
      const api = apiFromVue(element.__vue__);
      if (api) {
        cachedApi = api;
        return cachedApi;
      }
    }
    return null;
  }

  async function waitForApi() {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const api = findApi();
      if (api) return api;
      await new Promise((resolve) => setTimeout(resolve, 80));
    }
    throw new Error("Không tìm thấy lớp API danh mục của ChineseTest.");
  }

  async function callApi(api, path, params) {
    const actions = {
      "/portal/index/getOptionList": () => api.ApigetOptionList(),
      "/portal/index/getSubjectList": () => api.getSubjectList(params.projectId),
      "/examinee/enroll/getExamTimeList": () => api.getExamTimeList(params),
      "/examinee/enroll/getZhouList": () => api.getZhouList(params),
      "/examinee/enroll/getCountryList": () => api.getCountryList(params),
      "/examinee/enroll/getProvinceList": () => api.getProvinceList(params),
      "/examinee/enroll/getCityList": () => api.getCityList(params),
      "/examinee/enroll/getExamSiteList": () => api.getExamSiteList(params)
    };
    const action = actions[path];
    if (!action) throw new Error("Endpoint không thuộc danh sách API danh mục an toàn.");
    return action();
  }

  window.addEventListener("message", async (event) => {
    if (event.source !== window || event.origin !== location.origin) return;
    const message = event.data;
    if (message?.source !== CONTENT_SOURCE || message.type !== "CATALOG_READ") return;

    const response = {
      source: PAGE_SOURCE,
      type: "RESPONSE",
      requestId: String(message.requestId || "")
    };
    try {
      const api = await waitForApi();
      response.payload = await callApi(api, String(message.path || ""), message.params || {});
    } catch (error) {
      response.error = error?.message || String(error);
    }
    window.postMessage(response, location.origin);
  });

  announceReady();
})();
