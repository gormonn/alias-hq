const inquirer = require('inquirer')
const fetch = require('node-fetch')

// ---------------------------------------------------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------------------------------------------------

const docsUrl = 'https://github.com/davestewart/alias-hq/blob/master/docs/'

const urls = {
  raw: 'https://raw.githubusercontent.com/davestewart/alias-hq/master/docs/integrations.md',
  markdowm: docsUrl + 'integrations.md',
}

function openIntegration (hash = '') {
  require('opn')(urls.markdowm + '#' + hash)
}

function openDocs (hash = '') {
  require('opn')(docsUrl + 'cli.md')
}

// ---------------------------------------------------------------------------------------------------------------------
// actions
// ---------------------------------------------------------------------------------------------------------------------

const actions = {
  getNames () {
    return fetch(urls.raw)
      .then(res => res.text())
      .then(text => {
        const matches = text.match(/\n## (.+)\n/g)
        if (matches) {
          answers.names = matches
            .map(text => text.replace(/\n/g, '').substr(3))
        }
      })
  },

  getChoices: () => {
    // no integrations
    if (answers.names.length === 0) {
      return openIntegration ()
    }

    // choices
    const choices = answers.names.map(name => {
      return {
        name: '- ' + name,
        value: name,
        short: name,
      }
    })

    // prompt
    return inquirer
      .prompt({
        type: 'list',
        name: 'name',
        pageSize: 100,
        message: 'Integration:',
        default: previous.name,
        choices,
      })
      .then(answer => {
        previous.name = answer.name
        const hash = answer.name
          .toLowerCase()
          .replace(/\W+/g, '-')
        return openIntegration(hash)
      })
  },
}

// ---------------------------------------------------------------------------------------------------------------------
// setup
// ---------------------------------------------------------------------------------------------------------------------

const previous = {}
const answers = {
  names: [],
}

function setupIntegration () {
  return Promise.resolve()
    .then(actions.getNames)
    .then(actions.getChoices)
}

module.exports = {
  setupIntegration,
  openIntegration,
  openDocs,
}
