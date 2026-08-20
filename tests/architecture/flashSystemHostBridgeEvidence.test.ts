import assert from "node:assert/strict";
import test from "node:test";

import type { IllegalOperationError } from "../../src/layaAir/flash/errors/IllegalOperationError.ts";
import type { ExternalInterface, ExternalInterfaceValue, NativeExternalInterfaceHost,
    installNativeExternalInterfaceHost } from "../../src/layaAir/flash/external/ExternalInterface.ts";
import type { Capabilities } from "../../src/layaAir/flash/system/Capabilities.ts";
import type { ImageDecodingPolicy } from "../../src/layaAir/flash/system/ImageDecodingPolicy.ts";
import type { NativeSystemHost, System, installNativeSystemHost } from "../../src/layaAir/flash/system/System.ts";

test("Flash system bridge compiler surface and clean-break dispositions", () => {
    assert.ok(true as boolean satisfies (
        typeof Capabilities extends unknown
            ? typeof ImageDecodingPolicy extends unknown
                ? typeof System extends unknown
                    ? typeof NativeSystemHost extends unknown
                        ? typeof installNativeSystemHost extends unknown ? boolean : never
                        : never
                    : never
                : never
            : never));
});

test("Flash external call-only bridge compiler surface", () => {
    assert.ok(true as boolean satisfies (
        typeof ExternalInterface extends unknown
            ? ExternalInterfaceValue extends ExternalInterfaceValue
                ? typeof NativeExternalInterfaceHost extends unknown
                    ? typeof installNativeExternalInterfaceHost extends unknown ? boolean : never
                    : never
                : never
            : never));
});

test("Flash native illegal-operation error compiler surface", () => {
    assert.ok(true as boolean satisfies (typeof IllegalOperationError extends unknown ? boolean : never));
});
