import { FlashGlobalErrorBoundary } from "../../src/layaAir/flash/browser/FlashGlobalErrorBoundary";

void run().then(
    result => publish({ ok: true, result }),
    error => publish({ ok: false, error: error instanceof Error ? `${error.stack ?? error.message}` : String(error) }),
);

async function run(): Promise<Record<string, unknown>> {
    const reports: Array<{
        source: string;
        payload: unknown;
        nativeEvent: Event;
        defaultPrevented: boolean;
    }> = [];
    const reportCount = (): number => reports.length;
    const canceledReason = Object.freeze({ id: "canceled-reason" });
    const producedError = new Error("actual uncaught producer");
    const producedReason = Object.freeze({ id: "actual-unhandled-rejection-producer" });
    const disposedError = new Error("actual uncaught producer after dispose");
    const disposedReason = Object.freeze({ id: "actual-rejection-after-dispose" });
    const recoveryReason = Object.freeze({ id: "actual-rejection-after-resubscribe" });
    let producedErrorEvent: ErrorEvent | undefined;
    let producedRejectionEvent: PromiseRejectionEvent | undefined;
    let disposedErrorEvent: ErrorEvent | undefined;
    let disposedRejectionEvent: PromiseRejectionEvent | undefined;
    let reportsFrozen = true;
    const cancelRejection = (event: PromiseRejectionEvent): void => {
        if (event.reason === producedReason) producedRejectionEvent = event;
        if (event.reason === disposedReason) disposedRejectionEvent = event;
        if ([canceledReason, producedReason, disposedReason, recoveryReason].includes(event.reason))
            event.preventDefault();
    };
    const cancelProducedError = (event: ErrorEvent): void => {
        if (event.error === producedError) producedErrorEvent = event;
        if (event.error === disposedError) disposedErrorEvent = event;
        if (event.error === producedError || event.error === disposedError) event.preventDefault();
    };
    window.addEventListener("unhandledrejection", cancelRejection);
    window.addEventListener("error", cancelProducedError);
    const lease = FlashGlobalErrorBoundary.subscribe(window, report => {
        reportsFrozen &&= Object.isFrozen(report);
        reports.push({
            source: report.source,
            payload: report.source === "error" ? report.error : report.reason,
            nativeEvent: report.nativeEvent,
            defaultPrevented: report.defaultPrevented,
        });
    });

    const exactError = new Error("native ErrorEvent identity");
    const errorEvent = new ErrorEvent("error", { error: exactError, message: exactError.message, cancelable: true });
    const rejectionEvent = new PromiseRejectionEvent("unhandledrejection", {
        promise: Promise.resolve(),
        reason: canceledReason,
        cancelable: true,
    });
    window.dispatchEvent(errorEvent);
    window.dispatchEvent(rejectionEvent);

    requireValue(reportCount() === 2, "two native reports expected");
    requireValue(reports[0].source === "error" && reports[1].source === "unhandledrejection", "route ordering drift");
    requireValue(reports[0].payload === exactError && reports[0].nativeEvent === errorEvent, "ErrorEvent identity drift");
    requireValue(reports[0].defaultPrevented === false && errorEvent.defaultPrevented === false, "boundary canceled ErrorEvent");
    requireValue(reports[1].payload === canceledReason && reports[1].nativeEvent === rejectionEvent, "rejection identity drift");
    requireValue(reports[1].defaultPrevented === true, "preexisting cancellation was not observed");
    requireValue(reportsFrozen, "reports must be immutable");

    // Exercise the browser's real producer routes. Promise rejection is
    // created before the throw in one timer task; Chromium reports the
    // synchronous error route before its later unhandled-rejection route.
    setTimeout(() => {
        void Promise.reject(producedReason);
        throw producedError;
    }, 0);
    await until(() => reportCount() === 4, "actual browser producers did not publish both routes");
    requireValue(reports[2].source === "error" && reports[3].source === "unhandledrejection", "actual producer ordering drift");
    requireValue(reports[2].payload === producedError, "actual ErrorEvent.error identity drift");
    requireValue(reports[3].payload === producedReason, "actual PromiseRejectionEvent.reason identity drift");
    requireValue(reports[2].nativeEvent === producedErrorEvent, "actual ErrorEvent native identity drift");
    requireValue(reports[3].nativeEvent === producedRejectionEvent, "actual rejection native identity drift");
    requireValue(reports[2].defaultPrevented === true, "actual ErrorEvent cancellation was not observed");
    requireValue(reports[3].defaultPrevented === true, "actual rejection cancellation was not observed");

    lease.dispose();
    setTimeout(() => {
        void Promise.reject(disposedReason);
        throw disposedError;
    }, 0);
    await until(
        () => disposedErrorEvent !== undefined && disposedRejectionEvent !== undefined,
        "both actual browser routes were not produced after disposal",
    );
    requireValue(reportCount() === 4, "disposed boundary received an actual browser event");

    const recovered: unknown[] = [];
    const recoveredLease = FlashGlobalErrorBoundary.subscribe(window, report => {
        if (report.source === "unhandledrejection") recovered.push(report.reason);
    });
    void Promise.reject(recoveryReason);
    await until(() => recovered.length === 1, "resubscribed boundary did not recover delivery");
    requireValue(recovered[0] === recoveryReason, "resubscribed rejection identity drift");
    recoveredLease.dispose();
    window.removeEventListener("error", cancelProducedError);
    window.removeEventListener("unhandledrejection", cancelRejection);

    return {
        nativeConstructors: [errorEvent.constructor.name, rejectionEvent.constructor.name],
        order: reports.slice(2).map(report => report.source),
        identitiesPreserved: true,
        cancellationObserved: true,
        disposalSuppressedDelivery: true,
        actualProducers: true,
        resubscribeRecoveredDelivery: true,
    };
}

async function until(predicate: () => boolean, message: string): Promise<void> {
    for (let attempt = 0; attempt < 100; attempt++) {
        if (predicate()) return;
        await delay(10);
    }
    throw new Error(message);
}

function delay(milliseconds: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, milliseconds));
}

function requireValue(condition: unknown, message: string): asserts condition {
    if (!condition) throw new Error(message);
}

function publish(value: unknown): void {
    const output = document.createElement("pre");
    output.id = "flash-global-error-browser-result";
    output.textContent = JSON.stringify(value);
    document.body.appendChild(output);
}
