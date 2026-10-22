import { it, expect } from "vitest";
import { X509Certificate } from "node:crypto";
import { rootCertificates } from "node:tls";
import {
  schoolCertificateAuthorities,
  HCMUE_INTERMEDIATE,
} from "../../integrations/hcmue/runner/tls";
it("supplements the missing DigiCert intermediate anchored to an existing trusted root", () => {
  const cert = new X509Certificate(HCMUE_INTERMEDIATE),
    cas = schoolCertificateAuthorities();
  expect(cert.ca).toBe(true);
  expect(cert.fingerprint256).toBe(
    "C8:02:5F:9F:C6:5F:DF:C9:5B:3C:A8:CC:78:67:B9:A5:87:B5:27:79:73:95:79:17:46:3F:C8:13:D0:B6:25:A9",
  );
  expect(
    rootCertificates.some((pem) => {
      const root = new X509Certificate(pem);
      return cert.checkIssued(root) && cert.verify(root.publicKey);
    }),
  ).toBe(true);
  expect(cas).toContain(HCMUE_INTERMEDIATE);
  expect(cas.length).toBeGreaterThan(100);
});
