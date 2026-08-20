import { prepareFlashHTTPRequest, requireFlashHTTPHost } from "./FlashHTTPTransport";
import { snapshotFlashURLRequest, URLRequest } from "./URLRequest";

/**
 * Starts a source-used fire-and-forget HTTP request. Browser delivery after
 * page termination remains subject to the Fetch keepalive limits and is not
 * reported as a Flash completion event.
 */
export function sendToURL(request: URLRequest): void {
    const prepared = prepareFlashHTTPRequest(snapshotFlashURLRequest(request), true);
    const host = requireFlashHTTPHost();
    const controller = new AbortController();
    void host.request(prepared, controller.signal, () => undefined, () => undefined)
        .catch(() => undefined);
}
