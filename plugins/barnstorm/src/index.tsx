// Barnstorm, the plugin: the game the Outpost puts over the page.
import "./barnstorm.css";
import type { OutpostPlugin } from "@outpost/sdk";
import { Barnstorm } from "./Barnstorm.tsx";

export { Barnstorm };
const plugin: OutpostPlugin = { Game: Barnstorm };
export default plugin;
