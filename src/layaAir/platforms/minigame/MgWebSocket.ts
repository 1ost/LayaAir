import { IWebSocket, IWebSocketCloseInfo, IWebSocketConnectOptions } from "../../laya/net/IWebSocket";
import { PAL } from "../../laya/platform/PlatformAdapters";

export class MgWebSocket implements IWebSocket {
    ws: WechatMinigame.SocketTask;

    onOpen: (result: any) => void;
    onClose: (info: IWebSocketCloseInfo) => void;
    onError: (e: any) => void;
    onMessage: (data: string | ArrayBuffer) => void;

    private _generation: number = 0;

    open(url: string, options?: IWebSocketConnectOptions) {
        const generation = ++this._generation;
        let failed = false;
        this.ws = PAL.g.connectSocket(Object.assign({
            url,
            multiple: true, //支付宝需要这个
            fail: (err: any) => {
                failed = true;
                if (this._generation === generation)
                    this.onError(err);
            }
        }, options));
        if (this.ws == null || failed) {
            this.ws = null;
            return;
        }

        const ws = this.ws;
        ws.onOpen(res => {
            if (this._isCurrent(ws, generation))
                this.onOpen(res);
        });
        ws.onClose(result => {
            if (!this._isCurrent(ws, generation))
                return;
            const closeResult: any = result;
            this.onClose({
                code: closeResult?.code,
                reason: closeResult?.reason,
                wasClean: closeResult?.wasClean
            });
            if (this._isCurrent(ws, generation))
                ++this._generation;
        });
        ws.onError(err => {
            if (this._isCurrent(ws, generation))
                this.onError(err);
        });
        ws.onMessage(msg => {
            if (this._isCurrent(ws, generation) && msg.data != null) {
                var data:any = msg.data;
                if (data.isBuffer) {
                    // 对齐web转成arrayBuffer;
                    data = this.base64ToArrayBuffer(data.data);
                }
                this.onMessage(data);
            }
        });
    }

    /** 将 Base64 字符串转为 ArrayBuffer */
    private base64ToArrayBuffer(base64: string): ArrayBuffer {
        const binary = atob(base64);
        const len = binary.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
            bytes[i] = binary.charCodeAt(i);
        }
        return bytes.buffer;
    }

    close(code?: number, reason?: string): void {
        if (this.ws) {
            const options: WechatMinigame.SocketTaskCloseOption = {};
            if (code != null)
                options.code = code;
            if (reason != null)
                options.reason = reason;
            this.ws.close(options);
        }
    }

    send(data: string | ArrayBuffer): Promise<void> {
        if (this.ws == null)
            return Promise.reject("WebSocket is not open");

        return new Promise((resolve, reject) => {
            this.ws.send({
                data,
                success: () => resolve(),
                fail: (e) => reject(e)
            });
        });
    }

    private _isCurrent(ws: WechatMinigame.SocketTask, generation: number): boolean {
        return this.ws === ws && this._generation === generation;
    }
}
