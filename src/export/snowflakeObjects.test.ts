// Req 23 Phase 4 — Snowflake data-engineering objects (stages, file formats,
// pipes, streams, tasks, dynamic tables): model → serialize round-trip →
// Snowflake DDL → omission on other dialects → validation.
import { describe, it, expect } from "vitest";
import { newModel, newSnowflakeObject, type Model, type SnowflakeObject } from "../model/model";
import { exportModelDDL } from "./ddl";
import { DIALECTS } from "./dialects";
import { serializeModel } from "../persist/serialize";
import { parseModelFile } from "../persist/schema";
import { validateWorkspace } from "../validation/rules";

function withObjects(objs: SnowflakeObject[]): Model {
  const m = newModel("sf_de", "2026-01-01T00:00:00Z", "Physical", "snowflake");
  m.snowflakeObjects = objs;
  return m;
}

describe("snowflake data-engineering object DDL", () => {
  it("emits a CREATE STAGE for an external stage with URL and file format", () => {
    const stage = newSnowflakeObject("stage", "LANDING");
    stage.stageType = "external";
    stage.url = "s3://bucket/path/";
    stage.fileFormat = "MY_CSV";
    const ddl = exportModelDDL(withObjects([stage]), DIALECTS.snowflake);
    expect(ddl).toContain('CREATE STAGE "LANDING"');
    expect(ddl).toContain("URL = 's3://bucket/path/'");
    expect(ddl).toContain('FORMAT_NAME = "MY_CSV"');
  });

  it("emits CREATE FILE FORMAT with type and options", () => {
    const ff = newSnowflakeObject("fileFormat", "MY_CSV");
    ff.formatType = "CSV";
    ff.options = "FIELD_DELIMITER = '|' SKIP_HEADER = 1";
    const ddl = exportModelDDL(withObjects([ff]), DIALECTS.snowflake);
    expect(ddl).toContain(`CREATE FILE FORMAT "MY_CSV" TYPE = 'CSV' FIELD_DELIMITER = '|' SKIP_HEADER = 1`);
  });

  it("emits CREATE PIPE with AUTO_INGEST and the COPY statement", () => {
    const pipe = newSnowflakeObject("pipe", "INGEST_PIPE");
    pipe.autoIngest = true;
    pipe.copyStatement = "COPY INTO orders FROM @landing";
    const ddl = exportModelDDL(withObjects([pipe]), DIALECTS.snowflake);
    expect(ddl).toContain('CREATE PIPE "INGEST_PIPE" AUTO_INGEST = TRUE AS');
    expect(ddl).toContain("COPY INTO orders FROM @landing");
  });

  it("emits CREATE STREAM with the append-only flag and source table", () => {
    const stream = newSnowflakeObject("stream", "ORDERS_STREAM");
    stream.sourceObject = "ORDERS";
    stream.streamType = "append_only";
    const ddl = exportModelDDL(withObjects([stream]), DIALECTS.snowflake);
    expect(ddl).toContain('CREATE STREAM "ORDERS_STREAM" ON TABLE "ORDERS" APPEND_ONLY = TRUE');
  });

  it("emits CREATE TASK with warehouse, schedule and body", () => {
    const task = newSnowflakeObject("task", "DAILY_LOAD");
    task.warehouse = "WH";
    task.schedule = "USING CRON 0 2 * * * UTC";
    task.sql = "INSERT INTO t SELECT * FROM s";
    const ddl = exportModelDDL(withObjects([task]), DIALECTS.snowflake);
    expect(ddl).toContain('CREATE TASK "DAILY_LOAD"');
    expect(ddl).toContain('WAREHOUSE = "WH"');
    expect(ddl).toContain("SCHEDULE = 'USING CRON 0 2 * * * UTC'");
    expect(ddl).toContain("INSERT INTO t SELECT * FROM s");
  });

  it("emits CREATE DYNAMIC TABLE with target lag and query", () => {
    const dt = newSnowflakeObject("dynamicTable", "DAILY_AGG");
    dt.targetLag = "1 hour";
    dt.warehouse = "WH";
    dt.sql = "SELECT d, COUNT(*) FROM orders GROUP BY d";
    const ddl = exportModelDDL(withObjects([dt]), DIALECTS.snowflake);
    expect(ddl).toContain('CREATE DYNAMIC TABLE "DAILY_AGG"');
    expect(ddl).toContain("TARGET_LAG = '1 hour'");
    expect(ddl).toContain("SELECT d, COUNT(*) FROM orders GROUP BY d");
  });

  it("omits the objects (with a count comment) on non-Snowflake dialects", () => {
    const m = withObjects([newSnowflakeObject("stage", "S1"), newSnowflakeObject("pipe", "P1")]);
    const ddl = exportModelDDL(m, DIALECTS.postgres);
    expect(ddl).toContain("2 Snowflake data-engineering object(s) omitted for Postgres");
    expect(ddl).not.toContain("CREATE STAGE");
  });
});

describe("snowflake object serialization round-trip", () => {
  it("is byte-identical through serialize → parse → serialize", () => {
    const stage = newSnowflakeObject("stage", "LANDING");
    stage.stageType = "external";
    stage.url = "s3://b/";
    const pipe = newSnowflakeObject("pipe", "P");
    pipe.copyStatement = "COPY INTO t FROM @LANDING";
    pipe.autoIngest = true;
    const m = withObjects([stage, pipe]);
    const once = serializeModel(m);
    const parsed = parseModelFile(once);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(serializeModel(parsed.value)).toBe(once);
    expect(parsed.value.snowflakeObjects).toHaveLength(2);
  });
});

describe("snowflake object validation", () => {
  it("warns when a pipe has no COPY statement and a stream has no source", () => {
    const m = withObjects([newSnowflakeObject("pipe", "P"), newSnowflakeObject("stream", "S")]);
    const issues = validateWorkspace({ models: [{ id: m.id, name: m.name, model: m }], links: [], conceptGroups: [] });
    const msgs = issues.map((i) => i.message);
    expect(msgs.some((x) => x.includes("needs a COPY INTO statement"))).toBe(true);
    expect(msgs.some((x) => x.includes("needs a source object"))).toBe(true);
  });

  it("warns when an external stage lacks a URL, and is silent once set", () => {
    const stage = newSnowflakeObject("stage", "S");
    stage.stageType = "external";
    const m = withObjects([stage]);
    let issues = validateWorkspace({ models: [{ id: m.id, name: m.name, model: m }], links: [], conceptGroups: [] });
    expect(issues.some((i) => i.message.includes("needs a URL"))).toBe(true);
    stage.url = "s3://b/";
    issues = validateWorkspace({ models: [{ id: m.id, name: m.name, model: m }], links: [], conceptGroups: [] });
    expect(issues.some((i) => i.message.includes("needs a URL"))).toBe(false);
  });
});
