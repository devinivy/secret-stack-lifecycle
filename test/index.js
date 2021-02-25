'use strict'

const crypto = require('crypto')
const SecretStack = require('secret-stack')
const Lifecycle = require('..');

(() => {
  const hash = (s) => crypto.createHash('sha256').update(s).digest()

  const pluginA = {
    name: 'plugin-a',
    init (api) {
      const { setup, readyable, cb } = Lifecycle(api)
      const ready = readyable()

      setup(() => {
        const readyCb = cb(ready)
        setTimeout(() => readyCb(), 1000)
      })

      return { ready }
    }
  }

  const pluginB = {
    name: 'plugin-b',
    init (api) {
      const { readyable, setup, dependOn, fn } = Lifecycle(api)
      const someFuncReady = readyable()

      setup(() => {
        dependOn(someFuncReady, api.pluginA.ready)
      })

      return {
        ready: someFuncReady,
        someFunc: fn(someFuncReady, () => 10)
      }
    }
  }

  const pluginC = {
    name: 'plugin-c',
    init (api) {
      const { setup, readyable, asyncFn, dependOn } = Lifecycle(api)
      const someOtherFuncReady = readyable()

      setup(() => {
        dependOn(someOtherFuncReady, api.pluginB.someFunc.ready)
      })

      return {
        someOtherFunc: asyncFn(someOtherFuncReady, (cb) => cb(null, api.pluginB.someFunc()))
      }
    }
  }

  const create = SecretStack({ appKey: hash('secret-stack-lifecycle-testing') })
    .use(pluginA)
    .use(pluginB)
    .use(pluginC)

  const app = create()

  app.pluginC.someOtherFunc(console.log)
  app.pluginC.someOtherFunc(console.log)
  app.pluginC.someOtherFunc(console.log)
  app.pluginC.someOtherFunc(console.log)
  setTimeout(() => app.pluginC.someOtherFunc(console.log), 500)
  setTimeout(() => app.pluginC.someOtherFunc(console.log), 1500)

  // const { run, ready } = Lifecycle(app)
  // run(app.pluginA.ready, console.log);
  // run(app.pluginA.ready, console.log);
  // run(app.pluginC.someOtherFunc.ready, () => app.pluginC.someOtherFunc(console.log));
  //   app.pluginC.someOtherFunc(() => {
  //     console.log(null)
  //     app.pluginC.someOtherFunc(console.log)
  //   })
  //   run(ready, console.log)
})()
