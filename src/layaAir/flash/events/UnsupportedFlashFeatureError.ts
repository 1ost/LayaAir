/**
 * Raised when ported ActionScript reaches a Flash capability that this bridge
 * has not admitted. The bridge never silently substitutes different behavior.
 */
export class UnsupportedFlashFeatureError extends Error {
    readonly feature: string;

    constructor(feature: string, detail?: string) {
        super(detail ? `${feature}: ${detail}` : feature);
        this.name = "UnsupportedFlashFeatureError";
        this.feature = feature;
    }
}
