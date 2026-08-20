const LAYA_VERSION = "LAYA 3,4,0,0";

function browserNavigator(): Navigator | undefined {
    return typeof globalThis.navigator === "undefined" ? undefined : globalThis.navigator;
}

function platformName(): string {
    const navigator = browserNavigator();
    const identity = `${navigator?.platform ?? ""} ${navigator?.userAgent ?? ""}`;
    if (/android/i.test(identity)) return "Android";
    if (/iphone|ipad|ipod/i.test(identity)) return "iOS";
    if (/windows|win32|win64/i.test(identity)) return "Windows";
    if (/macintosh|mac os|macintel/i.test(identity)) return "Mac OS";
    if (/linux/i.test(identity)) return "Linux";
    return navigator?.platform || "Unknown";
}

/**
 * Native web-runtime diagnostics for the source-used Capabilities surface.
 * Values describe the current Laya/browser runtime; they never impersonate a
 * Flash Player or expose plugin/VM admission state.
 */
export class Capabilities {
    private constructor() {}

    static get isDebugger(): boolean { return false; }
    static get language(): string { return browserNavigator()?.language || "en"; }
    static get languages(): readonly string[] {
        const values = browserNavigator()?.languages;
        return Object.freeze(values && values.length > 0 ? [...values] : [Capabilities.language]);
    }
    static get manufacturer(): string { return "LayaAir Web Runtime"; }
    static get os(): string { return platformName(); }
    static get playerType(): string { return "Browser"; }
    static get version(): string { return LAYA_VERSION; }
}
