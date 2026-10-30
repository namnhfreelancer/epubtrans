import { ProjectDatabase } from './project-database';
import { createProjectRepository } from './project-repository';

/** App-wide persistence singletons (one IndexedDB database per origin). */
export const database = new ProjectDatabase();
export const repository = createProjectRepository(database);
