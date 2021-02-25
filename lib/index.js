'use strict'

const assert = require('assert')
const pull = require('pull-stream')
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
    setups: [],
    readyables: []
  }

  setImmediate(() => {
    state.status = 'initializing'
    try {
      state.setups.forEach((fn) => fn())
      state.readyables.forEach((readyable) => {
        readyable.run()
      })
      state.status = 'initialized'
    } catch (err) {
      state.status = 'failed'
      throw err
    }
  })

  const lifecycle = {
    status() {
      return state.status
    },
    setup(cb) {
      assert(state.status === 'uninitialized')
      state.setups.push(cb)
    },
    readyable() {
      const readyable = createReadyable();
      state.readyables.push(readyable)
      return readyable;
    },
    cb(readyable) {
      const cbStream = defer()
      readyable.dependOn(cbStream)
      return (err) => {
        cbStream.resolve(err ? pull.error(err) : pull.empty())
      }
    },
    dependOn(readyable, befores) {
      return readyable.dependOn(befores)
    },
    run(deps, cb) {
      return run(all(deps), cb)
    },
    fn(deps, fn) {
      const depsStream = cacheResult(all(deps))

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
    asyncFn(deps, fn) {
      const depsStream = cacheResult(all(deps))

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


function createReadyable() {
  const dependencies = []

  let ran = false
  let ready = false

  const deferredDeps = defer()
  const deferredProcess = defer()

  const readyable = cacheResult(
    pull(
      pull.values([
        deferredDeps,     // Resolve dependencies
        deferredProcess   // Kick off process routine
      ]),
      pull.flatten(),     // Run above streams in sequence
      pull.through(null, (err) => {
        ready = err ? null : true;
      })
    )
  )

  return Object.assign(readyable, {
    get: () => ready,
    run: (process) => {
      assert(!ran)
      ran = true

      deferredDeps.resolve(all(dependencies))
      deferredProcess.resolve(process ? wait(process) : pull.empty())

      pull(readyable, pull.drain()) // Make it flow
      return readyable
    },
    dependOn: (deps) => {
      assert(!ran)
      dependencies.push(...([].concat(deps)))
      return readyable
    }
  })
}

const forget = pull.filter(() => false)

function cacheResult (stream) {
  return pull(stream, forget, cache)()
}

function run (stream, cb) {
  return pull(stream, pull.onEnd(cb))
}

function all (streams) {
  return many([].concat(streams))
}

function wait(process) {
  return pull(pull.once('signal'), pull.asyncMap((_, cb) => process(cb)))
}

function defer () {
  const deferred = many()
  return Object.assign(deferred, {
    resolve (stream) {
      deferred.add(stream)
      deferred.cap()
    }
  })
}
