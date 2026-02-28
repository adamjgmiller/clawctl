#!/usr/bin/env node

import { Command } from 'commander';
import { createAgentsCommand } from './commands/agents.js';
import { createNetworkCommand } from './commands/network.js';
import { createInitCommand } from './commands/init.js';
import { createConfigCommand } from './commands/config.js';
import { createSecretsCommand } from './commands/secrets.js';
import { createPolicyCommand } from './commands/policy.js';
import { createDashboardCommand } from './commands/dashboard.js';
import { createAlertsCommand } from './commands/alerts.js';
import { createWatchCommand } from './commands/watch.js';
import { createUpdateCommand } from './commands/update.js';

const program = new Command('clawctl')
  .description('Agent-native control plane for managing OpenClaw fleets')
  .version('0.1.0');

program.addCommand(createInitCommand());
program.addCommand(createAgentsCommand());
program.addCommand(createNetworkCommand());
program.addCommand(createConfigCommand());
program.addCommand(createSecretsCommand());
program.addCommand(createPolicyCommand());
program.addCommand(createDashboardCommand());
program.addCommand(createAlertsCommand());
program.addCommand(createWatchCommand());
program.addCommand(createUpdateCommand());

await program.parseAsync();
