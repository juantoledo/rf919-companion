import {Waiters} from "./memories.js";

// Shared between the links and the UI: every decoded event passes through waiters (see memories.js)
export const waiters = new Waiters();
