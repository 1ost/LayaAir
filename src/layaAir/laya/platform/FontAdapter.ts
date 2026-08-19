import { ILaya } from "../../ILaya";
import { ILoadTask } from "../net/Loader";
import { URL } from "../net/URL";
import { Browser } from "../utils/Browser";
import { Utils } from "../utils/Utils";
import { PAL } from "./PlatformAdapters";

/**
 * @ignore
 */
export class FontAdapter {

    loadFont(task: ILoadTask): Promise<{ family: string } | null> {
        let fontName = this.resolveFamily(task);
        let url = URL.postFormatURL(URL.formatURL(task.url));
        if (Browser.window.FontFace)
            return this.loadByFontFace(task, url, fontName);
        else
            return this.loadByCSS(task, url, fontName);
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
