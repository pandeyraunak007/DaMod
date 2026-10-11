#!/usr/bin/env python3
"""Generate DaMod_ETL_Designer_E2E_Handbook.pdf (ReportLab).

Grounded in the current repo: ETL Designer with source/filter/select/derive/cast/join/
aggregate/distinct/target nodes, schema propagation, graph+flat SQL, graph+flat target
DDL, validation, v2 persistence. Execution is EXTERNAL (connectors metadata-only).
A documentation generator under docs/etl_e2e/ — not application source.
"""
import os, re
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import cm
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.platypus import (
    BaseDocTemplate, PageTemplate, Frame, Paragraph, Spacer, Table, TableStyle,
    PageBreak, Preformatted, KeepTogether, Flowable, ListFlowable, ListItem, NextPageTemplate,
)
from reportlab.platypus.tableofcontents import TableOfContents
from reportlab.graphics.shapes import Drawing, Rect, String, Line, Polygon
import math

OUT = os.path.join(os.path.dirname(__file__), "DaMod_ETL_Designer_E2E_Handbook.pdf")
VERSION, PREPARED = "1.0", "2026-10-11"

NAVY = colors.HexColor("#1e3a5f"); BLUE = colors.HexColor("#2563eb"); SOFT = colors.HexColor("#e8eef7")
GREEN = colors.HexColor("#1b7f4b"); GREENBG = colors.HexColor("#e6f4ea")
AMBER = colors.HexColor("#8a5a00"); AMBERBG = colors.HexColor("#fff4e0")
RED = colors.HexColor("#9a2b2b"); REDBG = colors.HexColor("#fdecec")
GREY = colors.HexColor("#f4f6f8"); LINE = colors.HexColor("#c9d4e2"); CODEBG = colors.HexColor("#f5f7fa")

ss = getSampleStyleSheet()
styles = {
    "Body": ParagraphStyle("Body", fontName="Helvetica", fontSize=9.5, leading=13.5, spaceAfter=6),
    "Cell": ParagraphStyle("Cell", fontName="Helvetica", fontSize=7.8, leading=10),
    "CellB": ParagraphStyle("CellB", fontName="Helvetica-Bold", fontSize=7.8, leading=10, textColor=colors.white),
    "H1": ParagraphStyle("H1", fontName="Helvetica-Bold", fontSize=18, leading=22, textColor=NAVY, spaceAfter=8),
    "H2": ParagraphStyle("H2", fontName="Helvetica-Bold", fontSize=12.5, leading=16, textColor=BLUE, spaceBefore=10, spaceAfter=4),
    "Code": ParagraphStyle("Code", fontName="Courier", fontSize=7.6, leading=9.6),
    "Bullet": ParagraphStyle("Bullet", fontName="Helvetica", fontSize=9.5, leading=13, spaceAfter=2),
    "TOC1": ParagraphStyle("TOC1", fontName="Helvetica-Bold", fontSize=10.5, leading=16, textColor=NAVY),
    "TOC2": ParagraphStyle("TOC2", fontName="Helvetica", fontSize=9.5, leading=13.5, leftIndent=14),
    "CT": ParagraphStyle("CT", fontName="Helvetica-Bold", fontSize=30, leading=36, textColor=NAVY, alignment=TA_CENTER),
    "CS": ParagraphStyle("CS", fontName="Helvetica", fontSize=16, leading=22, textColor=BLUE, alignment=TA_CENTER),
    "CM": ParagraphStyle("CM", fontName="Helvetica", fontSize=10.5, leading=16, textColor=colors.HexColor("#444"), alignment=TA_CENTER),
}
_state = {"chapter": ""}

class HR(Flowable):
    def __init__(self, w=None, color=LINE, th=1.2): super().__init__(); self.w=w; self.c=color; self.th=th
    def wrap(self, aw, ah): self.width = self.w or aw; return (self.width, self.th + 6)
    def draw(self): self.canv.setStrokeColor(self.c); self.canv.setLineWidth(self.th); self.canv.line(0, 3, self.width, 3)

class Handbook(BaseDocTemplate):
    def __init__(self, path):
        super().__init__(path, pagesize=A4, title="DaMod ETL Designer E2E Handbook", author="DaMod",
                         leftMargin=2*cm, rightMargin=2*cm, topMargin=2.1*cm, bottomMargin=1.8*cm)
        frame = Frame(self.leftMargin, self.bottomMargin, self.width, self.height, id="m")
        self.addPageTemplates([
            PageTemplate(id="cover", frames=[frame], onPage=lambda c, d: None),
            PageTemplate(id="body", frames=[frame], onPage=_decorate),
        ])
        self._key = 0
    def afterFlowable(self, flow):
        if flow.__class__.__name__ != "Paragraph": return
        if flow.style.name not in ("H1", "H2"): return
        text = flow.getPlainText()
        key = "h_" + re.sub(r"[^A-Za-z0-9]", "", text)[:40]  # deterministic → TOC converges
        self.canv.bookmarkPage(key)
        lvl = 0 if flow.style.name == "H1" else 1
        self.canv.addOutlineEntry(text, key, lvl, 0)  # H1+H2 in the PDF bookmark pane
        if flow.style.name == "H1":                    # only chapters in the printed TOC (stable)
            self.notify("TOCEntry", (0, text, self.page, key))
            _state["chapter"] = text

def _decorate(canvas, doc):
    canvas.saveState(); canvas.setFont("Helvetica", 7.5); canvas.setFillColor(colors.HexColor("#6b7a8d"))
    canvas.drawString(2*cm, A4[1]-1.35*cm, "DaMod — ETL Designer · End-to-End Handbook")
    canvas.drawRightString(A4[0]-2*cm, A4[1]-1.35*cm, _state["chapter"][:58])
    canvas.setStrokeColor(LINE); canvas.setLineWidth(0.5)
    canvas.line(2*cm, A4[1]-1.5*cm, A4[0]-2*cm, A4[1]-1.5*cm)
    canvas.line(2*cm, 1.45*cm, A4[0]-2*cm, 1.45*cm)
    canvas.drawString(2*cm, 1.15*cm, "v%s · %s" % (VERSION, PREPARED))
    canvas.drawCentredString(A4[0]/2, 1.15*cm, "Page %d" % doc.page)
    canvas.drawRightString(A4[0]-2*cm, 1.15*cm, "Synthetic data · design-time guide")
    canvas.restoreState()

story = []
CW = A4[0] - 4*cm

def h1(t): story.append(PageBreak()); story.append(Paragraph(t, styles["H1"])); story.append(HR())
def h2(t): story.append(Paragraph(t, styles["H2"]))
def p(t): story.append(Paragraph(t, styles["Body"]))
def sp(h=4): story.append(Spacer(1, h))
def bullets(items): story.append(ListFlowable([ListItem(Paragraph(x, styles["Bullet"]), leftIndent=10, value="•") for x in items], bulletType="bullet", leftIndent=12)); sp(4)
def steps(items): story.append(ListFlowable([ListItem(Paragraph(x, styles["Bullet"]), leftIndent=12) for x in items], bulletType="1", leftIndent=16)); sp(4)

def code(txt):
    flow = Preformatted(txt.strip("\n"), styles["Code"])
    box = Table([[flow]], colWidths=[CW])
    box.setStyle(TableStyle([("BACKGROUND", (0,0),(-1,-1), CODEBG), ("BOX",(0,0),(-1,-1),0.5,LINE),
        ("LEFTPADDING",(0,0),(-1,-1),6),("RIGHTPADDING",(0,0),(-1,-1),6),
        ("TOPPADDING",(0,0),(-1,-1),5),("BOTTOMPADDING",(0,0),(-1,-1),5)]))
    story.append(KeepTogether(box)); sp(6)

def callout(kind, text):
    cfg = {"warn":(AMBER,AMBERBG,"⚠ LIMITATION"),"block":(RED,REDBG,"⛔ BLOCKED / PRODUCT GAP"),
           "note":(BLUE,SOFT,"ℹ NOTE"),"ok":(GREEN,GREENBG,"✓ RUNNABLE IN DAMOD TODAY")}
    bar, bg, label = cfg[kind]
    inner = [Paragraph("<b>%s</b>" % label, ParagraphStyle("cl", fontName="Helvetica-Bold", fontSize=8.5, textColor=bar, leading=11)),
             Paragraph(text, ParagraphStyle("cb", fontName="Helvetica", fontSize=9, leading=12.5))]
    t = Table([[inner]], colWidths=[CW])
    t.setStyle(TableStyle([("BACKGROUND",(0,0),(-1,-1),bg),("LINEBEFORE",(0,0),(0,-1),3,bar),("BOX",(0,0),(-1,-1),0.4,bar),
        ("LEFTPADDING",(0,0),(-1,-1),8),("RIGHTPADDING",(0,0),(-1,-1),8),("TOPPADDING",(0,0),(-1,-1),5),("BOTTOMPADDING",(0,0),(-1,-1),6)]))
    story.append(KeepTogether(t)); sp(6)

def table(headers, rows, widths):
    def mk(x, st): return x if isinstance(x, Flowable) else Paragraph(str(x), styles[st])
    data = [[mk(h, "CellB") for h in headers]] + [[mk(c, "Cell") for c in r] for r in rows]
    t = Table(data, colWidths=widths, repeatRows=1, splitByRow=1)
    s = [("BACKGROUND",(0,0),(-1,0),NAVY),("GRID",(0,0),(-1,-1),0.4,LINE),("VALIGN",(0,0),(-1,-1),"TOP"),
         ("LEFTPADDING",(0,0),(-1,-1),4),("RIGHTPADDING",(0,0),(-1,-1),4),("TOPPADDING",(0,0),(-1,-1),3),("BOTTOMPADDING",(0,0),(-1,-1),3)]
    for i in range(2, len(data), 2): s.append(("BACKGROUND",(0,i),(-1,i),GREY))
    t.setStyle(TableStyle(s)); story.append(t); sp(8)

def _box(d, x, y, w, h, label, fill, stroke=NAVY, tc=colors.white, fs=8):
    d.add(Rect(x, y, w, h, fillColor=fill, strokeColor=stroke, strokeWidth=0.8, rx=4, ry=4))
    ls = label.split("\n")
    for i, ln in enumerate(ls):
        d.add(String(x+w/2, y+h/2+3-i*9+(len(ls)-1)*4.5, ln, textAnchor="middle", fontName="Helvetica-Bold", fontSize=fs, fillColor=tc))

def _arrow(d, x1, y1, x2, y2):
    d.add(Line(x1, y1, x2, y2, strokeColor=colors.HexColor("#5b6b7d"), strokeWidth=1))
    a = math.atan2(y2-y1, x2-x1); s = 5
    d.add(Polygon([x2, y2, x2-s*math.cos(a-0.5), y2-s*math.sin(a-0.5), x2-s*math.cos(a+0.5), y2-s*math.sin(a+0.5)],
                  fillColor=colors.HexColor("#5b6b7d"), strokeColor=colors.HexColor("#5b6b7d")))

def architecture_diagram():
    d = Drawing(CW, 250)
    _box(d, 10, 205, 150, 38, "Modeling engine\n(models·domains·standards)", BLUE, fs=7.5)
    _box(d, 180, 205, 140, 38, "Connectors\n(metadata discovery only)", BLUE, fs=7.5)
    _box(d, 340, 205, 130, 38, "Snapshots / drift", BLUE, fs=7.5)
    _box(d, 120, 140, 240, 34, "Pipeline spec v2 — flat objects + transform DAG", NAVY)
    _box(d, 10, 78, 100, 36, "Schema\npropagation", GREEN, fs=7.5)
    _box(d, 125, 78, 95, 36, "Validation", GREEN, fs=7.5)
    _box(d, 235, 78, 115, 36, "SQL + target DDL\ngeneration", GREEN, fs=7.5)
    _box(d, 365, 78, 105, 36, "ETL Designer\ncanvas (UI)", GREEN, fs=7.5)
    _box(d, 55, 12, 165, 32, "Execution runtime\n(NOT IMPLEMENTED)", colors.HexColor("#9aa7b5"), stroke=colors.HexColor("#7a8795"), fs=7.5)
    _box(d, 255, 12, 165, 32, "Copilot ETL actions\n(NOT IMPLEMENTED)", colors.HexColor("#9aa7b5"), stroke=colors.HexColor("#7a8795"), fs=7.5)
    _arrow(d, 85, 205, 170, 174); _arrow(d, 250, 205, 235, 174); _arrow(d, 400, 205, 300, 174)
    _arrow(d, 170, 140, 85, 114); _arrow(d, 210, 140, 172, 114); _arrow(d, 290, 140, 292, 114); _arrow(d, 330, 140, 410, 114)
    _arrow(d, 150, 78, 150, 44); _arrow(d, 320, 78, 330, 44)
    story.append(KeepTogether(d)); sp(6)

def dataflow_diagram():
    d = Drawing(CW, 140); y = 92
    _box(d, 2, y, 70, 32, "source\norder_items", BLUE, fs=7)
    _box(d, 2, y-58, 70, 32, "source\norders", BLUE, fs=7)
    _box(d, 92, y-28, 52, 32, "join\n(inner)", NAVY, fs=7)
    _box(d, 162, y-28, 55, 32, "filter\nstatus≠", NAVY, fs=7)
    _box(d, 235, y-28, 60, 32, "derive\nline_amt", NAVY, fs=7)
    _box(d, 313, y-28, 62, 32, "aggregate\nby cust", GREEN, fs=7)
    _box(d, 393, y-28, 68, 32, "target\nfact_sales", colors.HexColor("#7a3fa0"), fs=7)
    _arrow(d, 72, y+6, 92, y-8); _arrow(d, 72, y-46, 92, y-18)
    _arrow(d, 144, y-12, 162, y-12); _arrow(d, 217, y-12, 235, y-12)
    _arrow(d, 295, y-12, 313, y-12); _arrow(d, 375, y-12, 393, y-12)
    story.append(KeepTogether(d)); sp(6)

# ---- COVER ----
story += [Spacer(1, 3.2*cm), Paragraph("DaMod — ETL Designer", styles["CT"]), Spacer(1, 6),
          Paragraph("End-to-End Workflow Handbook", styles["CS"]), Spacer(1, 1.0*cm),
          HR(w=CW, color=BLUE, th=2), Spacer(1, 0.8*cm),
          Paragraph("Designing, validating, generating SQL for, and testing a model-driven ETL "
                    "pipeline in DaMod. Grounded in the current implementation — clearly separating "
                    "what runs today, what needs an external tool, and documented product gaps.", styles["CM"]),
          Spacer(1, 1.3*cm),
          Paragraph("Version %s &nbsp;·&nbsp; Prepared %s" % (VERSION, PREPARED), styles["CM"]),
          Paragraph("Case study: Retail Sales Analytics Pipeline", styles["CM"]),
          Paragraph("Synthetic data only · execution is external", styles["CM"])]

# ---- TOC ----
story.append(NextPageTemplate("body"))
story.append(PageBreak())
story.append(Paragraph("Table of Contents", styles["H1"])); story.append(HR())
toc = TableOfContents(); toc.levelStyles = [styles["TOC1"], styles["TOC2"]]
story.append(toc)

# ===========================================================================
# CHAPTER 1
# ===========================================================================
h1("1. Introduction to DaMod")
p("DaMod is a local-first desktop application for relational and dimensional data modeling, "
  "reverse-engineering, and — the subject of this handbook — model-driven ETL design. It stores "
  "everything as plain, Git-diffable JSON; there are no accounts and no telemetry.")
h2("1.1 What the modeling engine gives you")
bullets(["Entities, attributes, keys, foreign keys, constraints, and four modeling levels "
         "(Conceptual / Logical / Physical-Logical / Physical).",
         "Reusable <b>domains</b>, <b>Naming Standards</b>, and <b>Data Type Standards</b>.",
         "Reverse-engineering from SQL DDL, and DDL generation for seven dialects "
         "(Postgres, Snowflake, Databricks, Oracle, SQL Server, MySQL, BigQuery)."])
h2("1.2 How the ETL Designer extends it")
p("The ETL Designer treats your DaMod models as the authoritative source and target schemas. A "
  "pipeline references model objects by stable id, then layers a visual transform graph on top: "
  "source → filter → select → derive → cast → join → aggregate → distinct → target. From that graph "
  "DaMod infers each node's schema, validates the pipeline, and generates SQL and target DDL.")
callout("note", "Relationship of concepts: <b>models/metadata</b> define schemas; a <b>pipeline</b> "
        "references them and adds a transform DAG; <b>validation</b> checks it; <b>generation</b> emits "
        "SQL + DDL. Execution is a separate concern (external today).")
h2("1.3 Who this is for")
p("Data engineers, analytics engineers, product managers, and QA. The handbook is a practical "
  "implementation + testing guide: follow it to build the Retail Sales pipeline, validate it, "
  "generate SQL, execute it externally, and verify results against a hand-computed oracle.")

# ===========================================================================
# CHAPTER 2
# ===========================================================================
h1("2. ETL concepts and terminology")
table(["Term", "Practical meaning in DaMod"], [
    ["ETL vs ELT", "ETL transforms before load; ELT loads then transforms in the warehouse. DaMod generates SELECT-based SQL you can run either way."],
    ["Source / target system", "Source = where data originates (a modeled schema); target = the analytics schema you populate."],
    ["Metadata discovery", "Reading a schema's structure (tables/columns/keys) — NOT its rows. DaMod connectors are discovery-only."],
    ["Source / target model", "A DaMod model used as the pipeline's input or output schema."],
    ["Source-to-target mapping", "Which source column (or expression) fills each target column, with type + null rules."],
    ["Transformation node", "A step in the DAG (filter, join, derive, …). Each has an input and an inferred output schema."],
    ["Join / filter / aggregate / expression / cast / lookup", "Relate two inputs / keep rows / group+measure / compute a column / change type / enrich from another table (lookup = gap)."],
    ["Data lineage", "Which source fields feed a target column, through which transforms."],
    ["Full vs incremental load", "Full = reload everything (the only load strategy today); incremental = deltas (gap)."],
    ["CDC", "Change Data Capture — stream source changes (gap; needs execution)."],
    ["Pipeline validation", "Structural + schema + transform checks before you trust the design."],
    ["SQL generation", "Emitting runnable SQL text from the design (DaMod does this; it does not run it)."],
    ["Execution runtime", "The engine that actually moves data (external today)."],
    ["Data quality / reconciliation", "Null/duplicate/type checks and source↔target row/total comparisons."],
], [3.3*cm, CW - 3.3*cm])
callout("note", "Three distinct activities this handbook keeps separate: <b>designing</b> a pipeline, "
        "<b>generating</b> an artifact (SQL/DDL), and <b>executing</b> it. DaMod does the first two; "
        "execution is external.")

# ===========================================================================
# CHAPTER 3
# ===========================================================================
h1("3. DaMod architecture")
p("The diagram shows the verified relationships. Green = ETL engines available today; blue = "
  "existing modeling/connector foundation; grey = not implemented (shown only to place the gaps).")
architecture_diagram()
h2("3.1 Available today")
bullets(["Modeling engine, connectors (metadata discovery), snapshots/drift.",
         "Pipeline spec v2 (flat objects + transform DAG), persisted deterministically to "
         "<font face='Courier'>pipelines.json</font>.",
         "Schema propagation, validation, SQL + target-DDL generation, and the ETL Designer canvas."])
h2("3.2 Not implemented (do not treat as working)")
bullets(["Execution runtime (no data movement — connectors are metadata-only).",
         "Copilot ETL actions (the general modeling Copilot is not pipeline-aware)."])

# ===========================================================================
# CHAPTER 4
# ===========================================================================
h1("4. Environment setup and prerequisites")
h2("4.1 Launch DaMod")
steps(["From the repo root: <font face='Courier'>source ~/.cargo/env</font> then "
       "<font face='Courier'>npm install</font> (first time) and <font face='Courier'>npm run tauri dev</font>.",
       "Expected: Vite ready on http://localhost:1420, cargo “Finished”, a native window opens.",
       "Create or open a <b>workspace folder</b> from the Welcome screen (a workspace is a folder of JSON files)."])
callout("ok", "Launch, workspace, modeling, Import SQL, pipeline design, and SQL/DDL generation all run in DaMod with no database required.")
h2("4.2 Optional disposable Postgres (only for external execution, Ch.13/14)")
code("brew services start postgresql@16      # or Docker\ncreatedb damod_etl_test")
callout("warn", "Never use production credentials or datasets. Use a throwaway database; DaMod never "
        "connects to run the pipeline — you run the generated SQL yourself.")
h2("4.3 Reproducible state")
p("Keep the synthetic fixtures in <font face='Courier'>docs/etl_e2e/fixtures/</font> "
  "(source_schema.sql, source_data.sql, target_schema.expected.sql, verify.sql). Work in a fresh "
  "workspace folder so the test never touches other models.")

# ===========================================================================
# CHAPTER 5
# ===========================================================================
h1("5. End-to-end business use case")
p("<b>Retail Sales Analytics Pipeline.</b> Integrate customer, product, order, and order-item data "
  "into an analytics-ready sales model that answers: total sales by product, top customers, sales by "
  "date, units sold, and average order value.")
h2("5.1 Source → target")
table(["Source entities", "Target entities", "Grain"], [
    ["customers, products, orders, order_items", "dim_customer, dim_product, fact_sales", "fact_sales = one row per non-cancelled order_item (line grain)"],
], [6*cm, 5.5*cm, CW - 11.5*cm])
h2("5.2 Transform rules")
bullets(["Join order_items to orders (inner) to attach customer + order date.",
         "Filter out cancelled orders.",
         "Derive <font face='Courier'>line_amount = quantity * unit_price</font>.",
         "Optionally aggregate to sales-by-customer/day (aggregate node) — or keep line grain.",
         "Dimensions are straight column selects (customers → dim_customer, products → dim_product)."])
h2("5.3 Data-flow (fact_sales)")
dataflow_diagram()
callout("warn", "Simplification vs the ideal: lookup/SCD nodes are not implemented, and key-based dedup "
        "is not yet available. The use case stays fully testable at line grain; aggregation is optional.")

# ===========================================================================
# CHAPTER 6
# ===========================================================================
h1("6. Source dataset and schema")
p("Deterministic synthetic data (full files in <font face='Courier'>docs/etl_e2e/fixtures/</font>). "
  "Edge cases: a NULL email (customer 4), a 0.00 price (product 30), a cancelled order (102), and a "
  "zero-amount line (item 1006).")
h2("6.1 Schema (source_schema.sql)")
code("""CREATE TABLE customers (
  customer_id integer PRIMARY KEY, name varchar(100) NOT NULL,
  email varchar(200), country varchar(2) NOT NULL);
CREATE TABLE products (
  product_id integer PRIMARY KEY, sku varchar(20) NOT NULL, name varchar(100) NOT NULL,
  unit_price numeric(12,2) NOT NULL, category varchar(40));
CREATE TABLE orders (
  order_id integer PRIMARY KEY,
  customer_id integer NOT NULL REFERENCES customers(customer_id),
  order_date date NOT NULL, status varchar(20) NOT NULL);
CREATE TABLE order_items (
  order_item_id integer PRIMARY KEY,
  order_id integer NOT NULL REFERENCES orders(order_id),
  product_id integer NOT NULL REFERENCES products(product_id),
  quantity integer NOT NULL, unit_price numeric(12,2) NOT NULL);""")
h2("6.2 Sample records (counts: customers 4, products 3, orders 5, order_items 7)")
table(["order_item", "order", "status", "cust", "product", "qty", "unit_price", "line_amount"], [
    ["1000", "100", "shipped", "1", "10", "2", "9.99", "19.98"],
    ["1001", "100", "shipped", "1", "20", "1", "19.50", "19.50"],
    ["1002", "101", "shipped", "2", "10", "5", "9.99", "49.95"],
    ["1003", "102", "cancelled", "3", "30", "1", "0.00", "excluded"],
    ["1004", "103", "shipped", "1", "20", "3", "19.50", "58.50"],
    ["1005", "104", "pending", "4", "10", "1", "9.99", "9.99"],
    ["1006", "103", "shipped", "1", "30", "10", "0.00", "0.00"],
], [1.9*cm, 1.3*cm, 1.9*cm, 1.1*cm, 1.4*cm, 1.0*cm, 2.0*cm, CW - 10.6*cm])

# ===========================================================================
# CHAPTER 7
# ===========================================================================
h1("7. Source model creation")
callout("ok", "Offline path: reverse-engineer the schema from SQL — no database needed.")
steps(["Open/create a workspace folder.",
       "<b>File ribbon → Import SQL</b> (opens “Reverse-engineer from SQL”).",
       "“Load file…” → fixtures/source_schema.sql (or paste it); set model name <font face='Courier'>retail_source</font>.",
       "Confirm the live preview shows <b>4 entities, 3 relationships</b>; click <b>Import</b>.",
       "In Model Explorer, expand entities; verify PKs (*_id), FK relationships, and types "
       "(order_items.quantity integer, unit_price numeric(12,2); customers.email nullable).",
       "Validation runs live; save (autosave) and reopen to confirm persistence."])
callout("note", "This imports <b>metadata</b> (structure), not data. Loading rows into a database (Ch.13) "
        "is a separate, external step.")

# ===========================================================================
# CHAPTER 8
# ===========================================================================
h1("8. Target model design")
p("Two supported paths for the target (dim_customer, dim_product, fact_sales):")
bullets(["<b>Fast:</b> File ribbon → Import SQL → fixtures/target_schema.expected.sql → name "
         "<font face='Courier'>retail_target</font>.",
         "<b>Manual:</b> New Model dialog (target DB = Postgres) → add entities/columns/keys by hand."])
p("Why this target answers the business questions: <b>dim_customer</b>/<b>dim_product</b> provide the "
  "slice-by attributes; <b>fact_sales</b> at line grain carries quantity, unit_price, and the derived "
  "<font face='Courier'>line_amount</font>, so totals/averages/units roll up by product, customer, or date.")
p("You may also reuse domains and apply Naming/Data-Type Standards to the target (Home ribbon → "
  "Domains / Naming / Types). Optional for this pipeline.")
callout("note", "You don't have to hand-build the target: DaMod can generate target DDL from the pipeline "
        "(Ch.13), deriving columns from the DAG's target node.")

# ===========================================================================
# CHAPTER 9
# ===========================================================================
h1("9. Source-to-target mapping")
p("The mapping is the test oracle. Configure column edits in the <b>Mapping</b> tab "
  "(Data ribbon → Pipelines) and the multi-table fact in the visual <b>Designer</b> (Ch.11). "
  "Full table in Appendix B.")
h2("9.1 fact_sales (line grain)")
table(["Target column", "Source", "Transform", "Type", "Req?"], [
    ["order_item_id", "order_items.order_item_id", "identity", "integer", "yes"],
    ["order_id", "order_items.order_id", "identity", "integer", "yes"],
    ["customer_id", "orders.customer_id (via join)", "identity", "integer", "yes"],
    ["product_id", "order_items.product_id", "identity", "integer", "yes"],
    ["order_date", "orders.order_date (via join)", "identity", "date", "yes"],
    ["quantity", "order_items.quantity", "identity", "integer", "yes"],
    ["unit_price", "order_items.unit_price", "identity", "numeric(12,2)", "yes"],
    ["line_amount", "quantity, unit_price", "derive: quantity*unit_price", "numeric(12,2)", "yes"],
], [3.0*cm, 4.6*cm, 4.2*cm, 2.4*cm, CW - 14.2*cm])
p("Filter on the joined orders: <font face='Courier'>status != 'cancelled'</font> (excludes order 102).")
callout("note", "This table is the expected behavior / oracle. The implemented path is the Designer DAG + the "
        "Mapping tab for flat column edits — not a one-click auto-map across joined tables.")

# ===========================================================================
# CHAPTER 10
# ===========================================================================
h1("10. Transformation design")
table(["Transform", "Purpose", "In→Out schema", "Implemented?"], [
    ["select", "Keep/rename columns", "subset + renames", "Yes (node)"],
    ["rename/alias", "Rename a column", "via select renames", "Yes"],
    ["filter", "Keep matching rows (8 ops incl. null/in)", "passthrough", "Yes (node)"],
    ["derive", "Expression column (e.g. qty*price)", "input + new col", "Yes (node)"],
    ["cast", "Change a column's type", "retype a column", "Yes (node)"],
    ["join", "Relate two inputs (inner/left) on keys", "left + right cols", "Yes (node, L/R ports)"],
    ["aggregate", "group-by + sum/count/count_distinct/avg/min/max", "groups + measures", "Yes (node)"],
    ["distinct", "Full-row de-duplication", "passthrough", "Yes (node)"],
    ["null handling", "COALESCE / default via expression + filter", "via derive/filter", "Workaround (no node)"],
    ["lookup", "Enrich from another table (non-join)", "add cols", "No (gap)"],
    ["data-quality checks", "Null/duplicate/type rules", "n/a", "Partial (validation only)"],
], [2.6*cm, 5.4*cm, 3.6*cm, CW - 11.6*cm])
p("Every node's output schema is inferred (names + types) and flows downstream; the right panel shows "
  "it live. Derived/aggregate columns carry explicit types (e.g. sum→decimal, count→bigint).")
callout("warn", "Expressions (derive, filter values) are passed through to SQL verbatim — they must be "
        "valid for the source dialect. DaMod validates referenced columns, not full expression syntax.")

# ===========================================================================
# CHAPTER 11
# ===========================================================================
h1("11. Build the pipeline step by step")
steps(["<b>Data ribbon → Pipelines → New pipeline</b>: source model retail_source, name "
       "<font face='Courier'>retail_sales</font>, target platform postgres, select all 4 objects → "
       "Plan full load &amp; save. (Born as spec v2 with a starter graph.)",
       "<b>Data ribbon → Designer</b> → select retail_sales. If no graph, click <b>Create starter graph</b>.",
       "Use the left <b>palette</b> to add nodes; drag to position; drag between nodes to connect; "
       "Delete removes a selection. Configure each node in the right <b>NodeInspector</b>.",
       "fact_sales DAG: source order_items + source orders → <b>join</b> (inner; key order_id=order_id; "
       "wire the two sources to the join's left then right ports) → <b>filter</b> (status != cancelled) → "
       "<b>derive</b> (line_amount = quantity*unit_price, decimal) → <b>select</b> (keep the 8 fact columns) → "
       "<b>target</b> (targetObject = fact_sales).",
       "Optional: insert an <b>aggregate</b> before target (group by customer_id, SUM(line_amount) AS total_sales).",
       "dim_customer / dim_product: source → (optional select) → target.",
       "Watch the bottom <b>diagnostics</b> panel: resolve errors (warnings are OK). Select the derive "
       "node to confirm line_amount appears in its output schema.",
       "Save; reopen the workspace and the Designer to confirm the graph persists."])
callout("block", "Pipeline-edit <b>undo/redo</b> is not available (edits persist immediately; model ⌘Z does "
        "not affect pipelines). Re-edit manually to revert. Tracked as gap G-UNDO.")

# ===========================================================================
# CHAPTER 12
# ===========================================================================
h1("12. Validation and data quality")
p("Validation has distinct levels. Errors should block trust/export; warnings are advisory.")
table(["Level", "Checks", "Example message"], [
    ["Structural", "node ids, edges, no dangling, no cycle, input arity", "“Connection would create a cycle”; “Join needs exactly two inputs”"],
    ["Schema", "source/target columns exist, required mapped, dup outputs", "“Required target column … has no source mapping”"],
    ["Transform", "filter/cast/join columns exist, filter value present, derive name unique", "“Filter on unknown column”; “duplicates an existing column”"],
    ["Capability", "source/target/runtime support (metadata-only today)", "(execution capabilities absent — see Ch.13)"],
    ["Execution-readiness", "credentials, target exists, privileges", "N/A in DaMod (external)"],
], [3.0*cm, 6.2*cm, CW - 9.2*cm])
h2("12.1 Negative cases to exercise")
table(["Trigger", "Expected", "Blocking?"], [
    ["Rename a source column away (drift)", "“Source column … is missing (schema drift?)”", "yes"],
    ["Required target column with no source/transform", "“… has no source mapping”", "yes"],
    ["Filter on a non-existent column", "“Filter on unknown column …”", "yes"],
    ["String→numeric with no transform", "type-conversion warning", "no"],
    ["Connect a node back to an ancestor", "connect rejected: “… create a cycle”", "yes"],
    ["Join wired with 1 or 3 inputs", "“Join node needs exactly two inputs”", "yes"],
    ["Two sources share a column into a join", "duplicate-column warning", "no"],
], [6.2*cm, 7.0*cm, CW - 13.2*cm])

# ===========================================================================
# CHAPTER 13
# ===========================================================================
h1("13. SQL generation and execution")
h2("13.1 Generate (runnable in DaMod)")
bullets(["<b>SQL</b>: Designer → SQL toggle, or Pipelines → SQL tab. For a DAG it emits a "
         "<font face='Courier'>WITH</font>-chain (one CTE per node) per target, in the source dialect.",
         "<b>Target DDL</b>: Pipelines → Target DDL tab (derived from the DAG target node when present).",
         "<b>Export</b>: writes <font face='Courier'>&lt;name&gt;.extract.sql</font>, "
         "<font face='Courier'>.target.sql</font>, and <font face='Courier'>.pipeline-report.txt</font>."])
p("Representative generated SQL for fact_sales (shape; exact text comes from the app):")
code("""WITH "order_items" AS (SELECT * FROM "order_items"),
     "orders"      AS (SELECT * FROM "orders"),
     "join"   AS (SELECT "order_items".*, "orders".* FROM "order_items"
                   INNER JOIN "orders" ON "order_items"."order_id" = "orders"."order_id"),
     "filter" AS (SELECT * FROM "join" WHERE "status" != 'cancelled'),
     "derive" AS (SELECT *, "quantity" * "unit_price" AS "line_amount" FROM "filter"),
     "select" AS (SELECT "order_item_id","order_id","customer_id","product_id",
                         "order_date","quantity","unit_price","line_amount" FROM "derive"),
     "fact_sales" AS (SELECT * FROM "select")
SELECT * FROM "fact_sales";""")
h2("13.2 Execution")
callout("block", "DaMod does NOT execute pipelines. Connectors are metadata-only; the SQL is design-time "
        "text. A generated SQL script is not a running ETL job (gap G-EXEC).")
h2("13.3 Safe external execution (Category B)")
code("""psql damod_etl_test -f fixtures/source_schema.sql
psql damod_etl_test -f fixtures/source_data.sql
psql damod_etl_test -f fixtures/target_schema.expected.sql
psql damod_etl_test -c "INSERT INTO dim_customer SELECT * FROM customers;"
psql damod_etl_test -c "INSERT INTO dim_product  SELECT * FROM products;"
psql damod_etl_test -c "INSERT INTO fact_sales <paste the fact_sales WITH-chain SELECT>;" """)
callout("warn", "Re-running without TRUNCATE causes a PK violation (no upsert/merge). Truncate between runs. "
        "There is no retry/rollback because DaMod does not run the job.")

# ===========================================================================
# CHAPTER 14
# ===========================================================================
h1("14. Verify the final output")
p("All values are hand-computed from the synthetic data (Appendix C). Run "
  "<font face='Courier'>fixtures/verify.sql</font> after loading the targets.")
table(["Check", "Expected"], [
    ["dim_customer rows", "4"], ["dim_product rows", "3"], ["fact_sales rows", "6"],
    ["SUM(line_amount)", "157.92"],
    ["Cancelled orders in fact", "0"],
    ["fact_sales PK duplicates", "0"],
    ["line_amount = round(qty*price,2) mismatches", "0"],
    ["Sales by customer", "cust 1 = 97.98, cust 2 = 49.95, cust 4 = 9.99 (cust 3 absent)"],
    ["dim_customer #4 email", "NULL (null handling preserved)"],
], [7.6*cm, CW - 7.6*cm])
code("""SELECT COUNT(*) FROM fact_sales;                               -- 6
SELECT ROUND(SUM(line_amount),2) FROM fact_sales;             -- 157.92
SELECT COUNT(*) - COUNT(DISTINCT order_item_id) FROM fact_sales;   -- 0
SELECT COUNT(*) FROM fact_sales
 WHERE line_amount <> ROUND(quantity*unit_price,2);           -- 0""")

# ===========================================================================
# CHAPTER 15
# ===========================================================================
h1("15. Save, reopen, and maintain pipelines")
table(["Capability", "Status / how to verify"], [
    ["Persistence", "Pipelines saved to pipelines.json (deterministic). Reopen workspace → graph intact."],
    ["Reopen / edit", "Designer reloads nodes/edges/config/layout."],
    ["Undo / redo", "NOT supported for pipeline edits (G-UNDO)."],
    ["Source schema change", "Revalidate → drift errors; mappings are not silently rewritten."],
    ["Stale metadata", "Flagged by validation (missing object/column; unknown source)."],
    ["Version compatibility", "v1 pipelines.json upgrades to v2 on load and gains a starter graph."],
    ["Restart recovery", "Saved pipelines reload; unsaved in-memory graph edits since last save are lost."],
], [4.2*cm, CW - 4.2*cm])

# ===========================================================================
# CHAPTER 16
# ===========================================================================
h1("16. Troubleshooting guide")
table(["Symptom", "Likely cause", "Resolution", "Status"], [
    ["Import SQL parse error", "Unsupported DDL construct", "Keep to CREATE TABLE/PK/FK/standard types", "By design"],
    ["Live connection fails", "Only metadata discovery exists; creds in keychain", "Use Import SQL (offline) for this guide", "By design"],
    ["“Source object … no longer in the model”", "Schema drift after a model edit", "Re-point the source or fix the model; revalidate", "Expected"],
    ["Join shows “needs two inputs”", "Only one edge wired to the join", "Connect both sources to left + right ports", "Expected"],
    ["Type-conversion warning", "Source/target types differ, no transform", "Add a cast node or a transform", "Expected"],
    ["SQL tab is blank", "Source model not open", "Open the source model so schemas resolve", "Expected"],
    ["Target DDL misses derived cols", "Flat objects used, not the DAG", "Ensure a target node exists + model open (graph DDL)", "Fixed"],
    ["Can't undo a pipeline edit", "No pipeline undo stack", "Re-edit manually", "Gap (G-UNDO)"],
    ["Pipeline won't run in app", "No execution runtime", "Run generated SQL externally", "Gap (G-EXEC)"],
], [4.6*cm, 3.6*cm, 5.4*cm, CW - 13.6*cm])

# ===========================================================================
# CHAPTER 17
# ===========================================================================
h1("17. Test plan and acceptance criteria")
p("Unique IDs; fill Actual/Pass-Fail when executing. Full negative matrix in Chapter 12 and "
  "docs/etl_e2e/ETL_TEST_CASES.md.")
table(["ID", "Objective", "Expected", "Actual", "P/F"], [
    ["T1", "Reverse-engineer source", "4 entities, 3 FKs", "", ""],
    ["T2", "Create pipeline + starter graph", "Pipeline saved; canvas nodes", "", ""],
    ["T3", "Build fact_sales DAG", "0 errors; line_amount in derive schema", "", ""],
    ["T4", "Generate graph SQL", "WITH-chain with JOIN+WHERE+derive", "", ""],
    ["T5", "Generate target DDL", "CREATE TABLE fact_sales incl. line_amount", "", ""],
    ["T6", "Negative: cycle", "connect rejected", "", ""],
    ["T7", "Negative: drift", "“source column missing” error", "", ""],
    ["T8", "Save / reopen", "graph intact", "", ""],
    ["T9", "External execute + verify", "fact=6, total=157.92, checks 0", "", ""],
    ["T10", "Aggregate variant", "GROUP BY emitted; totals reconcile", "", ""],
], [1.1*cm, 4.2*cm, 5.6*cm, 2.3*cm, CW - 13.2*cm])
h2("17.1 End-to-end acceptance checklist")
bullets(["Source + target models created and validated.",
         "fact_sales DAG validates with 0 errors; dims mapped.",
         "Graph SQL + target DDL generated and inspected.",
         "External run of the generated SQL reproduces the Chapter-14 oracle exactly.",
         "Save/reopen preserves the pipeline."])

# ===========================================================================
# CHAPTER 18
# ===========================================================================
h1("18. Current limitations and roadmap")
table(["Area", "State", "Note"], [
    ["Source/filter/select/derive/cast/join nodes", "Done", "Schema-propagated + SQL"],
    ["Aggregate node", "Done", "group-by + sum/count/count_distinct/avg/min/max (G-AGG)"],
    ["Distinct (dedup) node", "Done", "full-row DISTINCT (G-XFORM partial)"],
    ["Graph target DDL", "Done", "from DAG target node (G-DDL-GRAPH)"],
    ["Union / lookup / SCD / key-based dedup", "Gap", "G-XFORM remaining"],
    ["Pipeline undo/redo", "Gap", "G-UNDO"],
    ["Incremental / CDC / scheduling", "Gap", "G-INC (needs execution)"],
    ["Copilot ETL actions", "Gap", "G-AI"],
    ["Native execution", "Gap", "G-EXEC — the headline gap (external today)"],
], [6.0*cm, 2.2*cm, CW - 8.2*cm])
p("<b>Recommended sequence:</b> G-XFORM (union, then lookup) → G-UNDO → G-AI (read-only "
  "compliance/suggestions first) → G-INC (design-time) → G-EXEC (a dry-run-first, explicitly "
  "confirmed Rust write adapter). G-EXEC carries the most risk (real data movement) and should be "
  "gated and isolated.")

# ===========================================================================
# APPENDICES
# ===========================================================================
h1("Appendix A — Quick-start checklist")
steps(["npm run tauri dev; open a fresh workspace folder.",
       "File ribbon → Import SQL → source_schema.sql (retail_source).",
       "File ribbon → Import SQL → target_schema.expected.sql (retail_target).",
       "Data ribbon → Pipelines → New (retail_source, postgres, all objects) → save.",
       "Data ribbon → Designer → Create starter graph → build the fact_sales DAG (Ch.11).",
       "Check diagnostics = 0 errors; SQL toggle to review generated SQL; Target DDL tab.",
       "Export report + SQL + DDL.",
       "(External) load fixtures into a disposable Postgres, run the SQL, run verify.sql.",
       "Confirm fact_sales = 6 rows, SUM(line_amount) = 157.92."])

h1("Appendix B — Mapping reference")
h2("dim_customer")
table(["Target", "Source", "Transform", "Null"], [
    ["customer_id", "customers.customer_id", "identity", "n/a"],
    ["name", "customers.name", "identity", "NOT NULL"],
    ["email", "customers.email", "identity", "passes NULL (cust 4)"],
    ["country", "customers.country", "identity", "NOT NULL"],
], [3.2*cm, 5.2*cm, 3.4*cm, CW - 11.8*cm])
h2("dim_product")
table(["Target", "Source", "Transform"], [
    ["product_id", "products.product_id", "identity"], ["sku", "products.sku", "identity"],
    ["name", "products.name", "identity"], ["unit_price", "products.unit_price", "identity (0.00 kept)"],
    ["category", "products.category", "identity"],
], [3.2*cm, 5.2*cm, CW - 8.4*cm])
p("fact_sales mapping is in Chapter 9.1.")

h1("Appendix C — Test data and expected results")
h2("Derived fact_sales (6 rows; cancelled order 102 excluded)")
table(["item", "cust", "product", "qty", "unit_price", "line_amount"], [
    ["1000", "1", "10", "2", "9.99", "19.98"], ["1001", "1", "20", "1", "19.50", "19.50"],
    ["1002", "2", "10", "5", "9.99", "49.95"], ["1004", "1", "20", "3", "19.50", "58.50"],
    ["1005", "4", "10", "1", "9.99", "9.99"], ["1006", "1", "30", "10", "0.00", "0.00"],
], [2.0*cm, 1.6*cm, 1.8*cm, 1.4*cm, 2.6*cm, CW - 9.4*cm])
p("Grand total = 19.98+19.50+49.95+58.50+9.99+0.00 = <b>157.92</b>. By customer: 1=97.98, 2=49.95, "
  "4=9.99 (sum 157.92 ✓). dim_customer=4, dim_product=3.")

h1("Appendix D — Glossary and references")
table(["Term", "Definition"], [
    ["DAG", "Directed acyclic graph of transform nodes; DaMod rejects cycles."],
    ["Grain", "The level of detail of a fact table's rows (here: one per order_item)."],
    ["Line amount", "quantity × unit_price for an order line."],
    ["Metadata-only connector", "Reads schema structure, never table rows."],
    ["Design-time", "Building/validating/generating without executing."],
], [3.6*cm, CW - 3.6*cm])
h2("Repository references")
bullets(["Playbook + fixtures: <font face='Courier'>docs/etl_e2e/</font> "
         "(ETL_E2E_WORKFLOW_PLAYBOOK.md, ETL_*_*.md, fixtures/*.sql).",
         "Pipeline engine: <font face='Courier'>src/connectors/pipeline/</font> "
         "(spec.ts, planner.ts, graph.ts, graphSql.ts).",
         "Designer UI: <font face='Courier'>src/etl/</font> (EtlDesigner.tsx, PipelineCanvas.tsx, NodeInspector.tsx).",
         "Decision log: <font face='Courier'>DECISIONS.md</font>; connector contract: <font face='Courier'>docs/CONNECTORS.md</font>."])

# ---- build (multiBuild resolves the TOC + outline) ----
if __name__ == "__main__":
    doc = Handbook(OUT)
    doc.multiBuild(story)
    print("WROTE", OUT)
