import assert from "node:assert/strict";
import test from "node:test";
import { BlendMode } from "../../src/layaAir/flash/display/BlendMode.ts";
import { GradientType } from "../../src/layaAir/flash/display/GradientType.ts";
import { StageAlign } from "../../src/layaAir/flash/display/StageAlign.ts";
import { StageQuality } from "../../src/layaAir/flash/display/StageQuality.ts";
import { StageScaleMode } from "../../src/layaAir/flash/display/StageScaleMode.ts";
import { URLLoaderDataFormat } from "../../src/layaAir/flash/net/URLLoaderDataFormat.ts";
import { FontType } from "../../src/layaAir/flash/text/FontType.ts";
import { MouseCursor } from "../../src/layaAir/flash/ui/MouseCursor.ts";
import { Endian } from "../../src/layaAir/flash/utils/Endian.ts";

test("Flash string constant compiler and runtime surface", () => {
    assert.deepEqual({
        values: [StageAlign.TOP_LEFT, GradientType.LINEAR, BlendMode.ADD, BlendMode.NORMAL,
            MouseCursor.ARROW, MouseCursor.AUTO, MouseCursor.BUTTON, MouseCursor.HAND, MouseCursor.IBEAM,
            StageQuality.BEST, StageQuality.HIGH, StageScaleMode.NO_SCALE, Endian.BIG_ENDIAN, Endian.LITTLE_ENDIAN,
            URLLoaderDataFormat.BINARY, FontType.DEVICE],
        complete: [StageQuality.BEST, StageQuality.HIGH, StageQuality.HIGH_16X16,
            StageQuality.HIGH_16X16_LINEAR, StageQuality.HIGH_8X8, StageQuality.HIGH_8X8_LINEAR,
            StageQuality.LOW, StageQuality.MEDIUM, StageScaleMode.EXACT_FIT, StageScaleMode.NO_BORDER,
            StageScaleMode.NO_SCALE, StageScaleMode.SHOW_ALL, Endian.BIG_ENDIAN, Endian.LITTLE_ENDIAN,
            URLLoaderDataFormat.BINARY, URLLoaderDataFormat.TEXT, URLLoaderDataFormat.VARIABLES,
            FontType.DEVICE, FontType.EMBEDDED, FontType.EMBEDDED_CFF],
        frozen: [StageAlign, GradientType, BlendMode, MouseCursor, StageQuality, StageScaleMode,
            Endian, URLLoaderDataFormat, FontType].map(Object.isFrozen),
        fixed: [StageAlign, GradientType, BlendMode, MouseCursor, StageQuality, StageScaleMode,
            Endian, URLLoaderDataFormat, FontType].map(constants =>
            Object.values(Object.getOwnPropertyDescriptors(constants))
                .filter(descriptor => "value" in descriptor && typeof descriptor.value === "string")
                .every(descriptor => descriptor.writable === false && descriptor.configurable === false)),
    }, {
        values: ["TL", "linear", "add", "normal", "arrow", "auto", "button", "hand", "ibeam",
            "best", "high", "noScale", "bigEndian", "littleEndian", "binary", "device"],
        complete: ["best", "high", "16x16", "16x16linear", "8x8", "8x8linear", "low", "medium",
            "exactFit", "noBorder", "noScale", "showAll", "bigEndian", "littleEndian", "binary", "text",
            "variables", "device", "embedded", "embeddedCFF"],
        frozen: [true, true, true, true, true, true, true, true, true],
        fixed: [true, true, true, true, true, true, true, true, true],
    });
});
