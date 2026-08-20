import assert from "node:assert/strict";
import test from "node:test";
import type {
    FlashURLRequestSnapshot, URLRequest, URLRequestHeader, isFlashURLRequest, navigateToURL,
    snapshotFlashURLRequest, snapshotNativeLoaderRequest
} from "../../src/layaAir/flash/net/URLRequest.ts";
import type { URLLoaderDataFormat } from "../../src/layaAir/flash/net/URLLoaderDataFormat.ts";
import type { URLVariables, isFlashURLVariables } from "../../src/layaAir/flash/net/URLVariables.ts";
import type { URLLoader, isFlashURLLoader } from "../../src/layaAir/flash/net/URLLoader.ts";
import type {
    FlashHTTPHost, FlashHTTPRequest, FlashHTTPProgressObserver, FlashHTTPResponse, FlashHTTPStatusObserver,
    installFlashHTTPHost, isFlashHTTPHost, prepareFlashHTTPRequest, requireFlashHTTPHost,
} from "../../src/layaAir/flash/net/FlashHTTPTransport.ts";
import type { sendToURL } from "../../src/layaAir/flash/net/sendToURL.ts";
import type {
    FlashSharedObjectStorageHost, SharedObject, installFlashSharedObjectStorageHost, isFlashSharedObject,
} from "../../src/layaAir/flash/net/SharedObject.ts";
import type { LocalConnection, isFlashLocalConnection } from "../../src/layaAir/flash/net/LocalConnection.ts";
import type {
    FileReference, FlashFileDownload, FlashFileDownloadHost, installFlashFileDownloadHost, isFlashFileReference,
} from "../../src/layaAir/flash/net/FileReference.ts";
import type {
    FlashSocketCallbacks, FlashSocketConnectOptions, FlashSocketConnection, FlashSocketHost, Socket,
    installFlashSocketHost, isFlashSocket,
} from "../../src/layaAir/flash/net/Socket.ts";
import type {
    NativeClassConstructor, registerClassAlias, resolveAliasForClass, resolveClassAlias,
} from "../../src/layaAir/flash/net/ClassAlias.ts";

test("Flash net bridge compiler surface", () => {
    assert.ok(true as boolean satisfies ([
        typeof URLRequest, URLRequestHeader, FlashURLRequestSnapshot, typeof isFlashURLRequest,
        typeof navigateToURL, typeof snapshotNativeLoaderRequest, typeof snapshotFlashURLRequest,
        typeof URLLoaderDataFormat, typeof URLVariables, typeof isFlashURLVariables,
        typeof URLLoader, typeof isFlashURLLoader,
        typeof FlashHTTPHost, FlashHTTPRequest, FlashHTTPResponse, FlashHTTPProgressObserver,
        FlashHTTPStatusObserver, typeof installFlashHTTPHost, typeof isFlashHTTPHost,
        typeof prepareFlashHTTPRequest, typeof requireFlashHTTPHost, typeof sendToURL,
        typeof FlashSharedObjectStorageHost, typeof SharedObject,
        typeof installFlashSharedObjectStorageHost, typeof isFlashSharedObject,
        typeof LocalConnection, typeof isFlashLocalConnection,
        FlashFileDownload, typeof FlashFileDownloadHost, typeof FileReference,
        typeof installFlashFileDownloadHost, typeof isFlashFileReference,
        FlashSocketCallbacks, FlashSocketConnection, FlashSocketConnectOptions,
        typeof FlashSocketHost, typeof Socket, typeof installFlashSocketHost, typeof isFlashSocket,
        NativeClassConstructor, typeof registerClassAlias, typeof resolveClassAlias, typeof resolveAliasForClass,
    ] extends readonly unknown[] ? boolean : never));
});
