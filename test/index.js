'use strict'

const crypto = require('crypto')
const test = require('tape')
const SecretStack = require('secret-stack')
const { createReadyable } = require('pull-readyable')
const { lifecycle, withLifecycle } = require('..')

test('lifecycle tracks listening, ready, closing, and closed', (t) => {
  t.plan(13)
  const create = stack()
  const app = create()
  const { run, listening, ready, closing, closed, status } = lifecycle(app)
  const calls = []
  t.ok(status(), 'uninitialized')
  app.once('close', (err) => {
    t.error(err)
    t.ok(status(), 'closing')
    calls.push('once-close')
  })
  run(listening, (err) => {
    t.error(err)
    t.ok(status(), 'initializing')
    calls.push('listening')
  })
  run(ready, (err) => {
    t.error(err)
    t.ok(status(), 'ready')
    calls.push('ready')
    app.close(() => {
      t.ok(status(), 'closing')
      calls.push('app-close')
    })
  })
  run(closing, (err) => {
    t.error(err)
    t.ok(status(), 'closing')
    calls.push('closing')
  })
  run(closed, (err) => {
    t.error(err)
    t.ok(status(), 'closed')
    calls.push('closed')
    t.deepEqual(calls, ['listening', 'ready', 'once-close', 'app-close', 'closing', 'closed'])
    t.end()
  })
})

test('lifecycle during()', (t) => {
  const create = stack()
    .use(withLifecycle({
      name: 'plugin-a',
      init (app) {
        const { during, ready } = app.lifecycle
        const pluginReady = during(ready)
        return { ready: pluginReady }
      }
    }))
  const app = create()
  t.teardown(app.close)
  const { run } = app.lifecycle
  const calls = []
  run(app.lifecycle.ready, (err) => {
    t.error(err)
    calls.push('app-ready')
  })
  run(app.pluginA.ready, (err) => {
    t.error(err)
    calls.push('plugin-a-ready')
  })
  run([app.pluginA.ready, app.lifecycle.ready], (err) => {
    t.error(err)
    t.deepEqual(calls, ['plugin-a-ready', 'app-ready'])
    t.end()
  })
})

test('lifecycle handle()', (t) => {
  const calls = []
  const create = stack()
    .use(withLifecycle({
      name: 'plugin-a',
      init (app) {
        const { handle, ready, closing } = app.lifecycle
        handle(ready, (cb) => {
          calls.push('ready-handler-start')
          setTimeout(() => {
            calls.push('ready-handler-end')
            cb()
          }, 10)
        })
        handle(closing, (cb) => {
          calls.push('closing-handler-start')
          setTimeout(() => {
            calls.push('closing-handler-end')
            cb()
          }, 10)
        })
        return {}
      }
    }))
  const app = create()
  t.teardown(app.close)
  const { run } = app.lifecycle
  t.deepEqual(calls, [])
  run(app.lifecycle.ready, (err) => {
    t.error(err)
    t.deepEqual(calls, ['ready-handler-start', 'ready-handler-end'])
    t.end()
  })
})

test('lifecycle setup()', (t) => {
  const calls = []
  const create = stack()
    .use(withLifecycle({
      name: 'plugin-a',
      init (app) {
        const { setup } = app.lifecycle
        calls.push('plugin-a')
        setImmediate(() => {
          calls.push('plugin-a-immediate-pre')
        })
        t.notOk(app.pluginA)
        t.notOk(app.pluginB)
        setup(() => {
          calls.push('plugin-a-setup')
          t.ok(app.pluginA)
          t.ok(app.pluginB)
          t.ok(app.pluginB.name, 'b')
        })
        setImmediate(() => {
          calls.push('plugin-a-immediate-post')
        })
        return { name: 'a' }
      }
    }))
    .use(withLifecycle({
      name: 'plugin-b',
      init (app) {
        const { setup } = app.lifecycle
        calls.push('plugin-b')
        setImmediate(() => {
          calls.push('plugin-b-immediate-pre')
        })
        t.ok(app.pluginA)
        t.notOk(app.pluginB)
        setup(() => {
          calls.push('plugin-b-setup')
          t.ok(app.pluginA)
          t.ok(app.pluginB)
          t.ok(app.pluginA.name, 'a')
        })
        setImmediate(() => {
          calls.push('plugin-b-immediate-post')
        })
        return { name: 'b' }
      }
    }))
  const app = create()
  t.teardown(app.close)
  const { run } = app.lifecycle
  t.deepEqual(calls, ['plugin-a', 'plugin-b'])
  run(app.lifecycle.ready, (err) => {
    t.error(err)
    t.deepEqual(calls, ['plugin-a', 'plugin-b', 'plugin-a-setup', 'plugin-b-setup'])
    setImmediate(() => {
      t.deepEqual(calls, ['plugin-a', 'plugin-b', 'plugin-a-setup', 'plugin-b-setup', 'plugin-a-immediate-pre', 'plugin-a-immediate-post', 'plugin-b-immediate-pre', 'plugin-b-immediate-post'])
      t.end()
    })
  })
})

test('lifecycle setup(), failure', (t) => {
  const create = stack()
    .use(withLifecycle({
      name: 'plugin-a',
      init (app) {
        const { setup } = app.lifecycle
        setup(() => {
          throw new Error('Bad setup')
        })
        return {}
      }
    }))
  const app = create()
  t.teardown(app.close)
  const { status } = app.lifecycle
  process.once('uncaughtException', (err) => {
    t.equal(err.message, 'Bad setup')
    t.equal(status(), 'failed')
    t.end()
  })
})

test('lifecycle dependOn()', (t) => {
  const calls = []
  const create = stack()
    .use(withLifecycle({
      name: 'plugin-a',
      init (app) {
        const { ready, dependOn } = app.lifecycle
        const dependency = createReadyable()
        dependOn(ready, dependency)
        setTimeout(() => {
          calls.push('dependency-run')
          dependency.go()
        }, 10)
        return {}
      }
    }))
  const app = create()
  t.teardown(app.close)
  const { run } = app.lifecycle
  t.deepEqual(calls, [])
  run(app.lifecycle.ready, (err) => {
    t.error(err)
    t.deepEqual(calls, ['dependency-run'])
    t.end()
  })
})

test('lifecycle fn(), success', (t) => {
  const create = stack()
    .use(withLifecycle({
      name: 'plugin-a',
      init (app) {
        const { fn, during, ready, handle } = app.lifecycle
        const addReady = during(ready)
        let baseline = NaN
        handle(addReady, (cb) => {
          setTimeout(() => {
            baseline = 10
            cb()
          }, 10)
        })
        return {
          add: fn(addReady, (a, b) => {
            return baseline + a + b
          })
        }
      }
    }))
  const app = create()
  t.teardown(app.close)
  const { run } = app.lifecycle
  t.throws(() => app.pluginA.add(1, 2), {
    name: 'NotReadyError',
    code: 'ENOTREADY'
  })
  run(app.pluginA.addReady, (err) => {
    t.error(err)
    t.equal(app.pluginA.add(1, 2), 13)
    t.end()
  })
})

test('lifecycle fn(), error', (t) => {
  const create = stack()
    .use(withLifecycle({
      name: 'plugin-a',
      init (app) {
        const { fn, during, ready, handle } = app.lifecycle
        const addReady = during(ready)
        handle(addReady, (cb) => {
          setTimeout(() => {
            cb(new Error())
          }, 10)
        })
        return {
          add: fn(addReady, (a, b) => {
            return a + b
          })
        }
      }
    }))
  const app = create()
  t.teardown(app.close)
  const { run } = app.lifecycle
  t.throws(() => app.pluginA.add(1, 2), {
    name: 'NotReadyError',
    code: 'ENOTREADY'
  })
  run(app.pluginA.addReady, (err) => {
    t.ok(err)
    t.throws(() => app.pluginA.add(1, 2), {
      name: 'NotReadyError',
      code: 'ENOTREADY'
    })
    t.end()
  })
})

test('lifecycle fn(), multiple', (t) => {
  const create = stack()
    .use(withLifecycle({
      name: 'plugin-a',
      init (app) {
        const { fn, during, ready, handle } = app.lifecycle
        const addReady1 = during(ready)
        const addReady2 = during(ready)
        let baseline1 = NaN
        let baseline2 = NaN
        handle(addReady1, (cb) => {
          setTimeout(() => {
            baseline1 = 10
            cb()
          }, 10)
        })
        handle(addReady2, (cb) => {
          setTimeout(() => {
            baseline2 = 15
            cb()
          }, 10)
        })
        return {
          add: fn([addReady1, addReady2], (a, b) => {
            return baseline1 + baseline2 + a + b
          })
        }
      }
    }))
  const app = create()
  t.teardown(app.close)
  const { run } = app.lifecycle
  t.throws(() => app.pluginA.add(1, 2), {
    name: 'NotReadyError',
    code: 'ENOTREADY'
  })
  run(app.pluginA.addReady, (err) => {
    t.error(err)
    t.equal(app.pluginA.add(1, 2), 28)
    t.end()
  })
})

test('lifecycle asyncFn(), success', (t) => {
  t.plan(5)
  const create = stack()
    .use(withLifecycle({
      name: 'plugin-a',
      init (app) {
        const { asyncFn, during, ready, handle } = app.lifecycle
        const addReady = during(ready)
        let baseline = NaN
        handle(addReady, (cb) => {
          setTimeout(() => {
            baseline = 10
            cb()
          }, 10)
        })
        return {
          add: asyncFn(addReady, (a, b, cb) => {
            return process.nextTick(() => cb(null, baseline + a + b))
          })
        }
      }
    }))
  const app = create()
  t.teardown(app.close)
  const { run } = app.lifecycle
  app.pluginA.add(1, 2, (err, result) => {
    t.error(err)
    t.equal(result, 13)
  })
  run(app.pluginA.addReady, (err) => {
    t.error(err)
    app.pluginA.add(1, 2, (err, result) => {
      t.error(err)
      t.equal(result, 13)
      t.end()
    })
  })
})

test('lifecycle asyncFn(), error', (t) => {
  t.plan(5)
  const create = stack()
    .use(withLifecycle({
      name: 'plugin-a',
      init (app) {
        const { asyncFn, during, ready, handle } = app.lifecycle
        const addReady = during(ready)
        handle(addReady, (cb) => {
          setTimeout(() => {
            cb(new Error())
          }, 10)
        })
        return {
          add: asyncFn(addReady, (a, b, cb) => {
            return process.nextTick(() => cb(null, a + b))
          })
        }
      }
    }))
  const app = create()
  t.teardown(app.close)
  const { run } = app.lifecycle
  app.pluginA.add(1, 2, (err, result) => {
    t.ok(err)
    t.equal(result, undefined)
  })
  run(app.pluginA.addReady, (err) => {
    t.ok(err)
    app.pluginA.add(1, 2, (err, result) => {
      t.ok(err)
      t.equal(result, undefined)
      t.end()
    })
  })
})

test('lifecycle asyncFn(), multiple', (t) => {
  const create = stack()
    .use(withLifecycle({
      name: 'plugin-a',
      init (app) {
        const { asyncFn, during, ready, handle } = app.lifecycle
        const addReady1 = during(ready)
        const addReady2 = during(ready)
        let baseline1 = NaN
        let baseline2 = NaN
        handle(addReady1, (cb) => {
          setTimeout(() => {
            baseline1 = 10
            cb()
          }, 10)
        })
        handle(addReady2, (cb) => {
          setTimeout(() => {
            baseline2 = 15
            cb()
          }, 10)
        })
        return {
          add: asyncFn([addReady1, addReady2], (a, b, cb) => {
            return process.nextTick(() => cb(null, baseline1 + baseline2 + a + b))
          })
        }
      }
    }))
  const app = create()
  t.teardown(app.close)
  const { run } = app.lifecycle
  app.pluginA.add(1, 2, (err, result) => {
    t.error(err)
    t.equal(result, 28)
  })
  run(app.pluginA.addReady, (err) => {
    t.error(err)
    app.pluginA.add(1, 2, (err, result) => {
      t.error(err)
      t.equal(result, 28)
      t.end()
    })
  })
})

test('lifecycle() maintains referential integrity across calls', (t) => {
  const app = stack()()
  t.teardown(app.close)
  t.equal(lifecycle(app), lifecycle(app))
  t.end()
})

test('close hook preserves both arguments', (t) => {
  const app = stack()()
  lifecycle(app)
  app.close(new Error(), (err) => {
    t.error(err)
    t.end()
  })
})

test('failure during closing', (t) => {
  const create = stack()
    .use(withLifecycle({
      name: 'plugin-a',
      init (app) {
        const { handle, closing } = app.lifecycle
        handle(closing, (cb) => {
          setTimeout(() => {
            cb(new Error())
          }, 10)
        })
        return {}
      }
    }))
  const app = create()
  const { run, status } = app.lifecycle
  run(app.lifecycle.ready, (err) => {
    t.error(err)
    app.close()
    run(app.lifecycle.closed, (err) => {
      t.ok(err)
      t.equal(status(), 'failed')
      t.end()
    })
  })
})

function stack (opts) {
  return SecretStack({ appKey: hash('secret-stack-lifecycle-testing'), ...opts })
}

function hash (s) {
  return crypto.createHash('sha256').update(s).digest()
}
