import { ILoadTask, IResourceLoader, Loader } from "../../net/Loader";
import { SwfParser } from "./SwfParser";

export class SwfLoader implements IResourceLoader {
    load(task: ILoadTask): Promise<any> {
        return task.loader.fetch(task.url, "arraybuffer", task.progress.createCallback(), task.options).then(data => {
            if (!data) {
                return null;
            }
            return SwfParser.parse(data);
        });
    }
}

Loader.registerLoader([], SwfLoader, Loader.FLASH_SWF);
