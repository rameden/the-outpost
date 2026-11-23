// The star chart's page (`npm start`): every outpost on this machine, and a way into each.
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { startThemes } from "../themes.ts";
import { Hub } from "./Hub.tsx";
import "../styles.css";

startThemes();
createRoot(document.getElementById("root")!).render(<StrictMode><Hub /></StrictMode>);
