import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("generated LayaFlash declarations expose the narrow strict XML surface", async () => {
    const declaration = await readFile(new URL("../../build/types/LayaFlash.d.ts", import.meta.url), "utf8");
    for (const name of ["StrictXmlDocument", "StrictXmlLimits", "StrictXmlDeclaration", "StrictXmlAttribute",
        "StrictXmlText", "StrictXmlCData", "StrictXmlComment", "StrictXmlElement", "StrictXmlNode", "StrictXmlDocumentNode"])
        assert.match(declaration, new RegExp(`\\b${name}\\b`));
    assert.doesNotMatch(declaration,
        /\b(?:class|interface|type|function|const)\s+(?:XMLList|E4X|DOMParser|XMLSerializer)\b/);
    const element = declaration.match(/interface StrictXmlElement \{([\s\S]*?)\r?\n    \}/)?.[1];
    assert.ok(element, "StrictXmlElement declaration block missing");
    assert.doesNotMatch(element, /\b(?:appendChild|setAttribute|serialize|toXMLString)\b/);
});
