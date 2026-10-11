-- DaMod ETL E2E — synthetic SOURCE data (deterministic, tiny, hand-verifiable).
-- Load into a disposable local Postgres AFTER source_schema.sql. Synthetic only.
--
-- Edge cases embedded:
--   * customer 4 (Katherine) has a NULL email            → null-handling test
--   * product 30 (Manual) has unit_price 0.00            → zero-price boundary
--   * order 102 is 'cancelled'                           → must be EXCLUDED by filter
--   * order_item 1006 has unit_price 0.00                → line_amount 0 boundary
--   * customer 3 has only a cancelled order              → 0 fact rows for them

INSERT INTO customers (customer_id, name, email, country) VALUES
  (1, 'Ada Lovelace',  'ada@x.test',   'UK'),
  (2, 'Alan Turing',   'alan@x.test',  'UK'),
  (3, 'Grace Hopper',  'grace@x.test', 'US'),
  (4, 'Katherine J',    NULL,          'US');

INSERT INTO products (product_id, sku, name, unit_price, category) VALUES
  (10, 'SKU-A', 'Widget', 9.99,  'Hardware'),
  (20, 'SKU-B', 'Gadget', 19.50, 'Hardware'),
  (30, 'SKU-C', 'Manual', 0.00,  'Docs');

INSERT INTO orders (order_id, customer_id, order_date, status) VALUES
  (100, 1, DATE '2026-01-02', 'shipped'),
  (101, 2, DATE '2026-01-03', 'shipped'),
  (102, 3, DATE '2026-01-03', 'cancelled'),
  (103, 1, DATE '2026-01-05', 'shipped'),
  (104, 4, DATE '2026-01-06', 'pending');

INSERT INTO order_items (order_item_id, order_id, product_id, quantity, unit_price) VALUES
  (1000, 100, 10, 2, 9.99),   -- line_amount 19.98
  (1001, 100, 20, 1, 19.50),  -- line_amount 19.50
  (1002, 101, 10, 5, 9.99),   -- line_amount 49.95
  (1003, 102, 30, 1, 0.00),   -- EXCLUDED (order 102 cancelled)
  (1004, 103, 20, 3, 19.50),  -- line_amount 58.50
  (1005, 104, 10, 1, 9.99),   -- line_amount 9.99
  (1006, 103, 30, 10, 0.00);  -- line_amount 0.00 (zero-price boundary)
