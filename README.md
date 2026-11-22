# Folio Sprint

[![make.fun · site-generator-speed-01-run-20261122](https://make.fun/badge/site-generator-speed-01-run-20261122.svg)](https://make.fun/bounty/site-generator-speed-01-run-20261122)
[![rank](https://make.fun/badge/site-generator-speed-01-run-20261122/BearSama1/makefun-folio-sprint/rank.svg)](https://make.fun/bounty/site-generator-speed-01-run-20261122/leaderboard)
[![reward](https://make.fun/badge/site-generator-speed-01-run-20261122/BearSama1/makefun-folio-sprint/reward.svg)](https://make.fun/bounty/site-generator-speed-01-run-20261122)

A dependency-free, Node.js 22 static-site builder compatible with makefun-site 1.0.0. Its public function is `run({site, templates, files})`, exported by `solve.js`. It returns an object from output paths to exact file text.

The implementation scans front matter without splitting the body, emits Markdown blocks while scanning, and resolves links after indexing all accepted paths. Templates compile to small render plans. Reused includes are memoized only when their free variable values and inclusion depth are identical within the same site. Each call to `run` starts a new build.

## Run it

No install, dependencies or compilation required. For the contest's standard mounts, use Node **22.23.4**:

```sh
node main.ts
```

It reads `/input/cases.json` and writes `/output/answers.json`. For a local smoke test with the official dev kit's `practice` directory, from this directory:

```sh
KIT=/absolute/path/to/unpacked-kit
OUT="$(mktemp -d)"
MAKEFUN_INPUT_DIR="$KIT/practice/input" MAKEFUN_OUTPUT_DIR="$OUT" node main.ts
MAKEFUN_OUTPUT_DIR="$OUT" MAKEFUN_REFERENCE_DIR="$KIT/practice/reference" MAKEFUN_SCORES_DIR="$OUT/scores" node "$KIT/program/scorer/main.ts"
cat "$OUT/scores/scores.json"
```

The published inputs should return `{"passed":1,"cases_passed":3,"cases_total":3}`. Local timing and passing the public gate do not establish an official placement.

Original implementation under the MIT license. Compatibility reference: make.fun's makefun-site 1.0.0 (MIT; see `REFERENCE-NOTICES.txt`). Neither that implementation nor the official kit, datasets or Node binary are shipped here.
