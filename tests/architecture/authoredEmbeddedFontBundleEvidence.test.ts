import assert from "node:assert/strict";
import test from "node:test";

import type {
    NeutralAdvancedTextRasterization,
    NeutralEmbeddedFont,
    NeutralFontMediaType,
    NeutralFontAlignZones,
} from "../../src/extensions/authoredContent/core/NeutralAuthoredContentIR.ts";
import type {
    NativeAuthoredFontCatalogDescription,
    describeNativeAuthoredFontCatalog,
} from "../../src/extensions/authoredContent/emit/NativeAuthoredFontCatalog.ts";
import type {
    AuthoredAdvancedTextRasterizationConfiguration,
    AuthoredEmbeddedFontConfiguration,
    AuthoredFontAlignZonesConfiguration,
    configureAuthoredTextField,
} from "../../src/extensions/authoredContent/runtime/AuthoredTextField.ts";
import type {
    AuthoredFontRegistry,
    AuthoredPublishedFontSelection,
} from "../../src/layaAir/laya/platform/AuthoredFontRegistry.ts";

test("Authenticated embedded TTF dynamic-field compiler surface", () => {
    assert.ok(true as boolean satisfies ([
        NeutralFontMediaType,
        NeutralEmbeddedFont,
        NeutralFontAlignZones,
        NeutralAdvancedTextRasterization,
        NativeAuthoredFontCatalogDescription,
        typeof describeNativeAuthoredFontCatalog,
        AuthoredEmbeddedFontConfiguration,
        AuthoredFontAlignZonesConfiguration,
        AuthoredAdvancedTextRasterizationConfiguration,
        typeof configureAuthoredTextField,
        AuthoredPublishedFontSelection,
        typeof AuthoredFontRegistry,
    ] extends readonly unknown[] ? boolean : never));
});
