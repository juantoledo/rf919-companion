// RF919 Companion: entry point. The logic modules (protocol.js, radiomap.js, memories.js, link.js, tuner.js, logbook.js, names.js) have no DOM;
// the UI lives in ui/:
//   shell.js     status, the decoded-event handlers, routing between the five views, the Remote and ask() dialogs,
//                the band pickers and gestures
//   radio.js     what's on a frequency: the info panels shared by Radio and Explore, Nearby, Near me; Explore's
//                dial and band strip, pins, Share, reminders and Discover
//   find.js      Explore's home: search by station name, On air now, the pins' lamps
//   reception.js the reception estimate: its badge and sheet, the solar data, the conditions line
//   memories.js  the Memories view: list, runs, Store here, Start fresh, backup, list builders
//   log.js       the Log view: what the radio stayed on, with its best signal; the signal meter on Radio
//   more.js      tests and developer tools, the connection, keys and the keyboard
// Each module only declares things when it loads; its init() runs what has to happen at start-up, here, in this
// order, once every module is loaded (so the modules may use each other freely).
import {init as initShell} from "./ui/shell.js";
import {init as initReception} from "./ui/reception.js";
import {init as initRadio} from "./ui/radio.js";
import {init as initFind} from "./ui/find.js";
import {init as initMemories} from "./ui/memories.js";
import {init as initLog} from "./ui/log.js";
import {init as initMore} from "./ui/more.js";

initShell();
initReception();  // first: the views ask it for estimates as they draw
initRadio();
initFind();
initMemories();
initLog();
initMore();
