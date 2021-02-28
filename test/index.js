'use strict'

const crypto = require('crypto')
const SecretStack = require('secret-stack')
const Lifecycle = require('..');

(() => {
  const hash = (s) => crypto.createHash('sha256').update(s).digest()

  const pluginA = {
    name: 'plugin-a',
    init (app) {
      const { setup, readyable, cb } = Lifecycle(app)
      const ready = readyable()

      setup(() => {
        const readyCb = cb(ready)
        setTimeout(readyCb, 1000)
      })

      return { ready }
    }
  }

  const pluginB = {
    name: 'plugin-b',
    init (app) {
      const { readyable, setup, dependOn, fn } = Lifecycle(app)
      const someFuncReady = readyable()

      setup(() => {
        dependOn(someFuncReady, app.pluginA.ready)
      })

      return {
        ready: someFuncReady,
        someFunc: fn(someFuncReady, () => 10)
      }
    }
  }

  const pluginC = {
    name: 'plugin-c',
    init (app) {
      const { setup, teardown, readyable, unreadyable, asyncFn, dependOn, cb, ...lc } = Lifecycle(app)
      const someOtherFuncReady = readyable()

      setup(() => {
        dependOn(someOtherFuncReady, app.pluginB.someFunc.ready)
      })

      const closing = unreadyable()
      // const closed = unreadyable()

      teardown(() => {
        const closingCb = cb(closing)
        // const closedCb = cb(closed)
        dependOn(lc.close, closing)

        // dependOn(closing, lc.close)
        setTimeout(() => console.log('closingCb') || closingCb(), 400)
        // setTimeout(() => console.log('closedCb') || closedCb(), 800)
      })

      return {
        someOtherFunc: asyncFn(someOtherFuncReady, (cb) => cb(null, app.pluginB.someFunc()))
      }
    }
  }

  const pluginD = {
    name: 'plugin-d',
    init (app) {
      const { teardown, unreadyable, close, cb, dependOn } = Lifecycle(app)

      const closing = unreadyable()

      teardown(() => {
        const closingCb = cb(closing)
        dependOn(close, closing)
        setTimeout(closingCb, 2000)
      })

      return {}
    }
  }

  const create = SecretStack({ appKey: hash('secret-stack-lifecycle-testing') })
    .use(pluginA)
    .use(pluginB)
    .use(pluginC)
    .use(pluginD)

  const app = create()
  const { run, ready, close } = Lifecycle(app)

  run(ready, () => {
    console.log('ready')
    app.close((err) => console.log('vanilla close', err))
  })

  run(close, (err) => console.log('full close', err))

  // app.pluginC.someOtherFunc(console.log)
  // app.pluginC.someOtherFunc(console.log)
  // app.pluginC.someOtherFunc(console.log)
  // app.pluginC.someOtherFunc(console.log)
  // setTimeout(() => app.pluginC.someOtherFunc(console.log), 500)
  // setTimeout(() => app.pluginC.someOtherFunc(console.log), 1500)
  // run(listening, () => console.log('listening'));
  // run(app.pluginA.ready, console.log);
  // run(app.pluginA.ready, console.log);
  // run(app.pluginC.someOtherFunc.ready, () => app.pluginC.someOtherFunc(console.log));
  //   app.pluginC.someOtherFunc(() => {
  //     console.log(null)
  //     app.pluginC.someOtherFunc(console.log)
  //   })
  //   run(ready, console.log)
})()
