'use strict'

const cache = require('../lib/cache')
const mockTar = require('./util/mock-tarball')
const npmlog = require('npmlog')
const ssri = require('ssri')
const test = require('tap').test
const testDir = require('./util/test-dir')
const tnock = require('./util/tnock')

const CACHE = testDir(__filename)

const prefetch = require('../prefetch')

npmlog.level = process.env.LOGLEVEL || 'silent'
const BASE = {
  name: 'foo',
  version: '1.0.0',
  _hasShrinkwrap: false,
  _resolved: 'https://foo.bar/x.tgz',
  dist: {
    tarball: 'https://foo.bar/x.tgz'
  }
}

const OPTS = {
  registry: 'https://mock.reg',
  log: npmlog,
  cache: CACHE
}

const META = {
  name: 'foo',
  'dist-tags': { latest: '1.2.3', lts: '1.0.0' },
  versions: {
    '1.0.0': BASE
  }
}

const PKG = {
  'package.json': JSON.stringify({
    name: 'foo',
    version: '1.2.3'
  }),
  'index.js': 'console.log("hello world!")'
}

test('setup integrity', t => {
  return mockTar(PKG).then(tarData => {
    BASE.dist.integrity = BASE._integrity = ssri.fromData(tarData, {algorithms: ['sha1']}).toString()
    return 'lol ok'
  })
})

test('prefetch by manifest if no integrity hash', t => {
  cache.clearMemoized()
  return mockTar(PKG).then(tarData => {
    const srv = tnock(t, OPTS.registry)
    srv.get('/foo').reply(200, META, {
      'Age': '200',
      'Date': new Date().toUTCString(),
      'cache-control': 'max-age=300'
    })
    tnock(t, 'https://foo.bar').get('/x.tgz').reply(200, tarData, {
      'cache-control': 'immutable'
    })

    return prefetch('foo@1.0.0', OPTS).then(info => {
      t.equal(srv.isDone(), true)
      t.deepEqual(info, {
        byDigest: false,
        integrity: null, // not previously cached, so no integrity
        manifest: BASE,
        spec: 'foo@1.0.0'
      }, 'fresh fetch info returned')
      return cache.ls(CACHE)
    }).then(result => {
      t.equal(Object.keys(result).length, 2)
    })
  })
})

test('skip if no cache is provided', t => {
  cache.clearMemoized()
  return prefetch('foo@1.0.0', {}).then(info => {
    t.deepEqual(info, {
      spec: 'foo@1.0.0'
    }, 'no cache -> only spec returned')
    return cache.ls(CACHE)
  }).then(result => {
    t.equal(Object.keys(result).length, 0)
  })
})

test('use cache content if found', t => {
  cache.clearMemoized()
  tnock(t, OPTS.registry).get('/foo').reply(200, META)
  return mockTar(PKG).then(tarData => {
    tnock(t, 'https://foo.bar').get('/x.tgz').reply(200, tarData)
    return prefetch('foo@1.0.0', OPTS)
  }).then(() => {
    cache.clearMemoized()
    return prefetch('foo@1.0.0', OPTS)
  }).then(info => {
    t.deepEqual(info, {
      manifest: BASE,
      spec: 'foo@1.0.0',
      integrity: BASE._integrity, // if coming from cache, get integrity
      byDigest: false
    }, '')
    return cache.ls(CACHE)
  }).then(result => {
    t.equal(Object.keys(result).length, 2)
  })
})

test('prefetch by manifest if digest provided but no cache content found', t => {
  cache.clearMemoized()
  return mockTar(PKG).then(tarData => {
    const srv = tnock(t, OPTS.registry)
    srv.get('/foo').reply(200, META)

    tnock(t, 'https://foo.bar').get('/x.tgz').reply(200, tarData)
    const integrity = ssri.fromData(tarData)
    OPTS.digest = integrity

    return prefetch('foo@1.0.0', OPTS).then(info => {
      t.deepEqual(info, {
        byDigest: false,
        integrity: null, // not already cached, so no integrity
        manifest: BASE,
        spec: 'foo@1.0.0'
      }, 'fresh fetch info returned')
      t.equal(srv.isDone(), true)
      return cache.ls(CACHE)
    }).then(result => {
      t.equal(Object.keys(result).length, 2)
    })
  })
})