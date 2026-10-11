-- DaMod ETL E2E — EXPECTED target schema (Postgres).
-- This is the TARGET-DDL oracle: DaMod's pipeline "Target DDL" tab / Designer should
-- produce equivalent CREATE TABLE statements for the three target objects. For external
-- execution, create these in the disposable Postgres, then INSERT the rows produced by
-- DaMod's generated extract SELECT (see ETL_E2E_WORKFLOW_PLAYBOOK.md Stage 10).
--
-- fact_sales grain = ONE ROW PER NON-CANCELLED order_item (line grain). No aggregation
-- is used — DaMod has no aggregate/group-by node yet (see ETL_GAP_REGISTER.md G-AGG).

CREATE TABLE dim_customer (
  customer_id integer PRIMARY KEY,
  name        varchar(100) NOT NULL,
  email       varchar(200),
  country     varchar(2)  NOT NULL
);

CREATE TABLE dim_product (
  product_id integer PRIMARY KEY,
  sku        varchar(20)  NOT NULL,
  name       varchar(100) NOT NULL,
  unit_price numeric(12,2) NOT NULL,
  category   varchar(40)
);

CREATE TABLE fact_sales (
  order_item_id integer PRIMARY KEY,
  order_id      integer NOT NULL,
  customer_id   integer NOT NULL,
  product_id    integer NOT NULL,
  order_date    date    NOT NULL,
  quantity      integer NOT NULL,
  unit_price    numeric(12,2) NOT NULL,
  line_amount   numeric(12,2) NOT NULL   -- derived = quantity * unit_price
);
