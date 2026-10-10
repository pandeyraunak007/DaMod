// @vitest-environment jsdom
//
// Req 21 §2/Phase 2 item 3 — an Oracle EBS (mock) connection is creatable and usable
// in the Connections dialog: EBS-specific editor (instance only, no credentials),
// and Test reports the EBS release + Oracle DB version via the registered connector.

import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ConnectionsDialog } from "./ConnectionsDialog";
import { useWorkspaceStore } from "../../store/workspaceStore";
import type { ConnectionProfile } from "../connection";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

const ebsProfile: ConnectionProfile = { id: "g_ebs", name: "oracle_ebs", systemType: "oracle-ebs", params: { database: "VIS" } };

beforeEach(() => {
  useWorkspaceStore.setState({
    connections: [ebsProfile],
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

describe("Oracle EBS connection in the Connections dialog", () => {
  it("shows an EBS-specific editor (instance only, no credentials)", () => {
    const labels = [...container.querySelectorAll("label")].map((l) => l.textContent);
    expect(labels.some((t) => /EBS instance/.test(t ?? ""))).toBe(true);
    expect(labels.some((t) => /Host|Password|User/.test(t ?? ""))).toBe(false);
    expect(container.textContent).toContain("mock/offline source");
  });

  it("offers a '+ Oracle EBS (mock)' creation button", () => {
    expect(byText("button", /Oracle EBS \(mock\)/)).toBeTruthy();
  });

  it("Test reports the EBS release and Oracle DB version", async () => {
    const testBtn = byText("button", /^Test$/)!;
    await act(async () => {
      testBtn.click();
    });
    expect(container.textContent).toContain("E-Business Suite 12.2.9");
    expect(container.textContent).toContain("Oracle Database 19c");
  });
});
