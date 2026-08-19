import path from "node:path";

import { canonicalJson } from "./project/CanonicalJson.js";
import { preflightAuthoredContentProvider } from "./project/ProviderPreflight.js";
import { checkPublishedAuthoredContentGeneration } from "./publish/AtomicAuthoredContentPublisher.js";
import {
    AuthoredContentProject,
    AuthoredContentToolError,
    CheckAuthoredContentDeliveryRequest,
    CheckAuthoredContentDeliveryResult
} from "./types.js";

/** Authenticates an already-published delivery without converting or copying it. */
export async function checkAuthoredContentDelivery(
    requestValue: CheckAuthoredContentDeliveryRequest
): Promise<CheckAuthoredContentDeliveryResult> {
    const request = validateRequest(requestValue);
    const receipt = await checkPublishedAuthoredContentGeneration(request.deliveryRoot);
    const project: AuthoredContentProject = {
        schema: "laya-authored-content-project@1",
        provider: {
            repository: receipt.provider.repository,
            commit: receipt.provider.commit,
            packageVersion: receipt.provider.packageVersion,
            remote: receipt.provider.remote,
            capabilityLedger: receipt.provider.capabilityLedger
        },
        jobs: []
    };
    const current = await preflightAuthoredContentProvider(project, request.providerRoot);
    if (canonicalJson(current.receipt) !== canonicalJson(receipt.provider))
        throw new AuthoredContentToolError("AUTHORED_CONTENT_DELIVERY_PROVIDER_DRIFT", "stored receipt provider provenance does not match the authenticated LayaAir provider.");
    return { exitCode: 0, receipt };
}

function validateRequest(value: CheckAuthoredContentDeliveryRequest): CheckAuthoredContentDeliveryRequest {
    if (!value || typeof value !== "object" || Array.isArray(value))
        throw new AuthoredContentToolError("AUTHORED_CONTENT_DELIVERY_REQUEST", "delivery request must be an object.");
    const source = value as unknown as Record<string, unknown>;
    const keys = Object.keys(source).sort();
    if (keys.join("\0") !== ["deliveryRoot", "providerRoot"].sort().join("\0"))
        throw new AuthoredContentToolError("AUTHORED_CONTENT_DELIVERY_REQUEST_KEYS", "delivery request keys must be exactly deliveryRoot and providerRoot.");
    for (const key of keys) {
        const item = source[key];
        if (typeof item !== "string" || !path.isAbsolute(item) || item !== item.trim() || item.includes("\0"))
            throw new AuthoredContentToolError("AUTHORED_CONTENT_DELIVERY_REQUEST_PATH", `${key} must be an absolute path.`);
    }
    return { deliveryRoot: path.normalize(source.deliveryRoot as string), providerRoot: path.normalize(source.providerRoot as string) };
}
