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
      <p>Open the sign-in link the {w("camp")} printed in its terminal when it started. A link works once: if it has been used, press <kbd>Enter</kbd> in that terminal for a new one.</p>
      <p className="meta">After you've signed in, this address opens by itself in this browser.</p>
    </main>
  );
}
