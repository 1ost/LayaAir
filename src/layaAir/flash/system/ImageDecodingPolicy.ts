/** Browser-image decode scheduling values retained by the native image path. */
export class ImageDecodingPolicy {
    static readonly ON_DEMAND = "onDemand";
    static readonly ON_LOAD = "onLoad";
}

Object.freeze(ImageDecodingPolicy);
