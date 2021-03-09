# secret-stack-lifecycle
provides a lifecycle to secret-stack using [readyables](https://github.com/devinivy/pull-readyable)

[![Build Status](https://travis-ci.com/devinivy/secret-stack-lifecycle.svg?branch=main)](https://travis-ci.com/devinivy/secret-stack-lifecycle) [![Coverage Status](https://coveralls.io/repos/devinivy/secret-stack-lifecycle/badge.svg?branch=main&service=github)](https://coveralls.io/github/devinivy/secret-stack-lifecycle?branch=main)

## Installation
```sh
npm install secret-stack-lifecycle
```

## Usage
### Example
```js
'use strict'

const SecretStack = require('secret-stack')
const { withLifecycle } = require('secret-stack-lifecycle')

const mathPlugin = withLifecycle({
  name: 'math',
  init (app) {
    const { fn, during, ready, handle } = app.lifecycle
    const addReady = during(ready)

    let baseline = NaN
    handle(addReady, (cb) => {
      setTimeout(() => {
        baseline = 10
        cb()
      }, 10)
    })

    return {
      add: fn(addReady, (a, b) => {
        return baseline + a + b
      })
    }
  }
})

const create = SecretStack().use(mathPlugin)
const app = create()

const { run } = app.lifecycle

try {
  app.math.add(1, 2) // This would throw here, as the function is not ready yet
} catch {}

run(app.lifecycle.ready, (err) => {
  if (err) throw err
  // app.math.add() is guaranteed to be ready here
  const result = app.math.add(1, 2) // 10 + 1 + 2 = 13
})
```
