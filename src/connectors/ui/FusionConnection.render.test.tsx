// @vitest-environment jsdom
//
// Req 22 §3 — an Oracle Fusion Cloud (mock) connection is creatable and usable in the
// Connections dialog: a Fusion-specific editor (instance URL only, no credentials) and
// Test reporting the REST API version via the registered connector.

import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ConnectionsDialog } from "./ConnectionsDialog";
import { useWorkspaceStore } from "../../store/workspaceStore";
import type { ConnectionProfile } from "../connection";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

const fusionProfile: ConnectionProfile = {
  id: "g_fus",
  name: "oracle_fusion",
  systemType: "oracle-fusion",
  params: { baseUrl: "https://x.fa.ocs.oraclecloud.com" },
};

beforeEach(() => {
  useWorkspaceStore.setState({
    connections: [fusionProfile],
    upsertConnection: vi.fn(async () => {}) as never,
    deleteConnection: vi.fn(async () => {}) as never,
  });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root.render(<ConnectionsDialog onClose={() => {}} />));
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function byText(sel: string, re: RegExp) {
  return [...container.querySelectorAll(sel)].find((el) => re.test(el.textContent ?? "")) as HTMLElement | undefined;
}

describe("Oracle Fusion connection in the Connections dialog", () => {
  it("shows a Fusion-specific editor (instance URL only, no credentials)", () => {
    const labels = [...container.querySelectorAll("label")].map((l) => l.textContent);
    expect(labels.some((t) => /Fusion instance URL/.test(t ?? ""))).toBe(true);
    expect(labels.some((t) => /Host|Password|User/.test(t ?? ""))).toBe(false);
    expect(container.textContent).toContain("mock/offline source");
  });

  it("offers a '+ Oracle Fusion (mock)' creation button", () => {
    expect(byText("button", /Oracle Fusion \(mock\)/)).toBeTruthy();
  });

  it("Test reports the Fusion REST API version", async () => {
    const testBtn = byText("button", /^Test$/)!;
    await act(async () => {
      testBtn.click();
    });
    expect(container.textContent).toContain("REST API 11.13.18.05");
  });
});
