import { ApplicationDomain } from "../../src/layaAir/flash";

const current: ApplicationDomain = ApplicationDomain.currentDomain;
const child = new ApplicationDomain(current);

void [child.parentDomain, child.hasDefinition("Object")];
