const required = ['DATABASE_URL', 'JWT_SECRET']

for (const key of required) {
  if (!process.env[key]) {
    console.warn(`[env] Missing ${key}. Configure it in .env before using database or auth features.`)
  }
}

module.exports = {
  port: Number(process.env.PORT || 4000),
  nodeEnv: process.env.NODE_ENV || 'development',
  frontendOrigin: process.env.FRONTEND_ORIGIN || 'http://localhost:5173',
  jwtSecret: process.env.JWT_SECRET || 'dev-only-secret',
  uploadDir: process.env.UPLOAD_DIR || 'uploads',
}
