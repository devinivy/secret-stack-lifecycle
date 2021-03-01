'use strict'

const assert = require('assert')
const { createReadyable, run, cacheResult, all, cb } = require('./readyable')

const lifecycles = new WeakMap()

exports = module.exports = (app) => {
  if (!lifecycles.has(app)) {
    lifecycles.set(app, createLifecycle(app))
  }
  return lifecycles.get(app)
}

function createLifecycle (app) {
  const state = {
    status: 'uninitialized',
    setups: []
  }

  const listening = createReadyable()
  const ready = createReadyable().dependOn(listening)
  app.once('multiserver:listening', cb(listening))

  setImmediate(() => {
    state.status = 'initializing'
    try {
      listening.run()
      state.setups.forEach((fn) => fn())
      ready.run()
      state.status = 'initialized'
    } catch (err) {
      state.status = 'failed'
      throw err
    }
    run(ready, (err) => {
      state.status = err ? 'failed' : 'ready'
    })
  })

  const closing = createReadyable()
  const closed = createReadyable().dependOn(closing)

  app.close.hook((fn, [err, cb]) => {
    if (!cb) {
      cb = err
      err = null
    }
    state.status = 'closing'
    closing.handle((closedCb) => {
      fn(err, (error) => {
        cb(error)
        closedCb(error)
      })
    }).run()
    run(closing, closed.run)
    run(closed, (err) => {
      state.status = err ? 'failed' : 'closed'
    })
  })

  const lifecycle = {
    listening,
    ready,
    closing,
    closed,
    status () {
      return state.status
    },
    setup (cb) {
      assert(state.status === 'uninitialized')
      state.setups.push(cb)
    },
    during (point, opts) {
      return point.during(opts)
    },
    dependOn (readyable, befores) {
      return readyable.dependOn(befores)
    },
    handle (readyable, handler) {
      return readyable.handle(handler)
    },
    run (deps, cb) {
      return run(all(deps), cb)
    },
    fn (deps, fn) {
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
    asyncFn (deps, fn) { // TODO make deps optional?
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
