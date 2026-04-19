# Stocktake Feature

Stocktake is a disk-vs-torrent cross-referencing tool built into Flood. It scans configured directories, compares what's on disk with what the torrent client knows about, and surfaces mismatches: files with no matching torrent ("untied") and torrents whose data is missing from disk ("orphaned").

## How It Works

1. **Scan** — reads top-level entries from each scan directory (non-recursive, fast)
2. **Match** — maps each torrent's `basePath`/`directory` to a disk entry via path normalisation
3. **Classify** — labels every torrent as seeding, stopped, downloading, error, or orphaned; labels every disk entry as tied or untied
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

## Design Decisions

- **Top-level only** — scans only immediate children of each directory, avoiding slow recursive walks on large media libraries.
- **Auto-derived roots** — when `--stocktakedirs` is not set, the service infers scan directories from torrent base paths (directories with ≥ 5 torrents). This zero-config mode works for most setups.
- **Batch existence checks** — for torrents outside scan directories, parent dirs are read once and cached rather than calling `fs.access` per torrent.
- **Directory sizes from torrent metadata** — instead of recursive `stat`, directory sizes are estimated from matched torrent `sizeBytes` for speed.
- **Server-side cache** — scan results are held in memory and served on `GET` until a new scan is triggered, keeping repeated UI opens instant.
- **rTorrent `d.base_path=`** — added to the torrent list method calls so the service can resolve torrent-to-disk mappings accurately.

## Current Limitations

- Only rTorrent exposes `basePath` via the added `d.base_path=` call. Other clients fall back to `directory`.
- No scheduled/automatic scans — scans are user-triggered only.
- Results are in-memory only and lost on server restart.
- No bulk actions (e.g. remove orphaned torrents) from the UI yet.
