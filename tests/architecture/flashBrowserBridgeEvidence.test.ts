import assert from "node:assert/strict";
import test from "node:test";
import type {
    FlashGlobalErrorBoundary,
    FlashGlobalErrorLease,
    FlashGlobalErrorReceiver,
    FlashGlobalErrorObservation,
    FlashGlobalErrorReport,
    FlashUnhandledRejectionReport,
    FlashGlobalErrorSource,
} from "../../src/layaAir/flash/browser/FlashGlobalErrorBoundary.ts";

test("Flash browser global-error compiler surface", () => {
    assert.ok(true as boolean satisfies ([
        typeof FlashGlobalErrorBoundary,
        FlashGlobalErrorLease,
        FlashGlobalErrorReceiver,
        FlashGlobalErrorObservation,
        FlashGlobalErrorReport,
        FlashUnhandledRejectionReport,
        FlashGlobalErrorSource,
    ] extends readonly unknown[] ? boolean : never));
});
