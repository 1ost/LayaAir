import { ILaya } from "../../ILaya";
import { ILoadTask } from "../net/Loader";
import { URL } from "../net/URL";
import { Browser } from "../utils/Browser";
import { Utils } from "../utils/Utils";
import { PAL } from "./PlatformAdapters";
import { consumeFontTransactionPermit } from "./AuthoredFontRegistry";

export interface AuthenticatedFontReceiptIdentity {
    readonly key: string;
    readonly sourceSha256: string;
}

export interface AuthenticatedFontLoadReceipt {
    readonly family: string;
    readonly identity: AuthenticatedFontReceiptIdentity;
    readonly committed: boolean;
    readonly disposed: boolean;
    commit(): Promise<void>;
    dispose(): Promise<void>;
}

export type FontLoadResult = { family: string } | AuthenticatedFontLoadReceipt;

const AUTHENTICATED_FONT_RECEIPTS = new WeakSet<object>();
const SHA256 = /^[a-f0-9]{64}$/;

/** @internal Nominal proof that a receipt came from an engine font adapter. */
export function isAuthenticatedFontLoadReceipt(value: unknown): value is AuthenticatedFontLoadReceipt {
    return typeof value === "object" && value !== null && AUTHENTICATED_FONT_RECEIPTS.has(value);
}

/**
 * @ignore
 */
export class FontAdapter {

    loadFont(task: ILoadTask): Promise<FontLoadResult | null> {
        let fontName = this.resolveFamily(task);
        if (task.options.authoredFontIdentity != null) {
            if (!consumeFontTransactionPermit(task))
                throw new Error("Authored font loading requires an engine registry transaction");
            return this.prepareAuthenticatedFont(task, fontName);
        }
        let url = URL.postFormatURL(URL.formatURL(task.url));
        if (Browser.window.FontFace)
            return this.loadByFontFace(task, url, fontName);
        else
            return this.loadByCSS(task, url, fontName);
    }

    protected async prepareAuthenticatedFont(
        task: ILoadTask,
        fontName: string,
    ): Promise<AuthenticatedFontLoadReceipt | null> {
        if (!Browser.window.FontFace || !Browser.document?.fonts)
            return null;
        const authenticated = await this.fetchAuthenticatedBytes(task);
        if (!authenticated) return null;
        const fontFace: any = new Browser.window.FontFace(fontName, authenticated.bytes);
        await fontFace.load();
        const fonts = Browser.document.fonts as any;
        return this.createAuthenticatedReceipt(task, fontName, authenticated.sourceSha256, {
            commit: () => { fonts.add(fontFace); },
            dispose: () => { fonts.delete?.(fontFace); },
        });
    }

    protected async fetchAuthenticatedBytes(
        task: ILoadTask,
    ): Promise<{ bytes: ArrayBuffer; sourceSha256: string } | null> {
        const expected = task.options.authoredFontSourceSha256;
        if (typeof expected !== "string" || !SHA256.test(expected))
            throw new TypeError("authoredFontSourceSha256 must be lowercase SHA-256");
        const bytes = await task.loader.fetch(task.url, "arraybuffer", task.progress?.createCallback(), {
            ...task.options,
            cache: false,
            ignoreCache: true,
            noRetry: true,
        });
        if (!(bytes instanceof ArrayBuffer)) return null;
        // Detach authentication from any mutable buffer retained by the
        // transport/cache. The digest and platform registration consume this
        // one private snapshot, closing mutation-based TOCTOU as well as
        // refetch-based substitution.
        const snapshot = bytes.slice(0);
        const actual = await rawSha256(snapshot);
        if (actual !== expected)
            throw new Error(`Authenticated font bytes do not match sourceSha256 (expected ${expected}, got ${actual})`);
        return { bytes: snapshot, sourceSha256: actual };
    }

    protected createAuthenticatedReceipt(
        task: ILoadTask,
        family: string,
        sourceSha256: string,
        actions: { commit(): void | Promise<void>; dispose(): void | Promise<void> },
    ): AuthenticatedFontLoadReceipt {
        const key = task.options.authoredFontIdentity;
        if (typeof key !== "string" || key.length === 0)
            throw new TypeError("authoredFontIdentity must be a non-empty engine identity");
        let committed = false;
        let disposed = false;
        const identity = Object.freeze({ key, sourceSha256 });
        const receipt: AuthenticatedFontLoadReceipt = Object.freeze({
            family,
            identity,
            get committed() { return committed; },
            get disposed() { return disposed; },
            async commit() {
                if (disposed) throw new Error("Cannot commit a disposed font receipt");
                if (committed) return;
                await actions.commit();
                committed = true;
            },
            async dispose() {
                if (disposed) return;
                try {
                    await actions.dispose();
                } finally {
                    disposed = true;
                    committed = false;
                }
            },
        });
        AUTHENTICATED_FONT_RECEIPTS.add(receipt);
        return receipt;
    }

    /** @internal Authored fonts request a collision-safe family through the normal TTF load task. */
    protected resolveFamily(task: ILoadTask): string {
        const requested = task.options.authoredFontFamily;
        if (requested == null)
            return Utils.replaceFileExtension(Utils.getBaseName(task.url), "");
        if (typeof requested !== "string" || requested.length > 384
            || !/^LayaAuthored_[A-Za-z0-9_-]+$/.test(requested))
            throw new TypeError("authoredFontFamily must be a collision-safe Laya authored family name");
        return requested;
    }

    protected loadByFontFace(task: ILoadTask, url: string, fontName: string): Promise<{ family: string } | null> {
        let fontFace: any = new Browser.window.FontFace(fontName, "url('" + url + "')");
        const fonts = Browser.document.fonts as any;
        fonts.add(fontFace);
        return fontFace.load().then(() => {
            return fontFace;
        }, (error: unknown) => {
            fonts.delete?.(fontFace);
            throw error;
        });
    }

    protected loadByCSS(task: ILoadTask, url: string, fontName: string): Promise<{ family: string } | null> {
        let fontTxt = "40px " + fontName;
        Browser.context.font = fontTxt;
        let oldWidth = Browser.context.measureText(testString).width;

        let fontStyle = Browser.createElement("style");
        fontStyle.type = "text/css";
        Browser.document.body.appendChild(fontStyle);
        fontStyle.textContent = "@font-face { font-family:'" + fontName + "'; src:url('" + url + "');}";

        return new Promise((resolve) => {
            let checkComplete = () => {
                Browser.context.font = fontTxt;
                let newWidth = Browser.context.measureText(testString).width;
                if (newWidth != oldWidth)
                    complete(true);
            };
            let complete = (loaded = false) => {
                ILaya.systemTimer.clear(this, checkComplete);
                ILaya.systemTimer.clear(this, complete);
                if (!loaded) Browser.removeElement(fontStyle);
                resolve(loaded ? { family: fontName } : null);
            };

            ILaya.systemTimer.once(10000, this, complete, [false]);
            ILaya.systemTimer.loop(20, this, checkComplete);
        });
    }
}

const testString = "LayaTTFFont";

PAL.register("font", FontAdapter);

async function rawSha256(bytes: ArrayBuffer): Promise<string> {
    const subtle = Browser.window.crypto?.subtle;
    if (!subtle) throw new Error("Authenticated font loading requires Web Crypto SHA-256");
    const digest = await subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, "0")).join("");
}
