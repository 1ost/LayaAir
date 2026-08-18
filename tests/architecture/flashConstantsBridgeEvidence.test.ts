import assert from "node:assert/strict";
import test from "node:test";
import { BlendMode } from "../../src/layaAir/flash/display/BlendMode.ts";
import { GradientType } from "../../src/layaAir/flash/display/GradientType.ts";
import { StageAlign } from "../../src/layaAir/flash/display/StageAlign.ts";
import { MouseCursor } from "../../src/layaAir/flash/ui/MouseCursor.ts";

test("Flash string constant compiler and runtime surface", () => {
    assert.deepEqual({
        values: [StageAlign.TOP_LEFT, GradientType.LINEAR, BlendMode.ADD, BlendMode.NORMAL,
            MouseCursor.ARROW, MouseCursor.AUTO, MouseCursor.BUTTON, MouseCursor.HAND, MouseCursor.IBEAM],
        frozen: [StageAlign, GradientType, BlendMode, MouseCursor].map(Object.isFrozen),
        fixed: [StageAlign, GradientType, BlendMode, MouseCursor].map(constants =>
            Object.values(Object.getOwnPropertyDescriptors(constants))
                .filter(descriptor => "value" in descriptor && typeof descriptor.value === "string")
                .every(descriptor => descriptor.writable === false && descriptor.configurable === false)),
    }, {
        values: ["TL", "linear", "add", "normal", "arrow", "auto", "button", "hand", "ibeam"],
        frozen: [true, true, true, true],
        fixed: [true, true, true, true],
    });
});
