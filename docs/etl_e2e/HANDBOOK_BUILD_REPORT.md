# Handbook — generation & verification report

- **PDF:** `docs/etl_e2e/DaMod_ETL_Designer_E2E_Handbook.pdf` (~70 KB, **24 pages**)
- **Generator:** `docs/etl_e2e/build_handbook.py` (ReportLab 5.0.1, isolated `/tmp/pdfvenv`; no repo
  manifest or app source touched). Rebuild: `/tmp/pdfvenv/bin/python docs/etl_e2e/build_handbook.py`.
- **Version/date:** v1.0 · 2026-10-11.

## Structure
Cover · clickable Table of Contents · Chapters 1–18 · Appendices A–D · running header + page-number
footer · 46 PDF bookmarks (chapters + subsections) · two vector diagrams (architecture, data-flow).

## Verified (pypdf + pdftotext — text & structure, not pixel inspection)
- 24 pages; **no blank pages**; cover title present.
- All chapter headings (1–18) and appendices (A–D) present in extracted text.
- Both diagrams rendered (labels "Modeling engine", "Pipeline spec v2", "fact_sales", "aggregate",
  "derive" found as vector text).
- Code block not truncated (`SELECT * FROM "fact_sales";` tail present); verify-SQL present.
- Mapping/expected tables present (`order_item_id`, `numeric(12,2)`, total `157.92`).
- Gaps shown honestly (`NOT IMPLEMENTED`, `G-EXEC`).

## Not claimed
Rendered pages were **not pixel-inspected** (no image viewer in this environment); verification is by
text extraction, structure, page count, and no-blank-page checks.

## Accuracy
Reflects the current implementation (aggregate + distinct nodes, graph target DDL now done).
Execution is external (connectors metadata-only); expected results are hand-computed from
`fixtures/` (fact_sales = 6 rows, SUM(line_amount) = 157.92). Page count (24) is content-driven; no
filler added to reach a target.
