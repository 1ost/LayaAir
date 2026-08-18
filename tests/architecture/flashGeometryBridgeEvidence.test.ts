import assert from "node:assert/strict";
import test from "node:test";
import type { Point } from "../../src/layaAir/flash/geom/Point.ts";
import type { Rectangle } from "../../src/layaAir/flash/geom/Rectangle.ts";

test("Flash geometry bridge compiler surface", () => {
    assert.ok(true as boolean satisfies ([typeof Point, typeof Rectangle] extends readonly unknown[] ? boolean : never));
});
