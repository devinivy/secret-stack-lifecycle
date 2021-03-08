'use strict'

const assert = require('assert')
const { createReadyable, run, cacheResult, all, cb } = require('./readyable')

const lifecycles = new WeakMap()

exports.lifecycle = (app) => {
  if (!lifecycles.has(app)) {
    lifecycles.set(app, createLifecycle(app))
  }
  return lifecycles.get(app)
}

exports.withLifecycle = ({ init, ...plugin }) => {
  return {
    ...plugin,
    init (app, opts) {
      app.lifecycle = app.lifecycle || exports.lifecycle(app)
      return packReadyFns(init.call(this, app, opts))
    }
  }
}

exports.NotReadyError = class NotReadyError extends Error {
  constructor (message) {
    super(message)
    this.name = 'NotReadyError'
    this.code = 'ENOTREADY'
  }
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
        if (cb) cb(error)
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
    during (readyable, opts) {
      return readyable.during(opts)
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

      function wrapped (...args) {
        if (!ready) {
          throw new exports.NotReadyError('Function is not ready')
        }
        return fn.call(this, ...args)
      }

      return Object.assign(wrapped, {
        ready: depsStream
      })
    },
    asyncFn (deps, fn) {
      const depsStream = cacheResult(all(deps))

      let ready = false
      run(depsStream, (err) => {
        ready = err ? null : true
      })

      function wrapped (...args) {
        if (!ready) {
          const cb = args.pop()
          return run(depsStream, (err) => {
            if (err) return cb(err)
            fn.call(this, ...args, cb)
          })
        }
        return fn.call(this, ...args)
      }

      return Object.assign(wrapped, {
        ready: depsStream
      })
    }
  }

  return lifecycle
}

function packReadyFns (obj) {
  if (!obj || typeof obj !== 'object') {
    return obj
  }
  Object.entries(obj).forEach(([key, value]) => {
    if (typeof value === 'function' && typeof value.ready === 'function' && !(`${key}Ready` in obj)) {
      obj[`${key}Ready`] = value.ready
    }
    packReadyFns(value)
  })
  return obj
}
