import assert from "node:assert/strict";
import test from "node:test";

import type { normalizeNeutralAuthoredContent } from "../../src/extensions/authoredContent/core/NeutralAuthoredContentIR.ts";
import type { prepareNativeLayaHierarchy } from "../../src/extensions/authoredContent/emit/NativeLayaHierarchyWriter.ts";
import type { FlashLibrarySymbolAdapter } from "../../src/extensions/authoredContent/offlineAdapters/FlashLibrarySymbolAdapter.ts";
import type {
    isAuthoredSimpleButton,
    registerAuthoredContentPrimitives,
} from "../../src/extensions/authoredContent/runtime/AuthoredRuntimePrimitives.ts";
import type { isFlashSimpleButton } from "../../src/layaAir/flash/display/SimpleButton.ts";

test("Authored Flash button interaction compiler surface", () => {
    assert.ok(true satisfies ([
        typeof normalizeNeutralAuthoredContent,
        typeof prepareNativeLayaHierarchy,
        typeof FlashLibrarySymbolAdapter,
        typeof registerAuthoredContentPrimitives,
        typeof isAuthoredSimpleButton,
        typeof isFlashSimpleButton,
    ] extends readonly unknown[] ? boolean : never));
});
