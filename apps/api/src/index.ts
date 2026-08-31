import app from './app'
import { ensureUploadDirs } from './lib/images'
import { prisma } from './prisma/client'

const port = process.env.API_PORT ?? 3001

// Last-resort guards: log and keep serving rather than dying on a stray rejection.
process.on('unhandledRejection', reason => {
  console.error('[unhandledRejection]', reason)
})
process.on('uncaughtException', err => {
  console.error('[uncaughtException]', err)
})

ensureUploadDirs()
  .then(() => {
    const server = app.listen(port, () => {
      console.log(`API running on port ${port}`)
    })

    /**
     * `docker stop` sends SIGTERM, and Node's default is to exit immediately —
     * killing whatever request is mid-flight. During a rolling deploy that could
     * be a DSIR being saved, so the write is lost with no error the user can
     * act on. Stop accepting new connections, let the in-flight ones finish,
     * then close the database pool.
     *
     * This is also why the API needs no Traefik retry middleware: a retry can
     * re-send a request the server already processed, which for a save means
     * writing it twice.
     */
    let shuttingDown = false
    const shutdown = (signal: string) => {
      if (shuttingDown) return
      shuttingDown = true
      console.log(`[${signal}] draining in-flight requests...`)

      server.close(async () => {
        try {
          await prisma.$disconnect()
        } catch (err) {
          console.error('[shutdown] could not close the database pool', err)
        }
        console.log('[shutdown] done')
        process.exit(0)
      })

      // A stuck connection must not hold the deploy open forever. rollout.sh
      // stops containers with a 15s timeout, so give up before Docker does and
      // exit on our own terms.
      setTimeout(() => {
        console.error('[shutdown] forced exit — a connection did not close in time')
        process.exit(1)
      }, 10_000).unref()
    }

    process.on('SIGTERM', () => shutdown('SIGTERM'))
    process.on('SIGINT', () => shutdown('SIGINT'))
  })
  .catch(err => {
    console.error('[fatal] could not prepare upload directory', err)
    process.exit(1)
  })
