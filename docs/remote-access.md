# Remote access

[← Back to the README](../README.md)

Out of the box an outpost listens on `127.0.0.1`, and only the machine it runs on can reach it. There are three ways to open it further, and each is something you turn on.

## At home (LAN mode)

By default only the machine the outpost runs on can reach it. Put `CAMP_LAN=1` in `.env` and start it with `npm run ui:serve`: it prints the address your other machines use (for example `http://winbox:4747/`) and a sign-in link for it. It's plain HTTP, so it's for a home network you trust: never an office or shared network, and never a port forwarded to the internet. The terminal pane only opens on the outpost's own machine (it's a shell there), and from another machine you paste a folder's path instead of using the folder dialog. What lets the crew do more is also changed only there: from another machine (the network, a relay or Tailscale) you can lower the approval level and tighten the shell rules, but not raise or loosen them, turn on the approval reviewer or self-editing, or set the Anthropic key. Each browser signs in once with a one-time link: the outpost's terminal prints one, or make one under Settings → Devices & uploads → Other devices. On Windows, allow Node through the firewall for private networks when it asks.

## From anywhere

Two ways in, and both can be on at once. Each keeps the outpost running under launchd, so both are macOS only, and each script's header lists its steps.

- **Tailscale** (`scripts/tailscale.sh`): tailnet only, no public address. `scripts/tailscale.sh install` serves Mae on your tailnet, and `scripts/tailscale.sh install Work` another outpost. A machine has one name on a tailnet, so each outpost but Mae is served on its own port: `https://<this-mac>.<tailnet>.ts.net:4748/` for an outpost on 4748.
- **A relay of your own** (`scripts/relay/relay.sh`): a small server with Caddy and Google sign-in at the door, reached through an SSH tunnel from your Mac. Its defaults are the author's own setup, so read [the relay runbook](remote-relay.md) before you run it.

With either, the outpost itself stays on `127.0.0.1`; the proxy sits on the same machine and the outpost answers to the names in `CAMP_PROXY_NAMES`, which the scripts set. Each outpost keeps its own key behind the door.

## Approvals from your phone

You don't need remote access to say yes from your phone: [phone approvals](safety.md#approvals-from-your-phone) go through ntfy and are set up under Settings → Phone.
