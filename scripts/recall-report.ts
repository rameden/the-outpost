// How recall is doing, from camp/recall-queries.jsonl: how often a search finds nothing, and how
// often an agent searches again straight after. npm run recall:report [-- chains-to-show]
import { formatSummary, summarizeQueries } from "../src/recallqueries.ts";
console.log(formatSummary(summarizeQueries(), Number(process.argv[2]) || 10));
