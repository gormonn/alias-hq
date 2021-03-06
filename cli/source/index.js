require('colors')
const glob = require('glob')
const Fs = require('fs')
const Path = require('path')
const assert = require('assert').strict
const inquirer = require('inquirer')
const runner = require('jscodeshift/src/Runner')
const hq = require('../../src')
const { makeObjectBullets } = require('../common')
const { inspect } = require('../utils')
const { getLongestStringLength, makeHeader } = require('../utils/text')
const { getAliases, numAliases, saveSettings } = require('../utils/config')
const { getPathInfo, cleanPathsInfo } = require('../utils/paths')
const { makeChoices } = require('../utils/inquirer')
const { para } = require('../utils/text')
const { showConfig, checkPaths, makeItemsBullets, makePathsBullets } = require('../common')
const { TransformMode } = require('./paths')
const stats = require('./stats')

// ---------------------------------------------------------------------------------------------------------------------
// actions
// ---------------------------------------------------------------------------------------------------------------------

const actions = {
  getPaths () {
    // defaults
    let folders = hq.config.baseUrl
    if (hq.settings.folders.length) {
      folders = hq.settings.folders.map(folder => {
        return folder.includes(' ')
          ? `'${folder}'`
          : folder
      }).join(' ')
    }

    // question
    return inquirer
      .prompt({
        type: 'input',
        name: 'folders',
        message: 'Folders:',
        default: folders
      })
      .then(answer => {
        // variables
        const folders = answer.folders.trim()
        const { infos, valid, input } = checkPaths(folders)

        // check paths
        if (!valid) {
          return actions.getPaths()
        }

        // continue
        answers.paths = cleanPathsInfo(infos)
      })
  },

  checkForVue () {
    // skip
    if (hq.settings.extensions) {
      return
    }

    // variables
    const paths = answers.paths.map(info => info.relPath).join('|')
    const search = `+(${paths})/**/*.vue`
    const options = {
      cwd: hq.config.rootUrl
    }

    // glob!
    return new Promise(function (resolve, reject) {
      glob(search, options, function (er, files) {
        if (files.length) {
          csOptions.extensions += ', vue'
        }
        resolve()
      })
    })
  },

  getModules () {
    // choices
    const aliases = getAliases()
    const maxLength = getLongestStringLength(aliases.names)
    const choices = aliases.names
      .map(key => {
        const item = aliases.forName(key)
        const { name: alias, relPath } = item
        const label = alias + ' '.repeat(maxLength - alias.length)
        const name = label + '  ' + `- ${relPath}`.grey
        return {
          name,
          short: alias,
          value: alias,
        }
      })

    const defaults = hq.settings.modules

    // question
    return inquirer
      .prompt({
        type: 'checkbox',
        name: 'modules',
        message: `Module roots:`,
        choices: choices,
        default: defaults,
        pageSize: 20,
      })
      .then(answer => {
        answers.modules = answer.modules
          .map(answer => answer.match(/\S+/).toString())
          .map(name => aliases.forName(name))
      })
  },

  confirmChoices () {
    if (answers.mode === TransformMode.ALIASED) {
      console.log()
    }
    console.log(`  Paths:\n` + makePathsBullets(answers.paths))
    if (answers.mode === TransformMode.ALIASED && answers.modules.length) {
      console.log(`  Module roots:\n` + makeItemsBullets(answers.modules, 'name', 'relPath'))
    }
    console.log(`  Options:\n` + makeObjectBullets({
      extensions: csOptions.extensions,
      parser: csOptions.parser || 'default',
    }))
    console.log()
  },

  saveSettings () {
    const oldSettings = {
      folders: hq.settings.folders,
      modules: hq.settings.modules,
    }
    const newSettings = {
      folders: answers.paths.map(path => path.relPath),
      modules: answers.modules.map(alias => alias.name),
    }
    // inspect({ oldSettings, newSettings })

    try {
      assert.deepEqual(oldSettings, newSettings)
    } catch (err) {
      return inquirer
        .prompt({
          type: 'confirm',
          name: 'save',
          message: 'Save updated choices?',
        })
        .then(answer => {
          if (answer.save) {
            saveSettings(newSettings)
            Object.assign(hq.settings, newSettings)
          }
          console.log()
        })
    }
  },

  process (dry = true) {
    // aliases
    const aliases = getAliases()

    // paths
    const paths = answers.paths
      .filter(config => config.valid)
      .map(config => config.absPath)

    // modules
    const modules = answers.modules
      .map(module => module.name)

    // options
    const options = {
      ...csOptions,
      mode: answers.mode,
      dry,
    }

    // debug
    // inspect({ paths, modules, extensions })
    // inspect({ options: csOptions, paths, aliases })

    // track updated
    stats.reset()

    // do it
    if (aliases.names.length) {
      console.log()
      const file = __dirname + '/transformer.js'
      return runner
        .run(file, paths, { ...options, aliases, modules })
        .then(results => stats.present(results))
    }
  }
}

actions.getOptions = function () {
  if (answers.mode === TransformMode.ALIASED) {
    return Promise.resolve()
      .then(actions.getPaths)
      .then(actions.checkForVue)
      .then(actions.getModules)
      .then(actions.confirmChoices)
      .then(actions.saveSettings)
  }

  else {
    return Promise.resolve()
      .then(actions.getPaths)
      .then(actions.checkForVue)
      .then(actions.confirmChoices)
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// setup
// ---------------------------------------------------------------------------------------------------------------------

function getCsOptions () {
  // language
  const language = Path.basename(hq.settings.configFile).slice(0, 2)

  // parser
  const parser = Fs.existsSync('.flowconfig')
    ? 'flow'
    : language === 'ts'
      ? 'tsx'
      : undefined

  // extensions
  const defaultExtensions = language === 'ts'
    ? 'ts js tsx jsx'
    : 'js jsx'
  const extensions = (hq.settings.extensions || defaultExtensions)
    .match(/\w+/g)
    .join(', ')

  // TODO add options to
  // - ignore folders (node, vendor, etc)
  // - force conversion to aliases ?

  /**
   * @typedef {object} Options
   */
  return {
    dry: true,
    silent: true,
    verbose: 0,
    runInBand: true,
    ignorePattern: 'node_modules/*',
    extensions,
    parser,
  }
}

/**
 * @returns {SourceAnswers}
 */
function getAnswers () {
  /**
   * @typedef   {object}      SourceAnswers
   * @property  {PathInfo[]}  paths
   * @property  {Alias[]}     modules
   * @property  {string}      mode
   */
  return {
    paths: [],
    modules: [],
    mode: TransformMode.ALIASED,
  }
}

/**
 * @type {SourceAnswers}
 */
let answers

const previous = {}

/**
 * Options for JSCodeShift
 *
 * Need to generate these when loading, and before processing:
 *
 * - in case anything has changed
 * - because they are needed in the "confirm" step
 */
let csOptions

// main run function
function run () {
  const choices = {
    config: 'Show config',
    showOptions: 'Show options',
    chooseOptions: 'Configure options',
    preview: 'Preview updates',
    proceed: 'Update files ' + '- no further confirmation!'.red,
    back: 'Back',
  }

  // no paths - limit choices
  const hasPaths = hq.settings.folders.length || answers.paths.length
  if (!hasPaths) {
    delete choices.showOptions
    delete choices.preview
    delete choices.proceed
  }

  let header = 'Source Code Menu'
  if (answers.mode === TransformMode.RELATIVE) {
    header += ' (Reverting files)'.red
  }
  makeHeader(header)
  return inquirer
    .prompt({
      type: 'list',
      name: 'action',
      message: `What do you want to do?:`,
      choices: makeChoices(choices),
      default: previous.action
    })
    .then(answer => {
      const action = answer.action
      if (action !== choices.back) {
        previous.action = answer.action
      }

      switch (action) {
        case choices.config:
          return showConfig()

        case choices.showOptions:
          return actions.confirmChoices()

        case choices.chooseOptions:
          return actions.getOptions()

        case choices.preview:
          return actions.process(true)

        case choices.proceed:
          return actions.process(false)

        case choices.back:
          return 'back'
      }
    })
    .then(result => {
      return result === 'back'
        ? null
        : run()
    })
}

function setup (aliased = true) {
  // setup
  hq.load()
  answers = getAnswers()
  csOptions = getCsOptions()

  // aliases
  const aliases = getAliases()
  if (aliases.names.length === 0) {
    para('No aliases configured: skipping source code update!'.red)
    return
  }

  // get settings
  answers.paths = hq.settings.folders
    .map(folder => getPathInfo(hq.config.rootUrl, folder))
  answers.modules = hq.settings.modules
    .map(name => aliases.forName(name))

  // previous
  previous.action = "Show config"

  // actions
  answers.mode = aliased
    ? TransformMode.ALIASED
    : TransformMode.RELATIVE
}

// main function
function updateSource (aliased = true) {
  setup(aliased)
  return run()
}

module.exports = {
  updateSource
}
