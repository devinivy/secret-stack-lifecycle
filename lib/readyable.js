'use strict'

const assert = require('assert')
const pull = require('pull-stream')
const many = require('pull-many')
const cache = require('pull-cache')
const defer = require('pull-defer')

module.exports = {
  createReadyable,
  cacheResult,
  all,
  run,
  cb
}

function createReadyable () {
  const durings = []
  const dependencies = []
  const handlers = []

  let ran = false
  let ready = false

  const deferredDependencies = defer.source()
  const deferredHandlers = defer.source()

  const readyable = cacheResult(
    pull(
      pull.values([
        deferredDependencies, // Resolve dependencies
        deferredHandlers // Kick off handlers
      ]),
      pull.flatten(), // Run above streams in sequence
      pull.through(null, (err) => {
        ready = err ? null : true
      })
    )
  )

  return Object.assign(readyable, {
    isReady () {
      return ready
    },
    run () {
      assert(!ran)
      ran = true

      durings.forEach((during) => during.run())
      deferredDependencies.resolve(all(dependencies))
      deferredHandlers.resolve(all(handlers.reverse().map(wait)))

      pull(readyable, pull.onEnd(ignore)) // Make it flow
      return readyable
    },
    dependOn (deps) {
      assert(!ran)
      dependencies.push(...([].concat(deps)))
      return readyable
    },
    handle (handler) {
      assert(!ran)
      handlers.push(handler)
      return readyable
    },
    during ({ dependOn = true } = {}) {
      assert(!ran)
      const during = createReadyable()
      durings.push(during)
      if (dependOn) {
        readyable.dependOn(during)
      }
      return during
    }
  })
}

const forget = pull.filter(ignore)

function cacheResult (stream) {
  return pull(stream, forget, cache)()
}

function run (stream, cb) {
  return pull(stream, pull.onEnd(cb))
}

function all (streams) {
  return many([].concat(streams))
}

function wait (handler) {
  return pull(
    pull.once('signal'),
    pull.asyncMap((_, cb) => handler(cb))
  )
}

function cb (readyable) {
  const cbStream = defer.source()
  readyable.dependOn(cbStream)
  return (err) => {
    cbStream.resolve(err ? pull.error(err) : pull.empty())
  }
}

function ignore () {
  return null
}
