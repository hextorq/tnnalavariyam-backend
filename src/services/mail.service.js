const nodemailer = require('nodemailer')
const { isSmtpConfigured, smtpConfig } = require('../config/smtp')

function createTransporter() {
  if (!isSmtpConfigured()) {
    throw new Error('SMTP credentials are not configured')
  }
  return nodemailer.createTransport({
    host: smtpConfig.host,
    port: smtpConfig.port,
    secure: smtpConfig.secure,
    auth: smtpConfig.auth,
  })
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

async function sendPasswordResetMail({ email, name, resetUrl }) {
  const transporter = createTransporter()
  const displayName = name || 'User'
  const safeName = escapeHtml(displayName)
  const safeResetUrl = escapeHtml(resetUrl)
  await transporter.sendMail({
    from: `"${smtpConfig.fromName}" <${smtpConfig.auth.user}>`,
    to: email,
    subject: 'TN Nalavariyam Password Reset',
    text: [
      `Hello ${displayName},`,
      '',
      'We received a request to reset your TN Nalavariyam account password.',
      `Open this link to set a new password: ${resetUrl}`,
      '',
      'This link will expire in 30 minutes. If you did not request this, ignore this email.',
    ].join('\n'),
    html: `
      <div style="font-family:Arial,sans-serif;line-height:1.6;color:#0f172a">
        <h2>TN Nalavariyam Password Reset</h2>
        <p>Hello <strong>${safeName}</strong>,</p>
        <p>We received a request to reset your TN Nalavariyam account password.</p>
        <p><a href="${safeResetUrl}" style="display:inline-block;background:#007cba;color:#fff;padding:12px 18px;border-radius:8px;text-decoration:none;font-weight:700">Reset Password</a></p>
        <p>This link will expire in 30 minutes.</p>
        <p>If you did not request this, ignore this email.</p>
      </div>
    `,
  })
}

module.exports = { sendPasswordResetMail }
