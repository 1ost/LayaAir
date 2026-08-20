import assert from "node:assert/strict";
import test from "node:test";
import type {
    AuthoredFontBinding,
    AuthoredFontBindingCancelledError,
    AuthoredFontKey,
    AuthoredFontManifest,
    AuthoredFontManifestEntry,
    AuthoredFontRegistry,
    AuthoredTextProviderConsumer,
} from "../../src/layaAir/flash/text/Font.ts";

test("Authored font registry compiler surface", () => {
    assert.ok(true as boolean satisfies ([
        AuthoredFontBinding,
        typeof AuthoredFontBindingCancelledError,
        AuthoredFontKey,
        AuthoredFontManifest,
        AuthoredFontManifestEntry,
        typeof AuthoredFontRegistry,
        AuthoredTextProviderConsumer,
    ] extends readonly unknown[] ? boolean : never));
});
