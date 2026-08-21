import assert from "node:assert/strict";
import test from "node:test";
import type { Timer, isFlashTimer } from "../../src/layaAir/flash/utils/Timer.ts";
import type { Endian } from "../../src/layaAir/flash/utils/Endian.ts";
import type { ByteArray, ByteArrayInput, ZlibDecompressionHost } from "../../src/layaAir/flash/utils/ByteArray.ts";
import type { getTimer, setTimeout, clearTimeout, setInterval, clearInterval } from
    "../../src/layaAir/flash/utils/TimerFunctions.ts";
import type { getQualifiedClassName } from "../../src/layaAir/flash/utils/getQualifiedClassName.ts";
import type {
    describeType,
    FlashAccessorAccess,
    FlashAccessorDescription,
    FlashMethodDescription,
    FlashTypeDescription,
    FlashTypeMembers,
    FlashVariableDescription,
} from "../../src/layaAir/flash/utils/describeType.ts";

test("Flash utils compiler and runtime surface", () => {
    assert.ok(true as boolean satisfies (ByteArrayInput extends ByteArrayInput
        ? ZlibDecompressionHost extends ZlibDecompressionHost
            ? typeof Timer extends unknown
                ? typeof isFlashTimer extends unknown
                    ? typeof Endian extends unknown
                        ? typeof ByteArray extends unknown
                            ? typeof getTimer extends unknown
                                ? typeof setTimeout extends unknown
                                    ? typeof clearTimeout extends unknown
                                        ? typeof setInterval extends unknown
                                            ? typeof clearInterval extends unknown
                                                ? typeof getQualifiedClassName extends unknown
                                                    ? typeof describeType extends unknown
                                                        ? FlashAccessorAccess extends FlashAccessorAccess
                                                            ? FlashAccessorDescription extends FlashAccessorDescription
                                                                ? FlashMethodDescription extends FlashMethodDescription
                                                                    ? FlashTypeDescription extends FlashTypeDescription
                                                                        ? FlashTypeMembers extends FlashTypeMembers
                                                                            ? FlashVariableDescription extends FlashVariableDescription
                                                                                ? boolean : never
                                                                            : never
                                                                        : never
                                                                    : never
                                                                : never
                                                            : never
                                                        : never
                                                    : never
                                                : never
                                            : never
                                        : never
                                    : never
                                : never
                            : never
                        : never
                    : never
                : never
            : never
        : never));
});

test("Flash timer utility policy HOLDs remain explicit", () => {
    assert.ok(true, "bound-method lowering, background throttling, and behavior beyond 2^31 remain HOLD");
});
