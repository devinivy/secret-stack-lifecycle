'use strict'

const test = require('tape')
const pull = require('pull-stream')
const { createReadyable, cb, run } = require('../lib/readyable')

test('readyable caches its result, series.', (t) => {
  t.plan(2)
  const readyable = createReadyable()
  readyable.handle((cb) => {
    setTimeout(cb, 10)
  }).run()
  pull(readyable, pull.onEnd((err) => {
    t.error(err)
    pull(readyable, pull.onEnd((err) => {
      t.error(err)
    }))
  }))
})

test('readyable caches its result, parallel.', (t) => {
  t.plan(2)
  const readyable = createReadyable()
  readyable.handle((cb) => {
    setTimeout(cb, 10)
  }).run()
  pull(readyable, pull.onEnd((err) => {
    t.error(err)
  }))
  pull(readyable, pull.onEnd((err) => {
    t.error(err)
  }))
})

test('readyable caches its result, delayed run.', (t) => {
  t.plan(2)
  const readyable = createReadyable()
  readyable.handle((cb) => {
    setTimeout(cb, 10)
  })
  pull(readyable, pull.onEnd((err) => {
    t.error(err)
  }))
  pull(readyable, pull.onEnd((err) => {
    t.error(err)
  }))
  setTimeout(readyable.run, 10)
})

test('readyable run() pulls readyables.', (t) => {
  t.plan(3)
  const readyable = createReadyable()
  readyable.handle((cb) => {
    setTimeout(cb, 10)
  }).run()
  run(readyable, (err) => {
    t.error(err)
    run(readyable, (err) => {
      t.error(err)
    })
  })
  run(readyable, (err) => {
    t.error(err)
  })
})

test('readyable processes handlers in parallel once run.', (t) => {
  const readyable = createReadyable()
  const handlers = []
  readyable.handle((cb) => {
    t.deepEquals(handlers, [])
    handlers.push('10-start')
    setTimeout(() => {
      t.deepEquals(handlers, ['10-start', '15-start', '20-start'])
      handlers.push('10-end')
      cb()
    }, 10)
  })
  readyable.handle((cb) => {
    t.deepEquals(handlers, ['10-start'])
    handlers.push('15-start')
    setTimeout(() => {
      t.deepEquals(handlers, ['10-start', '15-start', '20-start', '10-end'])
      handlers.push('15-end')
      cb()
    }, 15)
  })
  readyable.handle((cb) => {
    t.deepEquals(handlers, ['10-start', '15-start'])
    handlers.push('20-start')
    setTimeout(() => {
      t.deepEquals(handlers, ['10-start', '15-start', '20-start', '10-end', '15-end']) // 10, 15 must have been in parallel since 10 + 15 > 20
      handlers.push('20-end')
      cb()
    }, 20)
  })
  pull(readyable, pull.onEnd((err) => {
    t.error(err)
    t.deepEquals(handlers, ['10-start', '15-start', '20-start', '10-end', '15-end', '20-end'])
    t.end()
  }))
  setTimeout(() => {
    t.deepEquals(handlers, [])
    readyable.run()
    t.deepEquals(handlers, ['10-start', '15-start', '20-start'])
  }, 25)
})

test('readyable processes dependencies in parallel prior to handlers once run.', (t) => {
  const dependencyA = createReadyable()
  const dependencyB = createReadyable()
  const dependencyC = createReadyable()
  const readyable = createReadyable()
  const handlers = []
  dependencyA.handle((cb) => {
    handlers.push('dependencyA-start')
    setTimeout(() => {
      handlers.push('dependencyA-end')
      cb()
    }, 10)
  })
  dependencyB.handle((cb) => {
    handlers.push('dependencyB-start')
    setTimeout(() => {
      handlers.push('dependencyB-end')
      cb()
    }, 15)
  })
  dependencyC.handle((cb) => {
    handlers.push('dependencyC-start')
    setTimeout(() => {
      handlers.push('dependencyC-end')
      cb()
    }, 20)
  })
  readyable.handle((cb) => {
    handlers.push('readyable-start')
    setTimeout(() => {
      handlers.push('readyable-end')
      cb()
    }, 5)
  })
  pull(readyable, pull.onEnd((err) => {
    t.error(err)
    t.deepEquals(handlers, ['dependencyA-start', 'dependencyB-start', 'dependencyC-start', 'dependencyA-end', 'dependencyB-end', 'dependencyC-end', 'readyable-start', 'readyable-end'])
    t.end()
  }))
  readyable.dependOn([dependencyA, dependencyB])
  readyable.dependOn(dependencyC)
  t.deepEquals(handlers, [])
  dependencyA.run()
  dependencyB.run()
  dependencyC.run()
  readyable.run()
  t.deepEquals(handlers, ['dependencyA-start', 'dependencyB-start', 'dependencyC-start'])
})

test('readyable chaining dependencies.', (t) => {
  const dependencyA = createReadyable()
  const dependencyB = createReadyable()
  const readyable = createReadyable()
  const handlers = []
  dependencyA.handle((cb) => {
    handlers.push('dependencyA-start')
    setTimeout(() => {
      handlers.push('dependencyA-end')
      cb()
    }, 5)
  })
  dependencyB.handle((cb) => {
    handlers.push('dependencyB-start')
    setTimeout(() => {
      handlers.push('dependencyB-end')
      dependencyA.run()
      cb()
    }, 15)
  })
  readyable.handle((cb) => {
    handlers.push('readyable-start')
    setTimeout(() => {
      handlers.push('readyable-end')
      cb()
    }, 5)
  })
  pull(readyable, pull.onEnd((err) => {
    t.error(err)
    t.deepEquals(handlers, ['dependencyB-start', 'dependencyB-end', 'dependencyA-start', 'dependencyA-end', 'readyable-start', 'readyable-end'])
    t.end()
  }))
  readyable.dependOn([dependencyA, dependencyB])
  t.deepEquals(handlers, [])
  dependencyB.run()
  readyable.run()
  t.deepEquals(handlers, ['dependencyB-start'])
})

test('readyable during() with default dependOn.', (t) => {
  const readyable = createReadyable()
  const dependency = readyable.during()
  const handlers = []
  dependency.handle((cb) => {
    handlers.push('dependency-start')
    setTimeout(() => {
      handlers.push('dependency-end')
      cb()
    }, 15)
  })
  readyable.handle((cb) => {
    handlers.push('readyable-start')
    setTimeout(() => {
      handlers.push('readyable-end')
      cb()
    }, 5)
  })
  pull(readyable, pull.onEnd((err) => {
    t.error(err)
    t.deepEquals(handlers, ['dependency-start', 'dependency-end', 'readyable-start', 'readyable-end'])
    t.end()
  }))
  t.deepEquals(handlers, [])
  readyable.run()
  t.deepEquals(handlers, ['dependency-start'])
})

test('readyable during() with dependOn false.', (t) => {
  const readyableA = createReadyable()
  const readyableB = readyableA.during({ dependOn: false })
  const handlers = []
  readyableA.handle((cb) => {
    handlers.push('readyableA-start')
    setTimeout(() => {
      handlers.push('readyableA-end')
      cb()
    }, 5)
  })
  readyableB.handle((cb) => {
    handlers.push('readyableB-start')
    setTimeout(() => {
      handlers.push('readyableB-end')
      cb()
    }, 15)
  })
  pull(readyableA, pull.onEnd((err) => {
    t.error(err)
    t.deepEquals(handlers, ['readyableB-start', 'readyableA-start', 'readyableA-end'])
    pull(readyableB, pull.onEnd((err) => {
      t.error(err)
      t.deepEquals(handlers, ['readyableB-start', 'readyableA-start', 'readyableA-end', 'readyableB-end'])
      t.end()
    }))
  }))
  t.deepEquals(handlers, [])
  readyableA.run()
  t.deepEquals(handlers, ['readyableB-start', 'readyableA-start'])
})

test('readyable cb() as a one-off dependency, success.', (t) => {
  t.plan(6)
  const readyable = createReadyable()
  const readyableCb = cb(readyable)
  const handlers = []
  setTimeout(() => {
    t.deepEquals(handlers, [])
    readyableCb()
    t.deepEquals(handlers, ['readyable-start'])
  }, 15)
  readyable.handle((cb) => {
    handlers.push('readyable-start')
    setTimeout(() => {
      handlers.push('readyable-end')
      cb()
    }, 5)
  })
  pull(readyable, pull.onEnd((err) => {
    t.error(err)
    t.deepEquals(handlers, ['readyable-start', 'readyable-end'])
  }))
  t.deepEquals(handlers, [])
  readyable.run()
  t.deepEquals(handlers, [])
})

test('readyable cb() as a one-off dependency, error.', (t) => {
  t.plan(6)
  const readyable = createReadyable()
  const readyableCb = cb(readyable)
  const handlers = []
  setTimeout(() => {
    t.deepEquals(handlers, [])
    readyableCb(new Error())
    t.deepEquals(handlers, [])
  }, 15)
  readyable.handle((cb) => {
    handlers.push('readyable-start')
    setTimeout(() => {
      handlers.push('readyable-end')
      cb()
    }, 5)
  })
  pull(readyable, pull.onEnd((err) => {
    t.ok(err)
    t.deepEquals(handlers, [])
  }))
  t.deepEquals(handlers, [])
  readyable.run()
  t.deepEquals(handlers, [])
})

test('readyable isReady() indicates not-ready, ready.', (t) => {
  t.plan(5)
  const readyable = createReadyable()
  t.equal(readyable.isReady(), false)
  readyable.handle((cb) => {
    t.equal(readyable.isReady(), false)
    setTimeout(cb, 10)
  }).run()
  run(readyable, (err) => {
    t.error(err)
    t.equal(readyable.isReady(), true)
  })
  t.equal(readyable.isReady(), false)
})

test('readyable isReady() indicates not-ready, errored.', (t) => {
  t.plan(5)
  const readyable = createReadyable()
  t.equal(readyable.isReady(), false)
  readyable.handle((cb) => {
    t.equal(readyable.isReady(), false)
    setTimeout(() => cb(new Error()), 10)
  }).run()
  run(readyable, (err) => {
    t.ok(err)
    t.equal(readyable.isReady(), null)
  })
  t.equal(readyable.isReady(), false)
})
