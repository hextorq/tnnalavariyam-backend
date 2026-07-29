const { applicationForms } = require('../services/formCatalog')

async function listForms(req, res) {
  res.json({ forms: applicationForms })
}

async function listSubmissions(req, res) {
  res.json({ submissions: [] })
}

async function createSubmission(req, res) {
  res.status(201).json({
    message: 'Application submission endpoint scaffolded.',
    payload: req.body,
  })
}

module.exports = { listForms, listSubmissions, createSubmission }
