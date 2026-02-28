export { freshDeploy } from './fresh.js';
export type { DeployCallbacks } from './fresh.js';
export { adoptDeploy } from './adopt.js';
export { provisionEc2Instance } from './ec2.js';
export type { Ec2ProvisionInput, Ec2ProvisionResult } from './ec2.js';
export { loadDeployTemplates, getTemplatesDir, ensureTemplatesDir, seedDefaultTemplates } from './templates.js';
export type { DeployTemplates } from './templates.js';
export {
  DEFAULT_OPENCLAW_JSON,
  DEFAULT_ENV_TEMPLATE,
  DEFAULT_SYSTEMD_UNIT,
} from './default-templates.js';
export {
  installTailscaleScript,
  getTailscaleIpScript,
  installOpenClawScript,
  setupSystemdScript,
  startServiceScript,
} from './scripts.js';
