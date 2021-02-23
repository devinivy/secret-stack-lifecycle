'use strict'

const crypto = require('crypto')
const SecretStack = require('secret-stack')
const Lifecycle = require('..');

(() => {
  const hash = (s) => crypto.createHash('sha256').update(s).digest()

  const pluginA = {
    name: 'plugin-a',
    init (api) {
      const { start, readyable, cb } = Lifecycle(api)
      const ready = readyable()

      start(() => {
        const readyCb = cb(ready)
        setTimeout(() => readyCb(), 1000)
      })

      return { ready }
    }
  }

  const pluginB = {
    name: 'plugin-b',
    init (api) {
      const { readyable, start, wait, sync } = Lifecycle(api)
      const someFuncReady = readyable()

      start(() => {
        wait(api.pluginA.ready, someFuncReady)

        // wait(someFuncReady, api.pluginA.ready);
      })

      return {
        ready: someFuncReady,
        someFunc: sync(someFuncReady, () => 10)
      }
    }
  }

  const pluginC = {
    name: 'plugin-c',
    init (api) {
      const { start, readyable, async, wait } = Lifecycle(api)
      const someOtherFuncReady = readyable()

      start(() => {
        wait(api.pluginB.someFunc.ready, someOtherFuncReady)
      })

      // run(someOtherFuncReady, console.log);

      return {
        someOtherFunc: async(someOtherFuncReady, (cb) => cb(null, api.pluginB.someFunc()))
      }
    }
  }

  const create = SecretStack({ appKey: hash('secret-stack-lifecycle-testing') })
    .use(pluginA)
    .use(pluginB)
    .use(pluginC)

  const app = create()
  const { run, ready } = Lifecycle(app)

  // run(app.pluginA.ready, console.log);
  // run(app.pluginA.ready, console.log);
  // run(app.pluginC.someOtherFunc.ready, () => app.pluginC.someOtherFunc(console.log));
  app.pluginC.someOtherFunc(console.log)

//   app.pluginC.someOtherFunc(() => {
//     console.log(null)
//     app.pluginC.someOtherFunc(console.log)
//   })

//   run(ready, console.log)
})()
