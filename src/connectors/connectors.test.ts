import { describe, it, expect } from "vitest";
import { createMockConnector, mockExtract } from "./mock/mockConnector";
import { parseMetadata, allObjects, type CanonicalMetadata } from "./metadata";
import { serializeMetadata, serializeSnapshot, parseSnapshot, type SourceSnapshot } from "./snapshot";
import { findSecretLeaks } from "./connection";
import { getConnector, registeredSystemTypes } from "./registry";
import { ConnectorError, isConnectorError } from "./errors";
import type { ConnectionProfile } from "./connection";

const profile: ConnectionProfile = {
  id: "g_test0001",
  name: "mock-db",
  systemType: "mock",
  params: { database: "demo" },
  secretRef: "keychain:mock-db",
};

describe("mock connector", () => {
  it("is resolvable through the registry", () => {
    expect(registeredSystemTypes()).toContain("mock");
    expect(getConnector("mock")).toBeTruthy();
  });

  it("declares capabilities and tests the connection", async () => {
    const c = createMockConnector();
    expect(c.capabilities()).toContain("discoverForeignKeys");
    expect(c.capabilities()).not.toContain("fullExtract");
    expect((await c.testConnection(profile)).ok).toBe(true);
    const bad = await c.testConnection({ ...profile, params: {} });
    expect(bad.ok).toBe(false);
  });

  it("discovers canonical metadata with composite keys, FKs and a self-reference", async () => {
    const c = createMockConnector();
    const { metadata } = await c.discover(profile);
    const parsed = parseMetadata(metadata);
    expect(parsed.ok).toBe(true);

    const objs = allObjects(metadata);
    const orderLine = objs.find((o) => o.object.name === "OrderLine")!.object;
    expect(orderLine.primaryKey).toEqual(["order_id", "product_id"]); // composite
    expect(orderLine.foreignKeys).toHaveLength(2);

    const customer = objs.find((o) => o.object.name === "Customer")!.object;
    const selfFk = customer.foreignKeys.find((f) => f.refObject === "Customer");
    expect(selfFk?.columns).toEqual(["manager_id"]); // self-reference preserved
  });

  it("preserves a native type even when it has no normalized mapping", async () => {
    const { metadata } = await createMockConnector().discover(profile);
    const geo = allObjects(metadata)
      .find((o) => o.object.name === "OrderLine")!
      .object.columns.find((col) => col.name === "geo")!;
    expect(geo.nativeType).toBe("geography(Point,4326)");
    expect(geo.normalizedType).toBeUndefined();
  });

  it("honours schema filtering and the includeViews option", async () => {
    const c = createMockConnector();
    const onlySales = await c.discover(profile, { schemas: ["sales"], includeViews: false });
    const schemaNames = onlySales.metadata.catalogs[0].schemas.map((s) => s.name);
    expect(schemaNames).toEqual(["sales"]);
    expect(allObjects(onlySales.metadata).some((o) => o.object.kind === "view")).toBe(false);

    const withViews = await c.discover(profile, { schemas: ["reporting"] });
    expect(allObjects(withViews.metadata).some((o) => o.object.kind === "view")).toBe(true);
  });

  it("represents an unsupported operation explicitly (no silent success)", () => {
    expect(() => mockExtract()).toThrow(ConnectorError);
    try {
      mockExtract();
    } catch (e) {
      expect(isConnectorError(e) && e.code).toBe("unsupported");
    }
  });
});

describe("canonical metadata validation", () => {
  it("rejects an object that is not valid metadata", () => {
    const bad = parseMetadata({ metadataVersion: 1, catalogs: "nope" });
    expect(bad.ok).toBe(false);
  });

  it("rejects an unknown normalized type", () => {
    const md = {
      metadataVersion: 1,
      source: { systemType: "mock", name: "x" },
      capabilities: [],
      catalogs: [
        {
          name: "x",
          schemas: [
            {
              name: "s",
              objects: [
                {
                  name: "t",
                  kind: "table",
                  foreignKeys: [],
                  indexes: [],
                  columns: [
                    { name: "c", ordinal: 0, nativeType: "weird", normalizedType: { type: "blob" }, nullable: true },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    expect(parseMetadata(md).ok).toBe(false);
  });
});

describe("snapshot serialization", () => {
  async function makeSnapshot(): Promise<SourceSnapshot> {
    const { metadata, provenance } = await createMockConnector().discover(profile);
    return { snapshotVersion: 1, id: "s_test0001", connectionRef: profile.id, metadata, provenance };
  }

  it("serializes metadata deterministically regardless of object order", async () => {
    const snap = await makeSnapshot();
    const a = serializeMetadata(snap.metadata);
    // Shuffle object order in the first schema; stable output must be identical.
    const shuffled: CanonicalMetadata = structuredClone(snap.metadata);
    shuffled.catalogs[0].schemas[0].objects.reverse();
    const b = serializeMetadata(shuffled);
    expect(a).toBe(b);
  });

  it("round-trips a snapshot through serialize/parse", async () => {
    const snap = await makeSnapshot();
    const text = serializeSnapshot(snap);
    const parsed = parseSnapshot(text);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.connectionRef).toBe(profile.id);
    expect(serializeSnapshot(parsed.value)).toBe(text); // deterministic
  });

  it("rejects a snapshot that carries credential-like fields", async () => {
    const snap = await makeSnapshot();
    const poisoned = JSON.parse(serializeSnapshot(snap));
    poisoned.provenance.password = "hunter2";
    const parsed = parseSnapshot(JSON.stringify(poisoned));
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error).toMatch(/credential/i);
  });
});

describe("credential redaction", () => {
  it("finds secret-like keys at any depth", () => {
    expect(findSecretLeaks({ a: { password: "x" } })).toEqual(["a.password"]);
    expect(findSecretLeaks({ params: { host: "h", token: "t" } })).toContain("params.token");
    expect(findSecretLeaks({ safe: "value", nested: [{ ok: 1 }] })).toEqual([]);
  });

  it("a clean connection profile has no leaks", () => {
    expect(findSecretLeaks(profile)).toEqual([]);
  });
});
