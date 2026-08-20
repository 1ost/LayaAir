import {
    ExternalInterface, ExternalInterfaceValue, installNativeExternalInterfaceHost,
} from "../../src/layaAir/flash/external/ExternalInterface";
import * as externalModule from "../../src/layaAir/flash/external/ExternalInterface";
import { IllegalOperationError } from "../../src/layaAir/flash/errors/IllegalOperationError";
import { UnsupportedFlashFeatureError } from "../../src/layaAir/flash/events/UnsupportedFlashFeatureError";
import { Capabilities } from "../../src/layaAir/flash/system/Capabilities";
import { System, installNativeSystemHost } from "../../src/layaAir/flash/system/System";
import * as systemModule from "../../src/layaAir/flash/system/System";

class BrowserExternalHost {
    readonly calls: string[] = [];
    call(functionName: string, arguments_: readonly ExternalInterfaceValue[]): unknown {
        this.calls.push(`${functionName}:${arguments_.join(",")}`);
        return arguments_.length;
    }
}

class BrowserSystemHost {
    clipboard = "";
    setClipboard(text: string): void { this.clipboard = text; }
}

try {
    let preinstallTyped = false;
    try { ExternalInterface.call("preinstall"); } catch (error) {
        preinstallTyped = error instanceof UnsupportedFlashFeatureError
            && error.feature === "flash.external.ExternalInterface.call";
    }
    const externalBase = Reflect.get(externalModule, ["Native", "ExternalInterfaceHost"].join(""));
    const systemBase = Reflect.get(systemModule, ["Native", "SystemHost"].join(""));
    const noExternalConstructor = externalBase === undefined;
    const noSystemConstructor = systemBase === undefined;
    let craftedExternalRejected = false;
    let craftedSystemRejected = false;
    try { craftedPrototypeConstruct(externalBase, "call"); }
    catch { craftedExternalRejected = true; }
    try { craftedPrototypeConstruct(systemBase, "setClipboard"); }
    catch { craftedSystemRejected = true; }
    const external = new BrowserExternalHost();
    const system = new BrowserSystemHost();
    const externalLease = installNativeExternalInterfaceHost(external);
    const systemLease = installNativeSystemHost(system);
    const result = ExternalInterface.call("bleachDebugLog", "info", "ready");
    let invalidRejected = false;
    let objectRejected = false;
    try { ExternalInterface.call("."); } catch { invalidRejected = true; }
    try { ExternalInterface.call("bleachDebugLog", { mutable: true } as unknown as ExternalInterfaceValue); }
    catch { objectRejected = true; }
    System.setClipboard("browser text");
    const replacementExternal = new BrowserExternalHost();
    const replacementExternalLease = installNativeExternalInterfaceHost(replacementExternal);
    externalLease.dispose();
    const staleExternalSafe = replacementExternalLease.active && ExternalInterface.call("replacement", 1) === 1;
    const replacementSystem = new BrowserSystemHost();
    const replacementSystemLease = installNativeSystemHost(replacementSystem);
    systemLease.dispose();
    System.setClipboard("replacement text");
    const staleSystemSafe = replacementSystemLease.active && replacementSystem.clipboard === "replacement text";
    const illegal = new IllegalOperationError("blocked", 17);
    const descriptor = Object.getOwnPropertyDescriptor(illegal, "errorID");
    const availableBeforeDispose = ExternalInterface.available;
    replacementExternalLease.dispose();
    replacementSystemLease.dispose();
    let externalDisposed = !ExternalInterface.available;
    let systemDisposed = false;
    try { System.setClipboard("disposed"); } catch (error) {
        systemDisposed = error instanceof UnsupportedFlashFeatureError;
    }
    publish({
        ok: result === 2 && external.calls[0] === "bleachDebugLog:info,ready"
            && system.clipboard === "browser text" && availableBeforeDispose
            && preinstallTyped && noExternalConstructor && noSystemConstructor
            && craftedExternalRejected && craftedSystemRejected && staleExternalSafe && staleSystemSafe
            && externalDisposed && systemDisposed
            && invalidRejected && objectRejected && illegal.name === "Error"
            && illegal.toString() === "Error: blocked" && descriptor?.writable === false,
        version: Capabilities.version,
        language: Capabilities.language,
        os: Capabilities.os,
        memory: System.totalMemory,
    });
} catch (error) {
    publish({ ok: false, error: error instanceof Error ? error.stack ?? error.message : String(error) });
}

function craftedPrototypeConstruct(exportedBase: unknown, methodName: string): object {
    const base = exportedBase as Function & { prototype: object };
    function Fake(): void {}
    Fake.prototype = Object.create(base.prototype) as object;
    Object.defineProperty(Fake.prototype, methodName, { value: (): void => undefined });
    return Reflect.construct(base, [], Fake);
}

function publish(value: unknown): void {
    const marker = document.createElement("pre");
    marker.id = "flash-system-host-browser-result";
    marker.textContent = JSON.stringify(value);
    document.body.appendChild(marker);
}
