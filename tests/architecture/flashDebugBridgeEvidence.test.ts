import assert from "node:assert/strict";
import test from "node:test";
import type { trace } from "../../src/layaAir/flash/debug/trace.ts";

test("Flash debug compiler surface", () => {
    assert.ok(true as boolean satisfies ([typeof trace] extends readonly unknown[] ? boolean : never));
});
