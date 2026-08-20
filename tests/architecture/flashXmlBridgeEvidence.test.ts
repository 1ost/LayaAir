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

test("Strict immutable XML resource compiler surface", () => {
    assert.ok(true as boolean satisfies (
        typeof StrictXmlDocument extends unknown
            ? StrictXmlLimits extends StrictXmlLimits
                ? StrictXmlDeclaration extends StrictXmlDeclaration
                    ? StrictXmlAttribute extends StrictXmlAttribute
                        ? StrictXmlText extends StrictXmlNode
                            ? StrictXmlCData extends StrictXmlNode
                                ? StrictXmlComment extends StrictXmlDocumentNode
                                    ? StrictXmlElement extends StrictXmlDocumentNode ? boolean : never
                                    : never
                                : never
                            : never
                        : never
                    : never
                : never
            : never));
});
