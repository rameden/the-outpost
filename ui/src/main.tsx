import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { signIn } from "./api.ts";
import { startThemes } from "./themes.ts";
import { readyChimeOnFirstGesture } from "./chime.ts";
import { SignIn } from "./components/SignIn.tsx";
import { App } from "./App.tsx";
import { PageBoundary } from "./components/ErrorBoundary.tsx";
import { createFeedStore } from "./feed/store.ts";
import "./styles.css";

// Your saved light/dark choice and palette, before anything is drawn; and from then on, whatever
// another tab changes (Settings in another window, or the tour's own switches).
startThemes();
// The notification chime can only sound after a click, so it's set up on the first one.
readyChimeOnFirstGesture();

// The feed lives outside React, so it carries on across reconnects and hot reloads.
const store = createFeedStore();

// The page signs in before it asks the camp for anything: with the one-time code in the link it
// was opened with, or the key this browser already keeps. Without either it says how to get in.
// If the page throws while drawing itself, say so (with a way out) instead of going blank.
const root = createRoot(document.getElementById("root")!);
const show = (signedIn: boolean) => root.render(<StrictMode><PageBoundary>{signedIn ? <App store={store} /> : <SignIn />}</PageBoundary></StrictMode>);
void signIn().then(show);
// The camp turned this browser's key down part-way (it was given a new one): back to signing in.
window.addEventListener("camp:signed-out", () => show(false));
// A sign-in link pasted into this tab's address bar only changes what follows the #: take it.
window.addEventListener("hashchange", () => { if (location.hash.includes("k=")) void signIn().then(show); });
