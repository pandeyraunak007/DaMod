-- ============================================================
-- ENTERPRISE RETAIL & ORDER MANAGEMENT
-- Database: PostgreSQL
-- Purpose: Data modeling, reverse engineering, ETL design
-- ============================================================

CREATE SCHEMA IF NOT EXISTS retail;
CREATE SCHEMA IF NOT EXISTS inventory;
CREATE SCHEMA IF NOT EXISTS fulfillment;
CREATE SCHEMA IF NOT EXISTS finance;

-- ============================================================
-- 1. CUSTOMER MANAGEMENT
-- ============================================================

CREATE TABLE retail.customers (
    customer_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    customer_number VARCHAR(30) NOT NULL UNIQUE,
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    email VARCHAR(255),
    phone VARCHAR(30),
    customer_type VARCHAR(20) NOT NULL DEFAULT 'INDIVIDUAL',
    date_of_birth DATE,
    status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT chk_customer_type
        CHECK (customer_type IN ('INDIVIDUAL', 'BUSINESS')),

    CONSTRAINT chk_customer_status
        CHECK (status IN ('ACTIVE', 'INACTIVE', 'BLOCKED')),

    CONSTRAINT chk_customer_email
        CHECK (email IS NULL OR POSITION('@' IN email) > 1)
);

CREATE TABLE retail.customer_addresses (
    address_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    customer_id BIGINT NOT NULL,
    address_type VARCHAR(20) NOT NULL,
    address_line1 VARCHAR(200) NOT NULL,
    address_line2 VARCHAR(200),
    city VARCHAR(100) NOT NULL,
    state_province VARCHAR(100),
    postal_code VARCHAR(20),
    country_code CHAR(2) NOT NULL,
    is_default BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_address_customer
        FOREIGN KEY (customer_id)
        REFERENCES retail.customers(customer_id)
        ON DELETE CASCADE,

    CONSTRAINT chk_address_type
        CHECK (address_type IN ('BILLING', 'SHIPPING', 'BOTH'))
);

CREATE TABLE retail.customer_segments (
    segment_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    segment_code VARCHAR(30) NOT NULL UNIQUE,
    segment_name VARCHAR(100) NOT NULL,
    description TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE retail.customer_segment_memberships (
    customer_id BIGINT NOT NULL,
    segment_id BIGINT NOT NULL,
    assigned_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMPTZ,

    CONSTRAINT pk_customer_segment_memberships
        PRIMARY KEY (customer_id, segment_id),

    CONSTRAINT fk_membership_customer
        FOREIGN KEY (customer_id)
        REFERENCES retail.customers(customer_id)
        ON DELETE CASCADE,

    CONSTRAINT fk_membership_segment
        FOREIGN KEY (segment_id)
        REFERENCES retail.customer_segments(segment_id),

    CONSTRAINT chk_membership_dates
        CHECK (expires_at IS NULL OR expires_at > assigned_at)
);

-- ============================================================
-- 2. PRODUCT CATALOG
-- ============================================================

CREATE TABLE retail.product_categories (
    category_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    parent_category_id BIGINT,
    category_code VARCHAR(30) NOT NULL UNIQUE,
    category_name VARCHAR(100) NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,

    CONSTRAINT fk_category_parent
        FOREIGN KEY (parent_category_id)
        REFERENCES retail.product_categories(category_id)
);

CREATE TABLE retail.products (
    product_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    sku VARCHAR(40) NOT NULL UNIQUE,
    product_name VARCHAR(200) NOT NULL,
    description TEXT,
    category_id BIGINT,
    brand VARCHAR(100),
    product_type VARCHAR(20) NOT NULL DEFAULT 'PHYSICAL',
    unit_price NUMERIC(14,2) NOT NULL,
    currency_code CHAR(3) NOT NULL DEFAULT 'USD',
    tax_rate NUMERIC(7,4) NOT NULL DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_product_category
        FOREIGN KEY (category_id)
        REFERENCES retail.product_categories(category_id),

    CONSTRAINT chk_product_type
        CHECK (product_type IN ('PHYSICAL', 'DIGITAL', 'SERVICE')),

    CONSTRAINT chk_product_price
        CHECK (unit_price >= 0),

    CONSTRAINT chk_product_tax
        CHECK (tax_rate >= 0 AND tax_rate <= 1)
);

CREATE TABLE retail.product_attributes (
    product_id BIGINT NOT NULL,
    attribute_name VARCHAR(100) NOT NULL,
    attribute_value TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT pk_product_attributes
        PRIMARY KEY (product_id, attribute_name),

    CONSTRAINT fk_attribute_product
        FOREIGN KEY (product_id)
        REFERENCES retail.products(product_id)
        ON DELETE CASCADE
);

-- ============================================================
-- 3. SUPPLIER AND PROCUREMENT
-- ============================================================

CREATE TABLE inventory.suppliers (
    supplier_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    supplier_code VARCHAR(30) NOT NULL UNIQUE,
    supplier_name VARCHAR(200) NOT NULL,
    email VARCHAR(255),
    country_code CHAR(2) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT chk_supplier_status
        CHECK (status IN ('ACTIVE', 'INACTIVE', 'BLOCKED'))
);

CREATE TABLE inventory.product_suppliers (
    product_id BIGINT NOT NULL,
    supplier_id BIGINT NOT NULL,
    supplier_sku VARCHAR(50),
    cost_price NUMERIC(14,2) NOT NULL,
    lead_time_days INTEGER NOT NULL DEFAULT 0,
    is_preferred BOOLEAN NOT NULL DEFAULT FALSE,

    CONSTRAINT pk_product_suppliers
        PRIMARY KEY (product_id, supplier_id),

    CONSTRAINT fk_ps_product
        FOREIGN KEY (product_id)
        REFERENCES retail.products(product_id),

    CONSTRAINT fk_ps_supplier
        FOREIGN KEY (supplier_id)
        REFERENCES inventory.suppliers(supplier_id),

    CONSTRAINT chk_supplier_cost
        CHECK (cost_price >= 0),

    CONSTRAINT chk_supplier_lead_time
        CHECK (lead_time_days >= 0)
);

-- ============================================================
-- 4. ORDER MANAGEMENT
-- ============================================================

CREATE TABLE retail.orders (
    order_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    order_number VARCHAR(40) NOT NULL UNIQUE,
    customer_id BIGINT NOT NULL,
    billing_address_id BIGINT,
    shipping_address_id BIGINT,
    order_date TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    order_status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    currency_code CHAR(3) NOT NULL DEFAULT 'USD',
    subtotal NUMERIC(14,2) NOT NULL DEFAULT 0,
    discount_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
    tax_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
    shipping_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
    total_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_order_customer
        FOREIGN KEY (customer_id)
        REFERENCES retail.customers(customer_id),

    CONSTRAINT fk_order_billing_address
        FOREIGN KEY (billing_address_id)
        REFERENCES retail.customer_addresses(address_id)
        ON DELETE SET NULL,

    CONSTRAINT fk_order_shipping_address
        FOREIGN KEY (shipping_address_id)
        REFERENCES retail.customer_addresses(address_id)
        ON DELETE SET NULL,

    CONSTRAINT chk_order_status
        CHECK (order_status IN (
            'PENDING', 'CONFIRMED', 'PROCESSING',
            'SHIPPED', 'DELIVERED', 'CANCELLED', 'RETURNED'
        )),

    CONSTRAINT chk_order_amounts
        CHECK (
            subtotal >= 0
            AND discount_amount >= 0
            AND tax_amount >= 0
            AND shipping_amount >= 0
            AND total_amount >= 0
        )
);

CREATE TABLE retail.order_items (
    order_item_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    order_id BIGINT NOT NULL,
    product_id BIGINT NOT NULL,
    line_number INTEGER NOT NULL,
    quantity INTEGER NOT NULL,
    unit_price NUMERIC(14,2) NOT NULL,
    discount_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
    tax_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
    line_total NUMERIC(14,2) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_item_order
        FOREIGN KEY (order_id)
        REFERENCES retail.orders(order_id)
        ON DELETE CASCADE,

    CONSTRAINT fk_item_product
        FOREIGN KEY (product_id)
        REFERENCES retail.products(product_id),

    CONSTRAINT uq_order_line
        UNIQUE (order_id, line_number),

    CONSTRAINT chk_order_item_quantity
        CHECK (quantity > 0),

    CONSTRAINT chk_order_item_amounts
        CHECK (
            unit_price >= 0
            AND discount_amount >= 0
            AND tax_amount >= 0
            AND line_total >= 0
        )
);

CREATE TABLE retail.order_status_history (
    status_history_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    order_id BIGINT NOT NULL,
    previous_status VARCHAR(20),
    new_status VARCHAR(20) NOT NULL,
    changed_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    changed_by VARCHAR(100),
    change_reason TEXT,

    CONSTRAINT fk_status_history_order
        FOREIGN KEY (order_id)
        REFERENCES retail.orders(order_id)
        ON DELETE CASCADE
);

-- ============================================================
-- 5. INVENTORY AND FULFILLMENT
-- ============================================================

CREATE TABLE inventory.warehouses (
    warehouse_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    warehouse_code VARCHAR(30) NOT NULL UNIQUE,
    warehouse_name VARCHAR(150) NOT NULL,
    country_code CHAR(2) NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE inventory.stock_levels (
    warehouse_id BIGINT NOT NULL,
    product_id BIGINT NOT NULL,
    quantity_on_hand INTEGER NOT NULL DEFAULT 0,
    quantity_reserved INTEGER NOT NULL DEFAULT 0,
    reorder_level INTEGER NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT pk_stock_levels
        PRIMARY KEY (warehouse_id, product_id),

    CONSTRAINT fk_stock_warehouse
        FOREIGN KEY (warehouse_id)
        REFERENCES inventory.warehouses(warehouse_id),

    CONSTRAINT fk_stock_product
        FOREIGN KEY (product_id)
        REFERENCES retail.products(product_id),

    CONSTRAINT chk_stock_quantities
        CHECK (
            quantity_on_hand >= 0
            AND quantity_reserved >= 0
            AND quantity_reserved <= quantity_on_hand
            AND reorder_level >= 0
        )
);

CREATE TABLE fulfillment.shipments (
    shipment_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    order_id BIGINT NOT NULL,
    warehouse_id BIGINT,
    tracking_number VARCHAR(100) UNIQUE,
    carrier VARCHAR(100),
    shipment_status VARCHAR(20) NOT NULL DEFAULT 'CREATED',
    shipped_at TIMESTAMPTZ,
    delivered_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_shipment_order
        FOREIGN KEY (order_id)
        REFERENCES retail.orders(order_id),

    CONSTRAINT fk_shipment_warehouse
        FOREIGN KEY (warehouse_id)
        REFERENCES inventory.warehouses(warehouse_id),

    CONSTRAINT chk_shipment_status
        CHECK (shipment_status IN (
            'CREATED', 'PICKING', 'SHIPPED',
            'DELIVERED', 'FAILED', 'CANCELLED'
        )),

    CONSTRAINT chk_shipment_dates
        CHECK (
            delivered_at IS NULL
            OR shipped_at IS NULL
            OR delivered_at >= shipped_at
        )
);

CREATE TABLE fulfillment.shipment_items (
    shipment_id BIGINT NOT NULL,
    order_item_id BIGINT NOT NULL,
    quantity_shipped INTEGER NOT NULL,

    CONSTRAINT pk_shipment_items
        PRIMARY KEY (shipment_id, order_item_id),

    CONSTRAINT fk_si_shipment
        FOREIGN KEY (shipment_id)
        REFERENCES fulfillment.shipments(shipment_id)
        ON DELETE CASCADE,

    CONSTRAINT fk_si_order_item
        FOREIGN KEY (order_item_id)
        REFERENCES retail.order_items(order_item_id),

    CONSTRAINT chk_quantity_shipped
        CHECK (quantity_shipped > 0)
);

-- ============================================================
-- 6. FINANCE AND PAYMENTS
-- ============================================================

CREATE TABLE finance.payments (
    payment_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    order_id BIGINT NOT NULL,
    payment_reference VARCHAR(100) NOT NULL UNIQUE,
    payment_method VARCHAR(30) NOT NULL,
    payment_status VARCHAR(20) NOT NULL DEFAULT 'INITIATED',
    amount NUMERIC(14,2) NOT NULL,
    currency_code CHAR(3) NOT NULL,
    paid_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_payment_order
        FOREIGN KEY (order_id)
        REFERENCES retail.orders(order_id),

    CONSTRAINT chk_payment_method
        CHECK (payment_method IN (
            'CARD', 'BANK_TRANSFER', 'WALLET', 'CASH'
        )),

    CONSTRAINT chk_payment_status
        CHECK (payment_status IN (
            'INITIATED', 'AUTHORIZED', 'CAPTURED',
            'FAILED', 'REFUNDED', 'CANCELLED'
        )),

    CONSTRAINT chk_payment_amount
        CHECK (amount > 0)
);

CREATE TABLE finance.refunds (
    refund_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    payment_id BIGINT NOT NULL,
    refund_reference VARCHAR(100) NOT NULL UNIQUE,
    amount NUMERIC(14,2) NOT NULL,
    refund_status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    requested_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMPTZ,
    reason TEXT,

    CONSTRAINT fk_refund_payment
        FOREIGN KEY (payment_id)
        REFERENCES finance.payments(payment_id),

    CONSTRAINT chk_refund_amount
        CHECK (amount > 0),

    CONSTRAINT chk_refund_status
        CHECK (refund_status IN (
            'PENDING', 'APPROVED', 'COMPLETED', 'REJECTED'
        ))
);

-- ============================================================
-- 7. AUDIT AND ETL CONTROL
-- ============================================================

CREATE TABLE retail.etl_batch_audit (
    batch_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    pipeline_name VARCHAR(150) NOT NULL,
    source_system VARCHAR(100) NOT NULL,
    target_system VARCHAR(100) NOT NULL,
    started_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMPTZ,
    batch_status VARCHAR(20) NOT NULL DEFAULT 'RUNNING',
    rows_read BIGINT NOT NULL DEFAULT 0,
    rows_inserted BIGINT NOT NULL DEFAULT 0,
    rows_updated BIGINT NOT NULL DEFAULT 0,
    rows_rejected BIGINT NOT NULL DEFAULT 0,
    error_message TEXT,

    CONSTRAINT chk_batch_status
        CHECK (batch_status IN (
            'RUNNING', 'SUCCEEDED', 'FAILED', 'PARTIAL'
        )),

    CONSTRAINT chk_batch_row_counts
        CHECK (
            rows_read >= 0
            AND rows_inserted >= 0
            AND rows_updated >= 0
            AND rows_rejected >= 0
        )
);

-- ============================================================
-- 8. INDEXES
-- ============================================================

CREATE INDEX idx_customers_email
    ON retail.customers(email);

CREATE INDEX idx_customer_addresses_customer
    ON retail.customer_addresses(customer_id);

CREATE INDEX idx_products_category
    ON retail.products(category_id);

CREATE INDEX idx_products_active_category
    ON retail.products(category_id, product_id)
    WHERE is_active = TRUE;

CREATE INDEX idx_orders_customer_date
    ON retail.orders(customer_id, order_date DESC);

CREATE INDEX idx_orders_status_date
    ON retail.orders(order_status, order_date);

CREATE INDEX idx_order_items_product
    ON retail.order_items(product_id);

CREATE INDEX idx_order_status_history_order_date
    ON retail.order_status_history(order_id, changed_at DESC);

CREATE INDEX idx_stock_levels_product
    ON inventory.stock_levels(product_id);

CREATE INDEX idx_shipments_order_status
    ON fulfillment.shipments(order_id, shipment_status);

CREATE INDEX idx_payments_order_status
    ON finance.payments(order_id, payment_status);

CREATE INDEX idx_etl_batch_pipeline_started
    ON retail.etl_batch_audit(pipeline_name, started_at DESC);

-- ============================================================
-- 9. REPORTING VIEW
-- ============================================================

CREATE VIEW retail.vw_order_sales AS
SELECT
    o.order_id,
    o.order_number,
    o.order_date,
    o.order_status,
    c.customer_id,
    c.customer_number,
    c.country_code AS customer_country,
    oi.order_item_id,
    p.product_id,
    p.sku,
    p.product_name,
    pc.category_name,
    oi.quantity,
    oi.unit_price,
    oi.discount_amount,
    oi.tax_amount,
    oi.line_total,
    o.currency_code
FROM retail.orders o
JOIN retail.customers c
    ON c.customer_id = o.customer_id
JOIN retail.order_items oi
    ON oi.order_id = o.order_id
JOIN retail.products p
    ON p.product_id = oi.product_id
LEFT JOIN retail.product_categories pc
    ON pc.category_id = p.category_id;

-- ============================================================
-- END OF SCHEMA
-- ============================================================