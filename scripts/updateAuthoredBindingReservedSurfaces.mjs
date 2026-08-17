import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ledgerPath = resolve(root, "docTool/architecture/authored-content-capabilities.json");
const outputPath = resolve(root, "src/extensions/authoredContent/runtime/AuthoredBindingReservedSurfaces.ts");
const ledgerBytes = readFileSync(ledgerPath);
const ledgerText = ledgerBytes.toString("utf8");
if (!Buffer.from(ledgerText, "utf8").equals(ledgerBytes))
  throw new Error("A12 ledger must be valid UTF-8");
const canonicalLedgerText = ledgerText.replace(/\r\n?/g, "\n");
const ledger = JSON.parse(canonicalLedgerText);
if (ledger.schema !== "laya-authored-content-capabilities@1" || ledger.hashMode !== "canonical-lf-utf8")
  throw new Error("authored binding reserved surfaces require the canonical A12 ledger");

const sourceTypes = ["MovieClip", "SimpleButton", "Sprite", "TextField"];
const surfaces = {};
for (const sourceType of sourceTypes) {
  const matches = ledger.capabilities.flatMap(capability => capability.obligations ?? [])
    .filter(obligation => obligation.kind === "class" && obligation.export === sourceType);
  if (matches.length !== 1) throw new Error(`A12 ledger must own exactly one ${sourceType} class obligation`);
  const names = [...new Set(matches[0].members
    .filter(member => member.scope === "instance")
    .map(member => member.name))].sort();
  if (names.length === 0 || names.some(name => typeof name !== "string" || name.length === 0))
    throw new Error(`A12 ${sourceType} instance surface is empty or invalid`);
  surfaces[sourceType] = names;
}
const ledgerSha256 = createHash("sha256").update(canonicalLedgerText, "utf8").digest("hex");
const nodeKinds = { button: "SimpleButton", form: "Sprite", input: "TextField", interactive: "Sprite", timeline: "MovieClip" };
const artifact = {
  schema: "laya-authored-binding-reserved-surfaces@1",
  hashMode: "canonical-lf-utf8",
  ledgerSha256,
  nodeKinds,
  sourceTypes: surfaces,
};
const source = `// Generated from docTool/architecture/authored-content-capabilities.json; do not edit.\n`
  + `export const AUTHORED_BINDING_RESERVED_SURFACE_SCHEMA = "laya-authored-binding-reserved-surfaces@1" as const;\n`
  + `export const AUTHORED_BINDING_RESERVED_LEDGER_SHA256 = ${JSON.stringify(ledgerSha256)} as const;\n`
  + `export const AUTHORED_BINDING_RESERVED_SOURCE_SURFACES = Object.freeze(${JSON.stringify(surfaces, null, 2)}) as Readonly<Record<"MovieClip" | "SimpleButton" | "Sprite" | "TextField", readonly string[]>>;\n`
  + `export const AUTHORED_BINDING_NODE_SOURCE_TYPES = Object.freeze(${JSON.stringify(nodeKinds, null, 2)}) as Readonly<Record<string, keyof typeof AUTHORED_BINDING_RESERVED_SOURCE_SURFACES>>;\n`;
if (process.argv.includes("--check")) {
  if (readFileSync(outputPath, "utf8") !== source) throw new Error("authored binding reserved surface artifact is stale");
} else {
  writeFileSync(outputPath, source, "utf8");
  console.log(`Updated ${outputPath} from A12 ${ledgerSha256}`);
}
const jsonIndex = process.argv.indexOf("--json-output");
if (jsonIndex >= 0) {
  const jsonOutput = process.argv[jsonIndex + 1];
  if (!jsonOutput) throw new Error("--json-output requires a path");
  writeFileSync(resolve(jsonOutput), `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
}
