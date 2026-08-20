import {
    ExternalInterface, ExternalInterfaceValue, NativeExternalInterfaceHost, installNativeExternalInterfaceHost,
} from "../../src/layaAir/flash/external/ExternalInterface";
import { IllegalOperationError } from "../../src/layaAir/flash/errors/IllegalOperationError";
import { UnsupportedFlashFeatureError } from "../../src/layaAir/flash/events/UnsupportedFlashFeatureError";
import { Capabilities } from "../../src/layaAir/flash/system/Capabilities";
import { NativeSystemHost, System, installNativeSystemHost } from "../../src/layaAir/flash/system/System";

class BrowserExternalHost extends NativeExternalInterfaceHost {
    readonly calls: string[] = [];
    constructor() { super(); }
    call(functionName: string, arguments_: readonly ExternalInterfaceValue[]): unknown {
        this.calls.push(`${functionName}:${arguments_.join(",")}`);
        return arguments_.length;
    }
}

class BrowserSystemHost extends NativeSystemHost {
    clipboard = "";
    constructor() { super(); }
    setClipboard(text: string): void { this.clipboard = text; }
}

try {
    let preinstallTyped = false;
    try { ExternalInterface.call("preinstall"); } catch (error) {
        preinstallTyped = error instanceof UnsupportedFlashFeatureError
            && error.feature === "flash.external.ExternalInterface.call";
    }
    let directExternalRejected = false;
    let directSystemRejected = false;
    try { Reflect.construct(NativeExternalInterfaceHost as unknown as Function, []); }
    catch { directExternalRejected = true; }
    try { Reflect.construct(NativeSystemHost as unknown as Function, []); }
    catch { directSystemRejected = true; }
    let forgedNewTargetRejected = false;
    try { Reflect.construct(NativeExternalInterfaceHost as unknown as Function, [], class Fake {}); }
    catch { forgedNewTargetRejected = true; }
    const external = new BrowserExternalHost();
    const system = new BrowserSystemHost();
    installNativeExternalInterfaceHost(external);
    installNativeSystemHost(system);
    const result = ExternalInterface.call("bleachDebugLog", "info", "ready");
    let invalidRejected = false;
    let objectRejected = false;
    try { ExternalInterface.call("."); } catch { invalidRejected = true; }
    try { ExternalInterface.call("bleachDebugLog", { mutable: true } as unknown as ExternalInterfaceValue); }
    catch { objectRejected = true; }
    System.setClipboard("browser text");
    const illegal = new IllegalOperationError("blocked", 17);
    const descriptor = Object.getOwnPropertyDescriptor(illegal, "errorID");
    publish({
        ok: result === 2 && external.calls[0] === "bleachDebugLog:info,ready"
            && system.clipboard === "browser text" && ExternalInterface.available
            && preinstallTyped && directExternalRejected && directSystemRejected
            && forgedNewTargetRejected
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

function publish(value: unknown): void {
    const marker = document.createElement("pre");
    marker.id = "flash-system-host-browser-result";
    marker.textContent = JSON.stringify(value);
    document.body.appendChild(marker);
}
