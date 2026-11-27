import { getTestDatabaseUrl, recreateDatabase } from '../support/test-database';

const setup = (): Promise<void> => recreateDatabase(getTestDatabaseUrl());

export default setup;
