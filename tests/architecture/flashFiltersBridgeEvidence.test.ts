import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import type { DisplayObject } from "../../src/layaAir/flash/display/DisplayObject.ts";
import type {
    BitmapFilter, bitmapFilterNumberEquals,
} from "../../src/layaAir/flash/filters/BitmapFilter.ts";
import type { BlurFilter, isBlurFilter } from "../../src/layaAir/flash/filters/BlurFilter.ts";
import type { ColorMatrixFilter, isColorMatrixFilter } from "../../src/layaAir/flash/filters/ColorMatrixFilter.ts";
import type { DropShadowFilter, isDropShadowFilter } from "../../src/layaAir/flash/filters/DropShadowFilter.ts";
import type { FilterProxy } from "../../src/layaAir/flash/filters/FilterProxy.ts";
import type { ConcreteBitmapFilter, bitmapFilterEquals, isBitmapFilter } from "../../src/layaAir/flash/filters/FilterRegistry.ts";
import type { GlowFilter, isGlowFilter } from "../../src/layaAir/flash/filters/GlowFilter.ts";
import type { GradientBevelFilter, isGradientBevelFilter } from "../../src/layaAir/flash/filters/GradientBevelFilter.ts";
import type { FlashBlurEffect2D } from "../../src/layaAir/laya/display/effect2d/FlashFilterEffects.ts";
import type {
    createFlashAuthoredBevelFilter, FlashAuthoredBevelFilterOptions, FlashBevelEffect2D,
} from "../../src/layaAir/laya/display/effect2d/FlashBevelEffects.ts";

test("Flash filter bridge compiler surface and native effect ownership", () => {
    assert.ok(true as boolean satisfies ([
        typeof BitmapFilter, typeof bitmapFilterNumberEquals,
        typeof BlurFilter, typeof isBlurFilter, typeof ColorMatrixFilter, typeof isColorMatrixFilter,
        typeof DropShadowFilter, typeof isDropShadowFilter, typeof GlowFilter, typeof isGlowFilter,
        typeof GradientBevelFilter, typeof isGradientBevelFilter,
        typeof bitmapFilterEquals, typeof isBitmapFilter,
        ConcreteBitmapFilter,
        typeof FilterProxy, typeof FlashBlurEffect2D, typeof FlashBevelEffect2D,
        typeof createFlashAuthoredBevelFilter, FlashAuthoredBevelFilterOptions,
    ] extends readonly unknown[] ? DisplayObject extends { filters: BitmapFilter[] } ? boolean : never : never));
});

test("DisplayObject.filters accepts direct nullable source clears", () => {
    const compileNullableFilterClear = (display: DisplayObject): void => {
        display.filters = null;
        display.filters = [];
    };
    assert.equal(typeof compileNullableFilterClear, "function");
});

test("GradientBevelFilter and synchronous BitmapData filtering are native", () => {
    const manifest = JSON.parse(readFileSync(join(process.cwd(), "docTool/architecture/flash-filter-bridge.json"), "utf8"));
    assert.equal(manifest.schema, "laya-flash-filter-bridge@1");
    assert.ok(manifest.implemented.includes("flash.filters.GradientBevelFilter"));
    assert.ok(manifest.implemented.includes("swf.BEVELFILTER.internal-native-effect"));
    assert.ok(manifest.implemented.includes("flash.display.BitmapData.applyFilter"));
    assert.ok(manifest.implemented.includes("flash.display.BitmapData.generateFilterRect"));
    assert.deepEqual(manifest.holds, []);
    const barrel = readFileSync(join(process.cwd(), "src/layaAir/flash/index.ts"), "utf8");
    assert.match(barrel, /export \{ GradientBevelFilter \} from "\.\/filters\/GradientBevelFilter"/);
    assert.doesNotMatch(barrel, /export\s*\{\s*(?:BevelFilter|createFlashAuthoredBevelFilter)\s*\}/,
        "authored BEVELFILTER stays engine-internal and no public BevelFilter is invented");
    const bitmapData = readFileSync(join(process.cwd(), "src/layaAir/flash/display/BitmapData.ts"), "utf8");
    assert.match(bitmapData, /\bapplyFilter\s*\(/);
    assert.match(bitmapData, /\bgenerateFilterRect\s*\(/);
});
