import assert from "node:assert/strict";
import test from "node:test";

import type { normalizeNeutralAuthoredContent } from "../../src/extensions/authoredContent/core/NeutralAuthoredContentIR.ts";
import type { NativeLayaEmitter } from "../../src/extensions/authoredContent/emit/NativeLayaEmitter.ts";
import type { NativeAnimationClip2DWriter } from "../../src/extensions/authoredContent/emit/NativeAnimationClip2DWriter.ts";
import type { prepareNativeLayaHierarchy } from "../../src/extensions/authoredContent/emit/NativeLayaHierarchyWriter.ts";
import type { FlashLibrarySymbolAdapter } from "../../src/extensions/authoredContent/offlineAdapters/FlashLibrarySymbolAdapter.ts";
import type { registerAuthoredContentPrimitives } from "../../src/extensions/authoredContent/runtime/AuthoredRuntimePrimitives.ts";
import type { validateAuthoredMovieClipFrameLabels } from "../../src/layaAir/flash/display/MovieClip.ts";

test("Authored Flash timeline publication compiler surface", () => {
    assert.ok(true satisfies ([
        typeof normalizeNeutralAuthoredContent,
        typeof FlashLibrarySymbolAdapter,
        typeof NativeLayaEmitter,
        typeof NativeAnimationClip2DWriter,
        typeof prepareNativeLayaHierarchy,
        typeof registerAuthoredContentPrimitives,
        typeof validateAuthoredMovieClipFrameLabels,
    ] extends readonly unknown[] ? boolean : never));
});
