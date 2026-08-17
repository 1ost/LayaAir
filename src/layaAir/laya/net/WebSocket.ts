import { Browser } from "../utils/Browser";
import { IWebSocket, IWebSocketCloseInfo, IWebSocketConnectOptions } from "./IWebSocket";

/** @internal */
export class _WebSocket implements IWebSocket {
    ws: WebSocket;

    onOpen: (result: any) => void;
    onClose: (info: IWebSocketCloseInfo) => void;
    onError: (e: any) => void;
    onMessage: (data: string | ArrayBuffer) => void;

    private _generation: number = 0;
    private _openTimeout: number = null;
    private _receiveQueue: Promise<void> = Promise.resolve();

    open(url: string, options?: IWebSocketConnectOptions) {
        this._clearOpenTimeout();
        const previous = this.ws;
        const generation = ++this._generation;
        if (previous) {
            try {
                previous.close();
            } catch (e) {
            }
        }
        let protocols = options?.protocols;
        if (!protocols || protocols.length == 0)
            this.ws = new Browser.window.WebSocket(url);
        else
            this.ws = new Browser.window.WebSocket(url, protocols);
        const ws = this.ws;
        this._receiveQueue = Promise.resolve();
        ws.binaryType = "arraybuffer";

        ws.onopen = () => {
            if (!this._isCurrent(ws, generation))
                return;
            this._clearOpenTimeout();
            this.onOpen({});
        };
        ws.onclose = e => {
            if (!this._isCurrent(ws, generation))
                return;
            this._clearOpenTimeout();
            const info: IWebSocketCloseInfo = {
                code: e.code,
                reason: e.reason,
                wasClean: e.wasClean
            };
            this._enqueue(ws, generation, () => {
                this.onClose(info);
                if (this._isCurrent(ws, generation))
                    ++this._generation;
            });
        };
        ws.onerror = err => {
            if (!this._isCurrent(ws, generation))
                return;
            this._clearOpenTimeout();
            this.onError(err);
        };
        ws.onmessage = msg => {
            if (!this._isCurrent(ws, generation) || msg.data == null)
                return;
            this._enqueue(ws, generation, async () => {
                let data: string | ArrayBuffer = msg.data;
                const BlobClass = Browser.window.Blob;
                if (BlobClass && data instanceof BlobClass)
                    data = await (<Blob><unknown>data).arrayBuffer();
                if (this._isCurrent(ws, generation))
                    this.onMessage(data);
            });
        };

        const timeout = options?.timeout;
        if (timeout > 0) {
            this._openTimeout = Browser.window.setTimeout(() => {
                if (!this._isCurrent(ws, generation))
                    return;
                this._openTimeout = null;
                this.onError(new Error(`WebSocket connection timed out after ${timeout} ms.`));
                try {
                    ws.close();
                } catch (e) {
                }
            }, timeout);
        }
    }

    close(code?: number, reason?: string): void {
        this._clearOpenTimeout();
        if (code == null)
            this.ws.close();
        else if (reason == null)
            this.ws.close(code);
        else
            this.ws.close(code, reason);
    }

    send(data: string | ArrayBuffer): Promise<void> {
        this.ws.send(data);
        return Promise.resolve();
    }

    private _isCurrent(ws: WebSocket, generation: number): boolean {
        return this.ws === ws && this._generation === generation;
    }

    private _enqueue(ws: WebSocket, generation: number, task: () => void | Promise<void>): void {
        this._receiveQueue = this._receiveQueue.then(async () => {
            if (this._isCurrent(ws, generation))
                await task();
        }).catch(e => {
            if (this._isCurrent(ws, generation))
                this.onError(e);
        });
    }

    private _clearOpenTimeout(): void {
        if (this._openTimeout != null) {
            Browser.window.clearTimeout(this._openTimeout);
            this._openTimeout = null;
        }
    }
}
