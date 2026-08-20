import type {
    FileReference, FlashFileDownloadHost, FlashHTTPHost, FlashSharedObjectStorageHost, FlashSocketHost,
    LocalConnection, SharedObject, Socket, URLLoader, URLRequest, URLVariables,
} from "../../src/layaAir/flash/index";
import {
    FileReference as FileReferenceValue,
    LocalConnection as LocalConnectionValue,
    SharedObject as SharedObjectValue,
    Socket as SocketValue,
    URLLoader as URLLoaderValue,
    URLRequest as URLRequestValue,
    URLVariables as URLVariablesValue,
    registerClassAlias,
    sendToURL,
} from "../../src/layaAir/flash/index";
import type { ByteArray } from "../../src/layaAir/flash/utils/ByteArray";

declare const request: URLRequest;
declare const bytes: ByteArray;
declare const httpHost: FlashHTTPHost;
declare const socketHost: FlashSocketHost;
declare const storageHost: FlashSharedObjectStorageHost;
declare const fileHost: FlashFileDownloadHost;

const loader: URLLoader = new URLLoaderValue(request);
loader.dataFormat = "binary";
const variables: URLVariables = new URLVariablesValue("a=1&a=2");
variables.log = "message";
const socket: Socket = new SocketValue();
socket.writeBytes(bytes, 0, bytes.length);
const shared: SharedObject = SharedObjectValue.getLocal("BleachGame");
const local: LocalConnection = new LocalConnectionValue();
const file: FileReference = new FileReferenceValue();
file.save(bytes, "asset.plib");
sendToURL(new URLRequestValue("/log"));
registerClassAlias("game.Type", class GameType {});

void [loader, variables, socket, shared, local, file, httpHost, socketHost, storageHost, fileHost];
