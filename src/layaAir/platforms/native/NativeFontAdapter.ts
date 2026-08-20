import { ILoadTask } from "../../laya/net/Loader";
import { FontAdapter, FontLoadResult } from "../../laya/platform/FontAdapter";
import { PAL } from "../../laya/platform/PlatformAdapters";

export class NativeFontAdapter extends FontAdapter {

    loadFont(task: ILoadTask): Promise<FontLoadResult | null> {
        let fontName = this.resolveFamily(task);
        if (task.options.authoredFontIdentity != null) return super.loadFont(task);
        return task.loader.fetch(task.url, "arraybuffer").then(data => {
            if (!data) return null;
            PAL.g.registerFont(fontName, data);
            return { family: fontName };
        });
    }

    protected async prepareAuthenticatedPlatform(
        task: ILoadTask,
        fontName: string,
    ) {
        if (typeof PAL.g?.registerFont !== "function" || typeof PAL.g?.unregisterFont !== "function")
            return null;
        const authenticated = await this.fetchAuthenticatedBytes(task);
        if (!authenticated) return null;
        return {
            sourceSha256: authenticated.sourceSha256,
            commit: () => PAL.g.registerFont(fontName, authenticated.bytes),
            dispose: () => PAL.g.unregisterFont(fontName),
        };
    }
}

PAL.register("font", NativeFontAdapter);
