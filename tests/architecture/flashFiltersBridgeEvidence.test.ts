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
import type { FlashBlurEffect2D } from "../../src/layaAir/laya/display/effect2d/FlashFilterEffects.ts";

test("Flash filter bridge compiler surface and native effect ownership", () => {
    assert.ok(true as boolean satisfies ([
        typeof BitmapFilter, typeof bitmapFilterNumberEquals,
        typeof BlurFilter, typeof isBlurFilter, typeof ColorMatrixFilter, typeof isColorMatrixFilter,
        typeof DropShadowFilter, typeof isDropShadowFilter, typeof GlowFilter, typeof isGlowFilter,
        typeof bitmapFilterEquals, typeof isBitmapFilter,
        ConcreteBitmapFilter,
        typeof FilterProxy, typeof FlashBlurEffect2D,
    ] extends readonly unknown[] ? DisplayObject extends { filters: BitmapFilter[] } ? boolean : never : never));
});

test("DisplayObject.filters accepts direct nullable source clears", () => {
    const compileNullableFilterClear = (display: DisplayObject): void => {
        display.filters = null;
        display.filters = [];
    };
    assert.equal(typeof compileNullableFilterClear, "function");
});

test("GradientBevelFilter and BitmapData.applyFilter remain explicit HOLDs", () => {
    const manifest = JSON.parse(readFileSync(join(process.cwd(), "docTool/architecture/flash-filter-bridge.json"), "utf8"));
    assert.equal(manifest.schema, "laya-flash-filter-bridge@1");
    assert.deepEqual(manifest.holds.map((entry: any) => [entry.symbol, entry.status]), [
        ["flash.filters.GradientBevelFilter", "HOLD"],
        ["flash.display.BitmapData.applyFilter", "HOLD"],
    ]);
    const barrel = readFileSync(join(process.cwd(), "src/layaAir/flash/index.ts"), "utf8");
    assert.doesNotMatch(barrel, /GradientBevelFilter/);
    const bitmapData = readFileSync(join(process.cwd(), "src/layaAir/flash/display/BitmapData.ts"), "utf8");
    assert.doesNotMatch(bitmapData, /\bapplyFilter\s*\(/);
});
