// Connector registry. New sources register a factory keyed by system type; the
// UI and pipeline planner resolve connectors through here, so adding a connector
// never touches the canvas or planner (§4: future extensibility).

import type { Connector, ConnectorFactory } from "./connector";
import type { SourceSystemType } from "./metadata";
import { createMockConnector } from "./mock/mockConnector";
import { createPostgresConnector } from "./postgres/postgresConnector";
import { createMockEbsConnector } from "./oracle/mockEbsConnector";
import { createMockFusionConnector } from "./fusion/mockFusionConnector";
import { createMockSnowflakeConnector } from "./snowflake/mockSnowflakeConnector";

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
// Oracle E-Business Suite — mock/offline connector (Req 21 Phase 1). The live
// Rust Oracle adapter is deferred pending a driver-dependency sign-off.
registerConnector("oracle-ebs", createMockEbsConnector);
// Oracle Fusion Cloud — mock/offline connector (Req 22 Phase 1). The live REST
// connector (tenant + OAuth + pagination/rate limits) is a later increment.
registerConnector("oracle-fusion", createMockFusionConnector);
// Snowflake — mock/offline connector (Req 23 Phase 2). The live adapter needs
// account/warehouse/role + key-pair/OAuth auth and an account to verify against.
registerConnector("snowflake", createMockSnowflakeConnector);
