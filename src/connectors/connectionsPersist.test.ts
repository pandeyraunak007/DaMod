import { describe, it, expect } from "vitest";
import {
  emptyConnectionsDoc,
  serializeConnections,
  parseConnectionsFile,
} from "./connectionsPersist";
import type { ConnectionProfile } from "./connection";

const a: ConnectionProfile = {
  id: "g_2",
  name: "prod",
  systemType: "postgres",
  params: { user: "ro", host: "db", port: "5432", database: "app" },
  secretRef: "g_2",
};
const b: ConnectionProfile = {
  id: "g_1",
  name: "stage",
  systemType: "postgres",
  params: { host: "db2", database: "app" },
};

describe("connections persistence", () => {
  it("serializes deterministically (profiles by id, params by key)", () => {
    const doc = { ...emptyConnectionsDoc(), connections: [a, b] };
    const text = serializeConnections(doc);
    // g_1 sorts before g_2; params keys sorted.
    expect(text.indexOf('"stage"')).toBeLessThan(text.indexOf('"prod"'));
    expect(text).toBe(serializeConnections({ ...emptyConnectionsDoc(), connections: [b, a] }));
    const params = JSON.parse(text).connections[1].params;
    expect(Object.keys(params)).toEqual(["database", "host", "port", "user"]);
  });

  it("round-trips through parse", () => {
    const doc = { ...emptyConnectionsDoc(), connections: [a, b] };
    const text = serializeConnections(doc);
    const parsed = parseConnectionsFile(text);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.connections.map((c) => c.id).sort()).toEqual(["g_1", "g_2"]);
    expect(serializeConnections(parsed.value)).toBe(text);
  });

  it("refuses to serialize a profile that carries a secret", () => {
    const leaky = { ...a, params: { ...a.params, password: "hunter2" } };
    expect(() => serializeConnections({ ...emptyConnectionsDoc(), connections: [leaky] })).toThrow(/credential/i);
  });

  it("rejects loading a file with credential-like fields", () => {
    const bad = JSON.stringify({ formatVersion: 1, connections: [{ ...a, token: "x" }] });
    const parsed = parseConnectionsFile(bad);
    expect(parsed.ok).toBe(false);
  });
});
