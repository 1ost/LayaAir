import assert from "node:assert/strict";
import test from "node:test";

import type { IllegalOperationError } from "../../src/layaAir/flash/errors/IllegalOperationError.ts";
import type { ExternalInterface, ExternalInterfaceValue, NativeExternalInterfaceHost,
    NativeExternalInterfaceHostLease,
    installNativeExternalInterfaceHost } from "../../src/layaAir/flash/external/ExternalInterface.ts";
import type { ApplicationDomain } from "../../src/layaAir/flash/system/ApplicationDomain.ts";
import type { Capabilities } from "../../src/layaAir/flash/system/Capabilities.ts";
import type { ImageDecodingPolicy } from "../../src/layaAir/flash/system/ImageDecodingPolicy.ts";
import type {
    LoaderContext, NativeLoaderContextSnapshot, isFlashLoaderContext, snapshotNativeLoaderContext
} from "../../src/layaAir/flash/system/LoaderContext.ts";
import type { Security } from "../../src/layaAir/flash/system/Security.ts";
import type { NativeSystemHost, NativeSystemHostLease, System,
    installNativeSystemHost } from "../../src/layaAir/flash/system/System.ts";

test("Flash system bridge compiler surface and clean-break dispositions", () => {
    assert.ok(true as boolean satisfies ([
        typeof ApplicationDomain,
        typeof Capabilities,
        typeof ImageDecodingPolicy,
        typeof LoaderContext,
        NativeLoaderContextSnapshot,
        typeof isFlashLoaderContext,
        typeof snapshotNativeLoaderContext,
        typeof Security,
        typeof System,
        NativeSystemHost,
        NativeSystemHostLease,
        typeof installNativeSystemHost,
    ] extends readonly unknown[] ? boolean : never));
});

test("Flash external call-only bridge compiler surface", () => {
    assert.ok(true as boolean satisfies (
        typeof ExternalInterface extends unknown
            ? ExternalInterfaceValue extends ExternalInterfaceValue
                ? NativeExternalInterfaceHost extends NativeExternalInterfaceHost
                    ? NativeExternalInterfaceHostLease extends NativeExternalInterfaceHostLease
                        ? typeof installNativeExternalInterfaceHost extends unknown ? boolean : never
                        : never
                    : never
                : never
            : never));
});

test("Flash native illegal-operation error compiler surface", () => {
    assert.ok(true as boolean satisfies (typeof IllegalOperationError extends unknown ? boolean : never));
});
