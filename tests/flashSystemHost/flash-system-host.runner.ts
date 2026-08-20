import assert from "node:assert/strict";
import test from "node:test";

import { IllegalOperationError } from "../../src/layaAir/flash/errors/IllegalOperationError";
import {
    ExternalInterface, ExternalInterfaceValue, NativeExternalInterfaceHost, installNativeExternalInterfaceHost,
} from "../../src/layaAir/flash/external/ExternalInterface";
import { Capabilities } from "../../src/layaAir/flash/system/Capabilities";
import { ImageDecodingPolicy } from "../../src/layaAir/flash/system/ImageDecodingPolicy";
import { NativeSystemHost, System, installNativeSystemHost } from "../../src/layaAir/flash/system/System";
import { UnsupportedFlashFeatureError } from "../../src/layaAir/flash/events/UnsupportedFlashFeatureError";

class ExternalHost extends NativeExternalInterfaceHost {
    readonly calls: Array<readonly [string, readonly ExternalInterfaceValue[]]> = [];
    readonly failure = new Error("host failure");
    constructor() { super(); }
    call(functionName: string, arguments_: readonly ExternalInterfaceValue[]): unknown {
        assert(Object.isFrozen(arguments_));
        this.calls.push([functionName, arguments_]);
        if (functionName === "host.throw") throw this.failure;
        if (functionName === "host.reenter") return ExternalInterface.call("host.inner", 3);
        if (functionName === "host.replace") {
            try { installNativeExternalInterfaceHost(new ExternalHost()); } catch { return "blocked"; }
            return "replaced";
        }
        return { functionName, arguments_ };
    }
}

class SystemHost extends NativeSystemHost {
    readonly clipboard: string[] = [];
    readonly failure = new Error("clipboard failure");
    constructor() { super(); }
    setClipboard(text: string): void {
        this.clipboard.push(text);
        if (text === "throw") throw this.failure;
        if (text === "reenter") System.setClipboard("inner");
    }
}

test("host/system bridge is explicit, nominal, call-only and native-runtime identified", () => {
    assert.equal(ExternalInterface.available, false);
    assert.throws(() => ExternalInterface.call("gamePay"), error =>
        error instanceof UnsupportedFlashFeatureError
        && error.feature === "flash.external.ExternalInterface.call"
        && /has not installed a native external host/.test(error.message));
    assert.throws(() => System.setClipboard("before install"), error =>
        error instanceof UnsupportedFlashFeatureError
        && error.feature === "flash.system.System.setClipboard"
        && /has not installed a native clipboard host/.test(error.message));
    assert.equal(ExternalInterface.available, false);
    assert.throws(() => Reflect.construct(NativeExternalInterfaceHost as unknown as Function, []),
        /requires a direct concrete data-method subclass/);
    assert.throws(() => Reflect.construct(NativeSystemHost as unknown as Function, []),
        /requires a direct concrete data-method subclass/);
    assert.throws(() => Reflect.construct(NativeExternalInterfaceHost as unknown as Function, [], class Fake {}),
        /requires a direct concrete data-method subclass/);
    assert.throws(() => Reflect.construct(NativeSystemHost as unknown as Function, [], class Fake {}),
        /requires a direct concrete data-method subclass/);
    assert.throws(() => installNativeExternalInterfaceHost(Object.create(NativeExternalInterfaceHost.prototype)),
        /nominal Laya capability/);
    assert.throws(() => installNativeSystemHost(Object.create(NativeSystemHost.prototype)),
        /nominal Laya capability/);

    const malformedExternal = new ExternalHost();
    Object.defineProperty(malformedExternal, "call", { value: null });
    assert.throws(() => installNativeExternalInterfaceHost(malformedExternal), /call must be a data method/);
    const accessorExternal = new ExternalHost();
    let externalGetterCalls = 0;
    Object.defineProperty(accessorExternal, "call", { get: () => {
        externalGetterCalls++; return (): null => null;
    } });
    assert.throws(() => installNativeExternalInterfaceHost(accessorExternal), /call must be a data method/);
    assert.equal(externalGetterCalls, 0);
    assert.equal(ExternalInterface.available, false);
    let preinstallCoercions = 0;
    assert.throws(() => System.setClipboard(({ toString: () => {
        preinstallCoercions++; return "forged";
    } }) as unknown as string), UnsupportedFlashFeatureError);
    assert.equal(preinstallCoercions, 0);

    const malformedSystem = new SystemHost();
    Object.defineProperty(malformedSystem, "setClipboard", { value: undefined });
    assert.throws(() => installNativeSystemHost(malformedSystem), /setClipboard must be a data method/);

    const external = new ExternalHost();
    const system = new SystemHost();
    installNativeExternalInterfaceHost(external);
    installNativeSystemHost(system);
    assert.equal(ExternalInterface.available, true);
    assert.deepEqual(ExternalInterface.call("host.gamePay", 7, "sku"), {
        functionName: "host.gamePay", arguments_: [7, "sku"],
    });
    assert.deepEqual(external.calls, [["host.gamePay", [7, "sku"]]]);
    for (const invalid of ["", ".", ".host", "host.", "host..call", "1host", "host-call", " host.call"])
        assert.throws(() => ExternalInterface.call(invalid), TypeError);
    for (const invalid of [{ retained: true }, [1], undefined, NaN, Infinity, Symbol("x"), (): null => null])
        assert.throws(() => ExternalInterface.call("host.call", invalid as unknown as ExternalInterfaceValue),
            /finite primitive host value/);
    assert.equal(external.calls.length, 1);

    assert.deepEqual(ExternalInterface.call("host.reenter"), {
        functionName: "host.inner", arguments_: [3],
    });
    assert.throws(() => ExternalInterface.call("host.throw"), error => error === external.failure);
    (external as { call: ExternalHost["call"] }).call = () => "mutated";
    assert.deepEqual(ExternalInterface.call("host.captured", true), {
        functionName: "host.captured", arguments_: [true],
    });
    assert.equal(ExternalInterface.call("host.replace"), "blocked");
    assert.throws(() => installNativeExternalInterfaceHost(new ExternalHost()), /already installed/);

    System.setClipboard("Ichigo");
    System.setClipboard(null as unknown as string);
    System.setClipboard("reenter");
    assert.deepEqual(system.clipboard, ["Ichigo", "", "reenter", "inner"]);
    assert.throws(() => System.setClipboard("throw"), error => error === system.failure);
    (system as { setClipboard: SystemHost["setClipboard"] }).setClipboard = () => { throw new Error("mutated"); };
    System.setClipboard("captured");
    assert.equal(system.clipboard[system.clipboard.length - 1], "captured");
    assert.throws(() => installNativeSystemHost(new SystemHost()), /already installed/);
    setHeapMemory(Number.MAX_SAFE_INTEGER + 2);
    assert.equal(System.totalMemoryNumber, Number.MAX_SAFE_INTEGER);
    assert.equal(System.totalMemory, 0);
    setHeapMemory(0xffffffff);
    assert.deepEqual([System.totalMemory, System.totalMemoryNumber], [0xffffffff, 0xffffffff]);
    setHeapMemory(Infinity);
    assert.deepEqual([System.totalMemory, System.totalMemoryNumber], [0, 0]);

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
        ["Error", "blocked", 17, "Error: blocked"]);
    const idDescriptor = Object.getOwnPropertyDescriptor(error, "errorID");
    assert.deepEqual(idDescriptor && [idDescriptor.value, idDescriptor.writable, idDescriptor.configurable],
        [17, false, false]);
    assert.throws(() => { (error as { errorID: number }).errorID = 99; }, TypeError);
    let coercions = 0;
    const hostileId = { valueOf: () => { coercions++; return 41; } };
    assert.equal(new IllegalOperationError("hostile", hostileId as unknown as number).errorID, 41);
    assert.equal(coercions, 1);
    assert.deepEqual([new IllegalOperationError().message, new IllegalOperationError().errorID], ["", 0]);
});

function setHeapMemory(usedJSHeapSize: number): void {
    Object.defineProperty(globalThis.performance, "memory", {
        value: { usedJSHeapSize }, configurable: true,
    });
}
