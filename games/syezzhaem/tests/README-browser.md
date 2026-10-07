# Optional R2 browser smoke

Requires an available Playwright installation and its Chromium browser. These runners are author checks; they do not replace independent native API/Auth acceptance or physical phone testing.

From `front/`:

```sh
node tests/front-r2-view.mjs
node --import tsx tests/front-r2-ui.mjs
```

If Playwright is provided outside the project, set `R2_PLAYWRIGHT_MODULE` to its module path. Set `R2_CHROMIUM_PATH` only when using a custom Chromium binary; otherwise Playwright chooses its installed browser. Any shared libraries required by that custom binary must be available to the operating system.

The view fixture renders actual core/view code with test poses. Its hazard poses are visual-only and do not represent valid persisted snapshots. The main runner uses actual DOM actions, IndexedDB, snapshot validation and Babylon, with explicitly mocked HTTP session/RPC responses. It tests the first bridge, separate PC and emulated touch item actions, canceled touches, material selection, saved hint preference, pause, visual fuse and optional AudioContext, landscape HUD bounds and portrait suspension. It cannot certify the backend, email delivery, hardware performance or physical touch behavior.

Both runners save temporary screenshots under `test-evidence/`. These raw author screenshots are not release assets.
