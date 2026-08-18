import assert from "node:assert/strict";
import test from "node:test";
import type { URLRequest, URLRequestHeader, isFlashURLRequest, navigateToURL } from "../../src/layaAir/flash/net/URLRequest.ts";
import type { URLLoaderDataFormat } from "../../src/layaAir/flash/net/URLLoaderDataFormat.ts";

test("Flash net bridge compiler surface", () => {
    assert.ok(true as boolean satisfies ([typeof URLRequest, URLRequestHeader, typeof isFlashURLRequest,
        typeof navigateToURL, typeof URLLoaderDataFormat] extends readonly unknown[] ? boolean : never));
});
