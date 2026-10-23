import { describe, expect, it } from "vitest";
import { request } from "node:http";
import { createWebsiteSetup, setupWebsiteOrigin } from "../../integrations/runner/setup";

describe("browser website setup", () => {
  it("accepts a pasted management-page link without changing deep-link validation", () => {
    expect(setupWebsiteOrigin(" https://example.test/chinesetest#runs ", "chinesetest")).toBe("https://example.test");
    expect(setupWebsiteOrigin("https://example.test/", "hcmue")).toBe("https://example.test");
    expect(setupWebsiteOrigin("https://example.test/hcmue/", "hcmue")).toBe("https://example.test");
    for (const value of ["http://example.test", "https://user:pass@example.test/", "https://example.test/other", "https://example.test/?redirect=other"])
      expect(() => setupWebsiteOrigin(value, "hcmue")).toThrow();
    expect(() => setupWebsiteOrigin("https://example.test/chinesetest", "hcmue")).toThrow();
  });

  it("requires a local token, Host, cookie and Origin before accepting the website", async () => {
    const setup = await createWebsiteSetup("chinesetest");
    const base = new URL(setup.url).origin;
    try {
      expect((await fetch(base)).status).toBe(401);
      expect((await fetch(base + "/?token=wrong")).status).toBe(403);
      const unlock = await fetch(setup.url, { redirect: "manual" });
      expect(unlock.status).toBe(303);
      expect(unlock.headers.get("referrer-policy")).toBe("same-origin");
      expect(unlock.headers.get("set-cookie")).toContain("HttpOnly; SameSite=Strict");
      const cookie = unlock.headers.get("set-cookie")!.split(";")[0];
      const foreignHost = await new Promise<number | undefined>((resolve, reject) => {
        const req = request(base, { headers: { Host: "foreign.test", Cookie: cookie } }, response => {
          response.resume();
          response.on("end", () => resolve(response.statusCode));
        });
        req.on("error", reject);
        req.end();
      });
      expect(foreignHost).toBe(403);
      const page = await fetch(base, { headers: { Cookie: cookie } });
      expect(await page.text()).toContain("Ctrl+V");
      const post = (body: string, origin = base) => fetch(base + "/website", {
        method: "POST", headers: { Cookie: cookie, Origin: origin, "Content-Type": "application/x-www-form-urlencoded" }, body,
      });
      expect((await post("website=https://example.test", "https://foreign.test")).status).toBe(403);
      expect((await fetch(base + "/website", { method: "POST", headers: { Origin: base }, body: "website=https://example.test" })).status).toBe(401);
      expect((await post("website=https://example.test&website=https://other.test")).status).toBe(400);
      const bad = await post(new URLSearchParams({ website: 'http://example.test/\"><script>alert(1)</script>' }).toString());
      expect(bad.status).toBe(400);
      expect(await bad.text()).not.toContain('<script>alert(1)</script>');
      expect((await post("website=" + "a".repeat(9000))).status).toBe(413);
      const response = await post(new URLSearchParams({ website: "https://example.test/chinesetest#runs" }).toString());
      expect(response.status).toBe(200);
      expect(await setup.result).toBe("https://example.test");
      expect(await response.text()).toContain("Đang mở runner");
    } finally { setup.close(); }
  });

  it("cancels without choosing or saving a website", async () => {
    const setup = await createWebsiteSetup("hcmue");
    setup.close();
    await expect(setup.result).rejects.toThrow("Đã đóng");
  });
});
