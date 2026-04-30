# /wave - Multi-Terminal Task Coordination

> Fusion architecture for parallel task execution across multiple terminals.

## Quick Start

```bash
node wave.js
```

That's it. Run this command in **each terminal** you want to use as a worker.

## How It Works

1. **First terminal**: Initializes wave (if needed), shows status, starts claiming tasks
2. **Additional terminals**: Join automatically and start claiming available tasks
3. **Atomic claiming**: Uses `mkdir` for conflict-free task claims
4. **Dependency tracking**: Tasks only become available when dependencies complete

## Commands

| Command | Description |
|---------|-------------|
| `node wave.js` | **Recommended** - Interactive dev mode |
| `node wave.js status` | View current progress |
| `node wave.js reset` | Reset all tasks to available |

## The Manifest

Tasks are defined in `scripts/wave/manifest.json`:

```json
{
  "project": "my-project",
  "tasks": {
    "shared-types": {
      "spec": "Define shared TypeScript types",
      "output": "src/shared/types.ts",
      "depends": []
    },
    "user-service": {
      "spec": "Implement user service",
      "output": "src/services/user.ts",
      "depends": ["shared-types"]
    }
  }
}
```

## Architecture

```
scripts/wave/.wave/
├── manifest.json        # Read-only task definitions
├── shared-types/
│   ├── claimed/         # mkdir = atomic claim
│   │   ├── agent        # Who claimed it
│   │   └── time         # When
│   └── done/            # mkdir = completion
└── user-service/
    └── ...
```

**Key insight**: Only `mkdir` is atomic. All state is directory existence, not file contents.

## Status Icons

- `○` Available - Ready to claim
- `◌` Blocked - Waiting for dependencies
- `◐` In Progress - Claimed by an agent
- `●` Complete - Done
