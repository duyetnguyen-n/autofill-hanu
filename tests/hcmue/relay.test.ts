import { it, expect } from "vitest";
import { httpFixture, users } from "../cloud/fixture";
import { connectRunner } from "./relay-fixture";
import type { Device } from "../../integrations/hcmue/protocol";
it("pairs once, relays only encrypted commands, and isolates owners", async () => {
  const app = await httpFixture(undefined, true);
  const runner = await connectRunner(app);
  try {
    const paired = await app.api("hcmue/pair", 0, { code: runner.code });
    expect(paired.status).toBe(200);
    const device = (await paired.json()) as Device;
    expect(device.publicKey.d).toBeUndefined();
    expect(device.connected).toBe(true);
    expect((await app.api("hcmue/pair", 1, { code: runner.code })).status).toBe(
      400,
    );
    expect(await (await app.api("hcmue/devices", 1)).json()).toEqual([]);
    expect((await runner.command(device, "state", {}, 1)).status).toBe(404);
    const state = await runner.command(device, "state");
    expect(state.status).toBe(200);
    expect(state.result).toMatchObject({
      ok: true,
      data: { accounts: [{ identity: { name: "Nguyễn Minh An" } }] },
    });
    const denied = await app.pool.query(
      "SELECT has_schema_privilege('authenticated','hcmue','USAGE') AS allowed",
    );
    expect(denied.rows[0].allowed).toBe(false);
    expect(
      (await app.api("hcmue/devices/" + device.id, 1, undefined, "DELETE"))
        .status,
    ).toBe(404);
    expect(
      (await app.api("hcmue/devices/" + device.id, 0, undefined, "DELETE"))
        .status,
    ).toBe(200);
    expect(await (await app.api("hcmue/devices")).json()).toEqual([]);
  } finally {
    await runner.close();
    await app.close();
  }
}, 30000);
it("leaves the provider disabled and Google Forms auth unchanged by default", async () => {
  const app = await httpFixture();
  try {
    expect(await (await app.api("auth/config")).json()).toEqual({
      cloud: true,
    });
    expect((await app.api("hcmue/devices")).status).toBe(404);
    expect((await app.api("state")).status).toBe(200);
  } finally {
    await app.close();
  }
}, 30000);
