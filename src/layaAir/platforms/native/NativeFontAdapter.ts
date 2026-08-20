import { ILoadTask } from "../../laya/net/Loader";
import { AuthenticatedFontLoadReceipt, FontAdapter, FontLoadResult } from "../../laya/platform/FontAdapter";
import { PAL } from "../../laya/platform/PlatformAdapters";
import { consumeAuthoredFontLoadAuthorization } from "../../flash/text/Font";

export class NativeFontAdapter extends FontAdapter {

    loadFont(task: ILoadTask): Promise<FontLoadResult | null> {
        let fontName = this.resolveFamily(task);
        if (task.options.authoredFontIdentity != null) {
            if (!consumeAuthoredFontLoadAuthorization(task))
                throw new Error("Authored font loading requires an engine registry transaction");
            return this.prepareAuthenticatedNativeFont(task, fontName);
        }
        return task.loader.fetch(task.url, "arraybuffer").then(data => {
            if (!data) return null;
            PAL.g.registerFont(fontName, data);
            return { family: fontName };
        });
    }

    private async prepareAuthenticatedNativeFont(
        task: ILoadTask,
        fontName: string,
    ): Promise<AuthenticatedFontLoadReceipt | null> {
        if (typeof PAL.g?.registerFont !== "function" || typeof PAL.g?.unregisterFont !== "function")
            return null;
        const authenticated = await this.fetchAuthenticatedBytes(task);
        if (!authenticated) return null;
        return this.createAuthenticatedReceipt(task, fontName, authenticated.sourceSha256, {
            commit: () => PAL.g.registerFont(fontName, authenticated.bytes),
            dispose: () => PAL.g.unregisterFont(fontName),
        });
    }
}

PAL.register("font", NativeFontAdapter);
