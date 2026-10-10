// PostgreSQL connector (Phase 2). Metadata discovery only — it queries the
// system catalogs (pg_catalog / pg_class / pg_attribute / pg_constraint / pg_index)
// and never reads table rows. Credentials come from the OS secure store (keyring)
// via a non-secret `secret_ref`, or a transient password passed once for a
// pre-save connection test; neither is ever persisted or logged.
//
// The Rust layer returns raw discovery JSON (native types verbatim); the
// TypeScript layer normalizes native types into the fixed modeling type set using
// the existing `mapSqlType`, so type normalization lives in exactly one place.

use serde::{Deserialize, Serialize};
use tokio_postgres::{Config, NoTls};

const KEYRING_SERVICE: &str = "DaMod";
const DEFAULT_TIMEOUT_SECS: u64 = 15;

#[derive(Deserialize)]
pub struct PgConnConfig {
    pub host: String,
    pub port: Option<u16>,
    pub database: String,
    pub user: String,
    /// Opaque key into the OS secure store; the secret itself is never sent here.
    pub secret_ref: Option<String>,
    /// Transient password for a pre-save test only (never persisted).
    pub password: Option<String>,
}

#[derive(Deserialize)]
pub struct DiscoverOptions {
    pub schemas: Option<Vec<String>>,
    pub include_views: Option<bool>,
    pub include_indexes: Option<bool>,
}

#[derive(Serialize)]
pub struct ConnTestResult {
    pub ok: bool,
    pub message: String,
    pub product_version: Option<String>,
}

#[derive(Serialize)]
pub struct PgColumn {
    pub name: String,
    pub ordinal: i32,
    pub native_type: String,
    pub nullable: bool,
    pub default: Option<String>,
    pub generated: bool,
}

#[derive(Serialize)]
pub struct PgForeignKey {
    pub name: Option<String>,
    pub columns: Vec<String>,
    pub ref_schema: String,
    pub ref_object: String,
    pub ref_columns: Vec<String>,
    pub on_delete: String,
    pub on_update: String,
}

#[derive(Serialize)]
pub struct PgIndex {
    pub name: String,
    pub columns: Vec<String>,
    pub unique: bool,
}

#[derive(Serialize)]
pub struct PgObject {
    pub name: String,
    pub kind: String, // table | view | materialized-view
    pub columns: Vec<PgColumn>,
    pub primary_key: Vec<String>,
    pub foreign_keys: Vec<PgForeignKey>,
    pub indexes: Vec<PgIndex>,
}

#[derive(Serialize)]
pub struct PgSchema {
    pub name: String,
    pub objects: Vec<PgObject>,
}

#[derive(Serialize)]
pub struct PgDiscovery {
    pub server_version: String,
    pub database: String,
    pub schemas: Vec<PgSchema>,
}

/// Resolve the password: explicit transient value wins; otherwise the keyring.
fn resolve_password(config: &PgConnConfig) -> Result<String, String> {
    if let Some(p) = &config.password {
        return Ok(p.clone());
    }
    if let Some(reference) = &config.secret_ref {
        let entry = keyring::Entry::new(KEYRING_SERVICE, reference)
            .map_err(|e| format!("keyring: {e}"))?;
        return entry
            .get_password()
            .map_err(|e| format!("No stored credential for this connection: {e}"));
    }
    Err("No credential: provide a password or a stored secret_ref".into())
}

fn relkind_to_kind(k: &str) -> &'static str {
    match k {
        "v" => "view",
        "m" => "materialized-view",
        _ => "table", // r, p
    }
}

fn fk_action(code: &str) -> &'static str {
    match code {
        "c" => "cascade",
        "r" => "restrict",
        "n" => "set null",
        "d" => "set default",
        _ => "no action", // a
    }
}

/// Open a connection, driving the connection future on Tauri's tokio runtime.
async fn connect(config: &PgConnConfig) -> Result<tokio_postgres::Client, String> {
    let password = resolve_password(config)?;
    let mut cfg = Config::new();
    cfg.host(&config.host)
        .port(config.port.unwrap_or(5432))
        .dbname(&config.database)
        .user(&config.user)
        .password(password)
        .connect_timeout(std::time::Duration::from_secs(DEFAULT_TIMEOUT_SECS));

    let (client, connection) = cfg
        .connect(NoTls)
        .await
        .map_err(|e| format!("connection failed: {e}"))?;
    tauri::async_runtime::spawn(async move {
        let _ = connection.await;
    });
    Ok(client)
}

#[tauri::command]
pub async fn pg_test_connection(config: PgConnConfig) -> ConnTestResult {
    match connect(&config).await {
        Ok(client) => match client.query_one("SELECT version()", &[]).await {
            Ok(row) => {
                let v: String = row.get(0);
                ConnTestResult { ok: true, message: "Connected".into(), product_version: Some(v) }
            }
            Err(e) => ConnTestResult { ok: false, message: format!("query failed: {e}"), product_version: None },
        },
        Err(e) => ConnTestResult { ok: false, message: e, product_version: None },
    }
}

#[tauri::command]
pub async fn pg_list_schemas(config: PgConnConfig) -> Result<Vec<String>, String> {
    let client = connect(&config).await?;
    let rows = client
        .query(
            "SELECT nspname FROM pg_namespace \
             WHERE nspname NOT IN ('pg_catalog','information_schema') \
             AND nspname NOT LIKE 'pg_%' AND nspname NOT LIKE 'pg\\_%' \
             ORDER BY nspname",
            &[],
        )
        .await
        .map_err(|e| format!("list schemas failed: {e}"))?;
    Ok(rows.iter().map(|r| r.get::<_, String>(0)).collect())
}

/// Store a credential in the OS secure store under `reference`.
#[tauri::command]
pub fn secret_store(reference: String, secret: String) -> Result<(), String> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, &reference).map_err(|e| format!("keyring: {e}"))?;
    entry.set_password(&secret).map_err(|e| format!("keyring set failed: {e}"))
}

#[tauri::command]
pub fn secret_delete(reference: String) -> Result<(), String> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, &reference).map_err(|e| format!("keyring: {e}"))?;
    match entry.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(format!("keyring delete failed: {e}")),
    }
}

#[tauri::command]
pub async fn pg_discover(config: PgConnConfig, options: DiscoverOptions) -> Result<PgDiscovery, String> {
    let client = connect(&config).await?;
    discover_with_client(&client, &config.database, &options).await
}

/// The discovery logic, factored out so an integration test can drive it with a
/// client it owns (see tests at the bottom of this file).
pub async fn discover_with_client(
    client: &tokio_postgres::Client,
    database: &str,
    options: &DiscoverOptions,
) -> Result<PgDiscovery, String> {
    let include_views = options.include_views.unwrap_or(true);
    let include_indexes = options.include_indexes.unwrap_or(true);

    let server_version: String = client
        .query_one("SELECT current_setting('server_version')", &[])
        .await
        .map(|r| r.get(0))
        .unwrap_or_else(|_| "unknown".into());

    // Resolve the schema set (filter or all user schemas).
    let schemas: Vec<String> = match &options.schemas {
        Some(s) if !s.is_empty() => s.clone(),
        _ => client
            .query(
                "SELECT nspname FROM pg_namespace \
                 WHERE nspname NOT IN ('pg_catalog','information_schema') \
                 AND nspname NOT LIKE 'pg\\_%' ORDER BY nspname",
                &[],
            )
            .await
            .map_err(|e| format!("list schemas failed: {e}"))?
            .iter()
            .map(|r| r.get::<_, String>(0))
            .collect(),
    };

    let kinds: &[&str] = if include_views { &["r", "p", "v", "m"] } else { &["r", "p"] };

    // Objects.
    let obj_rows = client
        .query(
            "SELECT n.nspname, c.relname, c.relkind::text \
             FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace \
             WHERE n.nspname = ANY($1) AND c.relkind::text = ANY($2) \
             ORDER BY n.nspname, c.relname",
            &[&schemas, &kinds],
        )
        .await
        .map_err(|e| format!("discover objects failed: {e}"))?;

    // Columns.
    let col_rows = client
        .query(
            "SELECT n.nspname, c.relname, a.attname, a.attnum, \
                    format_type(a.atttypid, a.atttypmod) AS native_type, \
                    (NOT a.attnotnull) AS nullable, \
                    pg_get_expr(d.adbin, d.adrelid) AS default_expr, \
                    (a.attgenerated <> '') AS generated \
             FROM pg_attribute a \
             JOIN pg_class c ON c.oid=a.attrelid \
             JOIN pg_namespace n ON n.oid=c.relnamespace \
             LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum \
             WHERE n.nspname = ANY($1) AND c.relkind::text = ANY($2) \
               AND a.attnum > 0 AND NOT a.attisdropped \
             ORDER BY n.nspname, c.relname, a.attnum",
            &[&schemas, &kinds],
        )
        .await
        .map_err(|e| format!("discover columns failed: {e}"))?;

    // Primary keys (ordered by key position).
    let pk_rows = client
        .query(
            "SELECT n.nspname, c.relname, a.attname, k.ord \
             FROM pg_index i \
             JOIN pg_class c ON c.oid=i.indrelid \
             JOIN pg_namespace n ON n.oid=c.relnamespace \
             JOIN unnest(i.indkey) WITH ORDINALITY AS k(attnum, ord) ON true \
             JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum=k.attnum \
             WHERE i.indisprimary AND n.nspname = ANY($1) \
             ORDER BY n.nspname, c.relname, k.ord",
            &[&schemas],
        )
        .await
        .map_err(|e| format!("discover primary keys failed: {e}"))?;

    // Foreign keys.
    let fk_rows = client
        .query(
            "SELECT n.nspname, c.relname, con.conname, \
                    con.confdeltype::text, con.confupdtype::text, \
                    (SELECT array_agg(att.attname ORDER BY k.ord) \
                       FROM unnest(con.conkey) WITH ORDINALITY AS k(attnum,ord) \
                       JOIN pg_attribute att ON att.attrelid=con.conrelid AND att.attnum=k.attnum) AS cols, \
                    fn.nspname AS ref_schema, fc.relname AS ref_table, \
                    (SELECT array_agg(att.attname ORDER BY k.ord) \
                       FROM unnest(con.confkey) WITH ORDINALITY AS k(attnum,ord) \
                       JOIN pg_attribute att ON att.attrelid=con.confrelid AND att.attnum=k.attnum) AS ref_cols \
             FROM pg_constraint con \
             JOIN pg_class c ON c.oid=con.conrelid \
             JOIN pg_namespace n ON n.oid=c.relnamespace \
             JOIN pg_class fc ON fc.oid=con.confrelid \
             JOIN pg_namespace fn ON fn.oid=fc.relnamespace \
             WHERE con.contype='f' AND n.nspname = ANY($1) \
             ORDER BY n.nspname, c.relname, con.conname",
            &[&schemas],
        )
        .await
        .map_err(|e| format!("discover foreign keys failed: {e}"))?;

    // Non-primary indexes.
    let idx_rows = if include_indexes {
        client
            .query(
                "SELECT n.nspname, c.relname, ic.relname AS idx, ix.indisunique, \
                        (SELECT array_agg(att.attname ORDER BY k.ord) \
                           FROM unnest(ix.indkey) WITH ORDINALITY AS k(attnum,ord) \
                           JOIN pg_attribute att ON att.attrelid=c.oid AND att.attnum=k.attnum \
                           WHERE k.attnum <> 0) AS cols \
                 FROM pg_index ix \
                 JOIN pg_class c ON c.oid=ix.indrelid \
                 JOIN pg_class ic ON ic.oid=ix.indexrelid \
                 JOIN pg_namespace n ON n.oid=c.relnamespace \
                 WHERE NOT ix.indisprimary AND n.nspname = ANY($1) \
                 ORDER BY n.nspname, c.relname, ic.relname",
                &[&schemas],
            )
            .await
            .map_err(|e| format!("discover indexes failed: {e}"))?
    } else {
        Vec::new()
    };

    // Assemble. Keyed by (schema, object).
    use std::collections::BTreeMap;
    let key = |s: &str, o: &str| format!("{s}\u{0}{o}");
    let mut objects: BTreeMap<String, PgObject> = BTreeMap::new();
    let mut order: Vec<(String, String)> = Vec::new();

    for r in &obj_rows {
        let s: String = r.get(0);
        let o: String = r.get(1);
        let k: String = r.get(2);
        objects.insert(
            key(&s, &o),
            PgObject {
                name: o.clone(),
                kind: relkind_to_kind(&k).into(),
                columns: Vec::new(),
                primary_key: Vec::new(),
                foreign_keys: Vec::new(),
                indexes: Vec::new(),
            },
        );
        order.push((s, o));
    }
    for r in &col_rows {
        let s: String = r.get(0);
        let o: String = r.get(1);
        if let Some(obj) = objects.get_mut(&key(&s, &o)) {
            obj.columns.push(PgColumn {
                name: r.get(2),
                ordinal: r.get::<_, i16>(3) as i32,
                native_type: r.get(4),
                nullable: r.get(5),
                default: r.get(6),
                generated: r.get(7),
            });
        }
    }
    for r in &pk_rows {
        let s: String = r.get(0);
        let o: String = r.get(1);
        if let Some(obj) = objects.get_mut(&key(&s, &o)) {
            obj.primary_key.push(r.get(2));
        }
    }
    for r in &fk_rows {
        let s: String = r.get(0);
        let o: String = r.get(1);
        if let Some(obj) = objects.get_mut(&key(&s, &o)) {
            let del: String = r.get(3);
            let upd: String = r.get(4);
            obj.foreign_keys.push(PgForeignKey {
                name: r.get(2),
                columns: r.get::<_, Option<Vec<String>>>(5).unwrap_or_default(),
                ref_schema: r.get(6),
                ref_object: r.get(7),
                ref_columns: r.get::<_, Option<Vec<String>>>(8).unwrap_or_default(),
                on_delete: fk_action(&del).into(),
                on_update: fk_action(&upd).into(),
            });
        }
    }
    for r in &idx_rows {
        let s: String = r.get(0);
        let o: String = r.get(1);
        if let Some(obj) = objects.get_mut(&key(&s, &o)) {
            obj.indexes.push(PgIndex {
                name: r.get(2),
                unique: r.get(3),
                columns: r.get::<_, Option<Vec<String>>>(4).unwrap_or_default(),
            });
        }
    }

    // Group objects back into their schemas, preserving discovery order.
    let mut by_schema: BTreeMap<String, Vec<PgObject>> = BTreeMap::new();
    for (s, o) in order {
        if let Some(obj) = objects.remove(&key(&s, &o)) {
            by_schema.entry(s).or_default().push(obj);
        }
    }
    let schemas_out = by_schema
        .into_iter()
        .map(|(name, objects)| PgSchema { name, objects })
        .collect();

    Ok(PgDiscovery { server_version, database: database.to_string(), schemas: schemas_out })
}

// ---- integration test (author-run; needs a reachable PostgreSQL) ------------
//
// Set DAMOD_TEST_PG_URL to a postgres connection string, e.g.
//   DAMOD_TEST_PG_URL=postgres://postgres:pw@localhost:5432/postgres cargo test
// Without it, the test is skipped (it returns early), so `cargo test` stays green
// in environments with no database.
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_fk_action_codes() {
        assert_eq!(fk_action("c"), "cascade");
        assert_eq!(fk_action("n"), "set null");
        assert_eq!(fk_action("a"), "no action");
        assert_eq!(fk_action("x"), "no action");
    }

    #[test]
    fn maps_relkind() {
        assert_eq!(relkind_to_kind("r"), "table");
        assert_eq!(relkind_to_kind("v"), "view");
        assert_eq!(relkind_to_kind("m"), "materialized-view");
    }

    #[tokio::test]
    async fn discovers_against_live_postgres() {
        let url = match std::env::var("DAMOD_TEST_PG_URL") {
            Ok(u) => u,
            Err(_) => return, // no database available — skip
        };
        let (client, connection) = tokio_postgres::connect(&url, NoTls).await.expect("connect");
        tokio::spawn(async move {
            let _ = connection.await;
        });
        client
            .batch_execute(
                "CREATE SCHEMA IF NOT EXISTS damod_it; \
                 DROP TABLE IF EXISTS damod_it.line, damod_it.parent CASCADE; \
                 CREATE TABLE damod_it.parent (id uuid PRIMARY KEY, mgr uuid REFERENCES damod_it.parent(id)); \
                 CREATE TABLE damod_it.line (a uuid, b uuid, qty integer NOT NULL DEFAULT 1, \
                   PRIMARY KEY (a, b), FOREIGN KEY (a) REFERENCES damod_it.parent(id));",
            )
            .await
            .expect("fixture");

        let opts = DiscoverOptions { schemas: Some(vec!["damod_it".into()]), include_views: Some(true), include_indexes: Some(true) };
        let d = discover_with_client(&client, "postgres", &opts).await.expect("discover");
        let schema = d.schemas.iter().find(|s| s.name == "damod_it").expect("schema");
        let line = schema.objects.iter().find(|o| o.name == "line").expect("line");
        assert_eq!(line.primary_key, vec!["a".to_string(), "b".to_string()]); // composite PK
        assert!(line.foreign_keys.iter().any(|f| f.ref_object == "parent"));
        let parent = schema.objects.iter().find(|o| o.name == "parent").expect("parent");
        assert!(parent.foreign_keys.iter().any(|f| f.ref_object == "parent")); // self-ref
    }
}
