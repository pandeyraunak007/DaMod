-- DaMod ETL E2E — independent verification assertions (run in the disposable Postgres
-- AFTER loading dim_customer/dim_product/fact_sales via DaMod's generated SQL).
-- Each query's expected value is a hand-computed oracle from source_data.sql
-- (full derivation in ETL_EXPECTED_RESULTS.md). All checks should return the noted value;
-- the "must be 0" checks are integrity assertions.

-- 1. Row counts ------------------------------------------------------------------
SELECT 'dim_customer' AS t, COUNT(*) AS n FROM dim_customer   -- expect 4
UNION ALL SELECT 'dim_product', COUNT(*) FROM dim_product     -- expect 3
UNION ALL SELECT 'fact_sales',  COUNT(*) FROM fact_sales;     -- expect 6

-- 2. Cancelled orders excluded (expect 0) ----------------------------------------
SELECT COUNT(*) AS cancelled_leaked
FROM fact_sales f JOIN orders o ON o.order_id = f.order_id
WHERE o.status = 'cancelled';

-- 3. fact_sales PK uniqueness (expect 0) -----------------------------------------
SELECT COUNT(*) - COUNT(DISTINCT order_item_id) AS dup_pk FROM fact_sales;

-- 4. line_amount correctness (expect 0 mismatches) -------------------------------
SELECT COUNT(*) AS bad_line_amount
FROM fact_sales
WHERE line_amount <> ROUND(quantity * unit_price, 2);

-- 5. Grand total line_amount (expect 157.92) -------------------------------------
SELECT ROUND(SUM(line_amount), 2) AS total_line_amount FROM fact_sales;

-- 6. Referential integrity: every fact FK resolves in the dims (expect 0) --------
SELECT COUNT(*) AS orphan_customer
FROM fact_sales f LEFT JOIN dim_customer c ON c.customer_id = f.customer_id
WHERE c.customer_id IS NULL;
SELECT COUNT(*) AS orphan_product
FROM fact_sales f LEFT JOIN dim_product p ON p.product_id = f.product_id
WHERE p.product_id IS NULL;

-- 7. Sales by customer (oracle: cust 1 = 97.98, cust 2 = 49.95, cust 4 = 9.99) ---
SELECT customer_id, ROUND(SUM(line_amount), 2) AS sales
FROM fact_sales GROUP BY customer_id ORDER BY customer_id;

-- 8. Null handling preserved in dim (expect email IS NULL for customer 4) --------
SELECT customer_id, email FROM dim_customer WHERE customer_id = 4;  -- email expected NULL
