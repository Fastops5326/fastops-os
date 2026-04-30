# /wave init - Initialize Wave Directory

## Skill Metadata
- **Name**: wave-init
- **Trigger**: `/wave init`
- **Purpose**: Create the .wave/ directory structure with a template state.json

## Overview

Initializes a new wave coordination directory for multi-agent parallel execution. Creates the necessary folder structure and a template state file that you can customize.

## Usage

```
/wave init
/wave init --project "my-project"
```

## What It Does

1. Creates `.wave/` directory if it doesn't exist
2. Creates `.wave/specs/` subdirectory for task specifications
3. Creates `.wave/state.json` with template structure
4. Displays next steps for configuration

## Implementation

Create the directory structure and template files:

```bash
mkdir -p .wave/specs
```

Create the state.json template:

```bash
cat > .wave/state.json << 'EOF'
{
  "project": "my-project",
  "description": "Project description here",
  "tasks": {
    "TASK-1": {
      "status": "available",
      "spec": "specs/TASK-1.md",
      "description": "First task description"
    },
    "TASK-2": {
      "status": "available",
      "spec": "specs/TASK-2.md",
      "description": "Second task description",
      "depends": ["TASK-1"]
    }
  }
}
EOF
```

## Output Format

```
Wave directory initialized!

Created:
  .wave/
  .wave/specs/
  .wave/state.json (template)

Next steps:
  1. Edit .wave/state.json to define your tasks
  2. Create spec files in .wave/specs/ for each task
  3. Run /wave status to verify configuration
  4. Run /wave execute to begin parallel execution
```

## Directory Structure Created

```
.wave/
  state.json        # Coordination state (edit this)
  state.lock        # Lock file (auto-created during operations)
  specs/            # Task specification files
    TASK-1.md       # Create one spec per task
    TASK-2.md
    ...
```

## Template state.json

```json
{
  "project": "my-project",
  "description": "Describe what this wave accomplishes",
  "tasks": {
    "EXAMPLE-1": {
      "status": "available",
      "spec": "specs/EXAMPLE-1.md",
      "description": "Example task with no dependencies"
    },
    "EXAMPLE-2": {
      "status": "available",
      "spec": "specs/EXAMPLE-2.md",
      "description": "Example task that depends on EXAMPLE-1",
      "depends": ["EXAMPLE-1"]
    }
  }
}
```

## Task Configuration

Each task in state.json has:

| Field | Required | Description |
|-------|----------|-------------|
| `status` | Yes | Always start as `"available"` |
| `spec` | Yes | Path to spec file (relative to .wave/) |
| `description` | No | Human-readable description |
| `depends` | No | Array of task IDs this depends on |

## Spec File Format

Each spec file (e.g., `specs/AUTH.md`) should contain:

```markdown
# AUTH Domain Contract

## Overview
What this task accomplishes

## Types
TypeScript interfaces/types to create

## Service Interface
Methods to implement

## API Routes
Endpoints to create

## Database Schema
Tables/collections needed

## Validation Rules
Input validation requirements

## Error Codes
Domain-specific error codes
```

## Connecting to Contract-First Development

If you've already generated contracts using contract-first methodology:

```bash
# Copy or symlink existing contracts
cp contracts/AUTH-CONTRACT.md .wave/specs/AUTH.md
cp contracts/USERS-CONTRACT.md .wave/specs/USERS.md
```

Then update state.json to reference them:

```json
{
  "project": "my-app",
  "tasks": {
    "AUTH": {
      "status": "available",
      "spec": "specs/AUTH.md"
    },
    "USERS": {
      "status": "available",
      "spec": "specs/USERS.md",
      "depends": ["AUTH"]
    }
  }
}
```

## Dependency Graph

Tasks can depend on other tasks. The wave system will:
- Block dependent tasks until dependencies complete
- Automatically unblock tasks when dependencies finish
- Allow parallel execution of independent tasks

Example dependency graph:
```
AUTH ──┬──> API ──> UI
       │
       └──> USERS ──> PERMISSIONS
```

This allows AUTH to run first, then API and USERS in parallel, then UI and PERMISSIONS in parallel.

## Validation

After initialization, run `/wave status` to verify:
- All spec files exist
- Dependencies reference valid task IDs
- No circular dependencies

## Related Commands

- `/wave status` - Verify initialization
- `/wave claim` - Start claiming tasks
- `/wave execute` - Run automated execution loop
