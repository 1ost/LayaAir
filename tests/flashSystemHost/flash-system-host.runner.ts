import assert from "node:assert/strict";
import test from "node:test";

import { IllegalOperationError } from "../../src/layaAir/flash/errors/IllegalOperationError";
import {
    ExternalInterface, ExternalInterfaceValue, installNativeExternalInterfaceHost,
} from "../../src/layaAir/flash/external/ExternalInterface";
import type { NativeExternalInterfaceHostLease } from "../../src/layaAir/flash/external/ExternalInterface";
import * as externalModule from "../../src/layaAir/flash/external/ExternalInterface";
import { Capabilities } from "../../src/layaAir/flash/system/Capabilities";
import { ImageDecodingPolicy } from "../../src/layaAir/flash/system/ImageDecodingPolicy";
import { Security } from "../../src/layaAir/flash/system/Security";
import { System, installNativeSystemHost } from "../../src/layaAir/flash/system/System";
import type { NativeSystemHostLease } from "../../src/layaAir/flash/system/System";
import * as systemModule from "../../src/layaAir/flash/system/System";
import { UnsupportedFlashFeatureError } from "../../src/layaAir/flash/events/UnsupportedFlashFeatureError";

let reentrantExternalHost: ExternalHost | null = null;
let reentrantExternalLease: NativeExternalInterfaceHostLease | null = null;

class ExternalHost {
    readonly calls: Array<readonly [string, readonly ExternalInterfaceValue[]]> = [];
    readonly failure = new Error("host failure");
    call(functionName: string, arguments_: readonly ExternalInterfaceValue[]): unknown {
        assert(Object.isFrozen(arguments_));
        this.calls.push([functionName, arguments_]);
        if (functionName === "host.throw") throw this.failure;
        if (functionName === "host.reenter") return ExternalInterface.call("host.inner", 3);
        if (functionName === "host.replace") {
            reentrantExternalHost = new ExternalHost();
            reentrantExternalLease = installNativeExternalInterfaceHost(reentrantExternalHost);
            return "replaced";
        }
        return { functionName, arguments_ };
    }
}

class SystemHost {
    readonly clipboard: string[] = [];
    readonly failure = new Error("clipboard failure");
    setClipboard(text: string): void {
        this.clipboard.push(text);
        if (text === "throw") throw this.failure;
        if (text === "reenter") System.setClipboard("inner");
    }
}

test("host/system bridge uses opaque replaceable leases and native-runtime semantics", () => {
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
    const externalBase = Reflect.get(externalModule, ["Native", "ExternalInterfaceHost"].join(""));
    const systemBase = Reflect.get(systemModule, ["Native", "SystemHost"].join(""));
    assert.equal(externalBase, undefined);
    assert.equal(systemBase, undefined);
    assert.throws(() => craftedPrototypeConstruct(externalBase, "call"), TypeError);
    assert.throws(() => craftedPrototypeConstruct(systemBase, "setClipboard"), TypeError);

    const malformedExternal = Object.defineProperty({}, "call", { value: null });
    assert.throws(() => installNativeExternalInterfaceHost(malformedExternal as unknown as { call(): void }),
        /call must be a data method/);
    const accessorExternal = {};
    let externalGetterCalls = 0;
    Object.defineProperty(accessorExternal, "call", { get: () => {
        externalGetterCalls++; return (): null => null;
    } });
    assert.throws(() => installNativeExternalInterfaceHost(accessorExternal as unknown as { call(): void }),
        /call must be a data method/);
    assert.equal(externalGetterCalls, 0);
    assert.equal(ExternalInterface.available, false);
    let preinstallCoercions = 0;
    assert.throws(() => System.setClipboard(({ toString: () => {
        preinstallCoercions++; return "forged";
    } }) as unknown as string), UnsupportedFlashFeatureError);
    assert.equal(preinstallCoercions, 0);

    const malformedSystem = Object.defineProperty({}, "setClipboard", { value: undefined });
    assert.throws(() => installNativeSystemHost(malformedSystem as unknown as { setClipboard(): void }),
        /setClipboard must be a data method/);

    const external = new ExternalHost();
    const system = new SystemHost();
    const externalLease = installNativeExternalInterfaceHost(external);
    const systemLease = installNativeSystemHost(system);
    assert.equal(Object.isFrozen(externalLease), true);
    assert.equal(Object.isFrozen(systemLease), true);
    assert.deepEqual([externalLease.active, externalLease.disposed], [true, false]);
    assert.deepEqual([systemLease.active, systemLease.disposed], [true, false]);
    const forgedExternalLease = Object.create(Object.getPrototypeOf(externalLease)) as NativeExternalInterfaceHostLease;
    const forgedSystemLease = Object.create(Object.getPrototypeOf(systemLease)) as NativeSystemHostLease;
    assert.throws(() => forgedExternalLease.dispose(), /engine-issued lease/);
    assert.throws(() => forgedSystemLease.dispose(), /engine-issued lease/);
    const reentrantExternal = new Proxy({ call(): void {} }, {
        getOwnPropertyDescriptor(target, property): PropertyDescriptor | undefined {
            installNativeExternalInterfaceHost(new ExternalHost());
            return Reflect.getOwnPropertyDescriptor(target, property);
        },
    });
    assert.throws(() => installNativeExternalInterfaceHost(reentrantExternal), /already in progress/);
    assert.equal(externalLease.active, true);
    const reentrantSystem = new Proxy({ setClipboard(): void {} }, {
        getOwnPropertyDescriptor(target, property): PropertyDescriptor | undefined {
            installNativeSystemHost(new SystemHost());
            return Reflect.getOwnPropertyDescriptor(target, property);
        },
    });
    assert.throws(() => installNativeSystemHost(reentrantSystem), /already in progress/);
    assert.equal(systemLease.active, true);
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
    assert.equal(ExternalInterface.call("host.replace"), "replaced");
    assert(reentrantExternalHost);
    assert(reentrantExternalLease);
    assert.deepEqual([externalLease.active, externalLease.disposed], [false, true]);
    externalLease.dispose();
    assert.equal(reentrantExternalLease.active, true);
    assert.deepEqual(ExternalInterface.call("host.afterReplacement", 9), {
        functionName: "host.afterReplacement", arguments_: [9],
    });
    const invalidReplacement = Object.defineProperty({}, "call", { get: () => { throw new Error("getter"); } });
    assert.throws(() => installNativeExternalInterfaceHost(invalidReplacement as { call(): void }), /data method/);
    assert.equal(reentrantExternalLease.active, true);

    System.setClipboard("Ichigo");
    System.setClipboard(null as unknown as string);
    System.setClipboard("reenter");
    assert.deepEqual(system.clipboard, ["Ichigo", "", "reenter", "inner"]);
    assert.throws(() => System.setClipboard("throw"), error => error === system.failure);
    (system as { setClipboard: SystemHost["setClipboard"] }).setClipboard = () => { throw new Error("mutated"); };
    System.setClipboard("captured");
    assert.equal(system.clipboard[system.clipboard.length - 1], "captured");
    const replacementSystem = new SystemHost();
    const replacementSystemLease = installNativeSystemHost(replacementSystem);
    assert.deepEqual([systemLease.active, systemLease.disposed], [false, true]);
    systemLease.dispose();
    System.setClipboard("replacement");
    assert.deepEqual(replacementSystem.clipboard, ["replacement"]);
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
    assert.deepEqual([
        Security.APPLICATION, Security.LOCAL_TRUSTED, Security.LOCAL_WITH_FILE,
        Security.LOCAL_WITH_NETWORK, Security.REMOTE,
    ], ["application", "localTrusted", "localWithFile", "localWithNetwork", "remote"]);
    assert.equal(Object.isFrozen(Security), true);
    assert.equal(Security.sandboxType, Security.REMOTE);
    let domainCoercions = 0;
    const domain = { toString: () => { domainCoercions++; return "*"; } };
    Security.allowDomain(domain as unknown as string);
    Security.allowInsecureDomain(domain as unknown as string);
    assert.equal(domainCoercions, 2);

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

    reentrantExternalLease.dispose();
    assert.equal(ExternalInterface.available, false);
    assert.throws(() => ExternalInterface.call("after.dispose"), UnsupportedFlashFeatureError);
    reentrantExternalLease.dispose();
    replacementSystemLease.dispose();
    assert.throws(() => System.setClipboard("after dispose"), UnsupportedFlashFeatureError);
    replacementSystemLease.dispose();
});

function craftedPrototypeConstruct(exportedBase: unknown, methodName: string): object {
    const base = exportedBase as Function & { prototype: object };
    function Fake(): void {}
    Fake.prototype = Object.create(base.prototype) as object;
    Object.defineProperty(Fake.prototype, methodName, { value: (): void => undefined });
    return Reflect.construct(base, [], Fake);
}

function setHeapMemory(usedJSHeapSize: number): void {
    Object.defineProperty(globalThis.performance, "memory", {
        value: { usedJSHeapSize }, configurable: true,
    });
}
