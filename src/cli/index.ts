#!/usr/bin/env node

import { Command } from 'commander';
import { createAgentsCommand } from './commands/agents.js';
import { createNetworkCommand } from './commands/network.js';

const program = new Command('clawctl')
  .description('Agent-native control plane for managing OpenClaw fleets')
  .version('0.1.0');

program.addCommand(createAgentsCommand());
program.addCommand(createNetworkCommand());

await program.parseAsync();
