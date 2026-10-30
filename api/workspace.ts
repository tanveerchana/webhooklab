import { createWorkspaceHandler } from './_lib/workspace.js';
import { seedWorkspace, reduceWorkspace, type Workspace } from '../src/domain.js';
export default createWorkspaceHandler<Workspace>({app:'webhooklab',seed:seedWorkspace,reduce:reduceWorkspace});
