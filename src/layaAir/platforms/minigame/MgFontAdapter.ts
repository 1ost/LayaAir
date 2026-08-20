import { ILoadTask } from "../../laya/net/Loader";
import { FontAdapter } from "../../laya/platform/FontAdapter";
import { PAL } from "../../laya/platform/PlatformAdapters";
import { consumeFontTransactionPermit } from "../../laya/platform/AuthoredFontRegistry";

export class MgFontAdapter extends FontAdapter {

    loadFont(task: ILoadTask): Promise<{ family: string } | null> {
        if (task.options.authoredFontIdentity != null) {
            if (!consumeFontTransactionPermit(task))
                throw new Error("Authored font loading requires an engine registry transaction");
            return Promise.resolve(null);
        }
        if (!PAL.g.loadFont) {
            PAL.warnIncompatibility("TTFont");
            return Promise.resolve(null);
        }

        return task.loader.fetch(task.url, <any>"filePath", task.progress.createCallback(), task.options).then((filePath: string) => {
            if (filePath) {
                let fontFamily = PAL.g.loadFont(filePath);
                return fontFamily ? { family: fontFamily } : null;
            }
            else
                return null;
        });
    }
}

PAL.register("font", MgFontAdapter);
