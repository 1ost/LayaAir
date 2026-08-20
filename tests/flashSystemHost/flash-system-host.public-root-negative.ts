/// <reference path="../../build/types/LayaFlash.d.ts" />

const externalHost: LayaFlash.NativeExternalInterfaceHost = {
    call: (_name, _arguments) => undefined,
};
const systemHost: LayaFlash.NativeSystemHost = {
    setClipboard: _text => undefined,
};

const externalLease = LayaFlash.installNativeExternalInterfaceHost(externalHost);
const systemLease = LayaFlash.installNativeSystemHost(systemHost);
externalLease.dispose();
systemLease.dispose();

// @ts-expect-error generated public-root leases are nominal engine-issued values
const forgedExternalLease: LayaFlash.NativeExternalInterfaceHostLease = {
    active: true, disposed: false, dispose() {},
};
// @ts-expect-error generated public-root leases are nominal engine-issued values
const forgedSystemLease: LayaFlash.NativeSystemHostLease = {
    active: true, disposed: false, dispose() {},
};
// @ts-expect-error the emitted nominal external-host lease cannot be constructed
new LayaFlash.NativeExternalInterfaceHostLease();
// @ts-expect-error the emitted nominal System-host lease cannot be constructed
new LayaFlash.NativeSystemHostLease();
// @ts-expect-error the former hoisted unique-symbol brand must not be public
void LayaFlash.NATIVE_EXTERNAL_INTERFACE_HOST_LEASE;
// @ts-expect-error the former hoisted unique-symbol brand must not be public
void LayaFlash.NATIVE_SYSTEM_HOST_LEASE;

void [forgedExternalLease, forgedSystemLease];
