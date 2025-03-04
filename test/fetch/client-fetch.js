/* globals AbortController */

'use strict'

const { test } = require('tap')
const { createServer } = require('http')
const { ReadableStream } = require('stream/web')
const { Blob } = require('buffer')
const { fetch, Response, Request, FormData, File } = require('../..')
const { Client, setGlobalDispatcher, Agent } = require('../..')
const nodeFetch = require('../../index-fetch')
const { once } = require('events')
const { gzipSync } = require('zlib')

setGlobalDispatcher(new Agent({
  keepAliveTimeout: 1,
  keepAliveMaxTimeout: 1
}))

test('function signature', (t) => {
  t.plan(2)

  t.equal(fetch.name, 'fetch')
  t.equal(fetch.length, 1)
})

test('args validation', async (t) => {
  t.plan(2)

  await t.rejects(fetch(), TypeError)
  await t.rejects(fetch('ftp://unsupported'), TypeError)
})

test('request json', (t) => {
  t.plan(1)

  const obj = { asd: true }
  const server = createServer((req, res) => {
    res.end(JSON.stringify(obj))
  })
  t.teardown(server.close.bind(server))

  server.listen(0, async () => {
    const body = await fetch(`http://localhost:${server.address().port}`)
    t.strictSame(obj, await body.json())
  })
})

test('request text', (t) => {
  t.plan(1)

  const obj = { asd: true }
  const server = createServer((req, res) => {
    res.end(JSON.stringify(obj))
  })
  t.teardown(server.close.bind(server))

  server.listen(0, async () => {
    const body = await fetch(`http://localhost:${server.address().port}`)
    t.strictSame(JSON.stringify(obj), await body.text())
  })
})

test('request arrayBuffer', (t) => {
  t.plan(1)

  const obj = { asd: true }
  const server = createServer((req, res) => {
    res.end(JSON.stringify(obj))
  })
  t.teardown(server.close.bind(server))

  server.listen(0, async () => {
    const body = await fetch(`http://localhost:${server.address().port}`)
    t.strictSame(Buffer.from(JSON.stringify(obj)), Buffer.from(await body.arrayBuffer()))
  })
})

test('should set type of blob object to the value of the `Content-Type` header from response', (t) => {
  t.plan(1)

  const obj = { asd: true }
  const server = createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify(obj))
  })
  t.teardown(server.close.bind(server))

  server.listen(0, async () => {
    const response = await fetch(`http://localhost:${server.address().port}`)
    t.equal('application/json', (await response.blob()).type)
  })
})

test('pre aborted with readable request body', (t) => {
  t.plan(2)

  const server = createServer((req, res) => {
  })
  t.teardown(server.close.bind(server))

  server.listen(0, async () => {
    const ac = new AbortController()
    ac.abort()
    await fetch(`http://localhost:${server.address().port}`, {
      signal: ac.signal,
      method: 'POST',
      body: new ReadableStream({
        async cancel (reason) {
          t.equal(reason.name, 'AbortError')
        }
      })
    }).catch(err => {
      t.equal(err.name, 'AbortError')
    })
  })
})

test('pre aborted with closed readable request body', (t) => {
  t.plan(2)

  const server = createServer((req, res) => {
  })
  t.teardown(server.close.bind(server))

  server.listen(0, async () => {
    const ac = new AbortController()
    ac.abort()
    const body = new ReadableStream({
      async start (c) {
        t.pass()
        c.close()
      },
      async cancel (reason) {
        t.fail()
      }
    })
    queueMicrotask(() => {
      fetch(`http://localhost:${server.address().port}`, {
        signal: ac.signal,
        method: 'POST',
        body
      }).catch(err => {
        t.equal(err.name, 'AbortError')
      })
    })
  })
})

test('unsupported formData 1', (t) => {
  t.plan(1)

  const server = createServer((req, res) => {
    res.setHeader('content-type', 'asdasdsad')
    res.end()
  })
  t.teardown(server.close.bind(server))

  server.listen(0, () => {
    fetch(`http://localhost:${server.address().port}`)
      .then(res => res.formData())
      .catch(err => {
        t.equal(err.name, 'TypeError')
      })
  })
})

test('unsupported formData 2', (t) => {
  t.plan(1)

  const server = createServer((req, res) => {
    res.setHeader('content-type', 'multipart/form-data')
    res.end()
  })
  t.teardown(server.close.bind(server))

  server.listen(0, () => {
    fetch(`http://localhost:${server.address().port}`)
      .then(res => res.formData())
      .catch(err => {
        t.equal(err.name, 'NotSupportedError')
      })
  })
})

test('urlencoded formData', (t) => {
  t.plan(2)

  const server = createServer((req, res) => {
    res.setHeader('content-type', 'application/x-www-form-urlencoded')
    res.end('field1=value1&field2=value2')
  })
  t.teardown(server.close.bind(server))

  server.listen(0, () => {
    fetch(`http://localhost:${server.address().port}`)
      .then(res => res.formData())
      .then(formData => {
        t.equal(formData.get('field1'), 'value1')
        t.equal(formData.get('field2'), 'value2')
      })
  })
})

test('locked blob body', (t) => {
  t.plan(1)

  const server = createServer((req, res) => {
    res.end()
  })
  t.teardown(server.close.bind(server))

  server.listen(0, async () => {
    const res = await fetch(`http://localhost:${server.address().port}`)
    const reader = res.body.getReader()
    res.blob().catch(err => {
      t.equal(err.message, 'locked')
      reader.cancel()
    })
  })
})

test('disturbed blob body', (t) => {
  t.plan(2)

  const server = createServer((req, res) => {
    res.end()
  })
  t.teardown(server.close.bind(server))

  server.listen(0, async () => {
    const res = await fetch(`http://localhost:${server.address().port}`)
    res.blob().then(() => {
      t.pass(2)
    })
    res.blob().catch(err => {
      t.equal(err.message, 'disturbed')
    })
  })
})

test('redirect with body', (t) => {
  t.plan(3)

  let count = 0
  const server = createServer(async (req, res) => {
    let body = ''
    for await (const chunk of req) {
      body += chunk
    }
    t.equal(body, 'asd')
    if (count++ === 0) {
      res.setHeader('location', 'asd')
      res.statusCode = 302
      res.end()
    } else {
      res.end(String(count))
    }
  })
  t.teardown(server.close.bind(server))

  server.listen(0, async () => {
    const res = await fetch(`http://localhost:${server.address().port}`, {
      method: 'PUT',
      body: 'asd'
    })
    t.equal(await res.text(), '2')
  })
})

test('fail to extract locked body', (t) => {
  t.plan(1)

  const stream = new ReadableStream({})
  const reader = stream.getReader()
  try {
    // eslint-disable-next-line
    new Response(stream)
  } catch (err) {
    t.equal(err.name, 'TypeError')
  }
  reader.cancel()
})

test('fail to extract locked body', (t) => {
  t.plan(1)

  const stream = new ReadableStream({})
  const reader = stream.getReader()
  try {
    // eslint-disable-next-line
    new Request('http://asd', {
      method: 'PUT',
      body: stream,
      keepalive: true
    })
  } catch (err) {
    t.equal(err.message, 'keepalive')
  }
  reader.cancel()
})

test('post FormData with Blob', (t) => {
  t.plan(1)

  const body = new FormData()
  body.append('field1', new Blob(['asd1']))

  const server = createServer((req, res) => {
    req.pipe(res)
  })
  t.teardown(server.close.bind(server))

  server.listen(0, async () => {
    const res = await fetch(`http://localhost:${server.address().port}`, {
      method: 'PUT',
      body
    })
    t.ok(/asd1/.test(await res.text()))
  })
})

test('post FormData with File', (t) => {
  t.plan(2)

  const body = new FormData()
  body.append('field1', new File(['asd1'], 'filename123'))

  const server = createServer((req, res) => {
    req.pipe(res)
  })
  t.teardown(server.close.bind(server))

  server.listen(0, async () => {
    const res = await fetch(`http://localhost:${server.address().port}`, {
      method: 'PUT',
      body
    })
    const result = await res.text()
    t.ok(/asd1/.test(result))
    t.ok(/filename123/.test(result))
  })
})

test('invalid url', async (t) => {
  t.plan(1)

  try {
    await fetch('http://invalid')
  } catch (e) {
    t.match(e.cause.message, 'invalid')
  }
})

test('custom agent', (t) => {
  t.plan(2)

  const obj = { asd: true }
  const server = createServer((req, res) => {
    res.end(JSON.stringify(obj))
  })
  t.teardown(server.close.bind(server))

  server.listen(0, async () => {
    const dispatcher = new Client('http://localhost:' + server.address().port, {
      keepAliveTimeout: 1,
      keepAliveMaxTimeout: 1
    })
    const oldDispatch = dispatcher.dispatch
    dispatcher.dispatch = function (options, handler) {
      t.pass('custom dispatcher')
      return oldDispatch.call(this, options, handler)
    }
    t.teardown(server.close.bind(server))
    const body = await fetch(`http://localhost:${server.address().port}`, {
      dispatcher
    })
    t.strictSame(obj, await body.json())
  })
})

test('custom agent node fetch', (t) => {
  t.plan(2)

  const obj = { asd: true }
  const server = createServer((req, res) => {
    res.end(JSON.stringify(obj))
  })
  t.teardown(server.close.bind(server))

  server.listen(0, async () => {
    const dispatcher = new Client('http://localhost:' + server.address().port, {
      keepAliveTimeout: 1,
      keepAliveMaxTimeout: 1
    })
    const oldDispatch = dispatcher.dispatch
    dispatcher.dispatch = function (options, handler) {
      t.pass('custom dispatcher')
      return oldDispatch.call(this, options, handler)
    }
    t.teardown(server.close.bind(server))
    const body = await nodeFetch.fetch(`http://localhost:${server.address().port}`, {
      dispatcher
    })
    t.strictSame(obj, await body.json())
  })
})

test('error on redirect', async (t) => {
  const server = createServer((req, res) => {
    res.statusCode = 302
    res.end()
  })
  t.teardown(server.close.bind(server))

  server.listen(0, async () => {
    const errorCause = await fetch(`http://localhost:${server.address().port}`, {
      redirect: 'error'
    }).catch((e) => e.cause)

    t.equal(errorCause.message, 'unexpected redirect')
  })
})

// https://github.com/nodejs/undici/issues/1527
test('fetching with Request object - issue #1527', async (t) => {
  const server = createServer((req, res) => {
    t.pass()
    res.end()
  }).listen(0)

  t.teardown(server.close.bind(server))
  await once(server, 'listening')

  const body = JSON.stringify({ foo: 'bar' })
  const request = new Request(`http://localhost:${server.address().port}`, {
    method: 'POST',
    body
  })

  await t.resolves(fetch(request))
  t.end()
})

test('do not decode redirect body', (t) => {
  t.plan(3)

  const obj = { asd: true }
  const server = createServer((req, res) => {
    if (req.url === '/resource') {
      t.pass('we redirect')
      res.statusCode = 301
      res.setHeader('location', '/resource/')
      // Some dumb http servers set the content-encoding gzip
      // even if there is no response
      res.setHeader('content-encoding', 'gzip')
      res.end()
      return
    }
    t.pass('actual response')
    res.setHeader('content-encoding', 'gzip')
    res.end(gzipSync(JSON.stringify(obj)))
  })
  t.teardown(server.close.bind(server))

  server.listen(0, async () => {
    const body = await fetch(`http://localhost:${server.address().port}/resource`)
    t.strictSame(JSON.stringify(obj), await body.text())
  })
})

test('Receiving non-Latin1 headers', async (t) => {
  const ContentDisposition = [
    'inline; filename=rock&roll.png',
    'inline; filename="rock\'n\'roll.png"',
    'inline; filename="image â\x80\x94 copy (1).png"; filename*=UTF-8\'\'image%20%E2%80%94%20copy%20(1).png',
    'inline; filename="_å\x9C\x96ç\x89\x87_ð\x9F\x96¼_image_.png"; filename*=UTF-8\'\'_%E5%9C%96%E7%89%87_%F0%9F%96%BC_image_.png',
    'inline; filename="100 % loading&perf.png"; filename*=UTF-8\'\'100%20%25%20loading%26perf.png'
  ]

  const server = createServer((req, res) => {
    for (let i = 0; i < ContentDisposition.length; i++) {
      res.setHeader(`Content-Disposition-${i + 1}`, ContentDisposition[i])
    }

    res.end()
  }).listen(0)

  t.teardown(server.close.bind(server))
  await once(server, 'listening')

  const url = `http://localhost:${server.address().port}`
  const response = await fetch(url, { method: 'HEAD' })
  const cdHeaders = [...response.headers]
    .filter(([k]) => k.startsWith('content-disposition'))
    .map(([, v]) => v)
  const lengths = cdHeaders.map(h => h.length)

  t.same(cdHeaders, ContentDisposition)
  t.same(lengths, [30, 34, 94, 104, 90])
  t.end()
})
