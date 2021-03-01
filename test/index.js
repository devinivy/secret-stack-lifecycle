'use strict'

const crypto = require('crypto')
const SecretStack = require('secret-stack')
const Lifecycle = require('..');

(() => {
  const hash = (s) => crypto.createHash('sha256').update(s).digest()

  const pluginA = {
    name: 'plugin-a',
    init (app) {
      const { setup, during, handle, ...lc } = Lifecycle(app)
      const ready = during(lc.ready)

      setup(() => {
        handle(ready, (cb) => {
          setTimeout(cb, 1000)
        })
      })

      return { ready }
    }
  }

  const pluginB = {
    name: 'plugin-b',
    init (app) {
      const { during, ready, setup, dependOn, fn } = Lifecycle(app)
      const someFuncReady = during(ready)

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
      const { setup, during, handle, asyncFn, dependOn, ...lc } = Lifecycle(app)
      const someOtherFuncReady = during(lc.ready)

      setup(() => {
        dependOn(someOtherFuncReady, app.pluginB.someFunc.ready)
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
  }

  const pluginD = {
    name: 'plugin-d',
    init (app) {
      const { setup, during, handle, dependOn, ...lc } = Lifecycle(app)

      const closing = during(lc.closing)

      setup(() => {
        handle(closing, (cb) => {
          setTimeout(cb, 2000)
        })
      })

      return {}
    }
  }

  const pluginE = {
    name: 'plugin-e',
    init (app) {
      const { during, ...lc } = Lifecycle(app)

      const someFuncReady = during(lc.ready)
      const someFuncClosed = during(lc.closed)

      const database = db();

      setup(() => {
        handle(someFuncReady, database.setup)
        handle(someFuncClosed, database.end)
      })

      return {
        ready: someFuncReady,
        someFunc: fn(someFuncReady, () => 10)
      }
    }
  }

  const create = SecretStack({ appKey: hash('secret-stack-lifecycle-testing') })
    .use(pluginA)
    .use(pluginB)
    .use(pluginC)
    .use(pluginD)

  const app = create()
  const { run, ready, closed } = Lifecycle(app)

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
  // run(app.pluginA.ready, console.log);
  // run(app.pluginA.ready, console.log);
  // run(app.pluginC.someOtherFunc.ready, () => app.pluginC.someOtherFunc(console.log));
  //   app.pluginC.someOtherFunc(() => {
  //     console.log(null)
  //     app.pluginC.someOtherFunc(console.log)
  //   })
  //   run(ready, console.log)
})()
