# Linux testing from Windows

Run `npm run test:linux` from the Windows checkout to test in Ubuntu WSL2. Use
`npm run test:linux -- --target fedora` for an SSH-connected Fedora VM. The
Windows checkout remains the source of truth; each invocation creates a fresh
Linux copy under `~/.cache/prism-linux-tests/runs/<run-id>/source`.
If PowerShell blocks `npm.ps1`, use `npm.cmd` in these commands.

## One-time setup

### Ubuntu WSL2

From PowerShell in the repository (substitute your Windows repository path):

```powershell
wsl -d Ubuntu -u root --exec bash /mnt/c/Users/boofi/Documents/astra/prism/scripts/linux/setup.sh system
wsl -d Ubuntu --exec bash /mnt/c/Users/boofi/Documents/astra/prism/scripts/linux/setup.sh node
```

The system step installs the Ubuntu CI build dependencies, Electron runtime
libraries, Xvfb, and RPM packaging tools. The user step downloads official Node
22, verifies its SHA-256 checksum, and installs it in
`~/.local/share/prism-linux/node`. It neither replaces Windows Node nor changes
your shell configuration. The runner sets a Linux-only PATH and checks Node's
platform and version. Builds live on the Linux filesystem; Windows
`node_modules`, native binaries, and build directories are never reused.

### Fedora VM

Start the VM and log into its desktop. In a Fedora terminal:

```bash
sudo dnf install -y openssh-server
sudo systemctl enable --now sshd
sudo firewall-cmd --permanent --add-service=ssh
sudo firewall-cmd --reload
whoami
hostname -I
```

Add the Windows user's SSH **public** key to Fedora's `~/.ssh/authorized_keys`;
keep `~/.ssh` mode 700 and `authorized_keys` mode 600, then run
`restorecon -RF ~/.ssh`. Keep private keys on Windows. Establish a normal SSH
connection once to verify the host and authentication. The launcher uses batch
mode and fails rather than prompting for a password.

Add an alias to Windows `%USERPROFILE%\.ssh\config`:

```sshconfig
Host prism-fedora
    HostName <VM-IP>
    User <Fedora-user>
    IdentityFile ~/.ssh/id_ed25519
    IdentitiesOnly yes
```

`ssh prism-fedora id` should work. Update `HostName` if the VM's address changes.
Alternatively pass `--host user@IP` to the launcher. The VM must be running;
the launcher does not change VMware power or network settings.

Before installing packages or changing the original checkout, record its Git
revision, Node/Electron versions, and desktop session and reproduce any existing
failure. Copy `scripts/linux/setup.sh` to the VM, then run `sudo bash setup.sh
system` and `bash setup.sh node` when ready to prepare the separate test build.
An existing Linux Node 22.12+ on the system PATH also works. Do not run npm or
the application as root.

## Commands and results

```powershell
npm run test:linux
npm run test:linux -- --target wsl --distro Ubuntu --suite full
npm run test:linux -- --target fedora
npm run test:linux -- --target fedora --host user@IP --suite full
npm run test:linux -- --dry-run
```

- `routine`: install locked dependencies, explicitly rebuild/load the Linux
  native addon, typecheck, run `npm test`, build/test the TUI, and build the
  desktop and plugin UI.
- `full`: routine checks, then VST3/CLAP build/tests under Xvfb and
  `npm run dist:linux` (AppImage, deb, rpm, and tar.gz). Packages remain in the
  Linux source copy's `dist/`; they are not installed or published.
- `--dry-run`: list selected files without creating or transferring a run.

Logs are saved locally in `artifacts/linux-tests/<run-id>/`, which Git ignores:

- `source-manifest.json`: revision, dirty state, selected files, executable modes, and
  SHA-256 hashes. Selection includes staged/unstaged edits and untracked,
  non-ignored files; tracked deletions stay deleted. Inspect the dry run if you
  have local files you do not want transferred.
- `runner.log` and `result.json`: transport output, overall status, exit codes,
  source fingerprint, and Linux run directory.
- `logs/`: Linux environment, command output, individual step statuses, and
  shell-ending conversions. Partial logs are collected on failure too.

The transfer verifies every source hash before running tests. It restores Git
executable modes and converts CRLF to LF in shell scripts in the Linux copy,
including extensionless installer hooks. It records every conversion. Source
symlinks are rejected explicitly. A file changed during archiving causes a
failure; rerun once editing has stopped.

Native build failure is fatal even though Prism's normal postinstall allows a
JavaScript fallback. The runner stops at the first failed step and returns its
exit code. Logs and source copies remain available for investigation; old runs
are not automatically deleted. npm/Electron download caches are reused, but
compiled outputs are isolated per run. WSL/SSH commands may need approval to
cross the Windows agent sandbox boundary.

For a VM with unreliable GitHub DNS, an existing clean FTXUI checkout can seed
`~/.cache/prism-linux-tests/dependencies/ftxui-<revision>` using `git clone
--no-hardlinks /path/to/existing/ftxui-src <cache-path>` followed by
`git -C <cache-path> checkout --detach <revision>`. Use the immutable `GIT_TAG`
from `tui/CMakeLists.txt`. The runner verifies the cache's revision and clean
status before configuring CMake to use it. It never copies dependencies from
Windows or changes the VM's DNS settings.

## Fedora desktop and profile diagnosis

Build tests do not click native menus or prove desktop audio capture works.
Use the original logged-in KDE/GNOME session for the first reproduction. A
plain SSH shell lacks some display and session variables; launching from a
terminal inside the VM is the simplest faithful reproduction. Do not substitute
Xvfb for this check.

Back up `Documents/Prism Profiles` and the app's user-data directory before
testing; record its real location rather than assuming every installation uses
`~/.config/prism`. Preserve the original checkout. Keep diagnostics and backups
in a private directory outside it.

The opt-in `scripts/linux/profile-diagnostics.cjs` hook can be copied outside
the original checkout and loaded without editing its application source:

```bash
cd /path/to/original/prism
set -o pipefail
ELECTRON_ENABLE_LOGGING=1 \
NODE_OPTIONS='--require=/absolute/path/profile-diagnostics.cjs' \
npm run dev 2>&1 | tee /absolute/path/prism-dev.log
```

This hook is for development Electron only. Confirm `[profile-trace]` appears
with `installed` before testing. It logs native menu creation/clicks, menu events
received by the renderer, profile IPC requests/results/errors, renderer console
errors, and Electron's actual Documents/user-data paths with access checks.
It does not retain native Menu objects or change profile payloads. Restart
without `NODE_OPTIONS` to remove it. Because instrumentation can affect timing,
confirm a diagnosed behavior again without the hook.

Run this checklist and record pass/fail separately from automated results:

1. Show Profiles Folder opens the resolved directory in the file manager.
2. Save a uniquely named test profile, change a scope setting, then load it and
   confirm restoration. Overwrite, rename, and import a copied `.prsm` file.
3. Quit and relaunch; confirm the profile and active settings persist. Delete
   only the uniquely named test profiles when finished.
4. Enumerate output/input devices; play audio in the guest and verify capture
   and scope movement. Exercise a scope popout and relaunch.

For an inert menu, compare `menu-built`, `menu-click`, `renderer-received`,
`invoke`, and `resolved/rejected` to locate the break. Record Fedora release,
desktop, Wayland/X11, Electron version, source revision, and any displayed errors.
Investigate filesystem paths when the request reaches profile storage; do not
infer a permissions failure solely from a menu that closes without action.

VM audio represents virtual devices, not every physical Linux interface. Report
unexercised hardware and desktop checks as untested.
