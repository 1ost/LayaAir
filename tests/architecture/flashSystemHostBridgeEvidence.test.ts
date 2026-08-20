import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import { IllegalOperationError } from "../../src/layaAir/flash/errors/IllegalOperationError.ts";
import { ExternalInterface, NativeExternalInterfaceHost,
    installNativeExternalInterfaceHost } from "../../src/layaAir/flash/external/ExternalInterface.ts";
import { Capabilities } from "../../src/layaAir/flash/system/Capabilities.ts";
import { ImageDecodingPolicy } from "../../src/layaAir/flash/system/ImageDecodingPolicy.ts";
import { NativeSystemHost, System, installNativeSystemHost } from "../../src/layaAir/flash/system/System.ts";

const disposition = JSON.parse(readFileSync(
    new URL("../../docTool/architecture/flash-system-host-qname-dispositions.json", import.meta.url), "utf8"));

test("Flash system bridge compiler surface and clean-break dispositions", () => {
    assert.deepEqual({
        surface: [Capabilities.version, ImageDecodingPolicy.ON_DEMAND, ImageDecodingPolicy.ON_LOAD,
            typeof System.totalMemory, typeof NativeSystemHost, typeof installNativeSystemHost],
        holds: disposition.holds.map((entry: { qname: string }) => entry.qname),
    }, {
        surface: ["LAYA 3,4,0,0", "onDemand", "onLoad", "number", "function", "function"],
        holds: ["flash.system.ApplicationDomain", "flash.system.LoaderContext", "flash.system.Security",
            "flash.xml.XMLNode", "__AS3__.vec.Vector"],
    });
});

test("Flash external call-only bridge compiler surface", () => {
    assert.deepEqual([typeof ExternalInterface, typeof NativeExternalInterfaceHost,
        typeof installNativeExternalInterfaceHost, ExternalInterface.available],
        ["function", "function", "function", false]);
});

test("Flash native illegal-operation error compiler surface", () => {
    assert.deepEqual((error => [error instanceof Error, error.name, error.message, error.errorID])(
        new IllegalOperationError("blocked", 17)), [true, "IllegalOperationError", "blocked", 17]);
});
