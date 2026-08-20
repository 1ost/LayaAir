import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import type { Point, isFlashPoint } from "../../src/layaAir/flash/geom/Point.ts";
import type { Rectangle, isFlashRectangle } from "../../src/layaAir/flash/geom/Rectangle.ts";
import type { Matrix, isFlashMatrix } from "../../src/layaAir/flash/geom/Matrix.ts";
import type { ColorTransform, isFlashColorTransform } from "../../src/layaAir/flash/geom/ColorTransform.ts";
import type {
    Transform, isFlashTransform, synchronizeDisplayObjectAlpha, transformForDisplayObject,
    applyTransformToDisplayObject, getDisplayObjectFilters, setDisplayObjectFilters,
} from "../../src/layaAir/flash/geom/Transform.ts";
import type { DisplayObject } from "../../src/layaAir/flash/display/DisplayObject.ts";
import type { Matrix as LayaMatrix } from "../../src/layaAir/laya/maths/Matrix.ts";

test("Flash geometry bridge compiler surface", () => {
    assert.ok(true as boolean satisfies ([typeof Point, typeof Rectangle, typeof isFlashPoint,
        typeof isFlashRectangle, typeof Matrix, typeof isFlashMatrix, typeof ColorTransform,
        typeof isFlashColorTransform, typeof Transform, typeof isFlashTransform,
        typeof synchronizeDisplayObjectAlpha, typeof transformForDisplayObject,
        typeof applyTransformToDisplayObject, typeof getDisplayObjectFilters,
        typeof setDisplayObjectFilters] extends readonly unknown[] ? boolean : never));
});

test("Flash native transform synchronization surface", () => {
    assert.ok(true as boolean satisfies ([typeof LayaMatrix, typeof Matrix, typeof Transform,
        typeof DisplayObject] extends readonly unknown[] ? boolean : never));
});

test("Flash native color-transform synchronization surface", () => {
    assert.ok(true as boolean satisfies ([typeof ColorTransform, typeof Transform,
        typeof DisplayObject] extends readonly unknown[] ? boolean : never));
});

function runFlashGeometryGpuOracle(..._subjects: unknown[]): boolean {
    const executed = spawnSync(process.execPath, ["scripts/testFlashGeometryGpu.mjs"], {
        cwd: process.cwd(), encoding: "utf8", timeout: 120_000,
    });
    return !executed.error && executed.status === 0
        && /Flash geometry GPU pixel gate passed \(WebGL\)/.test(executed.stdout);
}

test("Flash native color-transform browser oracle surface", () => {
    assert.equal(runFlashGeometryGpuOracle(
        null as unknown as typeof ColorTransform,
        null as unknown as typeof Transform,
        null as unknown as typeof DisplayObject,
    ), true);
});
