# The relay and the landing page (the author's runbook)

[← Back to the README](../README.md)

This is the author's own operations note for the copy of Outpost at `outpostmae.app`: the Lightsail relay that lets its outposts be reached from anywhere, and the public landing page. It's kept here because the scripts are in the repository. If you only want to reach your own outpost from elsewhere, start with [Remote access](remote-access.md).

## The relay and Tailscale

Two ways in, both on at once: the Lightsail relay (`scripts/relay/relay.sh`: your own small server with Caddy and Google sign-in at the door, reached through an SSH tunnel from this Mac) and Tailscale as the backup (`scripts/tailscale.sh`: tailnet only, no public address). Each keeps the outpost running under launchd (so both are macOS only), and each script's header lists its steps. The relay script's defaults are the author's own setup: before you run it, set `RELAY_ZONE` to a domain you own (and `RELAY_DOMAIN`, `RELAY_NAME` and `RELAY_REGION` if you want other than `mae.<zone>`, `mae-relay` and `eu-west-1`); the `outpostmae.app` addresses below are examples of what you get. With no name they reach Mae, as they always have. Name an outpost after the command (or set `OUTPOST=Work`) to reach that one too:

```
scripts/relay/relay.sh create Work    # its DNS record (the server is shared)
scripts/relay/relay.sh server Work    # its tunnel key and an empty Caddy site
scripts/relay/relay.sh google Work    # Google sign-in, shared with Mae's (or: password Work)
scripts/relay/relay.sh install Work   # its outpost and tunnel under launchd
scripts/relay/relay.sh link Work      # a sign-in link for a phone
scripts/tailscale.sh install Work     # and on the tailnet
```

On the relay each outpost gets a subdomain of its own (`work.outpostmae.app`), its own tunnel key and port on the server (its port + 1000), its own Caddy site in `/etc/caddy/sites/` and its own launchd jobs (`app.outpostmae.work.camp`, `…tunnel`), which run `npm run outpost -- start Work` from this checkout. A subdomain needs no change to the page or Caddy's routing, where a path per outpost would. Google sign-in is set up once, for Mae: the other outposts' doors send you through Mae's address to sign in, with the same allowed addresses, and one sign-in then covers them all. Each outpost still has its own key behind the door. On Tailscale a machine has one name, so each outpost but Mae is served on its own port there: `https://<this-mac>.<tailnet>.ts.net:4748/` for an outpost on 4748.

## The landing page

`docs/index.html` (the Tour) is also the public page at `https://outpostmae.app`: a private S3 bucket behind CloudFront, with a free ACM certificate, and Route 53 pointing the domain and `www` (which redirects) at it. It's all one CloudFormation stack, `infra/site.yaml`, in us-east-1. `npm run site -- setup` makes it the first time (5–15 minutes), `npm run site -- deploy` puts up the current page after you change it, and `npm run site -- status` checks it from outside. It only touches the apex and `www` records, so the relay's `mae.outpostmae.app` and the outposts' subdomains stay as they are. For another domain, set `SITE_DOMAIN` (its hosted zone must be in the same account).
