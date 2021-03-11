# secret-stack-lifecycle
provides a lifecycle to [secret-stack](https://github.com/ssb-js/secret-stack) using [readyables](https://github.com/devinivy/pull-readyable)

[![Build Status](https://travis-ci.com/devinivy/secret-stack-lifecycle.svg?branch=main)](https://travis-ci.com/devinivy/secret-stack-lifecycle) [![Coverage Status](https://coveralls.io/repos/devinivy/secret-stack-lifecycle/badge.svg?branch=main&service=github)](https://coveralls.io/github/devinivy/secret-stack-lifecycle?branch=main)

## Installation
```sh
npm install secret-stack-lifecycle
```

## Usage
While [secret-stack](https://github.com/ssb-js/secret-stack) does provide a way to create and close an application, it doesn't provide a lifecycle for plugins to organize around.  It has become convention for plugins to use `setImmediate()` to wait for other plugins to be defined, for example when one plugin relies on the functionality of another during startup; it's also typical to use `app.close.hook()` to perform teardown tasks.  The result is that the plugin registration ordering takes on a major significance, and each plugin re-invents tracking state around setup and teardown.

The purpose of secret-stack-lifecycle is to provide an application lifecycle and a means for plugins to flexibly organize around each other.  It manages all the state that comes along with that, and deemphasizes the importance of plugin registration order.

The lifecycle consists of `listening`, `ready`, `closing`, and `close`.  These always occur in order, barring errors that may occur along the way, which stops the lifecycle.  Each lifecycle step takes the form of a [readyable](https://github.com/devinivy/pull-readyable), which allows it to be extended and branched off into plugin-defined lifecycle steps that may happen during any point in the application's lifeycle.  Plugins can become very granular with this— for example, a specific function provided by a plugin may have its own setup and teardown, and other plugins can become aware of this and organize around it.  One upside is that it becomes safe to use a function provided by a plugin before the entire application is ready.  Asynchronous functions provided by plugins can even be called before they are ready, and they will wait to become ready before running.

There's more than that, though!  Please check out the example and API documentation below to get started.  The library itself is also relatively short, and the tests are comprehensive in showing many different situations and usages.

### Example
```js
'use strict'

const SecretStack = require('secret-stack')
const { withLifecycle } = require('secret-stack-lifecycle')

const mathPlugin = withLifecycle({
  name: 'math',
  init (app) {
    const { during, ready, handle, fn } = app.lifecycle
    const addReady = during(ready)

    let baseline = NaN
    handle(addReady, (cb) => {
      setTimeout(() => {
        baseline = 143 // An arbitrary number for example purposes
        cb()
      }, 300)
    })

    return {
      // Other plugins can use the `app.math.addReady` readyable
      // to check if this function is ready to be used, and a
      // means to wait until it is ready.
      add: fn(addReady, (x) => {
        return baseline + x
      })
    }
  }
})

const create = SecretStack().use(mathPlugin)
const app = create()

const { run } = app.lifecycle

try {
  app.math.add(1) // This would throw here, as the function is not ready yet
} catch {}

run(app.lifecycle.ready, (err) => {
  if (err) throw err
  // app.math.add() is guaranteed to be ready here
  const result = app.math.add(1) // 143 + 1 = 144
})
```

## API

### `lifecycle(app)`
Given a secret-stack appliction `app`, this returns a [lifecycle object](#applifecycle).  This may be called on the same `app` many times, and you'll always receive the exact same lifecycle object.  Note that this does not decorate `app.lifecycle` onto `app`, although `withLifecycle()` does.

### `withLifecycle(plugin)`
Given a secret-stack `plugin`, this ensures that the plugin's `init(app, options)` is always passed an application with the `app.lifecycle` lifecycle object defined.  Additionally, this ensures that each function provided by the plugin that has been wrapped using [`fn()`](#fnreadyable-func) or [`asyncFn()`](#asyncfnreadyable-func) has a corresponding readyable (name suffixed with -`Ready`) for other plugins to interoperate with.  For example:
```js
const mathPlugin = withLifecycle({
  name: 'math',
  init (app) {
    const { fn, listening } = app.lifecycle
    return {
      // Other plugins can use the `app.math.addReady` readyable
      // to check if this function is ready to be used, and a
      // means to wait until it is ready.
      add: fn(listening, (a, b) => {
        // This function will throw if called before the app is listening.
        return a + b
      })
    }
  }
})
```

### `app.lifecycle`
A lifecycle object for a secret-stack application `app` provided using `withLifecycle(plugin)` or `lifecycle(app)`.  This object contains the following:

#### `listening`
A [readyable](https://github.com/devinivy/pull-readyable#createreadyable) that begins before [setup](#setupcb) and relies on `app`'s `'multiserver:listening'` event to fire to complete.

#### `ready`
A [readyable](https://github.com/devinivy/pull-readyable#createreadyable) that begins after [setup](#setupcb) and depends on `listening` to complete.

#### `closing`
A [readyable](https://github.com/devinivy/pull-readyable#createreadyable) that begins once `app.close()` is called and depends on `app.close()` to finish to complete.

#### `closed`
A [readyable](https://github.com/devinivy/pull-readyable#createreadyable) that begins once `app.close()` is finished and depends on `closing` to complete.

#### `run(readyable, cb)`
Runs the `readyable` until it ends, then calls `cb`.  You may also pass a stream or array of streams for `readyable`, and they will be rolled into a single readyable which waits for all of them to complete.

#### `status()`
Returns one of several values indicating the status of the app's lifecycle:
 - `'uninitialized'` - before setup, i.e. during plugin registration.
 - `'initializing'` - during setup.
 - `'initialized'` - setup has completed.
 - `'ready'` - the `ready` lifecycle step has completed and the application is actively listening.
 - `'closing'` - `app.close()` was called and is in progress.
 - `'closed'` - `app.close()` and the `closed` lifecycle step have completed.
 - `'failed'` - an error occurred at any point during the processing of the application lifecycle.

#### `setup(cb)`
This may be called during plugin registration to schedule `cb()` to run during app initialization.  Initialization of all plugins will occur synchronized with each other using a single `setImmediate()`.  During this time the implementation of `cb` may reference functions, etc. provided by other plugins registered to `app`.  It is also safe to call [`dependOn()`](#dependonreadyable-stream) during setup, so you can reference readyables exposed by other plugins.

#### `fn(readyable, func)`
Returns a new function wrapping `func` that will throw if it is called before `readyable` is ready.  You may also pass a stream or array of streams for `readyable`, and they will be rolled into a single readyable which waits for all of them to complete.

#### `asyncFn(readyable, func)`
Returns a new function wrapping callback-receiving `func` that will wait for `readyable` to become ready before continuing processing.  You may also pass a stream or array of streams for `readyable`, and they will be rolled into a single readyable which waits for all of them to complete.

#### `during(readyable, [{ dependOn }])`
Returns a new readyable that is automatically run when `readyable` begins. When `dependOn` is `true`, which is the default, this new readyable is also marked as a dependency of `readyable`.  See also the [pull-readyable docs](https://github.com/devinivy/pull-readyable#readyableduring-dependon-).

#### `dependOn(readyable, stream)`
Sets `stream` as a dependency of `readyable` (i.e. a lifecycle step such as [`ready`](#ready)): it will not run its handlers or complete until `stream` ends.  You may also pass an array of streams and they will be combined.  Returns `readyable`.  See also the [pull-readyable docs](https://github.com/devinivy/pull-readyable#readyabledependonstream).

#### `handle(readyable, cb)`
Sets callback `cb` as a handler of `readyable` (i.e. a lifecycle step such as [`ready`](#ready)): it will not complete until `cb` is called.  The `cb` callback may be called with an error, which will be propagated to `readyable`.  Returns `readyable`.  See also the [pull-readyable docs](https://github.com/devinivy/pull-readyable#readyablehandlecb).
