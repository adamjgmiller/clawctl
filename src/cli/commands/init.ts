import { Command } from 'commander';
import { createInterface } from 'node:readline';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { loadConfig, saveConfig, getClawctlDir } from '../../config/index.js';
import { ConfigSchema } from '../../types/index.js';
import type { Config } from '../../types/index.js';

function prompt(rl: ReturnType<typeof createInterface>, question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => resolve(answer.trim()));
  });
}

export function createInitCommand(): Command {
  return new Command('init')
    .description('Initialize ~/.clawctl/ with config and directory structure')
    .action(async () => {
      const clawctlDir = getClawctlDir();
      const configPath = join(clawctlDir, 'config.json');
      const isExisting = existsSync(configPath);

      const rl = createInterface({ input: process.stdin, output: process.stdout });

      try {
        if (isExisting) {
          const current = await loadConfig();
          console.log('clawctl is already initialized. Current config:\n');
          const labelWidth = 20;
          const fmt = (label: string, value: string) =>
            `  ${(label + ':').padEnd(labelWidth)} ${value}`;
          console.log(fmt('AWS Region', current.awsRegion));
          console.log(fmt('SSH Key Path', current.sshKeyPath));
          console.log(fmt('SSH User', current.sshUser));
          console.log(fmt('AWS Profile', current.awsProfile));
          console.log(fmt('EC2 Instance Type', current.ec2InstanceType));
          console.log('');

          const answer = await prompt(rl, 'Update config? (y/N) ');
          if (answer.toLowerCase() !== 'y') {
            console.log('No changes made.');
            return;
          }
          console.log('\nPress Enter to keep current values.\n');
        } else {
          console.log('Initializing clawctl...\n');
        }

        const defaults = isExisting ? await loadConfig() : ConfigSchema.parse({});

        const awsRegion =
          (await prompt(rl, `AWS Region (${defaults.awsRegion}): `)) || defaults.awsRegion;
        const sshKeyPath =
          (await prompt(rl, `SSH Key Path (${defaults.sshKeyPath}): `)) || defaults.sshKeyPath;
        const sshUser =
          (await prompt(rl, `Default SSH User (${defaults.sshUser}): `)) || defaults.sshUser;
        const awsProfile =
          (await prompt(rl, `AWS Profile (${defaults.awsProfile}): `)) || defaults.awsProfile;

        const config: Config = {
          ...defaults,
          awsRegion,
          sshKeyPath,
          sshUser,
          awsProfile,
        };

        // Create directory structure
        await mkdir(clawctlDir, { recursive: true });
        await mkdir(join(clawctlDir, 'templates'), { recursive: true });

        await saveConfig(config);

        console.log(`\nConfig written to ${configPath}`);
        console.log(`Templates directory: ${join(clawctlDir, 'templates')}`);
        console.log('\nclawctl initialized successfully.');
      } finally {
        rl.close();
      }
    });
}
