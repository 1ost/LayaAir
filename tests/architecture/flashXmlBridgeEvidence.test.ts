import assert from "node:assert/strict";
import test from "node:test";
import type {
    StrictXmlDocument,
    StrictXmlLimits,
    StrictXmlDeclaration,
    StrictXmlAttribute,
    StrictXmlText,
    StrictXmlCData,
    StrictXmlComment,
    StrictXmlElement,
    StrictXmlNode,
    StrictXmlDocumentNode,
} from "../../src/layaAir/flash/xml/StrictXmlDocument.ts";
import type { XMLNode } from "../../src/layaAir/flash/xml/XMLNode.ts";

test("Strict immutable XML resource compiler surface", () => {
    assert.ok(true as boolean satisfies ([
        typeof StrictXmlDocument,
        StrictXmlLimits,
        StrictXmlDeclaration,
        StrictXmlAttribute,
        StrictXmlText,
        StrictXmlCData,
        StrictXmlComment,
        StrictXmlElement,
        StrictXmlNode,
        StrictXmlDocumentNode,
        typeof XMLNode,
    ] extends readonly unknown[] ? boolean : never));
});
