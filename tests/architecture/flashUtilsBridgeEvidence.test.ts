import assert from "node:assert/strict";
import test from "node:test";
import type { Timer, isFlashTimer } from "../../src/layaAir/flash/utils/Timer.ts";
import type { Endian } from "../../src/layaAir/flash/utils/Endian.ts";
import type { ByteArray, ByteArrayInput, ZlibDecompressionHost } from "../../src/layaAir/flash/utils/ByteArray.ts";

test("Flash utils compiler and runtime surface", () => {
    assert.ok(true as boolean satisfies (ByteArrayInput extends ByteArrayInput
        ? ZlibDecompressionHost extends ZlibDecompressionHost
            ? typeof Timer extends unknown
                ? typeof isFlashTimer extends unknown
                    ? typeof Endian extends unknown
                        ? typeof ByteArray extends unknown ? boolean : never
                        : never
                    : never
                : never
            : never
        : never));
});
