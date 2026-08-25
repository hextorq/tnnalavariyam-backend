const defaultSmtpConfig = {
  host: 'smtp.gmail.com',
  port: 465,
  secure: true,
  auth: {
    user: 'CHANGE_ME_GMAIL_ADDRESS',
    pass: 'CHANGE_ME_GMAIL_APP_PASSWORD',
  },
  fromName: 'TN Nalavariyam',
}

function loadLocalSmtpConfig() {
  try {
    return require('./smtp.local')
  } catch (error) {
    if (error.code === 'MODULE_NOT_FOUND') return {}
    throw error
  }
}

const localSmtpConfig = loadLocalSmtpConfig()
const smtpConfig = {
  ...defaultSmtpConfig,
  ...localSmtpConfig,
  auth: {
    ...defaultSmtpConfig.auth,
    ...(localSmtpConfig.auth || {}),
  },
}

function isSmtpConfigured() {
  return Boolean(
    smtpConfig.auth.user &&
      smtpConfig.auth.pass &&
      !smtpConfig.auth.user.startsWith('CHANGE_ME_') &&
      !smtpConfig.auth.pass.startsWith('CHANGE_ME_')
  )
}

module.exports = { isSmtpConfigured, smtpConfig }
