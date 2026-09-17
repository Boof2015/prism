"""Verify transferred bytes, then restore Linux shell endings and executable modes."""
import hashlib
import json
import re
from pathlib import Path

run_dir = Path.cwd()
source_dir = (run_dir / 'source').resolve()
manifest = json.loads((run_dir / 'source-manifest.json').read_text())
prepared = []
for entry in manifest['files']:
    path = source_dir / entry['path']
    if not path.resolve().is_relative_to(source_dir) or path.is_symlink():
        raise RuntimeError(f"Invalid source path: {entry['path']}")
    content = path.read_bytes()
    if hashlib.sha256(content).hexdigest() != entry['sha256']:
        raise RuntimeError(f"Source changed while archiving or transferring: {entry['path']}. Run again.")
    is_shell = path.suffix == '.sh' or re.match(rb'^#![^\n]*\b(?:ba|da|z|k)?sh\b', content[:100])
    if is_shell and b'\r\n' in content:
        content = content.replace(b'\r\n', b'\n')
        path.write_bytes(content)
        prepared.append({'path': entry['path'], 'change': 'CRLF to LF', 'sha256': hashlib.sha256(content).hexdigest()})
    path.chmod(0o755 if is_shell or entry['mode'] == '100755' else 0o644)
(run_dir / 'logs').mkdir(exist_ok=True)
(run_dir / 'logs' / 'source-preparation.json').write_text(json.dumps(prepared, indent=2) + '\n')
print(f"Verified {len(manifest['files'])} source files; normalized {len(prepared)} shell scripts.")
