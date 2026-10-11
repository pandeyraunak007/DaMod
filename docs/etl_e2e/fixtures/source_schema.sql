-- DaMod ETL E2E — synthetic SOURCE schema (retail sales).
-- Purpose: (1) reverse-engineer into a DaMod source model via File ribbon → "Import SQL";
--          (2) load into a disposable local Postgres for EXTERNAL execution of the SQL
--              DaMod generates (DaMod itself does not execute — design-time only).
-- Uses only CREATE TABLE / PK / FK / standard types that DaMod's parseDdl supports.
-- Synthetic data only. Never run against production.

CREATE TABLE customers (
  customer_id integer PRIMARY KEY,
  name        varchar(100) NOT NULL,
  email       varchar(200),              -- nullable: null-handling case (customer 4)
  country     varchar(2)  NOT NULL
);

CREATE TABLE products (
  product_id  integer PRIMARY KEY,
  sku         varchar(20)  NOT NULL,
  name        varchar(100) NOT NULL,
  unit_price  numeric(12,2) NOT NULL,     -- includes a 0.00 boundary case (product 30)
  category    varchar(40)
);

CREATE TABLE orders (
  order_id    integer PRIMARY KEY,
  customer_id integer NOT NULL REFERENCES customers(customer_id),
  order_date  date    NOT NULL,
  status      varchar(20) NOT NULL        -- 'shipped' | 'pending' | 'cancelled'
);

CREATE TABLE order_items (
  order_item_id integer PRIMARY KEY,
  order_id      integer NOT NULL REFERENCES orders(order_id),
  product_id    integer NOT NULL REFERENCES products(product_id),
  quantity      integer NOT NULL,         -- line grain
  unit_price    numeric(12,2) NOT NULL    -- price captured at sale time
);
