// The Jira search behind the + menu's panel and the ticket wizard: your filter's tickets when
// nothing is typed, otherwise what matches as you type (after a short pause). `issues` is null until
// the first answer. `report` hears each answer's error text ("" when it went well), for a caller
// that shows errors in its own place.
import { useEffect, useState } from "react";
import { api, errorText } from "../api.ts";
import type { JiraRef } from "../types.ts";

export function useJiraSearch(query: string, on: boolean, report?: (error: string) => void) {
  const [issues, setIssues] = useState<JiraRef[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!on) return;
    let gone = false;
    const t = setTimeout(() => {
      api<{ issues: JiraRef[] }>(`/api/jira/issues?q=${encodeURIComponent(query.trim())}`)
        .then((r) => { if (!gone) { setIssues(r.issues); setError(""); report?.(""); } },
          (e) => { if (!gone) { setIssues([]); setError(errorText(e)); report?.(errorText(e)); } });
    }, query ? 250 : 0);
    return () => { gone = true; clearTimeout(t); };
  }, [query, on]); // eslint-disable-line react-hooks/exhaustive-deps
  return { issues, error };
}
