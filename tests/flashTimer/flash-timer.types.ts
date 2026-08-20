import {
    getTimer, setTimeout, clearTimeout, setInterval, clearInterval,
} from "../../src/layaAir/flash";

const elapsed: number = getTimer();
const timeoutId: number = setTimeout((value: number) => value + elapsed, 0, 1);
const intervalId: number = setInterval((left: string, right: number) => `${left}${right}`, 1, "x", 2);
clearTimeout(timeoutId);
clearInterval(intervalId);

export { elapsed };
