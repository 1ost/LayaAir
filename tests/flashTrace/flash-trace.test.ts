import assert from "node:assert/strict";
import test from "node:test";
import { trace } from "../../src/layaAir/flash/debug/trace.ts";

test("trace forwards exact argument identities in one host console call", () => {
    const original = globalThis.console.log;
    const calls: unknown[][] = [];
    globalThis.console.log = (...values: unknown[]) => { calls.push(values); };
    try {
        const object = { value: 1 };
        trace("message", 2, object, null);
        trace();
        assert.deepEqual(calls, [["message", 2, object, null], []]);
        assert.equal(calls[0][2], object);
    } finally {
        globalThis.console.log = original;
    }
});
