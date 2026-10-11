# ETL Source-to-Target Mapping Specification

The test oracle for mappings/transforms. Every row is achievable **at design time** in the
DaMod Designer using implemented node kinds (source/filter/select/derive/cast/join/target).
Expected output values are computed from `fixtures/source_data.sql`.

Grain note: `fact_sales` is **line grain** (one row per non-cancelled `order_item`). No
aggregation is used (DaMod has no aggregate node — G-AGG). Each target below is one
target node in a single pipeline's DAG; `graphSql` emits one `WITH`-chain per target.

## Target: `dim_customer`  (DAG: source `customers` → target `dim_customer`)

| Target column | Source | Transform | Target type | Null handling | Req? | Validation | Expected (sample) |
|---|---|---|---|---|---|---|---|
| customer_id | customers.customer_id | identity | integer | n/a (PK) | yes | PK unique | 1,2,3,4 |
| name | customers.name | identity | varchar(100) | NOT NULL in source | yes | — | Ada…,Katherine J |
| email | customers.email | identity | varchar(200) | **passes NULL through** | no | — | cust 4 = NULL |
| country | customers.country | identity | varchar(2) | NOT NULL | yes | — | UK,UK,US,US |

Result: **4 rows**, customer 4's email NULL preserved.

## Target: `dim_product`  (DAG: source `products` → target `dim_product`)

| Target column | Source | Transform | Target type | Req? | Expected |
|---|---|---|---|---|---|
| product_id | products.product_id | identity | integer | yes | 10,20,30 |
| sku | products.sku | identity | varchar(20) | yes | SKU-A/B/C |
| name | products.name | identity | varchar(100) | yes | Widget/Gadget/Manual |
| unit_price | products.unit_price | identity | numeric(12,2) | yes | 9.99,19.50,**0.00** |
| category | products.category | identity | varchar(40) | no | Hardware/Docs |

Result: **3 rows**, product 30 price 0.00 preserved.

## Target: `fact_sales`  (DAG below)

DAG: `source order_items` ─┐
`source orders` ──────────┘→ **join**(inner, order_items.order_id = orders.order_id)
→ **filter**(orders.status != 'cancelled')
→ **derive**(line_amount = quantity * unit_price, numeric(12,2))
→ **select**(keep the fact columns)
→ **target fact_sales**

| Target column | Source object.column | Transform | Target type | Null | Req? | Validation | Expected notes |
|---|---|---|---|---|---|---|---|
| order_item_id | order_items.order_item_id | identity | integer | n/a | yes | PK unique | 6 rows (1003 excluded) |
| order_id | order_items.order_id | identity | integer | — | yes | FK→orders | |
| customer_id | orders.customer_id (via join) | identity | integer | — | yes | FK→dim_customer | from joined orders |
| product_id | order_items.product_id | identity | integer | — | yes | FK→dim_product | |
| order_date | orders.order_date (via join) | identity | date | — | yes | — | |
| quantity | order_items.quantity | identity | integer | — | yes | — | |
| unit_price | order_items.unit_price | identity | numeric(12,2) | — | yes | — | sale-time price |
| line_amount | quantity, unit_price | **derive**: `quantity * unit_price` | numeric(12,2) | — | yes | = round(q*price,2) | see below |

**Filter:** `status <> 'cancelled'` on the joined `orders` → excludes order 102 (item 1003).

### Expected `fact_sales` rows (6)

| order_item_id | order_id | customer_id | product_id | order_date | quantity | unit_price | line_amount |
|---|---|---|---|---|---|---|---|
| 1000 | 100 | 1 | 10 | 2026-01-02 | 2 | 9.99 | **19.98** |
| 1001 | 100 | 1 | 20 | 2026-01-02 | 1 | 19.50 | **19.50** |
| 1002 | 101 | 2 | 10 | 2026-01-03 | 5 | 9.99 | **49.95** |
| 1004 | 103 | 1 | 20 | 2026-01-05 | 3 | 19.50 | **58.50** |
| 1005 | 104 | 4 | 10 | 2026-01-06 | 1 | 9.99 | **9.99** |
| 1006 | 103 | 1 | 30 | 2026-01-05 | 10 | 0.00 | **0.00** |

Grand total `line_amount` = **157.92**. (Order 102 / item 1003 excluded by the filter.)

## In-app configuration (per node, Designer right panel = NodeInspector)

- **source**: pick the source object from the dropdown (e.g. `order_items`).
- **join**: set kind (inner); add a key row `order_id = order_id`; wire the two upstream
  sources to the join's **left** and **right** ports (connect left first, then right).
- **filter**: add a row `status` `!=` `cancelled`.
- **derive**: add a column `line_amount`, expression `quantity * unit_price`, type decimal.
- **select**: tick the columns to keep; add renames if needed.
- **cast** (optional): change a column's type (e.g. widen unit_price) — not required here.
- **target**: set `targetObject` = `fact_sales` (or `dim_customer`/`dim_product`).

> Mapping vs. proof: this table is the **expected product behavior / test oracle**. The
> implemented path is the Designer DAG + `MappingEditor` for flat column edits. It is NOT
> a claim that a one-click "auto-map by name across joined tables" feature exists.
