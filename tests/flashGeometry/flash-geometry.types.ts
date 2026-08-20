import { DisplayObject } from "../../src/layaAir/flash/display/DisplayObject";
import { Matrix } from "../../src/layaAir/flash/geom/Matrix";
import { Point } from "../../src/layaAir/flash/geom/Point";
import { Transform } from "../../src/layaAir/flash/geom/Transform";
import { Matrix as LayaMatrix } from "../../src/layaAir/laya/maths/Matrix";
import { Point as LayaPoint } from "../../src/layaAir/laya/maths/Point";

const matrix = new Matrix();
const point: Point = matrix.transformPoint(new Point());
const mutation: void = matrix.concat(new Matrix());
const display = new DisplayObject();
const transform: Transform = display.transform;
display.transform = transform;

// @ts-expect-error Flash Matrix cannot consume a native Laya matrix.
matrix.concat(new LayaMatrix());
// @ts-expect-error Flash Matrix cannot consume a native Laya point.
matrix.transformPoint(new LayaPoint());
// @ts-expect-error Laya-only matrix operation is not source-visible.
matrix.skew(1, 1);
// @ts-expect-error Laya-only matrix static is not source-visible.
Matrix.EMPTY;
// @ts-expect-error Flash DisplayObject accepts only a Flash Transform facade.
display.transform = new LayaMatrix();
// @ts-expect-error Transform is not a Matrix and has no matrix fields.
transform.a;
// @ts-expect-error Transform is not a Matrix and cannot clone itself.
transform.clone();

void [point, mutation];
