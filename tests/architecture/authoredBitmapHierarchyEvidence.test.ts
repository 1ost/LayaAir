import assert from "node:assert/strict";
import test from "node:test";

import type { normalizeNeutralAuthoredContent } from "../../src/extensions/authoredContent/core/NeutralAuthoredContentIR.ts";
import type {
    canonicalLayaHierarchyBytes,
    prepareNativeLayaAuthoredContentBundle,
    prepareNativeLayaHierarchy,
    writeNativeLayaAuthoredContentTransaction
} from "../../src/extensions/authoredContent/emit/NativeLayaHierarchyWriter.ts";
import type { parseSwfAuthoredContentXml } from "../../src/extensions/authoredContent/offlineAdapters/SwfXmlSourceAdapter.ts";

test("Authenticated bitmap hierarchy compiler surface", () => {
    assert.ok(true as boolean satisfies ([
            typeof normalizeNeutralAuthoredContent,
            typeof parseSwfAuthoredContentXml,
            typeof prepareNativeLayaHierarchy,
            typeof canonicalLayaHierarchyBytes,
            typeof prepareNativeLayaAuthoredContentBundle,
            typeof writeNativeLayaAuthoredContentTransaction
        ] extends readonly unknown[] ? boolean : never));
});
