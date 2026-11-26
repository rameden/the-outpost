// What the page shows when this browser holds no key for the camp (it's new here, its storage was
// cleared, or the camp was started with a new key). Nothing of the camp is on this page.

import { MaeOrb } from "./MaeOrb.tsx";
import { outpostName } from "../outpost.ts";

import { w } from "../words.ts";
export function SignIn() {
  const name = outpostName();
  return (
    <main className="sign-in" role="main">
      <MaeOrb />
      <h1 aria-label={`Outpost ${name}`}><span className="outpost-title">Outpost</span><span className="outpost-sub">{name}</span></h1>
      <p><b>This browser isn't signed in to the {w("camp")}.</b></p>
      <p>You need a sign-in link. Each one works once.</p>
      <ul className="sign-in-ways">
        <li><b>On the {w("camp")}'s own machine:</b> open the link it printed in its terminal when it started. Used already? Press <kbd>Enter</kbd> in that terminal for a new one.</li>
        <li><b>From a phone or another computer:</b> in a browser that's already signed in, open Settings, Devices &amp; uploads and press <b>Make a sign-in link</b>. Through the relay or Tailscale, run <code>scripts/relay/relay.sh link</code> or <code>scripts/tailscale.sh link</code> on the {w("camp")}'s machine instead. These links last ten minutes.</li>
      </ul>
      <p className="meta">After you've signed in, this address opens by itself in this browser.</p>
    </main>
  );
}
