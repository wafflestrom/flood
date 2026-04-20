# Stocktake Feature

Stocktake is a disk-vs-torrent cross-referencing tool built into Flood. It scans configured directories, compares what's on disk with what the torrent client knows about, and surfaces mismatches: files with no matching torrent ("untied") and torrents whose data is missing from disk ("orphaned").

## How It Works

1. **Scan** — reads top-level entries from each scan directory (non-recursive, fast)
2. **Match** — maps each torrent's `basePath`/`directory` to a disk entry via path normalisation; then falls back to name-based matching for unmatched torrents
3. **Classify** — labels every torrent as seeding, stopped, downloading, error, orphaned, or relocated; labels every disk entry as tied or untied
4. **Summarise** — produces per-directory breakdowns and aggregate stats

Results are cached server-side after each scan and served from cache on subsequent `GET` requests until a new `POST /scan` is triggered.

## Configuration

### CLI flag

```
--stocktakedirs /data/torrents,/data/media
```

Comma-separated list of directories to scan. When omitted, stocktake auto-derives scan directories from torrent base paths (directories containing ≥ 5 torrents).

### Config schema

`stocktakeDirs` in `shared/schema/Config.ts` — optional `string[]`.

## API

All endpoints require authentication.

| Method | Path                            | Description                                    |
| ------ | ------------------------------- | ---------------------------------------------- |
| GET    | `/api/stocktake`                | Return cached result (or `no_scan`)            |
| POST   | `/api/stocktake/scan`           | Run a fresh scan and return result             |
| POST   | `/api/stocktake/match-torrents` | Match .torrent files against untied disk files |
| POST   | `/api/stocktake/add-matched`    | Add a matched .torrent to the client (stopped) |

### Response shape

See `shared/types/Stocktake.ts` for full type definitions:

- **`StocktakeResult`** — top-level response from both endpoints

  - `summary` — aggregate counts and sizes
  - `untiedFiles` — disk entries with no matching torrent
  - `orphanedTorrents` — torrents whose files are missing
  - `relocatedTorrents` — torrents matched by name at a different path
  - `allTorrents` / `allDiskEntries` — complete lists for the UI
  - `dirBreakdown` — per-directory tied/untied stats
  - `scanDirs` — directories that were scanned

- **`StocktakeMatchResult`** — response from `/match-torrents`
  - `torrentDir` — directory that was scanned for .torrent files
  - `torrentFileCount` / `parsedCount` — how many found vs successfully parsed
  - `matches` — array of `StocktakeMatch` (untied file ↔ .torrent pairings)
  - `unmatchedTorrents` — .torrent files with no matching untied disk entry

## UI

- **Sidebar button** (`StocktakeButton.tsx`) — opens the stocktake modal
- **Modal** (`stocktake-modal/`) — tabbed interface:
  - **Dashboard** — summary stats grid, size breakdown, scanned directories
  - **Untied Files** — sortable/filterable table of disk entries with no torrent; includes .torrent matching controls and match indicators (🔗 icon, tinted rows, "Add to Client" buttons)
  - **Orphaned Torrents** — sortable/filterable table of torrents missing from disk
  - **Relocated** — (appears when matches found) torrents whose files exist on disk at a different path; "Move & Hash" button to fix each one
  - **Stopped** — (appears when present) stopped torrents that still have files on disk
  - **All Torrents** — full torrent list with disk-match status
  - **Disk Usage** — per-directory bar charts showing tied vs untied space
  - **Matched & Added** — (appears after adding torrents) tracks torrents added via the match flow
- **Styles** — `client/src/sass/components/_stocktake.scss`

## File Map

```
shared/types/Stocktake.ts                          # Type definitions
shared/types/Torrent.ts                             # Added basePath field
shared/schema/Config.ts                             # stocktakeDirs config option
config.ts                                           # CLI --stocktakedirs parsing
server/services/stocktakeService.ts                 # Core scan logic
server/services/torrentMatchService.ts              # .torrent file matching service
server/routes/api/stocktake.ts                      # REST endpoints (scan + match + add)
server/routes/api/index.ts                          # Route registration
server/services/rTorrent/constants/.../torrentList.ts  # d.base_path= method call
client/src/javascript/stores/UIStore.ts             # 'stocktake' modal type
client/src/javascript/components/modals/Modals.tsx  # Modal routing
client/src/javascript/components/sidebar/Sidebar.tsx       # Button placement
client/src/javascript/components/sidebar/StocktakeButton.tsx
client/src/javascript/components/modals/stocktake-modal/   # Modal components
client/src/sass/components/_stocktake.scss           # Styles
client/src/sass/style.scss                          # Style import
```

## Torrent File Matching

The matching feature lets users reconnect untied disk files with .torrent files stored in a separate directory.

### How It Works

1. **Input** — user provides a directory path containing .torrent files (e.g. a torrent client's session directory or a backup folder)
2. **Walk** — the server recursively scans the directory tree for `*.torrent` files (capped at 10,000 files)
3. **Parse** — each .torrent file is decoded with `bencode` to extract `info.name`, total content size, file count, and tracker URLs
4. **Match** — `info.name` is compared (case-insensitive) against the names of untied disk entries from the last stocktake scan. When sizes also align (within ±10%), the match is flagged as "exact"; otherwise "name-only"
5. **Display** — matched untied files are highlighted with a 🔗 icon and tinted green background in the Untied tab
6. **Add** — per-row "Add to Client" button sends the .torrent file to the torrent client in stopped mode with `isCompleted: true`, triggering a hash check against the existing data
7. **Track** — added torrents appear in a "Matched & Added" tab (session-scoped, not persisted)

### API

- `POST /api/stocktake/match-torrents` — body: `{ torrentDir: string }` → returns `StocktakeMatchResult`
- `POST /api/stocktake/add-matched` — body: `{ torrentPath: string, destination: string }` → adds the torrent stopped+hashing

### Encoding

`info.name` is a Buffer. The service attempts UTF-8 decoding first, falling back to latin1 if the UTF-8 result contains replacement characters.

## Relocated Torrent Matching

When a torrent's `basePath` doesn't match any disk entry by path, the scan falls back to name-based matching. This catches torrents whose files have been moved to a different directory (e.g. from `/data/unsorted/` to `/data/television/`).

### How It Works

1. **Path match first** — standard exact-path matching against normalised scan directory entries
2. **Name fallback** — for unmatched torrents, search all disk entries by `name` (case-insensitive)
3. **Shape check** — files must match files, directories must match directories (directories always accepted for multi-file torrents)
4. **Size tolerance** — for file matches, size must be within ±10%
5. **Many-to-one** — multiple torrents can match the same disk entry (cross-seeding across trackers)

### Match Types

Each `StocktakeTorrentMatch` has a `matchType` field:

- `'path'` — matched by exact path (normal case)
- `'name'` — matched by name at a different location (relocated)
- `null` — no match found

### Relocated Tab

Relocated torrents appear in a dedicated tab showing:

- Current (wrong) base path
- Found-at path (where files actually are)
- **Repoint & Check** button — calls `POST /api/torrents/move` with `moveFiles: false` and `isCheckHash: true` to update the torrent's directory and trigger a hash check without moving any files

### Design Decisions

- **Separate status** — relocated torrents get `status: 'relocated'` rather than being folded into stopped/seeding. This makes them actionable in the UI without noise.
- **`suggestedPath`** — stores the `sourceDir` (parent directory) where files were found, not the full disk entry path. This is what gets passed to the move API.
- **No auto-fix** — the user must explicitly click "Move & Hash" per torrent. Automated bulk moves are too risky without review.

## Design Decisions

- **Top-level only** — scans only immediate children of each directory, avoiding slow recursive walks on large media libraries.
- **Auto-derived roots** — when `--stocktakedirs` is not set, the service infers scan directories from torrent base paths (directories with ≥ 5 torrents). This zero-config mode works for most setups.
- **Batch existence checks** — for torrents outside scan directories, parent dirs are read once and cached rather than calling `fs.access` per torrent.
- **Directory sizes from torrent metadata** — instead of recursive `stat`, directory sizes are estimated from matched torrent `sizeBytes` for speed.
- **Server-side cache** — scan results are held in memory and served on `GET` until a new scan is triggered, keeping repeated UI opens instant.
- **rTorrent `d.base_path=`** — added to the torrent list method calls so the service can resolve torrent-to-disk mappings accurately.

## Performance

The scan was optimised from **90 seconds** (cold cache) down to **~2 seconds** by benchmarking multiple directory-sizing strategies with hyperfine and applying the best combination of changes.

### Key optimisations

| Change                                                         | Impact                                |
| -------------------------------------------------------------- | ------------------------------------- |
| Parallel `du -sb` (8 concurrent processes, 2 s global timeout) | 90 s → 2.3 s cold; 2.3 s → 1.1 s warm |
| Skip forced `fetchTorrentList()` — use polled cache            | –1 s                                  |
| `Promise.all` across scan dirs instead of sequential loop      | –0.1–0.5 s                            |
| Pre-computed normalised paths                                  | minor                                 |
| Single-pass status counting + Map-based dir breakdown          | minor                                 |

The parallel `du` with a time budget is the dominant win. On warm caches all 76 untied directories complete within 1.1 s. On cold caches the 2 s deadline fires and partial results are returned (dirs that didn't finish get size = 0 and are filtered out). This is an acceptable trade-off — cold caches are rare in practice because the torrent client itself keeps the filesystem hot.

## Testing on the Production Server (reginald)

### SSH access

```bash
# Key is stored in a vault protected by touch id - user may be slow to unlock so be patient and wait at least 120 seconds before timing out
ssh reginald@reginald.local

# Flood runs as user `flood`, install dir: /home/flood/flood/
# Service: flood.service (systemd)
# Flood is started with: --auth none --rtsocket /tmp/rtorrent.sock --host 127.0.0.1
```

### Authenticating to Flood

Flood runs with `--auth none`, which still requires a JWT. Get one from the verify endpoint:

```bash
# Get JWT cookie
curl -s -c /tmp/flood_cookies http://127.0.0.1:3000/api/auth/verify > /dev/null
JWT=$(grep jwt /tmp/flood_cookies | awk '{print $NF}')

# Use it for API calls
curl -s -b "jwt=$JWT" http://127.0.0.1:3000/api/stocktake
curl -s -b "jwt=$JWT" -X POST http://127.0.0.1:3000/api/stocktake/scan
```

Note: `POST /api/stocktake/scan` has no request body — do not send a `Content-Type: application/json` header without a body or Fastify will reject it.

### Benchmarking the scan endpoint

```bash
# Warm cache (typical — torrent client keeps filesystem hot)
curl -s -b "jwt=$JWT" -X POST http://127.0.0.1:3000/api/stocktake/scan \
  | python3 -c "import json,sys; print(json.load(sys.stdin)['summary']['scanTime'])"

# Cold cache (worst case)
sudo sh -c 'echo 3 > /proc/sys/vm/drop_caches'
curl -s -b "jwt=$JWT" -X POST http://127.0.0.1:3000/api/stocktake/scan \
  | python3 -c "import json,sys; print(json.load(sys.stdin)['summary']['scanTime'])"
```

### Benchmarking directory sizing approaches with hyperfine

The `getDirectorySizes()` function dominates scan time. To benchmark alternatives:

1. **Get untied directory paths** — run a scan, then check the server logs for the untied dir list, or extract from the JSON response:

   ```bash
   curl -s -b "jwt=$JWT" -X POST http://127.0.0.1:3000/api/stocktake/scan \
     | python3 -c "
   import json, sys
   d = json.load(sys.stdin)
   for f in d['untiedFiles']:
       if f['isDirectory']:
           print(f['path'])
   " > /tmp/untied_dirs.txt
   ```

2. **Create benchmark scripts** — each script reads `/tmp/untied_dirs.txt` and sizes the directories a different way. Examples:

   ```bash
   # A: baseline — single sequential du
   cat > /tmp/bench_a.sh << 'EOF'
   #!/bin/bash
   xargs -d '\n' du -sb < /tmp/untied_dirs.txt > /dev/null
   EOF

   # C: parallel du (P8) — the winner
   cat > /tmp/bench_c.sh << 'EOF'
   #!/bin/bash
   cat /tmp/untied_dirs.txt | xargs -P8 -I{} du -sb {} > /dev/null
   EOF

   # E: find+awk parallel (P8)
   cat > /tmp/bench_e.sh << 'EOF'
   #!/bin/bash
   cat /tmp/untied_dirs.txt | xargs -P8 -I{} sh -c 'find "$1" -type f -printf "%s\n" | awk "{s+=\$1} END{print s\"\t\"ARGV[1]}"' _ {} > /dev/null
   EOF

   chmod +x /tmp/bench_*.sh
   ```

3. **Run hyperfine** — warm cache:

   ```bash
   hyperfine --warmup 2 --runs 5 \
     -n 'A:du-single'   '/tmp/bench_a.sh' \
     -n 'C:du-par-P8'   '/tmp/bench_c.sh' \
     -n 'E:find-awk-P8' '/tmp/bench_e.sh'
   ```

   Cold cache (requires root for cache drops):

   ```bash
   hyperfine --runs 3 \
     --prepare 'sudo sh -c "echo 3 > /proc/sys/vm/drop_caches"' \
     -n 'A:du-single'   '/tmp/bench_a.sh' \
     -n 'C:du-par-P8'   '/tmp/bench_c.sh' \
     -n 'E:find-awk-P8' '/tmp/bench_e.sh'
   ```

4. **Benchmark results** (76 untied dirs, April 2026):

   | Approach                      | Warm (mean) | Cold (mean) |
   | ----------------------------- | ----------- | ----------- |
   | A: `du -sb` single (baseline) | 2.28 s      | 90.3 s      |
   | C: `du -sb` parallel P8       | 1.10 s      | **28.8 s**  |
   | E: `find\|awk` parallel P8    | **1.07 s**  | 64.1 s      |

   Parallel `du` is the best cold-cache approach (3.1× faster). `find|awk` is slightly faster warm but much worse cold. A 2 s global timeout caps the worst case regardless.

### Deploying changes

```bash
# Build locally
pnpm run build

# Rsync to staging area, then copy into place and restart
DEPLOY_DIR=$(ssh reginald@reginald.local 'mktemp -d') || { echo "mktemp failed"; exit 1; }
[[ "$DEPLOY_DIR" == /tmp/* ]] || { echo "unexpected temp dir: $DEPLOY_DIR"; exit 1; }

rsync -az --delete dist/ package.json pnpm-lock.yaml \
  reginald@reginald.local:"$DEPLOY_DIR"/

ssh reginald@reginald.local "\
  set -e && \
  trap 'rm -rf $DEPLOY_DIR' EXIT && \
  sudo rsync -a --delete --exclude=package.json --exclude=pnpm-lock.yaml \
    $DEPLOY_DIR/ /home/flood/flood/dist/ && \
  sudo cp $DEPLOY_DIR/package.json $DEPLOY_DIR/pnpm-lock.yaml \
    /home/flood/flood/ && \
  sudo chown -R flood:flood /home/flood/flood/ && \
  sudo systemctl restart flood && \
  sleep 2 && \
  sudo systemctl status flood --no-pager"
```

## Current Limitations

- Only rTorrent exposes `basePath` via the added `d.base_path=` call. Other clients fall back to `directory`.
- No scheduled/automatic scans — scans are user-triggered only.
- Results are in-memory only and lost on server restart.
- No bulk actions (e.g. remove orphaned torrents) from the UI yet.
- Cold-cache scans may return incomplete untied-directory sizes if the 2 s `du` timeout fires. A subsequent warm-cache scan will return full results.
