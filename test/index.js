'use strict'

const crypto = require('crypto')
const SecretStack = require('secret-stack')
const { lifecycle, withLifecycle } = require('..');

(() => {
  const hash = (s) => crypto.createHash('sha256').update(s).digest()

  const pluginA = withLifecycle({
    name: 'plugin-a',
    init (app) {
      const { setup, during, handle, ...lc } = app.lifecycle
      const ready = during(lc.ready)

      handle(ready, (cb) => {
        setTimeout(cb, 1000)
      })

      return { ready }
    }
  })

  const pluginB = withLifecycle({
    name: 'plugin-b',
    init (app) {
      const { during, ready, setup, dependOn, fn } = app.lifecycle
      const someFuncReady = during(ready)

      setup(() => {
        dependOn(someFuncReady, app.pluginA.ready)
      })

      return {
        ready: someFuncReady,
        someFunc: fn(someFuncReady, () => 10)
      }
    }
  })

  const pluginC = withLifecycle({
    name: 'plugin-c',
    init (app) {
      const { setup, during, handle, asyncFn, dependOn, ...lc } = app.lifecycle
      const someOtherFuncReady = during(lc.ready)

      setup(() => {
        dependOn(someOtherFuncReady, app.pluginB.someFuncReady)
      })

      const closing = during(lc.closing)
      const closed = during(lc.closed)

      setup(() => {
        handle(closing, (cb) => {
          setTimeout(() => console.log('closingCb') || cb(), 400)
        })
        handle(closed, (cb) => {
          setTimeout(() => console.log('closedCb') || cb(), 800)
        })
      })

      return {
        someOtherFunc: asyncFn(someOtherFuncReady, (cb) => cb(null, app.pluginB.someFunc()))
      }
    }
  })

  const pluginD = withLifecycle({
    name: 'plugin-d',
    init (app) {
      const { setup, during, handle, dependOn, ...lc } = app.lifecycle

      setup(() => {
        handle(lc.closing, (cb) => {
          setTimeout(() => {
            console.log('closing plugin d')
            cb()
          }, 3000)
        })
        handle(lc.closed, (cb) => {
          console.log('closed plugin d')
          cb()
        })
      })

      return {}
    }
  })

  const create = SecretStack({ appKey: hash('secret-stack-lifecycle-testing') })
    .use(pluginA)
    .use(pluginB)
    .use(pluginC)
    .use(pluginD)

  const app = create()
  const { run, ready, closed } = lifecycle(app)

  run(ready, () => {
    console.log('ready')
    app.close((err) => console.log('vanilla close', err))
  })

  run(closed, (err) => {
    console.log('full close', err)
    setTimeout(() => {
      run(closed, (err) => console.log('full close', err))
    }, 200)
  })

  // app.pluginC.someOtherFunc(console.log)
  // app.pluginC.someOtherFunc(console.log)
  // app.pluginC.someOtherFunc(console.log)
  // app.pluginC.someOtherFunc(console.log)
  // setTimeout(() => app.pluginC.someOtherFunc(console.log), 500)
  // setTimeout(() => app.pluginC.someOtherFunc(console.log), 1500)
  // run(listening, () => console.log('listening'));
  // run(app.pluginA.ready, console.log)
  // run(app.pluginA.ready, console.log)
  app.pluginC.someOtherFunc(console.log)
  run(app.pluginC.someOtherFuncReady, () => app.pluginC.someOtherFunc(console.log))
  //   app.pluginC.someOtherFunc(() => {
  //     console.log(null)
  //     app.pluginC.someOtherFunc(console.log)
  //   })
  //   run(ready, console.log)
})()
