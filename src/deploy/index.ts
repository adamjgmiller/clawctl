export { freshDeploy } from './fresh.js';
export type { DeployCallbacks } from './fresh.js';
export { adoptDeploy } from './adopt.js';
export { provisionEc2Instance } from './ec2.js';
export type { Ec2ProvisionInput, Ec2ProvisionResult } from './ec2.js';
export { loadDeployTemplates, getTemplatesDir, ensureTemplatesDir } from './templates.js';
export type { DeployTemplates } from './templates.js';
export {
  installTailscaleScript,
  getTailscaleIpScript,
  installOpenClawScript,
  setupSystemdScript,
  startServiceScript,
} from './scripts.js';
