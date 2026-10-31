import { cancelGuideJob } from './guide-jobs';
import { removeProject } from './project-store';
import { cancelSampleJob, waitForSampleJob } from './sample-jobs';
import { discardJob } from './translation-jobs';

/**
 * Deletes a book from this device after stopping everything this tab runs for it: guideline generation, a sample and
 * the translation run. Each of them sends paid requests, so none may outlive the book; the sample and the run are
 * awaited so none of their writes lands after the deletion. Shared by the library page and the WebMCP `delete_book`.
 */
export async function deleteBookFromDevice(projectId: string): Promise<void> {
  cancelGuideJob(projectId);
  cancelSampleJob(projectId);
  await Promise.all([discardJob(projectId), waitForSampleJob(projectId)]);
  await removeProject(projectId);
}
