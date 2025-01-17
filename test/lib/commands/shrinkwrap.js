const t = require('tap')
const fs = require('fs')
const { resolve } = require('path')
const { real: mockNpm } = require('../../fixtures/mock-npm')

// Attempt to parse json values in snapshots before
// stringifying to remove escaped values like \\"
// This also doesn't reorder the keys of the object
// like tap does by default which is nice in this case
t.formatSnapshot = obj =>
  JSON.stringify(
    obj,
    (k, v) => {
      try {
        return JSON.parse(v)
      } catch (_) {}
      return v
    },
    2
  )

// Run shrinkwrap against a specified testdir with config items
// and make some assertions that should always be true. Sets
// the results on t.context for use in child tests
const shrinkwrap = async (t, testdir = {}, config = {}, mocks = {}) => {
  const { Npm, logs } = mockNpm(t, mocks)
  const npm = new Npm()
  await npm.load()

  npm.localPrefix = t.testdir(testdir)
  if (config.lockfileVersion) {
    npm.config.set('lockfile-version', config.lockfileVersion)
  }
  if (config.global) {
    npm.config.set('global', config.global)
  }

  await npm.exec('shrinkwrap', [])

  const newFile = resolve(npm.localPrefix, 'npm-shrinkwrap.json')
  const oldFile = resolve(npm.localPrefix, 'package-lock.json')
  const notices = logs.filter(([title]) => title === 'notice').map(([, , msg]) => msg)
  const warnings = logs.filter(([title]) => title === 'warn').map(([, , msg]) => msg)

  t.notOk(fs.existsSync(oldFile), 'package-lock is always deleted')
  t.same(warnings, [], 'no warnings')
  t.teardown(() => delete t.context)
  t.context = {
    localPrefix: testdir,
    config,
    shrinkwrap: JSON.parse(fs.readFileSync(newFile)),
    logs: notices,
  }
}

// Run shrinkwrap against all combinations of existing and config
// lockfile versions
const shrinkwrapMatrix = async (t, file, assertions) => {
  const ancient = JSON.stringify({ lockfileVersion: 1 })
  const existing = JSON.stringify({ lockfileVersion: 2 })
  const upgrade = { lockfileVersion: 3 }
  const downgrade = { lockfileVersion: 1 }

  let ancientDir = {}
  let existingDir = null
  if (file === 'package-lock') {
    ancientDir = { 'package-lock.json': ancient }
    existingDir = { 'package-lock.json': existing }
  } else if (file === 'npm-shrinkwrap') {
    ancientDir = { 'npm-shrinkwrap.json': ancient }
    existingDir = { 'npm-shrinkwrap.json': existing }
  } else if (file === 'hidden-lockfile') {
    ancientDir = { node_modules: { '.package-lock.json': ancient } }
    existingDir = { node_modules: { '.package-lock.json': existing } }
  }

  await t.test('ancient', async t => {
    await shrinkwrap(t, ancientDir)
    t.match(t.context, assertions.ancient)
    t.matchSnapshot(t.context)
  })
  await t.test('ancient upgrade', async t => {
    await shrinkwrap(t, ancientDir, upgrade)
    t.match(t.context, assertions.ancientUpgrade)
    t.matchSnapshot(t.context)
  })

  if (existingDir) {
    await t.test('existing', async t => {
      await shrinkwrap(t, existingDir)
      t.match(t.context, assertions.existing)
      t.matchSnapshot(t.context)
    })
    await t.test('existing upgrade', async t => {
      await shrinkwrap(t, existingDir, upgrade)
      t.match(t.context, assertions.existingUpgrade)
      t.matchSnapshot(t.context)
    })
    await t.test('existing downgrade', async t => {
      await shrinkwrap(t, existingDir, downgrade)
      t.match(t.context, assertions.existingDowngrade)
      t.matchSnapshot(t.context)
    })
  }
}

const NOTICES = {
  CREATED: (v = '') => [`created a lockfile as npm-shrinkwrap.json${v && ` with version ${v}`}`],
  RENAMED: (v = '') => [
    `package-lock.json has been renamed to npm-shrinkwrap.json${
      v && ` and updated to version ${v}`
    }`,
  ],
  UPDATED: (v = '') => [`npm-shrinkwrap.json updated to version ${v}`],
  SAME: () => [`npm-shrinkwrap.json up to date`],
}

t.test('with nothing', t =>
  shrinkwrapMatrix(t, null, {
    ancient: {
      shrinkwrap: { lockfileVersion: 2 },
      logs: NOTICES.CREATED(2),
    },
    ancientUpgrade: {
      shrinkwrap: { lockfileVersion: 3 },
      logs: NOTICES.CREATED(3),
    },
  })
)

t.test('with package-lock.json', t =>
  shrinkwrapMatrix(t, 'package-lock', {
    ancient: {
      shrinkwrap: { lockfileVersion: 2 },
      logs: NOTICES.RENAMED(2),
    },
    ancientUpgrade: {
      shrinkwrap: { lockfileVersion: 3 },
      logs: NOTICES.RENAMED(3),
    },
    existing: {
      shrinkwrap: { lockfileVersion: 2 },
      logs: NOTICES.RENAMED(),
    },
    existingUpgrade: {
      shrinkwrap: { lockfileVersion: 3 },
      logs: NOTICES.RENAMED(3),
    },
    existingDowngrade: {
      shrinkwrap: { lockfileVersion: 1 },
      logs: NOTICES.RENAMED(1),
    },
  })
)

t.test('with npm-shrinkwrap.json', t =>
  shrinkwrapMatrix(t, 'npm-shrinkwrap', {
    ancient: {
      shrinkwrap: { lockfileVersion: 2 },
      logs: NOTICES.UPDATED(2),
    },
    ancientUpgrade: {
      shrinkwrap: { lockfileVersion: 3 },
      logs: NOTICES.UPDATED(3),
    },
    existing: {
      shrinkwrap: { lockfileVersion: 2 },
      logs: NOTICES.SAME(),
    },
    existingUpgrade: {
      shrinkwrap: { lockfileVersion: 3 },
      logs: NOTICES.UPDATED(3),
    },
    existingDowngrade: {
      shrinkwrap: { lockfileVersion: 1 },
      logs: NOTICES.UPDATED(1),
    },
  })
)

t.test('with hidden lockfile', t =>
  shrinkwrapMatrix(t, 'hidden-lockfile', {
    ancient: {
      shrinkwrap: { lockfileVersion: 1 },
      logs: NOTICES.CREATED(),
    },
    ancientUpgrade: {
      shrinkwrap: { lockfileVersion: 3 },
      logs: NOTICES.CREATED(),
    },
    existing: {
      shrinkwrap: { lockfileVersion: 2 },
      logs: NOTICES.CREATED(),
    },
    existingUpgrade: {
      shrinkwrap: { lockfileVersion: 3 },
      logs: NOTICES.CREATED(3),
    },
    existingDowngrade: {
      shrinkwrap: { lockfileVersion: 1 },
      logs: NOTICES.CREATED(1),
    },
  })
)

t.test('throws in global mode', async t => {
  t.rejects(
    shrinkwrap(
      t,
      {},
      {
        global: true,
      }
    ),
    {
      message: '`npm shrinkwrap` does not work for global packages',
      code: 'ESHRINKWRAPGLOBAL',
    }
  )
})
