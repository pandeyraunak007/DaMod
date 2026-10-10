// Connector registry. New sources register a factory keyed by system type; the
// UI and pipeline planner resolve connectors through here, so adding a connector
// never touches the canvas or planner (§4: future extensibility).

import type { Connector, ConnectorFactory } from "./connector";
import type { SourceSystemType } from "./metadata";
import { createMockConnector } from "./mock/mockConnector";
import { createPostgresConnector } from "./postgres/postgresConnector";

const registry = new Map<SourceSystemType, ConnectorFactory>();

export function registerConnector(systemType: SourceSystemType, factory: ConnectorFactory): void {
  registry.set(systemType, factory);
}

export function getConnector(systemType: SourceSystemType): Connector | undefined {
  return registry.get(systemType)?.();
}

export function registeredSystemTypes(): SourceSystemType[] {
  return [...registry.keys()];
}

// Built-in connectors.
registerConnector("mock", createMockConnector);
registerConnector("postgres", createPostgresConnector);
