import assert from "node:assert/strict";
import test from "node:test";
import type { InteractiveObject } from "../../src/layaAir/flash/display/InteractiveObject.ts";
import type { TextField, TextFieldType } from "../../src/layaAir/flash/text/TextField.ts";

test("Flash text bridge compiler surface", () => {
    assert.ok(true as boolean satisfies ([typeof TextField, typeof TextFieldType] extends readonly unknown[]
        ? TextField extends InteractiveObject ? boolean : never : never));
});
