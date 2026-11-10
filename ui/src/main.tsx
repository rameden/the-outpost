import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { storeGet } from "./api.ts";
import { App } from "./App.tsx";
import { createFeedStore } from "./feed/store.ts";
import "./styles.css";

// Your saved light/dark choice, before anything is drawn.
const theme = storeGet("camp-theme");
if (theme) document.documentElement.dataset.theme = theme;

// The feed lives outside React, so it carries on across reconnects and hot reloads.
const store = createFeedStore();

createRoot(document.getElementById("root")!).render(<StrictMode><App store={store} /></StrictMode>);
