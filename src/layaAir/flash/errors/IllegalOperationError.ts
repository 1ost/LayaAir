/** Error raised when a caller requests an operation forbidden by an API contract. */
export class IllegalOperationError extends Error {
    declare readonly errorID: number;

    constructor(message = "", id = 0) {
        super(String(message));
        Object.setPrototypeOf(this, new.target.prototype);
        const numericId = Number(id);
        Object.defineProperty(this, "errorID", {
            value: Number.isFinite(numericId) ? numericId >> 0 : 0,
            enumerable: false,
            writable: false,
            configurable: false,
        });
    }
}
