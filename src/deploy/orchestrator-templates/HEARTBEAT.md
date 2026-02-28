# HEARTBEAT.md

## Every Heartbeat
- Run `clawctl agents status` — flag any offline or degraded agents
- Check `memory/pending-followups.json` — resume pending tasks
- If an agent has been offline >5 min, run `clawctl agents diagnose <name> --fix`

## Hourly
- Run `clawctl config diff --all` — flag any configuration drift
- Run `clawctl update check` — flag version mismatches

## Daily (first heartbeat after 09:00 operator timezone)
- Review yesterday's `memory/YYYY-MM-DD.md`
- Update `MEMORY.md` with anything worth keeping
- Send daily fleet summary to operator
