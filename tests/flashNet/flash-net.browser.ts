import { Event } from "../../src/layaAir/flash/events/Event";
import { HTTPStatusEvent } from "../../src/layaAir/flash/events/HTTPStatusEvent";
import { IOErrorEvent } from "../../src/layaAir/flash/events/IOErrorEvent";
import { ProgressEvent } from "../../src/layaAir/flash/events/ProgressEvent";
import { LocalConnection } from "../../src/layaAir/flash/net/LocalConnection";
import { SharedObject } from "../../src/layaAir/flash/net/SharedObject";
import { URLLoader } from "../../src/layaAir/flash/net/URLLoader";
import { URLLoaderDataFormat } from "../../src/layaAir/flash/net/URLLoaderDataFormat";
import { URLRequest } from "../../src/layaAir/flash/net/URLRequest";
import { URLVariables } from "../../src/layaAir/flash/net/URLVariables";
import { sendToURL } from "../../src/layaAir/flash/net/sendToURL";
import { ByteArray } from "../../src/layaAir/flash/utils/ByteArray";

function load(loader: URLLoader, request: URLRequest): Promise<{ events: string[]; progress: number[] }> {
    return new Promise((resolve, reject) => {
        const events: string[] = [];
        const progress: number[] = [];
        loader.addEventListener(HTTPStatusEvent.HTTP_STATUS, event => events.push(`status:${(event as HTTPStatusEvent).status}`));
        loader.addEventListener(ProgressEvent.PROGRESS, event => {
            events.push("progress");
            progress.push((event as ProgressEvent).bytesLoaded);
        });
        loader.addEventListener(IOErrorEvent.IO_ERROR, event => reject(new Error((event as IOErrorEvent).text)));
        loader.addEventListener(Event.COMPLETE, () => {
            events.push("complete");
            resolve({ events, progress });
        });
        loader.load(request);
    });
}

async function run(): Promise<Record<string, unknown>> {
    const binary = new URLLoader();
    binary.dataFormat = URLLoaderDataFormat.BINARY;
    const binaryResult = await load(binary, new URLRequest("/binary"));
    const bytes = binary.data as ByteArray;
    const binaryValue = bytes.readUnsignedInt();

    const payload = new URLVariables();
    payload.log = "browser producer";
    const report = new URLRequest("/log");
    report.data = payload;
    sendToURL(report);
    await new Promise(resolve => setTimeout(resolve, 50));
    const observed = new URLLoader();
    observed.dataFormat = URLLoaderDataFormat.VARIABLES;
    await load(observed, new URLRequest("/observed"));

    const shared = SharedObject.getLocal("flash-net-browser-gate");
    shared.clear();
    const live = shared.data;
    shared.setProperty("nullable", null);
    shared.setProperty("value", 9);
    shared.flush();
    shared.close();
    const reopened = SharedObject.getLocal("flash-net-browser-gate");
    const persisted = reopened.data.value;
    const persistedNull = reopened.data.nullable;
    reopened.clear();
    reopened.close();

    const first = new LocalConnection();
    const second = new LocalConnection();
    first.connect("browser-GC");
    let collision = false;
    try { second.connect("browser-GC"); }
    catch { collision = true; }
    first.close();

    return {
        binaryValue,
        firstEvent: binaryResult.events[0],
        finalEvent: binaryResult.events.at(-1),
        progressMonotonic: binaryResult.progress.every((value, index, all) => index === 0 || value >= all[index - 1]),
        observedLog: (observed.data as URLVariables).log,
        persisted,
        persistedNull,
        liveWasObject: typeof live === "object",
        collision,
    };
}

void run().then(result => publish({ ok: true, result }), error => publish({
    ok: false,
    error: error instanceof Error ? `${error.name}: ${error.message}\n${error.stack ?? ""}` : String(error),
}));

function publish(value: unknown): void {
    const marker = document.createElement("pre");
    marker.id = "flash-net-browser-result";
    marker.textContent = JSON.stringify(value);
    document.body.appendChild(marker);
}
