// FB-229: the studio's deploy settings must survive the move from railway.json to
// .railway/railway.ts exactly. `railway config migrate` itself dropped two of the five (the builder
// and the restart policy), so this test does not trust any tool's output: it runs the real file and
// checks every value by name.
//
// The `railway` package is not installed in this repo (the Railway CLI brings its own), so the file
// is run here with small stand-ins for the five functions it imports. Each stand-in returns its
// arguments as plain data, the same shape the real ones build, so what is checked is exactly what
// the file says.
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('..', import.meta.url));
const IAC_FILE = `${root}.railway/railway.ts`;
const LEGACY_FILE = `${root}railway.json`;

// The settings, as they were in railway.json on the day of the move, plus the pre-deploy step
// (FB-282). Changing one of these is a deploy change, and it belongs in its own pull request with its own staging deploy (FB-229, "Out of
// scope"). Do not edit this list to make the test pass.
const EXPECTED = {
  builder: 'NIXPACKS',
  startCommand: 'npm run start',
  // FB-282 (its own pull request): load any new schema files before each deploy. FB-287 (its own
  // pull request): then stop if the database lacks one. Both are in package.json's before-deploy.
  preDeployCommand: ['npm run before-deploy'],
  healthcheckPath: '/api/health',
  healthcheckTimeout: 100,
  restartPolicyType: 'ON_FAILURE',
  restartPolicyMaxRetries: 3,
} as const;

type Plain = Record<string, unknown>;

const stubs = {
  defineRailway: (program: () => unknown) => program,
  project: (name: string, def: Plain) => ({ name, ...def }),
  service: (name: string, config: Plain) => ({ name, ...config }),
  github: (repo: string, options: Plain = {}) => ({ type: 'github', repo, branch: 'main', ...options }),
  preserve: () => ({ type: 'preserve' }),
};

function loadIacFile(): { partial: unknown; project: { name: string; resources: Plain[] } } {
  const source = readFileSync(IAC_FILE, 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  const mod: { exports: Plain } = { exports: {} };
  const requireStub = (name: string) => {
    if (name !== 'railway/iac') throw new Error(`.railway/railway.ts imports ${name}; only railway/iac is expected`);
    return stubs;
  };
  new Function('require', 'module', 'exports', outputText)(requireStub, mod, mod.exports);
  const program = mod.exports.default as () => { name: string; resources: Plain[] };
  return { partial: mod.exports.partial, project: program() };
}

// Railway's service() takes variables under two keys, `env` and `variables`, and merges them. A value
// written under either one is applied, so both are read here.
function variableEntries(): [string, unknown][] {
  const studio = studioService();
  return [
    ...Object.entries((studio.variables ?? {}) as Plain),
    ...Object.entries((studio.env ?? {}) as Plain),
  ];
}

function studioService(): Plain {
  const { project } = loadIacFile();
  const studio = project.resources.find((r) => r.name === 'foundry-studio');
  if (!studio) throw new Error('.railway/railway.ts does not declare the foundry-studio service');
  return studio;
}

describe('.railway/railway.ts keeps the studio deploy settings (FB-229)', () => {
  it('declares one project, foundry-studio, managing only the foundry-studio service', () => {
    const { partial, project } = loadIacFile();
    expect(project.name).toBe('foundry-studio');
    expect(partial).toBe('foundry-studio');
    expect(project.resources.map((r) => r.name)).toEqual(['foundry-studio']);
  });

  it('keeps the builder', () => {
    expect((studioService().build as Plain).builder).toBe(EXPECTED.builder);
  });

  it('keeps the start command', () => {
    expect((studioService().deploy as Plain).startCommand).toBe(EXPECTED.startCommand);
  });

  it('loads any new schema files before each deploy (FB-282)', () => {
    expect((studioService().deploy as Plain).preDeployCommand).toEqual(EXPECTED.preDeployCommand);
  });

  it('keeps the health check path and its timeout', () => {
    const deploy = studioService().deploy as Plain;
    expect(deploy.healthcheckPath).toBe(EXPECTED.healthcheckPath);
    expect(deploy.healthcheckTimeout).toBe(EXPECTED.healthcheckTimeout);
  });

  it('keeps the restart policy and its retry count', () => {
    const deploy = studioService().deploy as Plain;
    expect(deploy.restartPolicyType).toBe(EXPECTED.restartPolicyType);
    expect(deploy.restartPolicyMaxRetries).toBe(EXPECTED.restartPolicyMaxRetries);
  });

  it('sets each setting in one place only, so a second spelling cannot override it', () => {
    // service() also accepts shorthands (start, healthcheck, run.command, ...). If one of them were
    // set as well, Railway would pick one and this test would be checking the other.
    const studio = studioService();
    for (const shorthand of ['start', 'startCommand', 'healthcheck', 'healthcheckPath', 'healthcheckTimeout', 'run']) {
      expect(studio, `remove the "${shorthand}" shorthand; the value lives under deploy`).not.toHaveProperty(shorthand);
    }
    expect(typeof studio.build, 'build must be the settings object, not a build command').toBe('object');
  });

  it('keeps the service connected to its GitHub repository', () => {
    // Without a source, `railway config apply` disconnects the service from GitHub, and nothing
    // deploys again until someone reconnects it by hand.
    expect(studioService().source).toMatchObject({ type: 'github', repo: 'wealthcx01/fountainbridge', branch: 'main' });
  });

  it('never holds a variable value: every variable is preserve()', () => {
    // A value in this file would be a secret in a public repository (non-negotiable 8).
    // Both `env` and `variables` are read: Railway applies a value written under either.
    const entries = variableEntries();
    expect(entries.length).toBeGreaterThan(0);
    for (const [name, value] of entries) {
      expect(value, `${name} must be preserve(), not a value`).toEqual({ type: 'preserve' });
    }
  });

  it('names every variable that exists on staging and production, so apply cannot delete one', () => {
    // A variable missing from the file is deleted by `railway config apply`. These are the names
    // that existed on staging and on a production-forked preview on 2026-10-02 (FB-229). Adding a
    // name is fine; removing one from here needs the variable gone from Railway first.
    const known = [
      'AUTH_SECRET', 'AUTH_TRUST_HOST', 'AUTH_URL', 'COMPOSER_API_KEY_ARCA', 'DATABASE_URL',
      'DEPLOY_BUMP', 'DOCUMENT_STORE', 'FOUNDRY_APPROVAL_SECRET', 'GITHUB_APP_ID',
      'GITHUB_APP_INSTALLATION_ID', 'GITHUB_APP_PRIVATE_KEY', 'GITHUB_ORG', 'GOOGLE_CLIENT_ID',
      'GOOGLE_CLIENT_SECRET', 'NIXPACKS_NODE_VERSION', 'OFFICE_HOST_ARCA', 'OFFICE_SECRET_ARCA',
      'STUDIO_ADMIN_EMAILS', 'STUDIO_APPROVAL_GITHUB_TOKEN', 'STUDIO_PASSWORD_LOGINS',
    ];
    const declared = variableEntries().map(([name]) => name);
    for (const name of known) expect(declared, `${name} would be deleted by apply`).toContain(name);
  });

  it('agrees with railway.json for as long as railway.json still exists', () => {
    // railway.json is what Railway actually uses until `railway config apply` has been run. Two
    // files that disagree would mean the deploy changes the moment someone applies.
    if (!existsSync(LEGACY_FILE)) return;
    const legacy = JSON.parse(readFileSync(LEGACY_FILE, 'utf8')) as { build: Plain; deploy: Plain };
    expect(legacy.build).toEqual({ builder: EXPECTED.builder });
    const { builder: _builder, ...deploy } = EXPECTED;
    expect(legacy.deploy).toEqual(deploy);
  });
});
