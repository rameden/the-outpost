// Settings → Plugins: what the Outpost can do besides what it's made of, each a package of its own
// (plugins/, see ui/src/plugins/types.ts), each turned on or off here. Off, nothing of it is
// fetched and nothing it adds is shown: HD Orbit's button leaves Orbit, Barnstorm's row leaves the
// ··· menu and the Konami code does nothing. Kept in camp/settings.json, for every device.

import { api, errorText } from "../api.ts";
import { complain } from "../components/StatusLine.tsx";
import { PLUGINS, pluginOn } from "../plugins/registry.ts";
import type { CampState } from "../types.ts";

export function PluginsPage({ S, refresh }: { S: CampState; refresh: () => void }) {
  const turn = async (id: string, on: boolean) => {
    try { await api("/api/plugins", { id, on }); refresh(); } catch (e) { complain(errorText(e)); }
  };
  return <>
    <p className="set-note">Plugins add to the Outpost without being part of it. Each is its own package, and none of it is loaded until it's on and wanted. A plugin you haven't turned off is on.</p>
    {PLUGINS.map((p) => {
      const on = pluginOn(S, p.id);
      return (
        <div key={p.id} className="set-row wide">
          <div className="set-label"><b>{p.name}</b>
            <p>{p.about}</p>
            <ul className="set-plugin-adds" aria-label={`What ${p.name} adds`}>{p.adds.map((a) => <li key={a}>{a}</li>)}</ul>
          </div>
          <div className="set-control">
            <label className="switch"><input type="checkbox" aria-label={p.name} checked={on} onChange={(ev) => void turn(p.id, ev.target.checked)} /> {on ? "On" : "Off"}</label>
          </div>
        </div>
      );
    })}
  </>;
}
