import {
    ExternalInterface, NativeExternalInterfaceHost, installNativeExternalInterfaceHost,
} from "../../src/layaAir/flash/external/ExternalInterface";
import { Capabilities } from "../../src/layaAir/flash/system/Capabilities";
import { NativeSystemHost, System, installNativeSystemHost } from "../../src/layaAir/flash/system/System";

class BrowserExternalHost extends NativeExternalInterfaceHost {
    readonly calls: string[] = [];
    constructor() { super(); }
    call(functionName: string, arguments_: readonly unknown[]): unknown {
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
    const external = new BrowserExternalHost();
    const system = new BrowserSystemHost();
    installNativeExternalInterfaceHost(external);
    installNativeSystemHost(system);
    const result = ExternalInterface.call("bleachDebugLog", "info", "ready");
    System.setClipboard("browser text");
    publish({
        ok: result === 2 && external.calls[0] === "bleachDebugLog:info,ready"
            && system.clipboard === "browser text" && ExternalInterface.available,
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
