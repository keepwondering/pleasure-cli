module.exports = function () {
  const Koa = require('koa')
  const { pleasureApi } = require('pleasure-api')
  const { getConfig, findRoot, packageJson } = require('pleasure-utils')
  const koaBody = require('koa-body')
  const { Nuxt, Builder } = require('nuxt')
  const fs = require('fs')
  const { get } = require('lodash')
  const chokidar = require('chokidar')
  const path = require('path')

  let runningConnection
  let runningBuilder
  let runningPort
  let runningWatcher

  function watcher () {
    if (runningWatcher) {
      runningWatcher.close()
      runningWatcher = null
    }

    const nuxtConfigFile = findRoot('./nuxt.config.js')
    const pleasureConfigFile = findRoot('./pleasure.config.js')

    // delete cache
    if (fs.existsAsync(nuxtConfigFile)) {
      delete require.cache[require.resolve(nuxtConfigFile)]
    }

    delete require.cache[require.resolve(pleasureConfigFile)]

    const { watchForRestart = [] } = getConfig('ui')
    const cacheClean = [nuxtConfigFile, pleasureConfigFile].concat(watchForRestart)
    runningWatcher = chokidar.watch(cacheClean, { ignored: /(^|[\/\\])\../, ignoreInitial: true })

    runningWatcher.on('all', (event, path) => {
      // todo: trigger restart
      restart()
        .catch(err => {
          console.log(`restarting failed with error`, err.message)
        })
    })
  }

  async function start (port) {
    if (runningConnection) {
      console.error(`An app is already running`)
      return
    }

    const nuxtConfigFile = findRoot('./nuxt.config.js')

    // delete cache
    delete require.cache[require.resolve(nuxtConfigFile)]
    delete require.cache[require.resolve(findRoot('./pleasure.config.js'))]

    const apiConfig = getConfig('api')
    console.log({ apiConfig })
    port = port || apiConfig.port

    let withNuxt = false
    let nuxt

    // enable nuxt
    if (fs.existsSync(nuxtConfigFile)) {
      withNuxt = true
      let nuxtConfig = require(nuxtConfigFile)

      const currentModules = nuxtConfig.modules = get(nuxtConfig, 'modules', [])
      const currentModulesDir = nuxtConfig.modulesDir = get(nuxtConfig, 'modulesDir', [])
      //console.log({ currentModulesDir })
      currentModulesDir.push(...require.main.paths.filter(p => {
        return currentModulesDir.indexOf(p) < 0
      }))
      //console.log({ currentModulesDir })
      const ui = ['pleasure-ui-nuxt', {
        root: findRoot(),
        name: packageJson().name,
        config: getConfig('ui'),
        pleasureRoot: path.join(__dirname, '..')
      }]
      currentModules.push(ui)

      //console.log({ nuxtConfig })
      nuxt = new Nuxt(nuxtConfig)

      // Build in development
      if (nuxtConfig.dev) {
        const builder = new Builder(nuxt)
        runningBuilder = builder
        await builder.build()
      }
    }

    const app = new Koa()

    app.use(koaBody())

    const server = runningConnection = app.listen(port)
    runningPort = port

    app.use(pleasureApi({
      prefix: apiConfig.prefix,
      plugins: apiConfig.plugins
    }, server))

    // nuxt
    if (withNuxt) {
      app.use(ctx => {
        ctx.status = 200
        ctx.respond = false // Mark request as handled for Koa
        ctx.req.ctx = ctx // This might be useful later on, e.g. in nuxtServerInit or with nuxt-stash
        nuxt.render(ctx.req, ctx.res)
      })
    }

    process.send && process.send('pleasure-ready')

    watcher()

    return port
  }

  async function restart () {
    if (!runningPort || !runningConnection) {
      console.error(`No app instance running`)
      return
    }

    if (runningBuilder) {
      await runningBuilder.close()
      runningBuilder = null
    }

    runningConnection.close()
    runningConnection = null
    return start(runningPort)
  }

  return {
    start,
    watcher,
    restart
  }
}