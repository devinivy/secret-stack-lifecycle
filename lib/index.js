'use strict'

const assert = require('assert')
const pull = require('pull-stream')
const many = require('pull-many')
const cache = require('pull-cache')
const defer = require('pull-defer')

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
    closing.process((closedCb) => {
      fn(err, (error) => {
        cb(error)
        closedCb(error)
        closed.run()
      })
    }).run()
  })

  run(closed, (err) => {
    state.status = err ? 'failed' : 'closed'
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
    process (readyable, proc) {
      return readyable.process(proc)
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

function createReadyable () {
  const durings = []
  const dependencies = []
  const processes = []

  let ran = false
  let ready = false

  const deferredDependencies = defer.source()
  const deferredProcesses = defer.source()

  const readyable = cacheResult(
    pull(
      pull.values([
        deferredDependencies, // Resolve dependencies
        deferredProcesses // Kick off process routine
      ]),
      pull.flatten(), // Run above streams in sequence
      pull.through(null, (err) => {
        ready = err ? null : true
      })
    )
  )

  return Object.assign(readyable, {
    get () {
      return ready
    },
    run () {
      assert(!ran)
      ran = true

      durings.forEach((during) => during.run())
      deferredDependencies.resolve(all(dependencies))
      deferredProcesses.resolve(all(processes.map(wait)))

      pull(readyable, pull.drain()) // Make it flow
      return readyable
    },
    dependOn (deps) {
      assert(!ran)
      dependencies.push(...([].concat(deps)))
      return readyable
    },
    process (proc) {
      assert(!ran)
      processes.push(proc)
      return readyable
    },
    during ({ dependOn = true } = {}) {
      assert(!ran)
      const during = createReadyable()
      durings.push(during)
      if (dependOn) {
        readyable.dependOn(during);
      }
      return during
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

function wait (process) {
  return pull(
    pull.once('signal'),
    pull.asyncMap((_, cb) => process(cb))
  )
}

function cb (readyable) {
  const cbStream = defer.source()
  readyable.dependOn(cbStream)
  return (err) => {
    cbStream.resolve(err ? pull.error(err) : pull.empty())
  }
}
