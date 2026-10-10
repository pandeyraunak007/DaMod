// Dev helper: write the mock EBS metadata out as a canonical JSON package, so the
// "Import metadata file…" flow can be exercised with a real file.
// Run: npx vite-node scripts/gen-ebs-sample.ts
import { writeFileSync } from "node:fs";
import { ebsMockMetadata } from "../src/connectors/oracle/mockEbsConnector";
import { serializeMetadata } from "../src/connectors/snapshot";

const out = "examples/ebs-sample-metadata.json";
writeFileSync(out, serializeMetadata(ebsMockMetadata("VIS")));
console.log(`wrote ${out}`);
