// Write the next release notes now (src/releases.ts), then stop: the star chart's "Check now".
// It runs on its own because the camp's modules hold the terminal open while they're loaded,
// which the chart's server must never do (it would keep it running, and swallow Ctrl-C).
//
//   npm run release-notes
import { writeReleaseNotes } from "../src/releases.ts";

const r = await writeReleaseNotes();
if (r.error) console.error(r.error);
process.exit(0);
