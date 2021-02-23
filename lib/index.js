'use strict'

const assert = require('assert')
const pull = require('pull-stream')
const defer = require('pull-defer')
const many = require('pull-many')
const cache = require('pull-cache')

const lifecycles = new WeakMap()

exports = module.exports = (obj) => {
  if (!lifecycles.has(obj)) {
    lifecycles.set(obj, createLifecycle(obj))
  }
  return lifecycles.get(obj)
}

function createLifecycle (obj) {
  const state = {
    status: 'uninitialized',
    startups: [],
    readyables: []
  }

  const readies = many();
  const ready = cacheResult(readies);

  setImmediate(() => {
    state.status = 'initializing'
    try {
      state.startups.forEach((fn) => fn())
      state.readyables.forEach((readyable) => {
        readyable.run()
        readies.add(readyable)
      })
      state.status = 'initialized'
      readies.cap();
    } catch (err) {
      state.status = 'failed'
      readies.add(pull.error(err))
      readies.cap()
      throw err
    }
  })

  const all = (streams) => many([].concat(streams))

  run(ready, (err) => {
    state.status = err ? 'failed' : 'started'
  });

  const lifecycle = {
    status: () => state.status,
    ready,
    start: (cb) => {
      assert(state.status === 'uninitialized')
      state.startups.push(cb)
    },
    readyable: () => {
      assert(state.status === 'uninitialized')

      const dependencies = []

      const deferred = defer.source()
      const readyable = cacheResult(deferred)
      state.readyables.push(readyable)

      let ran = false
      let ready = false

      return Object.assign(readyable, {
        get: () => ready,
        run: () => {
          assert(!ran)
          assert(dependencies.length)

          ran = true;
          run(readyable, (err) => {
            ready = err ? null : true
          })

          deferred.resolve(all(dependencies))
        },
        dependOn: (deps) => {
          assert(state.status === 'initializing')
          dependencies.push(...([].concat(deps)))
          return readyable
        }
      })
    },
    cb: (readyable) => {
      const cbStream = defer.source()
      readyable.dependOn(cbStream)
      return (err) => {
        cbStream.resolve(err ? pull.error(err) : pull.empty())
      }
    },
    wait: (befores, readyable = lifecycle.readyable()) => {
      return readyable.dependOn(befores)
    },
    run: (deps, cb) => {
      return run(all(deps), cb)
    },
    sync: (deps, fn) => {
      const depsStream = all(deps)

      let ready = false
      run(depsStream, (err) => {
        ready = err ? null : true
      })

      const wrapped = (...args) => {
        if (!ready) {
          throw new Error('Function is not ready')
        }
        return fn(...args)
      }

      return Object.assign(wrapped, {
        ready: depsStream
      })
    },
    async: (deps, fn) => {
      const depsStream = all(deps)

      let ready = false
      run(depsStream, (err) => {
        ready = err ? null : true
      })

      const wrapped = (...args) => {
        if (!ready) {
          const cb = args.pop()
          run(depsStream, (err) => {
            if (err) {
              return cb(err)
            }
            fn(...args, cb)
          })
          return
        }
        return fn(...args)
      }

      return Object.assign(wrapped, {
        ready: depsStream
      })
    }
  }

  return lifecycle
}

const forget = pull.filter(() => false);

function cacheResult (stream) {
  return pull(stream, forget, cache)()
}

function run (stream, cb) {
  return pull(stream, pull.onEnd(cb));
}
