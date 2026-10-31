import { createTeamHandler } from './_lib/team.js';
import { seedWorkspace } from '../src/domain.js';
export default createTeamHandler({ app: 'webhooklab', seed: seedWorkspace });
