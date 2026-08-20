import { ILoadTask } from "../../laya/net/Loader";
import { FontAdapter } from "../../laya/platform/FontAdapter";
import { PAL } from "../../laya/platform/PlatformAdapters";

export class MgFontAdapter extends FontAdapter {

    loadFont(task: ILoadTask): Promise<{ family: string } | null> {
        if (task.options.authoredFontIdentity != null) return super.loadFont(task);
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

    protected async prepareAuthenticatedPlatform(): Promise<null> {
        return null;
    }
}

PAL.register("font", MgFontAdapter);
