import { ILoadTask } from "../../laya/net/Loader";
import { FontAdapter } from "../../laya/platform/FontAdapter";
import { PAL } from "../../laya/platform/PlatformAdapters";

export class NativeFontAdapter extends FontAdapter {

    loadFont(task: ILoadTask): Promise<{ family: string } | null> {
        let fontName = this.resolveFamily(task);
        return task.loader.fetch(task.url, "arraybuffer").then(data => {
            if (!data) return null;
            PAL.g.registerFont(fontName, data);
            return { family: fontName };
        });
    }
}

PAL.register("font", NativeFontAdapter);
