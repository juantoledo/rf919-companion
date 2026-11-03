// RF919 Companion: entry point. The logic modules (protocol.js, radiomap.js, memories.js, link.js) have no DOM;
// the UI lives in ui/:
//   shell.js     status, the decoded-event handlers, routing between the four views, the Remote and ask() dialogs,
//                the band pickers and gestures
//   radio.js     what's on a frequency: the info panels shared by Radio and Explore, Nearby, Near me
//   memories.js  the Memories view: list, runs, Store here, Start fresh, backup, list builders
//   more.js      tests and developer tools, the connection, keys and the keyboard
// Each module only declares things when it loads; its init() runs what has to happen at start-up, here, in this
// order, once every module is loaded (so the modules may use each other freely).
import {init as initShell} from "./ui/shell.js";
import {init as initRadio} from "./ui/radio.js";
import {init as initMemories} from "./ui/memories.js";
import {init as initMore} from "./ui/more.js";

initShell();
initRadio();
initMemories();
initMore();
