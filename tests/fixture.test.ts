import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";

const here = resolve(fileURLToPath(new URL(".", import.meta.url)));
const html = readFileSync(resolve(here, "fixtures/google-form.html"), "utf8");

describe("Google Forms-like fixture", () => {
  it("covers required text, radio, optional text, file and verification controls", () => {
    const document = new JSDOM(html).window.document;
    const items = document.querySelectorAll('[role="listitem"]');
    expect(items).toHaveLength(5);
    expect(document.querySelectorAll('input[type="text"]')).toHaveLength(2);
    expect(document.querySelectorAll('[role="radio"]')).toHaveLength(2);
    expect(document.querySelectorAll('input[type="file"]')).toHaveLength(1);
    expect(document.querySelector("button")?.textContent).toBe("Next");
    expect(document.body.textContent).toContain("CÂU HỎI XÁC THỰC");
  });
});
