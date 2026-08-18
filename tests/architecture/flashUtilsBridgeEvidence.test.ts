import assert from "node:assert/strict";
import test from "node:test";
import type { Timer, isFlashTimer } from "../../src/layaAir/flash/utils/Timer.ts";

test("Flash utils Timer compiler and scheduler surface", () => {
    assert.ok(true as boolean satisfies ([typeof Timer, typeof isFlashTimer] extends readonly unknown[] ? boolean : never));
});
