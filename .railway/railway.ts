// How Railway builds, starts and watches the studio (FB-229).
//
// This replaces railway.json, which Railway stops reading on 2026-12-01. It carries the same five
// settings, unchanged. `railway config migrate` wrote the first draft of this file and dropped two of
// them: it left the builder as a comment and lost the restart policy entirely. They are written in by
// hand below. lib/railway-config.test.ts fails if any of the five goes missing or changes.
//
// Railway does NOT read this file when it deploys. It only takes effect when someone runs
// `railway config apply` against an environment. Until that has been done for staging and production,
// railway.json is still what Railway uses, and it must not be deleted. docs/deploy.md has the steps.
//
// Running `railway config apply` is a deploy. Only John runs it: staging first, production after,
// each with a recorded approval. Nobody else applies this file, however clean the plan looks.
import { defineRailway, github, preserve, project, service } from 'railway/iac';

// The studio is the only service in this file. `partial` tells Railway to manage only what is
// declared here and leave anything else in the project alone.
export const partial = 'foundry-studio';

export default defineRailway(() => {
  const studio = service('foundry-studio', {
    // Where the code comes from. Leave this out and `railway config apply` disconnects the
    // service from GitHub.
    source: github('wealthcx01/fountainbridge', { branch: 'main' }),
    // The studio's settings and keys. Keep them all here under `env`; do not also add a
    // `variables` list (Railway merges the two, and the test checks both). Every one is
    // `preserve()`: this file names them so that `apply` keeps them, and never holds a value. A
    // name missing from this list is DELETED from the environment by `apply`, which would sign
    // everyone out or stop the studio starting. So always run `railway config plan` first and stop
    // if it says anything will be destroyed.
    //
    // The list is every variable on staging and on a preview forked from production, read on
    // 2026-10-02. Staging has only the first eight of these.
    env: {
      AUTH_SECRET: preserve(),
      AUTH_TRUST_HOST: preserve(),
      AUTH_URL: preserve(),
      GITHUB_ORG: preserve(),
      GOOGLE_CLIENT_ID: preserve(),
      GOOGLE_CLIENT_SECRET: preserve(),
      NIXPACKS_NODE_VERSION: preserve(),
      STUDIO_ADMIN_EMAILS: preserve(),
      COMPOSER_API_KEY_ARCA: preserve(),
      DATABASE_URL: preserve(),
      DEPLOY_BUMP: preserve(),
      DOCUMENT_STORE: preserve(),
      FOUNDRY_APPROVAL_SECRET: preserve(),
      GITHUB_APP_ID: preserve(),
      GITHUB_APP_INSTALLATION_ID: preserve(),
      GITHUB_APP_PRIVATE_KEY: preserve(),
      OFFICE_HOST_ARCA: preserve(),
      OFFICE_SECRET_ARCA: preserve(),
      STUDIO_APPROVAL_GITHUB_TOKEN: preserve(),
      STUDIO_PASSWORD_LOGINS: preserve(),
      // FB-282, staging (and previews) only: where the pre-deploy step loads the schema, and the
      // studio role's password. Names only; the values live in Railway.
      SCHEMA_ADMIN_URL: preserve(),
      STUDIO_DB_PASSWORD: preserve(),
    },
    build: {
      builder: 'NIXPACKS',
    },
    deploy: {
      startCommand: 'npm run start',
      // Before each deploy (package.json's before-deploy): FB-282 loads any new schema files, which
      // it does only where SCHEMA_ADMIN_URL is set (staging, and previews, which copy staging); then
      // FB-287 stops the deploy if the database lacks a schema file this version has.
      preDeployCommand: ['npm run before-deploy'],
      // Without this, a deploy that starts but cannot serve a page is still marked healthy.
      healthcheckPath: '/api/health',
      healthcheckTimeout: 100,
      // If the studio crashes, Railway restarts it, up to three times.
      restartPolicyType: 'ON_FAILURE',
      restartPolicyMaxRetries: 3,
    },
  });
  return project('foundry-studio', {
    resources: [studio],
  });
});
