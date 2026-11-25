# ESC/POS virtual printer

Local dev/CI tool: a TCP server that behaves like a network thermal printer (port 9100), decodes the ESC/POS subset Sazono emits and shows each job as paper. Own ~200-line parser, no dependencies (the npm `escpos-emulator` has one maintainer and 12 stars, so it was not adopted).

## Run

```
npm run printer:emulator
npm run printer:emulator -- --columns 32 --port 9100 --http-port 9101
```

Options (flag or env): `--host` / `ESCPOS_EMULATOR_HOST` (TCP bind, default `0.0.0.0`, so a tablet on the LAN or the Android emulator at `10.0.2.2` can reach it), `--port` / `ESCPOS_EMULATOR_PORT` (9100), `--http-port` / `ESCPOS_EMULATOR_HTTP_PORT` (9101, bound to 127.0.0.1), `--columns` / `ESCPOS_EMULATOR_COLUMNS` (48 for 80 mm, 32 for 58 mm), `--out` / `ESCPOS_EMULATOR_OUT` (default `tools/escpos-emulator/out`).

Point a Sazono printer (transport TCP) at `127.0.0.1:9100` (backend, needs `PRINTING_TCP_ENABLED=true`) or `10.0.2.2:9100` (Android emulator).

## Output

- Terminal: each job as framed text paper, with a cut marker.
- `out/NNNN-<timestamp>.html` (standalone paper) and `.bin` (raw bytes, replayable with `nc`/a socket).
- `http://127.0.0.1:9101/` paper strips, newest first, timestamps and cut markers, refreshes every 3 s.
- `GET /jobs.json` (id, receivedAt, bytes, text) and `GET /jobs/last.txt` for assertions; `DELETE /jobs` clears the list.

A job ends when the client closes the socket or after 1.5 s idle.

## Supported commands

`ESC @`, `ESC t n` (16 = windows-1252, anything else CP858), `ESC E n`, `GS ! n`, `ESC a n`, `ESC d n`, LF/CR, `GS V` (modes 0, 1, 48, 49, 65, 66), `ESC p` (drawer pulse). Text is decoded as CP858 (ñ = 0xA4, Ñ = 0xA5, € = 0xD5). Anything else is skipped and reported as a warning. QR and images are not drawn. Lines wrap at the column count like a printer; double width counts two columns per character.

## Tests

- `npx jest tools`: parser golden bytes plus a TCP/HTTP round trip.
- `npm run printer:emulator:test`: sends the owner's reference ticket (hand-built bytes, `sample.ts`, 32 columns) and checks the parsed text. Self-contained by default; against a running emulator use `-- --host 127.0.0.1 --port 9100 --http-port 9101` (the running emulator must use `--columns 32`).

To check the real encoder in `src/modules/printing`, send its bytes to the emulator and compare with `SAMPLE_EXPECTED`.
