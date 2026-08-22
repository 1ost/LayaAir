import assert from "node:assert/strict";
import test from "node:test";

import {
    Proxy as FlashProxy,
    callFlashProxyProperty,
    declareFlashProxyProperties,
    flash_proxy,
} from "../../src/layaAir/flash/utils/Proxy";

class FilterLikeProxy extends FlashProxy {
    static override readonly flashProxyDeclaredProperties = declareFlashProxyProperties(
        "filter", "autoUpdateIndex", "callLater", "writes",
    );

    filter: Record<string, unknown> | null;
    autoUpdateIndex = false;
    callLater = false;
    writes = 0;

    constructor(filter: Record<string, unknown> | null) {
        super();
        this.filter = filter;
    }

    protected override getProperty(name: string): unknown { return this.filter?.[name]; }
    protected override setProperty(name: string, value: unknown): void {
        if (this.filter !== null) this.filter[name] = value;
        this.writes++;
    }
    protected override callProperty(name: string, ...args: unknown[]): unknown {
        const member = this.filter?.[name];
        if (typeof member !== "function") return super.callProperty(name, ...args);
        return Reflect.apply(member, this.filter, args);
    }
    protected override deleteProperty(name: string): boolean {
        return this.filter !== null && delete this.filter[name];
    }
    protected override hasProperty(name: string): boolean {
        return this.filter !== null && Object.prototype.hasOwnProperty.call(this.filter, name);
    }
}

test("routes only dynamic properties through Flash proxy hooks", () => {
    const filter: Record<string, unknown> = {
        blurX: 4,
        scale(this: { blurX: number }, factor: number) { return this.blurX * factor; },
    };
    const proxy = new FilterLikeProxy(filter) as FilterLikeProxy & Record<string, unknown>;
    assert.equal(proxy.filter, filter, "declared subclass initialization must bypass dynamic hooks");
    assert.equal(proxy.writes, 0);
    assert.equal(proxy.blurX, 4);
    proxy.blurX = 8;
    assert.equal(filter.blurX, 8);
    assert.equal(proxy.writes, 1);
    assert.equal("blurX" in proxy, true);
    assert.equal(callFlashProxyProperty(proxy, "scale", 3), 24);
    assert.equal(delete proxy.blurX, true);
    assert.equal("blurX" in proxy, false);
    assert.equal(flash_proxy, "http://www.adobe.com/2006/actionscript/flash/proxy");
});

test("rejects invalid declared-slot metadata before constructing a partial proxy", () => {
    class Invalid extends FlashProxy {
        static override readonly flashProxyDeclaredProperties = {} as readonly PropertyKey[];
    }
    assert.throws(() => new Invalid(), /declareFlashProxyProperties/);
});
