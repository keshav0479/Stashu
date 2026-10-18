# Deploying Stashu to stashu.tech

Production runs as two containers on a single Azure VM: the Stashu app (API +
built client, SQLite on a Docker volume) and Caddy in front of it for TLS.

SQLite on a persistent volume is the reason this is a VM rather than a
serverless host — Vercel, Netlify and Cloudflare Workers cannot keep the
database file between requests.

Order matters: DNS is pointed at the VM **before** the stack is started, because
Caddy cannot obtain a certificate until stashu.tech resolves to this machine.

## 1. Provision the VM

Azure Portal → Virtual machines → Create:

| Setting | Value                                                                           |
| ------- | ------------------------------------------------------------------------------- |
| Image   | Ubuntu Server 24.04 LTS                                                         |
| Size    | `Standard_B1s` (1 vCPU / 1 GiB) is enough to start                              |
| Auth    | SSH public key                                                                  |
| Disk    | 30 GB standard SSD                                                              |
| IP      | Create a **static** public IP — a dynamic one changes on dealloc and breaks DNS |

Then open the web ports. Networking → Network settings → Create port rule
→ Inbound, for TCP **80** and TCP **443**. Caddy needs 80 reachable as well as
443: Let's Encrypt validates over HTTP before issuing the certificate.

Leave SSH (22) restricted to your own IP rather than `Any`.

Note the VM's public IP — the next step needs it.

Reusing a VM that already serves another site? Stop whatever holds ports 80
and 443 first — usually nginx (`sudo systemctl disable --now nginx`) — or Caddy
cannot bind them and the stack will not start.

## 2. Point DNS at the VM

stashu.tech is a get.tech domain, so its records are edited by logging into
get.tech with the GitHub account that claimed it. It was registered for one
year and expires on **2027-03-21** — renew it before then, or the site goes
offline no matter how healthy the server is.

Point both records at the VM:

| Type | Host  | Value          | TTL |
| ---- | ----- | -------------- | --- |
| A    | `@`   | _VM public IP_ | 300 |
| A    | `www` | _VM public IP_ | 300 |

Use a short TTL until it works, then raise it. Confirm before deploying:

```bash
dig +short stashu.tech
```

That must print the VM's IP before you continue.

## 3. Install Docker

SSH in, then:

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
```

Log out and back in so the group change applies.

## 4. Configure the app

```bash
git clone https://github.com/keshav0479/Stashu.git
cd Stashu
```

Write the environment file. `openssl` ships with Ubuntu, so this needs no Node
on the VM:

```bash
cat > .env <<EOF
TOKEN_ENCRYPTION_KEY=$(openssl rand -hex 32)
CORS_ORIGINS=https://stashu.tech
MINT_URL=https://mint.minibits.cash/Bitcoin
CASHU_REQUEST_TIMEOUT_MS=10000
EOF
```

Three values matter in production:

- `TOKEN_ENCRYPTION_KEY` — 64 hex chars. The server refuses to start without
  it.
- `CORS_ORIGINS` — must be the real origin. In production the server uses
  **only** this list, so a wrong value here blocks every browser request.
- `MINT_URL` — the Cashu mint.

Back up the key somewhere safe. Every encrypted column — including sellers'
claimable Cashu tokens — is unreadable without it, so losing it means losing
unwithdrawn earnings. Rotating it does not re-encrypt existing rows.

## 5. Deploy

```bash
docker compose -f docker-compose.prod.yml up -d --build
```

Run that file **on its own**, not layered over `docker-compose.yml` — Compose
appends `ports` lists when merging, which would republish the app on `:3000`
and let traffic reach it without TLS.

`VITE_API_URL` defaults to `https://stashu.tech/api`. It is compiled into the
client bundle, so changing the domain means rebuilding, not just restarting.
It must stay **absolute**: the client puts that URL in the NIP-98 `u` tag and
the server parses the tag with `new URL()`, which throws on a relative path.

The compose file sets `TRUSTED_PROXY=1`, which it needs to: behind a proxy the
rate limiter otherwise keys every request as `global`, letting one visitor
throttle everybody. Only ever set it when something like Caddy is actually in
front, since it makes the app trust a client-supplied `X-Forwarded-For`.

## 6. Verify

```bash
curl -s https://stashu.tech/api/health
docker compose -f docker-compose.prod.yml logs -f caddy
```

Then load https://stashu.tech in a browser and confirm the padlock. If the
certificate fails, it is almost always DNS not yet pointing at the VM, or port
80 closed in the network security group.

## Updating

```bash
git pull
docker compose -f docker-compose.prod.yml up -d --build
```

The `stashu-data` volume survives rebuilds, so the database persists.

## Backups

The database is the only state that cannot be regenerated:

```bash
docker compose -f docker-compose.prod.yml exec stashu \
  sh -c 'sqlite3 /data/stashu.db ".backup /data/backup.db"'
docker compose -f docker-compose.prod.yml cp stashu:/data/backup.db ./stashu-backup.db
```

Copy it off the VM. A backup is useless without `TOKEN_ENCRYPTION_KEY`, and
dangerous to store beside it.
