/** Error raised when a caller requests an operation forbidden by an API contract. */
export class IllegalOperationError extends Error {
    readonly errorID: number;

    constructor(message = "", id = 0) {
        super(String(message));
        this.name = "IllegalOperationError";
        this.errorID = Number.isFinite(Number(id)) ? Math.trunc(Number(id)) : 0;
        Object.setPrototypeOf(this, new.target.prototype);
    }
}
