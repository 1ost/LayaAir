import assert from "node:assert/strict";
import test from "node:test";
import type { RestrictedFlashHtmlTextLayout, parseRestrictedFlashHtmlText } from
    "../../src/extensions/authoredContent/core/RestrictedFlashHtmlText.ts";
import type { AuthoredTextFieldConfiguration, configureAuthoredTextField } from
    "../../src/extensions/authoredContent/runtime/AuthoredTextField.ts";

test("Restricted authored Flash HTML TextField compiler surface", () => {
    assert.ok(true as boolean satisfies ([
        RestrictedFlashHtmlTextLayout,
        typeof parseRestrictedFlashHtmlText,
        AuthoredTextFieldConfiguration,
        typeof configureAuthoredTextField,
    ] extends readonly unknown[] ? boolean : never));
});
