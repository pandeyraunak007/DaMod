# ETL Expected Results (independent oracle)

All values are derived **by hand** from `fixtures/source_data.sql`, independent of DaMod,
so they serve as a trustworthy test oracle. Run `fixtures/verify.sql` against the target
tables (populated by DaMod's generated SQL in an external Postgres) to confirm.

## Source record counts
- customers: **4** · products: **3** · orders: **5** (100,101,102,103,104) · order_items: **7** (1000–1006)

## Derivation of `fact_sales` (line grain, cancelled excluded)

Cancelled orders = {102}. Its item 1003 is excluded. Remaining non-cancelled items:

| item | order | status | customer | product | qty | unit_price | line_amount = round(qty×price,2) |
|---|---|---|---|---|---|---|---|
| 1000 | 100 | shipped | 1 | 10 | 2 | 9.99 | 19.98 |
| 1001 | 100 | shipped | 1 | 20 | 1 | 19.50 | 19.50 |
| 1002 | 101 | shipped | 2 | 10 | 5 | 9.99 | 49.95 |
| 1004 | 103 | shipped | 1 | 20 | 3 | 19.50 | 58.50 |
| 1005 | 104 | pending | 4 | 10 | 1 | 9.99 | 9.99 |
| 1006 | 103 | shipped | 1 | 30 | 10 | 0.00 | 0.00 |

- **fact_sales rows = 6**
- **SUM(line_amount) = 19.98 + 19.50 + 49.95 + 58.50 + 9.99 + 0.00 = 157.92**

## Sales by customer (verify.sql #7 — a check on the fact, not a pipeline output)
- customer 1 (items 1000,1001,1004,1006): 19.98+19.50+58.50+0.00 = **97.98**
- customer 2 (item 1002): **49.95**
- customer 4 (item 1005): **9.99**
- customer 3: only cancelled order 102 → **0 rows** (absent)
- Cross-check: 97.98 + 49.95 + 9.99 = **157.92** ✓ (= grand total)

## dim_customer (4 rows)
| customer_id | name | email | country |
|---|---|---|---|
| 1 | Ada Lovelace | ada@x.test | UK |
| 2 | Alan Turing | alan@x.test | UK |
| 3 | Grace Hopper | grace@x.test | US |
| 4 | Katherine J | **NULL** | US |

## dim_product (3 rows)
| product_id | sku | name | unit_price | category |
|---|---|---|---|---|
| 10 | SKU-A | Widget | 9.99 | Hardware |
| 20 | SKU-B | Gadget | 19.50 | Hardware |
| 30 | SKU-C | Manual | **0.00** | Docs |

## Integrity assertions (all must hold)
- fact_sales PK `order_item_id` unique (6 distinct).
- No fact row joins to a cancelled order (verify.sql #2 → 0).
- `line_amount = round(quantity*unit_price,2)` for every row (verify.sql #4 → 0).
- Every fact `customer_id`/`product_id` resolves in the dims (verify.sql #6 → 0).
- dim_customer customer 4 email IS NULL (null handling preserved).

## Expected DaMod-generated artifacts (design-time, not executed)

**Graph SQL for fact_sales** (shape — exact text is produced by the Designer's SQL toggle /
PipelineDialog SQL tab; dialect = the source model's). Representative Postgres form:

```sql
WITH "order_items" AS (SELECT * FROM "order_items"),
     "orders"      AS (SELECT * FROM "orders"),
     "<join>"      AS (SELECT "order_items".*, "orders".* FROM "order_items"
                        INNER JOIN "orders" ON "order_items"."order_id" = "orders"."order_id"),
     "<filter>"    AS (SELECT * FROM "<join>" WHERE "status" != 'cancelled'),
     "<derive>"    AS (SELECT *, "quantity" * "unit_price" AS "line_amount" FROM "<filter>"),
     "<select>"    AS (SELECT "order_item_id","order_id","customer_id","product_id",
                              "order_date","quantity","unit_price","line_amount" FROM "<derive>"),
     "fact_sales"  AS (SELECT * FROM "<select>")
SELECT * FROM "fact_sales";
```
(CTE names are the node ids; `!=` is emitted verbatim from the filter op. Verify the
JOIN/WHERE/derive/column-list match the mapping spec — the row-level oracle above confirms
correctness once executed externally.)

**Target DDL**: equivalent to `fixtures/target_schema.expected.sql`.
