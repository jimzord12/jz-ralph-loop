# Example Control Plane

This directory is a template control plane for a Ralph loop run. Copy it for a
real project, then replace `PROGRESS.md` and the files under `tasks/` with the
actual plan before running `ralph.sh`.

The tool lives at the repository root. Run it with this directory as the control
plane:

```bash
RALPH_CONTROL_DIR="$PWD/examples/control-plane" \
RALPH_PROJECT="/path/to/project" \
RALPH_GATE_CMD="your verification command" \
./ralph.sh
```

