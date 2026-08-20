import assert from "node:assert/strict";
import test from "node:test";

import { IllegalOperationError } from "../../src/layaAir/flash/errors/IllegalOperationError";
import {
    ExternalInterface, NativeExternalInterfaceHost, installNativeExternalInterfaceHost,
} from "../../src/layaAir/flash/external/ExternalInterface";
import { Capabilities } from "../../src/layaAir/flash/system/Capabilities";
import { ImageDecodingPolicy } from "../../src/layaAir/flash/system/ImageDecodingPolicy";
import { NativeSystemHost, System, installNativeSystemHost } from "../../src/layaAir/flash/system/System";

class ExternalHost extends NativeExternalInterfaceHost {
    readonly calls: Array<readonly [string, readonly unknown[]]> = [];
    constructor() { super(); }
    call(functionName: string, arguments_: readonly unknown[]): unknown {
        assert(Object.isFrozen(arguments_));
        this.calls.push([functionName, arguments_]);
        return { functionName, arguments_ };
    }
}

class SystemHost extends NativeSystemHost {
    readonly clipboard: string[] = [];
    constructor() { super(); }
    setClipboard(text: string): void { this.clipboard.push(text); }
}

test("host/system bridge is explicit, nominal, call-only and native-runtime identified", () => {
    assert.equal(ExternalInterface.available, false);
    assert.throws(() => ExternalInterface.call("gamePay"), /has not installed a native external host/);
    assert.throws(() => System.setClipboard("before install"), /has not installed a native clipboard host/);
    assert.throws(() => installNativeExternalInterfaceHost(Object.create(NativeExternalInterfaceHost.prototype)),
        /nominal Laya capability/);
    assert.throws(() => installNativeSystemHost(Object.create(NativeSystemHost.prototype)),
        /nominal Laya capability/);

    const external = new ExternalHost();
    const system = new SystemHost();
    installNativeExternalInterfaceHost(external);
    installNativeSystemHost(system);
    assert.equal(ExternalInterface.available, true);
    assert.deepEqual(ExternalInterface.call("host.gamePay", 7, "sku"), {
        functionName: "host.gamePay", arguments_: [7, "sku"],
    });
    assert.deepEqual(external.calls, [["host.gamePay", [7, "sku"]]]);
    assert.throws(() => ExternalInterface.call(" host.gamePay"), TypeError);
    assert.throws(() => ExternalInterface.call("host[gamePay]"), TypeError);
    assert.throws(() => installNativeExternalInterfaceHost(new ExternalHost()), /already installed/);

    System.setClipboard("Ichigo");
    System.setClipboard(null as unknown as string);
    assert.deepEqual(system.clipboard, ["Ichigo", ""]);
    assert.equal(Number.isSafeInteger(System.totalMemory), true);
    assert.equal(System.totalMemory >= 0, true);

    assert.match(Capabilities.version, /^LAYA 3,4,0,0$/);
    assert.equal(Capabilities.manufacturer, "LayaAir Web Runtime");
    assert.equal(Capabilities.playerType, "Browser");
    assert.equal(Capabilities.isDebugger, false);
    assert.equal(Object.isFrozen(Capabilities.languages), true);
    assert.deepEqual([ImageDecodingPolicy.ON_DEMAND, ImageDecodingPolicy.ON_LOAD], ["onDemand", "onLoad"]);
    assert.equal(Object.isFrozen(ImageDecodingPolicy), true);

    const error = new IllegalOperationError("blocked", 17.8);
    assert(error instanceof Error);
    assert(error instanceof IllegalOperationError);
    assert.deepEqual([error.name, error.message, error.errorID, error.toString()],
        ["IllegalOperationError", "blocked", 17, "IllegalOperationError: blocked"]);
    assert.deepEqual([new IllegalOperationError().message, new IllegalOperationError().errorID], ["", 0]);
});
