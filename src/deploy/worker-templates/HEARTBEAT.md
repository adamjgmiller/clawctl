# HEARTBEAT.md

## Every Heartbeat
- Check `memory/pending-followups.json` — resume any incomplete tasks
- If a task has been pending >30 min with no progress, report status to orchestrator

## Task Pickup
- Check `memory/tasks/` for any `.md` files (excluding `.result.md` and `.error.md`)
- For each task file found:
  1. Read the instructions
  2. Do the work described
  3. Write your result to `memory/tasks/<task-id>.result.md`
  4. If you can't complete it, write the reason to `memory/tasks/<task-id>.error.md`
  5. Delete the original task file after writing result/error
- This is how the orchestrator delegates work to you
