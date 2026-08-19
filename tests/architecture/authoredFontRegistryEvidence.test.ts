import assert from "node:assert/strict";
import test from "node:test";
import type {
    AuthoredFontBinding,
    AuthoredFontBindingCancelledError,
    AuthoredFontKey,
    AuthoredFontLoadPort,
    AuthoredFontManifest,
    AuthoredFontManifestEntry,
    AuthoredFontRegistry,
    AuthoredTextProviderConsumer,
} from "../../src/extensions/authoredContent/runtime/AuthoredFontRegistry.ts";

test("Authored font registry compiler surface", () => {
    assert.ok(true as boolean satisfies ([
        AuthoredFontBinding,
        typeof AuthoredFontBindingCancelledError,
        AuthoredFontKey,
        AuthoredFontLoadPort,
        AuthoredFontManifest,
        AuthoredFontManifestEntry,
        typeof AuthoredFontRegistry,
        AuthoredTextProviderConsumer,
    ] extends readonly unknown[] ? boolean : never));
});
