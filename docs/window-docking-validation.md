# Windows docking validation

Build the Electron native addon with `npm run rebuild:native`, then launch with `npm run dev`. A renderer-only preview cannot exercise AppBar reservations. Older or unavailable native addons hide the docking option.

Automated checks: `npm run typecheck`, `npm run test:window-state`, `npm run test:desktop-integration`, `npm run test:profiles`, `npm run test:renderer-helpers`, and `npm run build`. The window-state suite covers docking normalization, persistence, monitor fallback, reservation lifecycle, requested versus active state, resize limits, restore geometry, and shell-induced popout geometry suppression.

## Desktop checks

- Enable **Reserve screen space** without first choosing an edge: it uses Bottom. Choose Top or Bottom while docked and maximize an ordinary application on that monitor. Confirm taskbars and other AppBars retain their space and other monitors retain their work areas.
- Grow and shrink the inward edge, including the 100-pixel minimum. Outer edges and native move/maximize/resize commands must not change the dock. Repeat with solid, blurred, and clear backgrounds.
- Click the grab handle without moving: remain docked. Drag: restore floating dimensions under the pointer. Disable through either menu: restore the original floating position and dimensions. Check both floating pin preferences.
- Open settings at both edges. Confirm width matches the rack, small workspaces scroll, controls update live meters, theme changes propagate, and application switching leaves settings open. Test toggle, Close and focused Escape. None of these operations should resize the reservation.
- Switch and save profiles while docked. The rack must stay docked, floating restore bounds must remain unchanged, and docking alone must not mark a profile modified. Deliberate popout moves should still persist.
- Minimize/restore and hide/show from the tray. Hidden or minimized Prism must reserve nothing. Restart with docking enabled, then with startup hidden. The remembered monitor, edge, height and floating bounds must survive.
- Recreate the rack through background changes, reload or crash its renderer, and quit. Settings close and reservations follow the visible, ready rack. Force-terminate a development instance and verify Windows releases its work area.
- Cover the dock with a fullscreen application, including borderless fullscreen, then exit fullscreen. Prism yields while fullscreen is foreground and returns above ordinary windows afterward.
- Restart Explorer. Prism must register with the new shell and reserve exactly one strip. Disconnect the selected monitor: docking turns off and the floating rack appears on the primary monitor. Reconnection must not redock it.
- Repeat on monitors with different scaling, including changing DPI while docked and monitors at negative desktop coordinates. Check physical strip height, settings placement and pointer alignment.

The shell API uses physical pixels; Electron and persisted window geometry use device-independent pixels. The native addon negotiates the rectangle against full monitor bounds and the shell. Its window subclass blocks native move/resize commands and releases registration on HWND destruction. Floating restore runs after the shell work-area message has completed, and uses current native work-area bounds to avoid Electron's stale display cache.

Settings use a same-origin owned child window and a React portal from the main renderer. The child has no independent settings store. Docking preferences live in the local window-state file, never in profiles.

## Validation performed

The Windows development run passed typecheck, native and production builds, and 253 window-state, profile, desktop-integration and renderer checks. Live checks covered top/bottom reservations on a 1920×480 monitor and a 3440×1440 monitor with a taskbar; settings edits, theme synchronization and scrolling; profile switching/saving; solid/clear/blurred recreation; inward resizing and drag/menu restore; hide/minimize; foreground borderless fullscreen; simulated shell registration loss followed by TaskbarCreated; forced process termination; and restart persistence including the floating pin preference.

Physical monitor removal, mixed-DPI changes, an actual Explorer restart, and packaged startup-hidden behavior still need manual verification. The available monitors all used 100% scaling. Missing-monitor fallback and initially hidden reservation behavior are covered by controller tests.
